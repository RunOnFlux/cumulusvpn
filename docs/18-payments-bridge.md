# 18 — Payments bridge (fiat → FLUX)

The bridge (`bridge/`) adds fiat rails — Stripe card subscriptions,
Apple IAP, Google Play Billing — **without touching the entitlement model**.
The chain remains the sole truth (04-payments.md "Principle"); the bridge is
just another *payer into* that system: it verifies a fiat payment and then
broadcasts the very same FLUX tx a crypto user would have sent, from an
operator treasury wallet, with the buyer's `CVPN1:<code>` memo.

Gateways need **no changes**: their `entitle` scanner sees a normal payment
tx with ≥1 confirmation and grants `+N × 30 days`. Clients need no
entitlement changes either — their existing `/v1/status` polling flips the
UI within ~1 min of confirmation.

## Rails and bindings

| Rail | Purchase → code binding | Renewal → code lookup | Idempotency key (one chain tx max) |
|---|---|---|---|
| Stripe | `subscription_data.metadata.cvpn_code`/`cvpn_plan` set at Checkout | invoice's subscription metadata (fallback: retrieve subscription) | **invoice id** — only `invoice.paid` grants |
| Apple | `appAccountToken` = UUID derived from the code (below); `/v1/apple/verify` recomputes and rejects mismatch | ASN v2 → `appAccountToken` map or `originalTransactionId` binding persisted at first verify | **transactionId** (unique per renewal) |
| Google | `obfuscatedExternalAccountId` = the raw code (~27 chars) | RTDN → `subscriptionsv2.get` → account id, fallback purchaseToken binding | **latestOrderId** (`GPA…-0, -1, …`) |
| Voucher | our own DB: `voucher_redemptions` UNIQUE(voucher, code) | n/a (one-shot grants) | **`voucher_id:payment_code`** (mirrors the UNIQUE) |

Everything a webhook/notification claims is re-verified against the
provider (Stripe signature over raw bytes; Apple JWS x5c chain to the
vendored Apple Root CA G3; Google OIDC push token **plus** an authoritative
`purchases.subscriptionsv2.get`).

### Apple appAccountToken derivation (shared vector)

Apple requires a UUID, and it must be derivable by both the app (at
purchase) and the bridge (at verify):

```
b = sha256(utf8("cvpn-appaccount:" + code))[0:16]
b[6] = (b[6] & 0x0f) | 0x40      // version 4
b[8] = (b[8] & 0x3f) | 0x80      // RFC 4122 variant
uuid = lowercase 8-4-4-4-12 hex of b
```

Reference impls: `bridge/src/codes.ts` `uuidForCode()` and
`@cumulusvpn/core` `appAccountToken()` — both pinned by a shared test
vector. The hash is one-way, so the bridge persists uuid → code at the
mandatory first `/v1/apple/verify`.

## Settlement pipeline

```
verified event ─▶ payments row (SQLite, UNIQUE(rail, event_key)) ─▶ pending
pending ─▶ broadcaster: select treasury UTXOs (minus in-flight outpoints),
           build v4 Sapling tx [N×20 FLUX → payment addr, OP_RETURN memo,
           change → treasury, nExpiryHeight = tip+40], sign (WIF), broadcast
broadcast ─▶ confirmer: ≥1 conf → confirmed; expired unmined → back to pending
```

- Monthly renewal = one 20-FLUX tx (stacks +30 d, per the entitlement rule);
  annual = one 240-FLUX tx = 12 months via the overpayment-multiples rule.
- **Plan changes are prorated, because chain grants are not refundable.**
  Switching plans puts a credit for the unused old plan and a charge for the
  new one on ONE Stripe invoice — but the old plan's days are already settled
  on chain. A full new grant on top would make the treasury pay for that
  overlap twice, so an invoice carrying proration lines grants
  `PLAN_DAYS × total_excluding_tax / list price` instead of the flat plan
  (`daysForInvoice`). That numerator is net of both the proration credit and
  any discount, and excludes tax — `subtotal` would be **pre**-discount and
  would over-grant a discounted switch. monthly→annual lands near 344 days
  rather than 360; annual→monthly nets to a credit and grants nothing (those
  annual days are still running). Invoices with **no** proration lines are
  untouched: a full plan, discounted or not — a promo buys a cheaper month,
  never a shorter one.
- **The plan is read from the invoice line's price id, never from
  `cvpn_plan` metadata.** Stripe writes that metadata once at Checkout and
  never rewrites it when a subscription's price changes, so after a portal
  switch it names the plan the customer *left*. Sizing grants from it hands
  an upgraded subscriber 30 days for a year's payment and a downgraded one a
  fresh 360 days every month. `planForLines` takes the largest positive
  line's price, with the metadata only as a fallback.
- **Test-mode invoices never settle** unless `STRIPE_TEST_GRANTS=true`,
  mirroring `APPLE_SANDBOX_GRANTS` / `GOOGLE_TEST_GRANTS`. They are verified
  and bound like any other, just not paid out — otherwise a single `4242`
  checkout against `sk_test_` broadcasts a real 20-FLUX tx and a testing
  session drains the treasury.
- **Store sandbox/test purchases settle a bounded probe grant.** Full grants
  stay off (`APPLE_SANDBOX_GRANTS` / `GOOGLE_TEST_GRANTS` default false) for
  the same reason test-mode Stripe invoices do — the sandbox renewal clock is
  accelerated, so a month renews in minutes and an idle test device would
  drain the treasury. But granting *nothing* is its own failure: App Review
  buys in the sandbox, and `store/app-store/app-review.md` tells the reviewer
  premium activates within a minute. A reviewer following our own instructions
  would watch the tier stay Free. `APPLE_SANDBOX_GRANT_DAYS` /
  `GOOGLE_TEST_GRANT_DAYS` (default 1) settle a token amount instead, keyed by
  `originalTransactionId` / `purchaseToken` — both constant for the life of a
  subscription — so every renewal and every Restore Purchases collapses onto
  one idempotency key. The worst case is one day's price per test
  subscription, once, ever: 0.67 FLUX against a store rejection.
- **Invoices settled from a credit balance grant nothing.** The only way a
  customer acquires credit is a downgrade, whose unused value we already paid
  out in full as irrevocable chain days; spending that credit again would buy
  the same time twice. They are covered by the existing zero-amount skip.
- Broadcasts are serialized through a single worker; our own 0-conf change
  is spendable, so bursts of renewals chain cleanly.
- Refunds/chargebacks: **chain grants are irrevocable** — accepted, bounded
  loss. The bridge halts future renewals (and cancels the Stripe sub).
- Treasury runs dry → rows stay `pending`, retry forever with backoff,
  operator is paged. Users see `pending` via the status endpoint.

## Vouchers & promo codes

Dashboard-managed codes (bridge SQLite; admin via `/internal/vouchers`,
proxied by the dashboard worker). Two types:

- **`grant_days`** — free time. Redemption enqueues a treasury settlement of
  `ceil(price_zats × days / 30)` zats (the CEIL is load-bearing: the gateway
  grants `floor(30 × amount/price)` days, and a floored payout would
  truncate to zero for 1-day grants). 30-multiples settle as whole price
  multiples and work on ANY gateway; day-granular values are gated by
  `DAY_GRANTS_ENABLED` until the fleet runs the pro-rata rule (docs/04).
  Every redemption spends real treasury FLUX — grants are as irrevocable as
  any chain payment; revoking a code only stops future redemptions.
- **`stripe_discount`** — percent off the card checkout. The bridge
  provisions one Stripe coupon per batch + one promotion code per voucher;
  the checkout endpoint applies it via `discounts` (deliberately not
  `allow_promotion_codes` — our box handles both code types with a uniform
  error taxonomy). Redemptions are attributed back from discounted
  `invoice.paid` webhooks for stats. Store-side IAP discounts are a
  different mechanism entirely: Apple Offer Codes / Play promo codes,
  console-configured, invisible to the bridge beyond ordinary purchases.

Code format: `CVPN-XXXXX-XXXXX` display, 10 chars canonical from a
31-char no-ambiguity alphabet (~2^49.5 entropy); vanity codes 6–20 chars
(≥8 for grants). Brute-force posture: 5/min/IP route limit + a global
breaker (>50 invalid-code attempts/10 min → 429 for all for 15 min +
operator alert). Redemption double-spend walls: `UNIQUE(voucher_id,
payment_code)` + the payments queue's `UNIQUE(rail, event_key)`.

## Client-facing API (`https://pay.cumulusvpn.com`, `{status,data}` envelope)

- `POST /v1/voucher/redeem` `{payment_code, code}` →
  `{type:'grant_days', days, state:'pending'}` (consumed; settles on-chain) or
  `{type:'stripe_discount', percent_off}` (not consumed; pass the code as
  `voucher` to checkout). Errors: `invalid` / `expired` / `exhausted` /
  `already_redeemed` / `temporarily_unavailable`.
- `POST /v1/stripe/checkout` `{payment_code, plan, voucher?}` → `{url, session_id}`
- `POST /v1/stripe/portal` `{payment_code, session_id}` → `{url}` — a Stripe
  billing-portal link (change card, switch plan, cancel). 404 `no_subscription`
  when the session is unknown, has no customer, or is bound to another code.
- `POST /v1/apple/verify` `{payment_code, signed_transaction}`
- `POST /v1/google/verify` `{payment_code, purchase_token}`
- `GET  /v1/payment/:code/status` → recent payments with
  `pending | broadcast | confirmed | failed` + `txid` — the "activating…"
  UX while waiting for the chain.
- Webhooks (not client-facing): `/v1/stripe/webhook`,
  `/v1/apple/notifications`, `/v1/google/rtdn`.

**Stripe redirect-URL contract** (enforced at bridge boot): `STRIPE_SUCCESS_URL`
must contain `{CHECKOUT_SESSION_ID}` inside the hash query
(`…#/upgrade?session={CHECKOUT_SESSION_ID}`) — the web app only shows the
activation panel, and only preserves a desktop `?code=` hand-off, when the
session comes back there. `STRIPE_CANCEL_URL` should be
`…#/upgrade?canceled=1` so a canceled checkout keeps the hand-off code alive.

### Why the portal is keyed on the Checkout Session, not the payment code

The payment code is `base58(sha256(device pubkey))`, and a client hands that
pubkey to **every gateway it enrolls with** — so any gateway operator can
derive their users' codes. Authorizing a billing portal on the code alone
would hand operators their users' billing email, card last-4, invoice history
and a cancel button. The Checkout Session id never leaves the buyer's own
browser, so it is the capability; the code is checked alongside it only to
bind the two (one device's session cannot open another's portal).

The consequence, and it is deliberate: **clearing browser storage loses the
in-app management link**, because there is no account to recover it from. The
web client keeps a `{code: session_id}` map in localStorage
(`PAY_PORTAL_SESSIONS_STORAGE_KEY`), keyed by code so a desktop `?code=`
hand-off manages the right device. Stripe's receipt emails carry the same
portal link and stay the documented fallback — the UI says so when the portal
call fails. Store subscribers (Apple/Google) never use this path: they manage
in the App Store / Play, which the mobile Upgrade screen deep-links to.

## What this deliberately does NOT change

- No accounts. The bridge stores payment codes and store-transaction ids,
  never emails, names, or card data (Stripe/Apple/Google hold those).
- Unlike gateways, the bridge is a **trusted, operator-run** component — but
  a compromised bridge can only *spend the treasury*; it cannot forge
  entitlements beyond what it pays for on-chain, and it cannot affect
  crypto-paying users at all.
- FLUX-direct payment stays first-class and cheapest (~$0.99 vs $1.99 fiat);
  fiat pricing absorbs store/processor fees plus the treasury payout.

Ops, deployment, and the treasury runbook: `bridge/README.md`.
