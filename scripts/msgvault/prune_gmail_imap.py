#!/usr/bin/env python3
"""Prune old messages from a Gmail mailbox over IMAP in UID batches."""

from __future__ import annotations

import argparse
import datetime as dt
import imaplib
import os
import re
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete messages older than N days from a Gmail IMAP mailbox."
    )
    parser.add_argument("--email", required=True, help="Gmail account email")
    parser.add_argument(
        "--host", default="imap.gmail.com", help="IMAP host (default: imap.gmail.com)"
    )
    parser.add_argument(
        "--mailbox",
        default="[Gmail]/All Mail",
        help='IMAP mailbox name (default: "[Gmail]/All Mail")',
    )
    parser.add_argument(
        "--older-than-days",
        type=int,
        default=30,
        help="Delete mail older than this many days (default: 30)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="UID batch size per delete+expunge step (default: 1000)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print candidate count without deleting",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="IMAP socket timeout in seconds (default: 60)",
    )
    return parser.parse_args()


def _parse_list_line(line: bytes) -> tuple[set[str], str] | None:
    decoded = line.decode("utf-8", errors="replace")
    match = re.match(r'^\((?P<flags>[^)]*)\)\s+"[^"]*"\s+(?P<name>.+)$', decoded)
    if not match:
        return None
    flags = {flag for flag in match.group("flags").split() if flag}
    raw_name = match.group("name").strip()
    if raw_name.startswith('"') and raw_name.endswith('"') and len(raw_name) >= 2:
        name = raw_name[1:-1].replace(r"\"", '"')
    else:
        name = raw_name
    return flags, name


def _list_mailboxes(client: imaplib.IMAP4_SSL) -> list[tuple[set[str], str]]:
    typ, data = client.list()
    if typ != "OK" or not data:
        return []

    parsed = [_parse_list_line(line) for line in data if isinstance(line, (bytes, bytearray))]
    parsed = [item for item in parsed if item is not None]
    return parsed


def resolve_mailbox(client: imaplib.IMAP4_SSL, requested: str) -> str:
    parsed = _list_mailboxes(client)
    if not parsed:
        return requested

    for _flags, name in parsed:
        if name == requested:
            return name

    requested_fold = requested.casefold()
    for _flags, name in parsed:
        if name.casefold() == requested_fold:
            return name

    for flags, name in parsed:
        if r"\All" in flags:
            return name

    return requested


def resolve_mailbox_by_flag(
    client: imaplib.IMAP4_SSL, special_flag: str, fallback: str
) -> str:
    parsed = _list_mailboxes(client)
    for flags, name in parsed:
        if special_flag in flags:
            return name
    return fallback


def quote_mailbox(name: str) -> str:
    escaped = name.replace("\\", "\\\\").replace('"', r"\"")
    return f'"{escaped}"'


def main() -> int:
    args = parse_args()

    if args.older_than_days < 1:
        print("--older-than-days must be >= 1", file=sys.stderr)
        return 2
    if args.batch_size < 1:
        print("--batch-size must be >= 1", file=sys.stderr, flush=True)
        return 2

    password = os.environ.get("GMAIL_APP_PASSWORD")
    if not password:
        print("GMAIL_APP_PASSWORD is required in environment", file=sys.stderr, flush=True)
        return 2

    cutoff = (dt.datetime.now(dt.UTC) - dt.timedelta(days=args.older_than_days)).strftime(
        "%d-%b-%Y"
    )
    print(
        f"Prune target: mailbox={args.mailbox} older_than_days={args.older_than_days} "
        f"cutoff={cutoff} batch_size={args.batch_size} dry_run={args.dry_run}"
    , flush=True)

    client = imaplib.IMAP4_SSL(args.host, timeout=args.timeout)
    try:
        typ, _ = client.login(args.email, password)
        if typ != "OK":
            print("IMAP login failed", file=sys.stderr, flush=True)
            return 1

        mailbox_all = resolve_mailbox(client, args.mailbox)
        typ, _ = client.select(quote_mailbox(mailbox_all))
        if typ != "OK":
            print(f'Failed to select mailbox "{mailbox_all}"', file=sys.stderr, flush=True)
            return 1

        typ, data = client.uid("SEARCH", None, "BEFORE", cutoff)
        if typ != "OK":
            print("IMAP search failed", file=sys.stderr, flush=True)
            return 1

        raw = data[0] if data and data[0] else b""
        uids = raw.split() if raw else []
        total = len(uids)
        print(f"Matched UIDs: {total}", flush=True)

        if args.dry_run or total == 0:
            return 0

        moved = 0
        for idx in range(0, total, args.batch_size):
            batch = uids[idx : idx + args.batch_size]
            uid_set = b",".join(batch).decode()

            typ, _ = client.uid("STORE", uid_set, "+X-GM-LABELS.SILENT", r"(\Trash)")
            if typ != "OK":
                print(
                    f"Failed to move batch starting at index {idx} to Trash",
                    file=sys.stderr,
                    flush=True,
                )
                return 1

            moved += len(batch)
            print(f"MovedToTrash {moved}/{total}", flush=True)

        mailbox_trash = resolve_mailbox_by_flag(client, r"\Trash", "[Gmail]/Trash")
        typ, _ = client.select(quote_mailbox(mailbox_trash))
        if typ != "OK":
            print(f'Failed to select Trash mailbox "{mailbox_trash}"', file=sys.stderr, flush=True)
            return 1

        typ, trash_data = client.uid("SEARCH", None, "BEFORE", cutoff)
        if typ != "OK":
            print("IMAP Trash search failed", file=sys.stderr, flush=True)
            return 1

        trash_raw = trash_data[0] if trash_data and trash_data[0] else b""
        trash_uids = trash_raw.split() if trash_raw else []
        trash_total = len(trash_uids)
        print(f"TrashPurgeCandidates: {trash_total}", flush=True)

        purged = 0
        for idx in range(0, trash_total, args.batch_size):
            batch = trash_uids[idx : idx + args.batch_size]
            uid_set = b",".join(batch).decode()

            typ, _ = client.uid("STORE", uid_set, "+FLAGS.SILENT", r"(\Deleted)")
            if typ != "OK":
                print(
                    f"Failed to mark trash batch starting at index {idx} as deleted",
                    file=sys.stderr,
                    flush=True,
                )
                return 1

            typ, _ = client.expunge()
            if typ != "OK":
                print(
                    f"EXPUNGE failed for trash batch starting at index {idx}",
                    file=sys.stderr,
                    flush=True,
                )
                return 1

            purged += len(batch)
            print(f"PurgedFromTrash {purged}/{trash_total}", flush=True)

        return 0
    finally:
        try:
            client.logout()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
