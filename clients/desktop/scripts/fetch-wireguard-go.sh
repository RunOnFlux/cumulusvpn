#!/usr/bin/env bash
#
# fetch-wireguard-go.sh — build (or vendor) the userspace `wireguard-go`
# binary and place it where Tauri's `externalBin` expects it:
#
#     src-tauri/binaries/wireguard-go-<rust-target-triple>[.exe]
#
# `wireguard-go` is the reference userspace WireGuard implementation
# (https://git.zx2c4.com/wireguard-go). It is licensed MIT — see the
# LICENCE note this script drops next to the binary
# (src-tauri/binaries/wireguard-go.LICENSE). Because it is MIT we may
# redistribute it inside our installers; we build it from a pinned commit
# rather than trusting an opaque download.
#
# Usage:
#   scripts/fetch-wireguard-go.sh                 # build for the host triple
#   scripts/fetch-wireguard-go.sh <target-triple> # cross-build for another target
#
# Requires: git, go (>= 1.23). Cross-compiling only needs the Go toolchain
# (wireguard-go is pure Go, CGO disabled) — no C cross-toolchain.
#
# Examples of targets Tauri may ask for (one binary per platform you ship):
#   aarch64-apple-darwin
#   x86_64-apple-darwin
#   x86_64-unknown-linux-gnu
#   aarch64-unknown-linux-gnu
#   x86_64-pc-windows-msvc   (produces wireguard-go-...-msvc.exe)
#
set -euo pipefail

# Pinned upstream commit. v0.0.20250522 — the first release whose bundled
# golang.org/x/net compiles cleanly on modern Go toolchains (the older
# 0.0.20230223 tag fails to link against Go >= 1.24). Bump deliberately.
WGGO_REPO="https://git.zx2c4.com/wireguard-go"
WGGO_COMMIT="ecfc5a8d54462e18e13c72173e2623d16d8e25a0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${DESKTOP_DIR}/src-tauri/binaries"

# ---- Resolve the target triple (arg overrides host autodetect) ------------
host_triple() {
  if command -v rustc >/dev/null 2>&1; then
    rustc -vV | sed -n 's/^host: //p'
    return
  fi
  # Fallback if rustc is absent: derive from uname.
  local arch os
  case "$(uname -m)" in
    arm64 | aarch64) arch="aarch64" ;;
    x86_64 | amd64) arch="x86_64" ;;
    *) arch="$(uname -m)" ;;
  esac
  case "$(uname -s)" in
    Darwin) os="apple-darwin" ;;
    Linux) os="unknown-linux-gnu" ;;
    MINGW* | MSYS* | CYGWIN*) os="pc-windows-msvc" ;;
    *) os="unknown" ;;
  esac
  echo "${arch}-${os}"
}

TRIPLE="${1:-$(host_triple)}"

# ---- Map the rust triple onto GOOS / GOARCH -------------------------------
case "${TRIPLE}" in
  *apple-darwin*) GOOS="darwin" ;;
  *linux*) GOOS="linux" ;;
  *windows*) GOOS="windows" ;;
  *)
    echo "error: unsupported/unknown OS in triple '${TRIPLE}'" >&2
    exit 1
    ;;
esac
case "${TRIPLE}" in
  aarch64-* | arm64-*) GOARCH="arm64" ;;
  x86_64-*) GOARCH="amd64" ;;
  i686-* | i586-*) GOARCH="386" ;;
  *)
    echo "error: unsupported/unknown arch in triple '${TRIPLE}'" >&2
    exit 1
    ;;
esac

EXT=""
[ "${GOOS}" = "windows" ] && EXT=".exe"
OUT="${BIN_DIR}/wireguard-go-${TRIPLE}${EXT}"

echo ">> target triple : ${TRIPLE}"
echo ">> GOOS/GOARCH   : ${GOOS}/${GOARCH}"
echo ">> output        : ${OUT}"

command -v go >/dev/null 2>&1 || { echo "error: 'go' toolchain not found on PATH" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "error: 'git' not found on PATH" >&2; exit 1; }

# ---- Fetch source at the pinned commit ------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
echo ">> cloning ${WGGO_REPO} @ ${WGGO_COMMIT}"
git clone --quiet "${WGGO_REPO}" "${WORK}/src"
git -C "${WORK}/src" checkout --quiet "${WGGO_COMMIT}"

# ---- Build (static, no CGO so cross-compiles trivially) -------------------
mkdir -p "${BIN_DIR}"
echo ">> building (CGO disabled) ..."
(
  cd "${WORK}/src"
  CGO_ENABLED=0 GOOS="${GOOS}" GOARCH="${GOARCH}" \
    go build -trimpath -ldflags "-s -w" -o "${OUT}" .
)
chmod +x "${OUT}"

# ---- Drop the licence note next to the binary -----------------------------
cp "${WORK}/src/LICENSE" "${BIN_DIR}/wireguard-go.LICENSE"

echo ">> done."
ls -la "${OUT}"
echo
echo "wireguard-go is MIT-licensed; the full text was written to"
echo "  ${BIN_DIR}/wireguard-go.LICENSE"
echo "Built from ${WGGO_REPO} @ ${WGGO_COMMIT}"
