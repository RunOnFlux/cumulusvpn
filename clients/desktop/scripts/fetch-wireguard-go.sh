#!/usr/bin/env bash
#
# fetch-wireguard-go.sh — build the userspace WireGuard engine binary and place
# it where Tauri's `externalBin` expects it:
#
#     src-tauri/binaries/wireguard-go-<rust-target-triple>[.exe]
#
# ENGINE: we build **AmneziaWG** (github.com/amnezia-vpn/amneziawg-go), a fork of
# wireguard-go whose cryptography is byte-identical to upstream WireGuard but
# which adds DPI-obfuscation params (jc/jmin/jmax/s1/s2/h1-h4). With no params it
# behaves exactly like wireguard-go, so the SAME binary serves both the vanilla
# and obfuscated (`wg-tls`/`awg`) transports — hence we keep the `wireguard-go-*`
# output name as a drop-in (the Rust sidecar resolver is unchanged). This matches
# the gateway + wgnest engines (docs/15-transports.md). AmneziaWG is MIT-licensed
# (like wireguard-go), so we may redistribute it in our installers; we build it
# from a pinned module version rather than trusting an opaque download.
#
# We hold the AWG-1.5 line (v0.2.x); the AWG-2.0 line (v1.x) drags a newer gVisor
# — keep this pin in lockstep with gateway/go.mod and wgnest/go.mod.
#
# Usage:
#   scripts/fetch-wireguard-go.sh                 # build for the host triple
#   scripts/fetch-wireguard-go.sh <target-triple> # cross-build for another target
#
# Requires: go (>= 1.23). Cross-compiling only needs the Go toolchain (pure Go,
# CGO disabled) — no C cross-toolchain.
#
set -euo pipefail

# Pinned AmneziaWG module version (AWG-1.5 line). Bump in lockstep with the
# gateway and wgnest go.mod pins.
AWG_MODULE="github.com/amnezia-vpn/amneziawg-go"
AWG_VERSION="v0.2.19"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${DESKTOP_DIR}/src-tauri/binaries"

# ---- Resolve the target triple (arg overrides host autodetect) ------------
host_triple() {
  if command -v rustc >/dev/null 2>&1; then
    rustc -vV | sed -n 's/^host: //p'
    return
  fi
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

echo ">> engine        : AmneziaWG (${AWG_MODULE}@${AWG_VERSION})"
echo ">> target triple : ${TRIPLE}"
echo ">> GOOS/GOARCH   : ${GOOS}/${GOARCH}"
echo ">> output        : ${OUT}"

command -v go >/dev/null 2>&1 || { echo "error: 'go' toolchain not found on PATH" >&2; exit 1; }

# ---- Build the amneziawg-go main package in module mode -------------------
# A throwaway module pins the version; `go build <module>` compiles its main
# package (the userspace engine binary). Pure Go + CGO disabled → trivial cross.
mkdir -p "${BIN_DIR}"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
(
  cd "${WORK}"
  cat > go.mod <<EOF
module awgbuild

go 1.23
EOF
  echo ">> resolving ${AWG_MODULE}@${AWG_VERSION} ..."
  GOFLAGS=-mod=mod go get "${AWG_MODULE}@${AWG_VERSION}"
  echo ">> building (CGO disabled) ..."
  CGO_ENABLED=0 GOOS="${GOOS}" GOARCH="${GOARCH}" GOFLAGS=-mod=mod \
    go build -trimpath -ldflags "-s -w" -o "${OUT}" "${AWG_MODULE}"
)
chmod +x "${OUT}"

echo ">> done."
ls -la "${OUT}"
echo
echo "AmneziaWG is MIT-licensed. Built from ${AWG_MODULE}@${AWG_VERSION}."
echo "With no obfuscation params it is wire-compatible with stock WireGuard."
