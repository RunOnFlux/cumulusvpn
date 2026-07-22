#!/usr/bin/env bash
# Build the wgnest multi-hop core into an Android AAR (wgmobile.aar) and drop it
# where the mobile app's gradle build consumes it (clients/mobile/android/app/libs).
#
# The AAR bundles libgojni.so for all four ABIs the RN app ships (arm64-v8a,
# armeabi-v7a, x86_64, x86 — see clients/mobile/android/gradle.properties
# reactNativeArchitectures) plus the generated com.cumulusvpn.wgnest.wgmobile.Wgmobile
# Java binding. Missing an ABI here means a device with the RN .so but no wgnest
# .so throws UnsatisfiedLinkError on the first multi-hop start (or, via AAB
# splits, never receives the lib). It is a gitignored build artifact; run this
# before building the Android app, in CI and locally.
#
# Requirements: Go >= 1.23, an Android NDK, ANDROID_HOME (or ANDROID_NDK_HOME).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
export ANDROID_HOME
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
  # Newest COMPLETE installed NDK under $ANDROID_HOME/ndk (skip partial installs
  # missing meta/platforms.json, which gomobile rejects).
  for d in $(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -Vr); do
    if [ -f "$d/meta/platforms.json" ]; then
      ANDROID_NDK_HOME="$d"
      break
    fi
  done
  export ANDROID_NDK_HOME
fi
echo "ANDROID_HOME=$ANDROID_HOME"
echo "ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-<unset>}"

export PATH="$PATH:$(go env GOPATH)/bin"
if ! command -v gomobile >/dev/null 2>&1; then
  echo "installing gomobile + gobind…"
  go install golang.org/x/mobile/cmd/gomobile@latest
  go install golang.org/x/mobile/cmd/gobind@latest
fi

out="$here/../../mobile/android/app/libs/wgmobile.aar"
mkdir -p "$(dirname "$out")"
echo "building $out …"
gomobile bind \
  -target=android/arm64,android/arm,android/amd64,android/386 \
  -androidapi 24 \
  -javapkg com.cumulusvpn.wgnest \
  -o "$out" \
  ./wgmobile

echo "done: $out"
ls -lh "$out"
