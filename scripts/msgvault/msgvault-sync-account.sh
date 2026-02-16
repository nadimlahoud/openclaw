#!/usr/bin/env bash
set -euo pipefail

MSGVAULT_BIN="${MSGVAULT_BIN:-}"
if [ -z "${MSGVAULT_BIN}" ]; then
  for candidate in "$(command -v msgvault 2>/dev/null || true)" "${HOME}/.local/bin/msgvault"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
      MSGVAULT_BIN="${candidate}"
      break
    fi
  done
fi

if [ -z "${MSGVAULT_BIN}" ]; then
  echo "msgvault is required on PATH." >&2
  exit 1
fi

: "${MSGVAULT_ACCOUNT:?Set MSGVAULT_ACCOUNT}"

"${MSGVAULT_BIN}" sync "${MSGVAULT_ACCOUNT}"
