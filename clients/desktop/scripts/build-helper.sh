#!/usr/bin/env bash
# Kept for muscle memory and old docs: the helper build is scripts/build-helper.mjs,
# which every platform's beforeBuildCommand runs (Node, so it also works where
# Tauri runs the command through cmd.exe). Arguments are passed through.
set -euo pipefail
exec node "$(dirname "$0")/build-helper.mjs" "$@"
