#!/bin/sh
# Xcode Cloud post-clone hook for the CumulusVPN iOS app.
# Runs on the Xcode Cloud macOS runner after the repo is cloned, before build.
# Sets up JS deps + the shared core, builds the wgnest xcframework, installs Pods.
# (The tunnel extension runs BOTH single- and multi-hop on the one wgnest Go core,
# so there is no longer a WireGuardKit libwg-go build phase / Go 1.22 step.)
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

# --- wgnest tunnel xcframework (gomobile bind; needs Go >= 1.23) ---
# Runs BOTH single- and multi-hop (WgmobileStartSingle / WgmobileStart). The
# result (clients/mobile/ios/Frameworks/Wgnest.xcframework) is a gitignored
# artifact the Xcode build links (extension) + embeds (app).
brew install go || true
PATH="$(brew --prefix go)/bin:$PATH" bash clients/native/wgnest/build-ios.sh

# --- mobile deps ---
cd clients/mobile
yarn install --no-immutable

# --- CocoaPods ---
# RN 0.86's hermes-engine.podspec resolves `which!('cmake')` when the podspec is
# *loaded* (even though Hermes ships prebuilt and isn't built from source here),
# so `pod install` aborts if cmake is missing. Xcode Cloud runners don't ship it.
brew install cmake || true
cd ios
pod install --repo-update

echo "▸ post-clone complete"
