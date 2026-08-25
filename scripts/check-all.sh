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

# The Go core is not an npm package, so the loop above cannot see it — but it
# carries the roaming tests (Rebind under a live session), which are exactly the
# kind that must not rot. Gradle/Xcode are deliberately left out: both need the
# gomobile bindings rebuilt first (NDK / Xcode), which is CI's job, not a
# pre-push check's.
if [ -d clients/native/wgnest ]; then
  echo "── clients/native/wgnest (go)"
  # label:command — the label is separate because "go vet"/"go test" would
  # otherwise both truncate to "go".
  for entry in "format:gofmt -l ." "vet:go vet ./..." "test:go test ./... -timeout 180s"; do
    label=${entry%%:*}
    step=${entry#*:}
    printf '   %-13s ' "$label"
    out=$(cd clients/native/wgnest && eval "$step" 2>&1)
    rc=$?
    # gofmt reports unformatted files by PRINTING them and still exits 0, so for
    # that step empty output is the pass condition, not the exit code.
    if [ $rc -eq 0 ] && { [ "$label" != "format" ] || [ -z "$out" ]; }; then
      echo "ok"
    else
      echo "FAIL"
      printf '%s\n' "$out" | sed 's/^/      /' | tail -15
      failed+=("wgnest:$label")
    fi
  done
  echo
fi

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "all checks passed"
  exit 0
fi
echo "FAILED (${#failed[@]}):"
printf '  %s\n' "${failed[@]}"
exit 1
