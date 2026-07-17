#!/usr/bin/env bash
# price-update.sh — retarget CVPN_PRICE_FLUX across the whole fleet when FLUX/USD drifts.
#
#   ./price-update.sh 5.2       # set canonical price to 5.2 FLUX (~$0.99 at new rate)
#
# The price constant lives in each spec's encrypted env; every gateway reads it from its own spec
# and hot-reloads. Gateways accept the PREVIOUS price for 72h after an update (grace window,
# docs/04) so nobody pays into a void mid-change. Updating = a paid app update per country.
set -euo pipefail
PRICE="${1:?usage: price-update.sh <flux-amount>}"
DIR="$(dirname "$0")"

for plain in "$DIR/../specs/plain"/cumulus*.json; do
  name=$(basename "$plain" .json)
  # rewrite CVPN_PRICE_FLUX in the plaintext, then re-encrypt + re-register
  tmp=$(mktemp)
  sed -E "s/\"CVPN_PRICE_FLUX=[0-9.]+\"/\"CVPN_PRICE_FLUX=${PRICE}\"/" "$plain" > "$tmp" && mv "$tmp" "$plain"
  node "$DIR/encrypt.mjs" "$name"
  "$DIR/register.sh" "$name"
  echo "priced $name → $PRICE FLUX"
done
echo "fleet reprice done. 72h grace: gateways still honor the old price until then."
