#!/usr/bin/env bash
set -euo pipefail

IMAPSYNC_BIN="${IMAPSYNC_BIN:-}"
if [ -z "${IMAPSYNC_BIN}" ]; then
  for candidate in "$(command -v imapsync 2>/dev/null || true)" "/opt/homebrew/bin/imapsync" "/usr/local/bin/imapsync"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
      IMAPSYNC_BIN="${candidate}"
      break
    fi
  done
fi

if [ -z "${IMAPSYNC_BIN}" ]; then
  echo "imapsync is required (brew install imapsync)." >&2
  exit 1
fi

: "${ICLOUD_EMAIL:?Set ICLOUD_EMAIL}"
: "${ICLOUD_APP_PASSWORD:?Set ICLOUD_APP_PASSWORD}"
: "${GMAIL_EMAIL:?Set GMAIL_EMAIL}"
: "${GMAIL_APP_PASSWORD:?Set GMAIL_APP_PASSWORD}"
BRIDGE_MAXAGE_DAYS="${BRIDGE_MAXAGE_DAYS:-0}"

# Avoid exposing app passwords in process args by using passfiles.
passfile1="$(mktemp "${TMPDIR:-/tmp}/imapsync-pass1.XXXXXX")"
passfile2="$(mktemp "${TMPDIR:-/tmp}/imapsync-pass2.XXXXXX")"
log_dir="${HOME}/.msgvault/logs"
mkdir -p "${log_dir}"
log_file="${log_dir}/imapsync-icloud-gmail-$(date +%Y%m%d-%H%M%S).log"
cleanup() {
  rm -f "${passfile1}" "${passfile2}"
}
trap cleanup EXIT INT TERM
chmod 600 "${passfile1}" "${passfile2}"
printf '%s\n' "${ICLOUD_APP_PASSWORD}" >"${passfile1}"
printf '%s\n' "${GMAIL_APP_PASSWORD}" >"${passfile2}"

args=(
  --host1 imap.mail.me.com
  --user1 "${ICLOUD_EMAIL}"
  --passfile1 "${passfile1}"
  --ssl1
  --host2 imap.gmail.com
  --user2 "${GMAIL_EMAIL}"
  --passfile2 "${passfile2}"
  --ssl2
  --logfile "${log_file}"
  --automap
  --nofoldersizes
  --nofoldersizesatend
  --useuid
  --syncinternaldates
)

if [ "${BRIDGE_MAXAGE_DAYS}" -gt 0 ]; then
  args+=(--maxage "${BRIDGE_MAXAGE_DAYS}")
fi

"${IMAPSYNC_BIN}" "${args[@]}"
