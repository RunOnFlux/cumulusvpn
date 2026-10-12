#!/usr/bin/env bash
# Build the privileged helper and stage it where the Tauri bundler expects it.
#
# macOS only. It runs as the macOS beforeBuildCommand (src-tauri/
# tauri.macos.conf.json), which also bundles the result. Linux and Windows run
# the tunnel in-process and ship no helper, so their builds never call this.
#
# The bundler copies a fixed path out of tauri.conf.json, but cargo's output
# directory depends on whether --target was passed (CI passes one, a local
# `tauri build` does not). Rather than teach the config about both, always stage
# the result at helper/build/cumulusvpn-helper.
#
# Tauri exports TAURI_ENV_TARGET_TRIPLE to beforeBuildCommand, so this works for
# either invocation.
set -euo pipefail

cd "$(dirname "$0")/.."
MANIFEST="src-tauri/Cargo.toml"
STAGE="src-tauri/helper/build"
TRIPLE="${TAURI_ENV_TARGET_TRIPLE:-}"

if [ -n "$TRIPLE" ]; then
  cargo build --release --manifest-path "$MANIFEST" -p cumulusvpn-helper --target "$TRIPLE"
  BUILT="src-tauri/target/$TRIPLE/release/cumulusvpn-helper"
else
  cargo build --release --manifest-path "$MANIFEST" -p cumulusvpn-helper
  BUILT="src-tauri/target/release/cumulusvpn-helper"
fi

mkdir -p "$STAGE"
cp "$BUILT" "$STAGE/cumulusvpn-helper"
echo "staged helper: $STAGE/cumulusvpn-helper (from $BUILT)"
