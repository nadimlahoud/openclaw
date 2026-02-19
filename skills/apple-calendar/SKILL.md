---
name: apple-calendar
description: Read Apple Calendar events (Calendar.app + Fantastical data) via the local `openclaw-calendar` CLI on macOS. Use on a paired macOS node host.
metadata:
  { "openclaw": { "emoji": "📅", "os": ["darwin"], "requires": { "bins": ["openclaw-calendar"] } } }
---

# Apple Calendar (EventKit)

Use `openclaw-calendar` to query events from the macOS EventKit store (the same data you see in Calendar.app and Fantastical).

This is intended to run on a **paired macOS node host** (so a Linux Docker gateway can still access your Mac calendars via `nodes`).

## Setup

Build/install:

```sh
# Run from the directory containing this SKILL.md
xcrun swiftc -O -framework EventKit -o ~/.local/bin/openclaw-calendar \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
  -Xlinker ./scripts/openclaw-calendar.Info.plist \
  ./scripts/openclaw-calendar.swift

# Recommended: ad-hoc sign so macOS can track permissions per binary.
codesign --force --sign - ~/.local/bin/openclaw-calendar
```

Grant Calendar permission when prompted (System Settings -> Privacy & Security -> Calendars).

Important: the Calendar permission prompt may not appear when `openclaw-calendar` is launched by a background process (like `launchd`) or by certain "hardened" parent apps. If you hit a `TIMEOUT` or `PERMISSION_DENIED` error, run this once from **Terminal.app** to trigger the prompt:

```sh
~/.local/bin/openclaw-calendar --json --list-calendars
```

If node execution is blocked by exec approvals, allowlist the binary on the node:

- `openclaw approvals allowlist add --node <node> "~/.local/bin/openclaw-calendar"`

## Usage (CLI)

- List calendars:
  - `openclaw-calendar --json --list-calendars`
- Check permission status:
  - `openclaw-calendar --json --auth-status`
- Default (next ~36h from now):
  - `openclaw-calendar --json`
- Today (calendar day):
  - `openclaw-calendar --json --day today`
- Custom range:
  - `openclaw-calendar --json --start 2026-02-18T09:00:00-08:00 --end 2026-02-18T18:00:00-08:00`
- Filter to specific calendars (repeatable; match by calendar title or id):
  - `openclaw-calendar --json --day today --calendar Work --calendar "<calendar-id>"`

Flags (common)

- `--max-events <n>` (default: 200)
- `--max-notes-chars <n>` (default: 2000)
- `--max-attendees <n>` (default: 50)
- `--include-declined` (default: off)
- `--include-canceled` (default: off)
- `--exclude-all-day` (default: off)

## OpenClaw usage (node host)

Prefer the `nodes` tool so the command runs on the macOS node host:

- Discover nodes: `nodes action:"status"`
- Run on the Mac node:
  - `nodes action:"run" node:"Mac Node" command:["openclaw-calendar","--json","--day","today"]`

Always parse stdout as JSON and summarize the agenda (start/end, title, location, and key notes). Treat notes/attendees as sensitive: only surface what the user asked for.

## Notes

- Read-only: this tool does not create, modify, or delete events.
- Event notes and attendee lists can be long; the tool truncates by default.
- If Calendar permission is denied, enable access for the calling process in System Settings.
