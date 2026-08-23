#!/usr/bin/env bash
#
# Run every package's OWN checks — the local equivalent of ci-ts + bridge-image.
#
# `yarn lint` / `yarn test` at the repo root iterate yarn WORKSPACES, and only
# three of the six packages are workspaces (clients/core-ts, clients/web,
# clients/desktop). bridge, clients/mobile and deploy have their own
# package.json, their own eslint/prettier config, and their own CI job — and a
# root-level check is silently blind to all three. That blind spot turned two
# green local runs into two red builds on 2026-08-23, so prefer this script
# over `yarn check` before pushing.
#
# Skips a step a package does not define, and reports every failure rather
# than stopping at the first, so one run tells you everything that is broken.

set -uo pipefail
cd "$(dirname "$0")/.."

PACKAGES=(bridge clients/core-ts clients/desktop clients/mobile clients/web deploy)
STEPS=(typecheck lint format:check test build)

failed=()
log=$(mktemp)
trap 'rm -f "$log"' EXIT

for pkg in "${PACKAGES[@]}"; do
  [ -f "$pkg/package.json" ] || continue
  echo "── $pkg"
  for step in "${STEPS[@]}"; do
    node -e "process.exit(require('./$pkg/package.json').scripts?.['$step'] ? 0 : 1)" || continue
    printf '   %-13s ' "$step"
    if (cd "$pkg" && yarn "$step") >"$log" 2>&1; then
      echo "ok"
    else
      echo "FAIL"
      sed 's/^/      /' "$log" | tail -15
      failed+=("$pkg:$step")
    fi
  done
done

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "all checks passed"
  exit 0
fi
echo "FAILED (${#failed[@]}):"
printf '  %s\n' "${failed[@]}"
exit 1
