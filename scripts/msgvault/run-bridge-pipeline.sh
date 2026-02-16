#!/usr/bin/env bash
set -euo pipefail

# End-to-end bridge pipeline:
# 1) iCloud -> Gmail bridge sync
# 2) msgvault incremental sync for that Gmail account

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/imapsync-icloud-to-gmail.sh"

: "${GMAIL_EMAIL:?Set GMAIL_EMAIL}"
MSGVAULT_ACCOUNT="${GMAIL_EMAIL}" "${SCRIPT_DIR}/msgvault-sync-account.sh"

BRIDGE_PRUNE_ENABLED="${BRIDGE_PRUNE_ENABLED:-1}"
if [ "${BRIDGE_PRUNE_ENABLED}" = "1" ]; then
  "${SCRIPT_DIR}/prune-gmail-bridge.sh"
fi
