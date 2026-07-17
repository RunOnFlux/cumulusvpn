#!/usr/bin/env bash
# renew.sh — renew every deployed CumulusVPN spec before it expires. Run from cron with alerting.
# A lapsed spec = a country vanishes from the fleet, so this is real infrastructure, not a chore.
#
#   ./renew.sh                 # check all onchain specs, renew any within the threshold
#   RENEW_THRESHOLD_BLOCKS=20000 ./renew.sh
#
# For each spec: query current registration height/expiry via /apps/appspecifications/<name>,
# and if (expiry - currentBlock) < threshold, submit a paid app update (same flow as register.sh).
set -euo pipefail

FLUX_API="${FLUX_API:-https://api.runonflux.io}"
THRESHOLD="${RENEW_THRESHOLD_BLOCKS:-20000}"   # ~ a week of headroom at 30s blocks
DIR="$(dirname "$0")/../specs/onchain"

BLOCK=$(curl -fsS "$FLUX_API/daemon/getblockcount" | sed -E 's/.*"data":([0-9]+).*/\1/')
echo "current block: $BLOCK  threshold: $THRESHOLD"

for spec in "$DIR"/cumulus*.json; do
  name=$(basename "$spec" .json)
  info=$(curl -fsS "$FLUX_API/apps/appspecifications/$name" || echo '{}')
  height=$(echo "$info" | sed -E 's/.*"height":([0-9]+).*/\1/;t;s/.*//')
  expire=$(echo "$info" | sed -E 's/.*"expire":([0-9]+).*/\1/;t;s/.*//')
  if [ -z "$height" ] || [ -z "$expire" ]; then echo "… $name: not found / not registered — skip"; continue; fi
  left=$(( height + expire - BLOCK ))
  if [ "$left" -lt "$THRESHOLD" ]; then
    echo "!! $name: $left blocks left → renewing"
    "$(dirname "$0")/register.sh" "$name"    # update = same broadcast+pay flow
  else
    echo "ok $name: $left blocks left"
  fi
done
