#!/usr/bin/env bash
# scale.sh — change the instance count for one country and push a paid update.
#
#   ./scale.sh cumulusde 8      # set Germany to 8 instances, regenerate, re-encrypt, re-register
#
# Clients pick up new instances automatically via Flux discovery (/apps/location) — no client
# release needed. Use when p95 gateway load for a country exceeds ~60% (see docs/02).
set -euo pipefail
NAME="${1:?usage: scale.sh cumulus<cc> <instances>}"; N="${2:?instance count}"
CC="${NAME#cumulus}"; DIR="$(dirname "$0")"

# bump the instance count for this country in the manifest (yq preferred; fallback note below)
if command -v yq >/dev/null; then
  yq -i "(.countries[] | select(.cc == \"$CC\")).instances = $N" "$DIR/../countries.yaml"
else
  echo "install yq, or hand-edit instances for cc=$CC in countries.yaml"; exit 1
fi

node "$DIR/generate.mjs" --stage scale
node "$DIR/encrypt.mjs" "$NAME"
"$DIR/register.sh" "$NAME"       # update = broadcast + pay
echo "scaled $NAME → $N instances"
