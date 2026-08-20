# CumulusVPN payments bridge

Converts verified **fiat** payments — Stripe card subscriptions, Apple IAP,
Google Play Billing — into **on-chain FLUX** payments carrying the buyer's
`CVPN1:<code>` memo. The chain stays the sole entitlement truth: gateways
notice the tx like any other payment and unlock premium with **zero gateway
changes**. See `docs/18-payments-bridge.md` for the design.

```
Stripe webhook ──┐
Apple ASN v2  ───┼─▶ verify ─▶ payments queue (SQLite, idempotent)
Play RTDN     ───┘                    │
                                      ▼
                     broadcaster ─▶ FLUX tx: N×20 FLUX + OP_RETURN memo
                                      │
                                      ▼
                     gateways' entitle scanner grants +N months
```

## Running

Operator infra only (VPS/container host you control). **Never deploy as a
Flux app** — the env (treasury WIF, Stripe key) would be readable by node
operators.

```sh
docker run -d --name cumulusvpn-bridge \
  -v bridge-data:/data \
  --env-file .env \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/runonflux/cumulusvpn-bridge:latest
```

Front with HTTPS (Caddy / nginx / Cloudflare Tunnel) at `pay.cumulusvpn.com`.
Configure from `.env.example` — a rail activates when its lead variable is
set (`STRIPE_SECRET_KEY`, `APPLE_BUNDLE_ID`, `GOOGLE_PACKAGE_NAME`), so you
can launch Stripe-only and add the store rails later.

## Secrets — what each one is and where it comes from

Everything is env-injected (see `.env.example` for the full annotated list);
nothing secret is ever committed or baked into the image.

| Variable                                     | What it is                                                                        | Where to get it                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TREASURY_WIF`                               | Private key (WIF) of the FLUX wallet that funds settlements. **The** crown jewel. | Generate a fresh keypair in any Flux wallet (Zelcore/SSP) you control, export the WIF, fund the address with FLUX. Never reuse an existing wallet.                                                                                                                                                            |
| `ADMIN_TOKEN`                                | Bearer token for `GET /internal/treasury`                                         | Generate yourself: `openssl rand -hex 32`                                                                                                                                                                                                                                                                     |
| `STRIPE_SECRET_KEY`                          | Stripe API key (`sk_live_…`)                                                      | Stripe Dashboard → Developers → API keys                                                                                                                                                                                                                                                                      |
| `STRIPE_WEBHOOK_SECRET`                      | Webhook signing secret (`whsec_…`)                                                | Stripe Dashboard → Developers → Webhooks → add endpoint `https://pay.cumulusvpn.com/v1/stripe/webhook` (events: `checkout.session.completed`, `invoice.paid`, `charge.refunded`, `customer.subscription.deleted`) — the secret is shown on creation                                                           |
| `STRIPE_PRICE_MONTHLY` / `_ANNUAL`           | Price ids (`price_…`) for $1.99/mo and $14.99/yr                                  | Stripe Dashboard → Product catalog → create one product with two recurring prices                                                                                                                                                                                                                             |
| Apple Pay / Google Pay                       | Wallet buttons in hosted Checkout — **no env var, easy to miss**                  | Stripe Dashboard → Settings → Payments → Payment methods → enable Apple Pay and Google Pay. We create sessions without `payment_method_types`, so this dashboard setting is the only thing that decides; leave it and checkout is card-only                                                                   |
| Billing portal                               | The self-service cancel / change-card / switch-plan page                          | Stripe Dashboard → Settings → Billing → Customer portal → activate. To allow monthly↔annual switching, add both prices to the portal's plan-change list and leave **proration ON** — the bridge sizes the day grant from the prorated invoice, and switching with proration off would over-grant a whole plan |
| `APPLE_BUNDLE_ID` / `APPLE_APP_ID`           | App identity for receipt verification                                             | App Store Connect (bundle id + numeric Apple ID of the app)                                                                                                                                                                                                                                                   |
| Apple root certs                             | Trust anchor for JWS verification                                                 | Already vendored in `certs/` (Apple Root CA – G3); nothing to fetch                                                                                                                                                                                                                                           |
| `GOOGLE_SERVICE_ACCOUNT_JSON`                | Service-account key with Play Android Publisher access                            | Google Cloud Console → create service account → grant it access in Play Console (Users & permissions → invite → financial data + app access); paste the JSON inline                                                                                                                                           |
| `GOOGLE_PACKAGE_NAME`                        | The app's applicationId                                                           | `com.cumulusvpn.app`                                                                                                                                                                                                                                                                                          |
| `GOOGLE_RTDN_AUDIENCE` / `GOOGLE_RTDN_EMAIL` | OIDC expectations for Pub/Sub pushes                                              | Cloud Console → Pub/Sub topic (set in Play Console → Monetization setup) → push subscription to `https://pay.cumulusvpn.com/v1/google/rtdn` with OIDC auth; audience = that URL, email = the push service account                                                                                             |
| `ALERT_WEBHOOK_URL`                          | Where operator alerts go (optional)                                               | Discord/Slack incoming-webhook URL                                                                                                                                                                                                                                                                            |

Non-secret but load-bearing: `PAYMENT_ADDRESS` + `PRICE_FLUX` must match the
gateway fleet's `CVPN_PAYMENT_ADDRESS` / `CVPN_PRICE_FLUX`
(deploy/specs/onchain/*), and `STRIPE_SUCCESS_URL` must keep the
`{CHECKOUT_SESSION_ID}` placeholder (boot fails fast otherwise).

## First deploy, in order

1. Provision the host, put `.env` together from the table above (Stripe rail
   only is fine to start), `docker run` as above, put HTTPS in front.
2. Check `GET /v1/health`, then `GET /internal/treasury` with the admin
   token — it shows the treasury address derived from your WIF.
3. Fund the treasury address (start small: ~50 FLUX).
4. **Dry-run the settlement path**: `sqlite3` an artificial row into the
   payments queue with a test device's payment code (see Development below)
   and watch `/v1/status/<pubkey>` on any gateway flip to premium ~1 min
   after the broadcast confirms.
5. Point the web app's checkout at it (already `pay.cumulusvpn.com` in
   `clients/web/src/config.ts`) and make a live-mode Stripe purchase with a
   real card; refund it afterwards from the Stripe dashboard if desired
   (the FLUX months stay granted — bounded, known loss).
6. Add the Apple/Google rails when the store consoles are set up
   (`store/*/readiness-checklist.md` §9), sandbox-test, then flip the
   `iapPurchase` flags in the dashboard KV before store submission.

### The /data volume is load-bearing

`bridge.db` holds the idempotency ledger (`UNIQUE(rail, event_key)`).
Restoring an old copy can **double-pay** grants that were queued after the
backup; losing it entirely means in-flight webhooks re-deliver and re-queue.
Snapshot the volume regularly (it is tiny) and never run two instances
against different databases.

## Treasury runbook

- The treasury address is logged at boot and shown by
  `GET /internal/treasury` (Bearer `ADMIN_TOKEN`): balance, queue depth,
  FLUX needed by pending grants, low-balance flag.
- **Top-up flow**: buy FLUX with fiat revenue, send to the treasury address.
  Payments stuck on an empty treasury stay `pending` and retry forever
  (backoff up to 6 h); an `ALERT_WEBHOOK_URL` ping fires when the balance
  drops under `MIN_TREASURY_FLUX` or the queue is stuck > 1 h.
- **Key rotation**: send the full balance to a fresh key's address, swap
  `TREASURY_WIF`, restart. Do it while the pending queue is empty.
- **Refunds**: chain grants cannot be revoked. The bridge marks the
  subscription `refunded` and cancels future renewals; the already-granted
  period is the accepted, bounded loss.

## Sandbox safety

`APPLE_SANDBOX_GRANTS` / `GOOGLE_TEST_GRANTS` default **false**: sandbox and
license-tester purchases verify and acknowledge normally but do NOT spend
real FLUX (the sandbox renewal clock is accelerated — hours per "month" —
and would drain the treasury).

## Development

```sh
yarn install
yarn typecheck && yarn lint && yarn format:check && yarn test && yarn build
```

Stripe end-to-end without deploying:

```sh
stripe listen --forward-to localhost:8080/v1/stripe/webhook
stripe trigger invoice.paid
```

The dry-run milestone before wiring any rail: fund the treasury with ~21
FLUX, enqueue a row by hand (`sqlite3` insert with a test code), and watch a
dev gateway's `/v1/status/<pubkey>` flip to premium within ~1 min of the
broadcast.
