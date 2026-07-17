#!/usr/bin/env bash
# register.sh — register (or update) one CumulusVPN country spec on Flux.
#
#   ./register.sh cumulusde
#
# Flow (FluxOS app API + Flux chain):
#   1. verify spec shape          POST /apps/verifyappregistrationspecifications
#   2. get price                  POST /apps/calculateprice        (FLUX) or /calculatefiatandfluxprice
#   3. sign spec with owner ZelID (message signature; use the RunOnFlux SDK or Zelcore)
#   4. broadcast                  POST /apps/appregister   (or /apps/appupdate for updates)
#      → returns a 64-char message hash
#   5. pay the quoted FLUX to the Flux apps address with that hash in OP_RETURN, within the window
#
# Requires: onchain/<name>.json already produced by generate.mjs + encrypt.mjs.
# This is a scaffold — wire steps 3/5 to the SDK/wallet you standardize on. Never commit keys.
set -euo pipefail

NAME="${1:?usage: register.sh cumulus<cc>}"
FLUX_API="${FLUX_API:-https://api.runonflux.io}"
SPEC="$(dirname "$0")/../specs/onchain/${NAME}.json"

[ -f "$SPEC" ] || { echo "no spec $SPEC — run generate.mjs + encrypt.mjs first"; exit 1; }
grep -q ENTERPRISE_ENCRYPTED "$SPEC" || echo "WARN: enterprise field not encrypted yet"

echo "1/5 verify…"
curl -fsS -X POST "$FLUX_API/apps/verifyappregistrationspecifications" \
  -H 'Content-Type: application/json' --data @"$SPEC" | tee /tmp/${NAME}.verify.json

echo "2/5 price…"
curl -fsS -X POST "$FLUX_API/apps/calculateprice" \
  -H 'Content-Type: application/json' --data @"$SPEC" | tee /tmp/${NAME}.price.json

echo "3/5 sign owner ZelID  → TODO: SDK/Zelcore signature over the spec message"
echo "4/5 broadcast         → TODO: POST /apps/appregister with {type, version, appSpecification, timestamp, signature}"
echo "5/5 pay FLUX to apps address with returned 64-char hash in OP_RETURN (see docs/04)"
echo "done (scaffold): $NAME"
