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

# --- shared core: the RN bundle imports @cumulusvpn/core via its built dist ---
yarn install --immutable
yarn workspace @cumulusvpn/core build

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
cd ios
pod install --repo-update

echo "▸ post-clone complete"
