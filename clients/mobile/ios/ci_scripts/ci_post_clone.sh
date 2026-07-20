#!/bin/sh
# Xcode Cloud post-clone hook for the CumulusVPN iOS app.
# Runs on the Xcode Cloud macOS runner after the repo is cloned, before build.
# Sets up JS deps + the shared core, installs Pods, and provisions Go 1.22 so the
# WireGuardKit `libwg-go.a` build phase can compile (see docs/13-ios-build.md).
set -e

echo "▸ CumulusVPN iOS post-clone"
cd "$CI_PRIMARY_REPOSITORY_PATH"

# --- Node 22 + Yarn 4 (Corepack) ---
brew install node@22 || true
export PATH="$(brew --prefix node@22)/bin:$PATH"
corepack enable

# node@22 is keg-only, so it is NOT on the PATH the Xcode "Bundle React Native
# code and images" build phase runs with. That phase sources ios/.xcode.env,
# which resolves `command -v node` — so node must be findable at a stable path.
# Symlink it into /usr/local/bin (already on the build-phase PATH; same trick as
# the Go symlink below). Without this the Release archive fails to bundle JS.
NODE22="$(brew --prefix node@22)/bin"
ln -sf "$NODE22/node" /usr/local/bin/node || sudo ln -sf "$NODE22/node" /usr/local/bin/node || true

# --- shared core: the RN bundle imports @cumulusvpn/core via its built dist ---
yarn install --immutable
yarn workspace @cumulusvpn/core build

# --- wgnest multi-hop xcframework (gomobile bind; needs Go >= 1.23) ---
# Build it now with a CURRENT Go, BEFORE the Go 1.22 symlink below: WireGuardKit's
# libwg-go.a build phase needs Go 1.22, but gomobile/wgnest needs 1.23+. The result
# (clients/mobile/ios/Frameworks/Wgnest.xcframework) is a gitignored artifact the
# Xcode build links + embeds into PacketTunnelExtension.
brew install go || true
PATH="$(brew --prefix go)/bin:$PATH" bash clients/native/wgnest/build-ios.sh

# --- mobile deps ---
cd clients/mobile
yarn install --no-immutable

# --- Go 1.22 for the wireguard-go archive (Go 1.26 breaks the pinned WG build) ---
# The archive is built by WireGuardKit's Makefile as an Xcode build phase; it
# needs `go` on PATH. Symlink go1.22 to a stable location the build phase can find.
brew install go@1.22 || true
GO122="$(brew --prefix go@1.22)/bin"
echo "export PATH=\"$GO122:\$PATH\"" >> "$HOME/.zprofile" || true
ln -sf "$GO122/go" /usr/local/bin/go || sudo ln -sf "$GO122/go" /usr/local/bin/go || true

# --- CocoaPods ---
# RN 0.86's hermes-engine.podspec resolves `which!('cmake')` when the podspec is
# *loaded* (even though Hermes ships prebuilt and isn't built from source here),
# so `pod install` aborts if cmake is missing. Xcode Cloud runners don't ship it.
brew install cmake || true
cd ios
pod install --repo-update

echo "▸ post-clone complete"
