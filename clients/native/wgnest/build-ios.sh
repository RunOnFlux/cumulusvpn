#!/usr/bin/env bash
# Build the wgnest multi-hop core into an iOS xcframework (Wgnest.xcframework)
# and drop it where the mobile app's Xcode build consumes it
# (clients/mobile/ios/Frameworks).
#
# The xcframework bundles the wgnest core (two stacked wireguard-go devices) and
# the generated Wgmobile Swift/ObjC binding. It is a build artifact (gitignored);
# run this before building the iOS app, in CI and locally.
#
# Requirements: Go >= 1.23, Xcode + command-line tools (for the iOS SDKs).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

export PATH="$PATH:$(go env GOPATH)/bin"
if ! command -v gomobile >/dev/null 2>&1; then
  # The x/mobile version go.mod pins (the one bind.go builds against), never
  # @latest: the CLI must match the bind library, and @latest drifted to a
  # release needing a newer Go than CI pins, failing mobile-v1.1.1's build.
  mobile_ver="$(go list -m -f '{{.Version}}' golang.org/x/mobile)"
  echo "installing gomobile + gobind ${mobile_ver}…"
  go install "golang.org/x/mobile/cmd/gomobile@${mobile_ver}"
  go install "golang.org/x/mobile/cmd/gobind@${mobile_ver}"
fi

out="$here/../../mobile/ios/Frameworks/Wgnest.xcframework"
mkdir -p "$(dirname "$out")"
rm -rf "$out"
echo "building $out …"
# iossimulator included so the extension can be run in the Simulator; drop it for
# a slimmer device-only build.
gomobile bind \
  -target=ios,iossimulator \
  -o "$out" \
  ./wgmobile

echo "done: $out"
du -sh "$out"
