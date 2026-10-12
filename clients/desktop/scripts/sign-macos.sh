#!/usr/bin/env bash
# Sign the macOS bundle inner-out, then verify the seal.
#
# The app ships three executables — the app itself, the wireguard-go sidecar and
# the privileged helper — plus a LaunchDaemon plist. macOS requires nested code
# to be signed BEFORE the enclosing bundle, because sealing the bundle hashes
# what it contains; sign the outside first and any later copy silently
# invalidates the signature. That ordering is the whole reason this script
# exists rather than leaving it to the bundler.
#
# It also matters more than usual here: SMAppService refuses to register a
# daemon whose plist and binary are not covered by the app's signature, and the
# helper refuses connections from an app that does not satisfy its designated
# requirement (see helper/src/peer.rs). A mis-signed bundle fails at both ends.
#
# Usage:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)" \
#     bash scripts/sign-macos.sh [path/to/CumulusVPN.app]
#
# TEAMID must equal APPLE_TEAM_ID in src-tauri/helper/src/peer.rs (the one place
# it is written down), or the app and its own daemon will refuse to talk to each
# other. This script reads it from there and refuses any other team.
set -euo pipefail

APP="${1:-src-tauri/target/release/bundle/macos/CumulusVPN.app}"
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
PEER_RS="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/helper/src/peer.rs"
TEAM_ID="$(sed -nE 's/^pub const APPLE_TEAM_ID: &str = "([A-Z0-9]+)";$/\1/p' "$PEER_RS")"

if [ -z "$TEAM_ID" ]; then
  echo "could not read APPLE_TEAM_ID from $PEER_RS" >&2
  exit 1
fi
if [ -z "$IDENTITY" ]; then
  echo "APPLE_SIGNING_IDENTITY is not set." >&2
  echo "Available identities:" >&2
  security find-identity -v -p codesigning >&2
  exit 1
fi
case "$IDENTITY" in
  *"($TEAM_ID)"*) ;;
  *)
    echo "signing identity is not from team $TEAM_ID: $IDENTITY" >&2
    echo "The helper only accepts an app signed by APPLE_TEAM_ID in $PEER_RS." >&2
    echo "Sign with that team's Developer ID, or change APPLE_TEAM_ID (and rebuild the helper)." >&2
    exit 1
    ;;
esac
if [ ! -d "$APP" ]; then
  echo "no such bundle: $APP" >&2
  exit 1
fi

sign() {
  echo "  signing $1"
  codesign --force --timestamp --options runtime --sign "$IDENTITY" "$@"
}

echo "signing nested executables first"
sign "$APP/Contents/MacOS/wireguard-go"
sign "$APP/Contents/MacOS/cumulusvpn-helper"

echo "sealing the bundle (covers Library/LaunchDaemons/*.plist)"
sign "$APP"

echo "verifying"
codesign --verify --deep --strict --verbose=2 "$APP"
echo
echo "helper identity (must show your Team ID, not 'adhoc'):"
codesign -dv --verbose=4 "$APP/Contents/MacOS/cumulusvpn-helper" 2>&1 | grep -E "Authority|TeamIdentifier|Identifier" || true
echo
echo "Signed. Notarize before distributing:"
echo "  xcrun notarytool submit <dmg> --keychain-profile <profile> --wait"
echo "  xcrun stapler staple <dmg>"
