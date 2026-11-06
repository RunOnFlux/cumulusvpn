#!/usr/bin/env bash
# Notarize the signed .dmg with Apple, then staple the ticket to the .dmg and
# to the .app in the bundle directory.
#
# Why this is not left to Tauri: Tauri submits and then polls Apple in one
# HTTP session with no retry. A new team's first submissions can sit
# "In Progress" for hours, and twice (desktop-v1.4.2) the GitHub macOS runner
# lost its network mid-poll ("No network route"), failing the whole build
# although Apple had the upload. Here the submission ID is kept, every status
# poll is retried, and the wait is bounded only by the job timeout.
#
# The .dmg is what is notarized: Apple notarizes everything nested in it, so
# the app inside passes Gatekeeper's online check too, and the .dmg (the file
# users download) carries the stapled ticket for offline first launch.
#
# Usage (CI):
#   CVPN_NOTARY_KEY_ID=… CVPN_NOTARY_ISSUER=… CVPN_NOTARY_KEY_PATH=…/AuthKey.p8 \
#   APPLE_SIGNING_IDENTITY="Developer ID Application: … (276MY32G8B)" \
#     bash scripts/notarize-macos.sh path/to/CumulusVPN.dmg [path/to/CumulusVPN.app]
#
# Optional: CVPN_NOTARY_MAX_WAIT seconds (default 18000 = 5 h).
set -euo pipefail

DMG="${1:?usage: notarize-macos.sh <dmg> [app]}"
APP="${2:-}"
: "${CVPN_NOTARY_KEY_ID:?not set}" "${CVPN_NOTARY_ISSUER:?not set}" "${CVPN_NOTARY_KEY_PATH:?not set}"
: "${APPLE_SIGNING_IDENTITY:?not set}"
MAX_WAIT="${CVPN_NOTARY_MAX_WAIT:-18000}"
AUTH=(--key "$CVPN_NOTARY_KEY_PATH" --key-id "$CVPN_NOTARY_KEY_ID" --issuer "$CVPN_NOTARY_ISSUER")

# Retry a command through transient failures (network drops on the runner).
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge 8 ]; then echo "notarize: giving up after $n attempts: $*" >&2; return 1; fi
    echo "notarize: attempt $n failed; retrying in $((n * 15)) s" >&2
    sleep $((n * 15))
  done
}

# The .dmg itself must carry a Developer ID signature (with a timestamp) for
# Gatekeeper to accept it as a downloaded file.
if ! codesign --verify --strict "$DMG" 2>/dev/null; then
  codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG"
fi
codesign --verify --strict --verbose=2 "$DMG"

submit_json="$(mktemp)"
retry xcrun notarytool submit "$DMG" "${AUTH[@]}" --output-format json >"$submit_json"
id="$(plutil -extract id raw -o - "$submit_json")"
echo "notarize: submitted $DMG as $id"

start=$(date +%s)
status=""
while :; do
  info="$(mktemp)"
  if xcrun notarytool info "$id" "${AUTH[@]}" --output-format json >"$info" 2>/dev/null; then
    status="$(plutil -extract status raw -o - "$info" 2>/dev/null || true)"
  else
    status="(poll failed, will retry)"
  fi
  elapsed=$(($(date +%s) - start))
  echo "notarize: $id status: $status after ${elapsed}s"
  case "$status" in
    Accepted) break ;;
    Invalid | Rejected)
      retry xcrun notarytool log "$id" "${AUTH[@]}" || true
      echo "::error::Apple notarization $status for $id (log above)"
      exit 1
      ;;
  esac
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "::error::Apple notarization still '$status' after ${elapsed}s (submission $id)."
    echo "Check later with: xcrun notarytool info $id …; then re-run this job."
    exit 1
  fi
  sleep 30
done

# Show Apple's log even on success: it lists warnings that become errors later.
retry xcrun notarytool log "$id" "${AUTH[@]}" || true

retry xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
if [ -n "$APP" ]; then
  retry xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
fi
echo "notarize: $DMG accepted and stapled"
