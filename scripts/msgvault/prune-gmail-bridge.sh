#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "python3 is required for Gmail prune." >&2
  exit 1
fi

: "${GMAIL_EMAIL:?Set GMAIL_EMAIL}"
: "${GMAIL_APP_PASSWORD:?Set GMAIL_APP_PASSWORD}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PRUNE_SCRIPT="${SCRIPT_DIR}/prune_gmail_imap.py"

if [ ! -f "${PRUNE_SCRIPT}" ]; then
  echo "Missing prune script: ${PRUNE_SCRIPT}" >&2
  exit 1
fi

BRIDGE_PRUNE_OLDER_THAN_DAYS="${BRIDGE_PRUNE_OLDER_THAN_DAYS:-30}"
BRIDGE_PRUNE_BATCH_SIZE="${BRIDGE_PRUNE_BATCH_SIZE:-1000}"
BRIDGE_PRUNE_DRY_RUN="${BRIDGE_PRUNE_DRY_RUN:-0}"
BRIDGE_PRUNE_MAILBOX="${BRIDGE_PRUNE_MAILBOX:-[Gmail]/All Mail}"

args=(
  --email "${GMAIL_EMAIL}"
  --older-than-days "${BRIDGE_PRUNE_OLDER_THAN_DAYS}"
  --batch-size "${BRIDGE_PRUNE_BATCH_SIZE}"
  --mailbox "${BRIDGE_PRUNE_MAILBOX}"
)

if [ "${BRIDGE_PRUNE_DRY_RUN}" = "1" ]; then
  args+=(--dry-run)
fi

"${PYTHON_BIN}" "${PRUNE_SCRIPT}" "${args[@]}"
