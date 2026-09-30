# 04 — Payments & entitlements (no accounts, no cards)

## Principle

A payment is a **fact on the Flux blockchain**, not a row in our database. Every gateway derives
the same entitlement state by scanning the chain. There is no activation server, no webhook, no
account. This copies the battle-tested mechanism FluxOS itself uses for app registration payments
(fixed address + 64-char hash in OP_RETURN, scanned by `explorerService.js`).

> **Fiat rails (18-payments-bridge.md):** card/IAP subscriptions do not weaken this principle.
> The operator-run bridge verifies a Stripe/Apple/Google payment and then **broadcasts the same
> FLUX tx a crypto user would have sent** (treasury wallet, buyer's memo). Gateways still trust
> only the chain; the bridge is a payer into the system, not an entitlement source. The webhooks
> it consumes are between the bridge and the payment providers — gateways still have none.

## The protocol

### Identity
- The client's WireGuard public key `K` (32 bytes) is the identity.
- The memo carries `H = base58(SHA256(K)[0:20])` (~27 chars) — the **payment code** — rather than
  the raw key, so the chain does not directly publish which WG pubkey was bought (weak but free
  privacy; anyone who already knows `K` can link it — see Privacy below).
- **Losing the key loses what was paid to it**, so the mobile app keeps it across uninstalls
  (`clients/mobile/src/state/identity.ts`), in three layers:
  1. **Automatic backup, on by default** (Settings → Your identity; switching it off deletes the
     backup). Android: Google **Block Store** — kept across reinstall while Google backup is on,
     moved to a new phone in device-to-device setup, and sent to Google's cloud ONLY when that
     copy is end-to-end encrypted (screen lock set); otherwise device-only. iOS: the **Keychain**
     (`AfterFirstUnlock`, survives delete + reinstall), deliberately **not** iCloud-Keychain
     synced — that would put one WireGuard key on every device of the Apple ID at once, and two
     devices on one key fight over the same tunnel. The stored value is the recovery key string.
  2. **Recovery key** (`CVPN-…`, core `encodeRecoveryKey` / `decodeRecoveryKey`): version ‖ key ‖
     sha256(version ‖ key)[0:4], base58, grouped by five, so a typo fails instead of restoring a
     different identity. Shown/shared from Settings; "Restore from recovery key" replaces the
     identity (disconnecting first). The only way back for a FLUX payer without a backup, and
     for phones without Play services.
  3. **Store subscriptions follow the store account** (docs/18 "Claims and transfers"): the app
     claims unowned purchases (offer/promo codes redeemed outside the purchase sheet)
     automatically, but a subscription owned by another identity is only MOVED on the user's
     tap ("Move it here") — an iPad and an iPhone on one Apple ID would otherwise tug it back
     and forth.

  One invariant: **never overwrite a backup that holds a different valid identity** — it may be
  the paid one (an install that began while Block Store was briefly unreadable mints a new key).
  It is surfaced as "the backup holds a different identity" with Switch / Keep; only a deliberate
  action replaces it. The in-app 5.4 disclosure (DISCLOSURE_VERSION 3) and the privacy policy
  §4.1 / §12 describe the backup.

### Memo format (OP_RETURN, ≤80 bytes standard relay)
```
CVPN1:<payment-code>
e.g. CVPN1:3QJmnh8vzBqoQpuTGDsUCkbFyxVQ
```
- `CVPN1` = protocol tag + version. Anything else in OP_RETURN is ignored by scanners.
- Client apps and the web onboarding page compute and display this string + a QR code.
  The wallet URI **must percent-encode the memo** — Zelcore's `zel:` parser (and the
  BIP21 `flux:` parser) split the raw URI on `:`, so an unencoded `CVPN1:<code>` colon
  makes them treat the fragment after it as the destination address. Two forms (see
  `@cumulusvpn/core` `walletDeepLink`): tap/deep-link uses Zelcore's protocol
  `zel:?action=pay&coin=flux&address=…&amount=20&message=CVPN1%3A<code>`; the QR uses
  BIP21 `flux:t1PayAddress?amount=20&message=CVPN1%3A<code>`. The wallet
  `decodeURIComponent`s the memo back to `CVPN1:<code>` before signing, so the on-chain
  OP_RETURN is exactly `CVPN1:<code>`.

### Payment rule (evaluated identically by every gateway)
A tx grants entitlement iff:
1. it pays `≥ price / 30` — one day's worth — to `CVPN_PAYMENT_ADDRESS`, where `price` is the
   schedule's **effective price at the tx's own block height** (see "Price in FLUX vs $0.99"
   below; the schedule lives in the app spec env, the single source of truth all gateways
   share), and
2. it carries exactly one valid `CVPN1:` memo, and
3. it has ≥ 1 confirmation (30 s blocks; optional optimistic 0-conf unlock while pending).

Effect: `paid_until[H] = max(now, paid_until[H]) + days`, where
`days = floor(30 × amount / price)` — pro-rata by the day. Whole multiples of the price grant
whole 30-day months (pay 3× → 90 days) exactly as the original rule did; sub-price amounts grant
days, which is how the payments bridge settles short vouchers ("7 days free", docs/18). Fiat and
voucher settlements round their payout UP to the next whole zat (`ceil(price_zats × days / 30)`)
so the day computation never truncates. Payments stack (prepay up to 24 months / 720 days).
Note the rule is retroactive at backfill: historical txs between `price/30` and `price` —
previously ignored as underpayment — grant their pro-rata days once a gateway runs this rule.

### Price in FLUX vs $0.99
**Promise: paying in FLUX always costs under $0.99 per 30 days.** FLUX/USD moves and gateways
must agree on one number without an oracle, so the price is an owner-updated, chain-anchored
**schedule** in the app spec env, read identically by every gateway and the payments bridge:

```
CVPN_PRICE_SCHEDULE=20@0,12@2985997   # 20 FLUX until block 2985996, 12 FLUX from 2985997
CVPN_PRICE_FLUX=12                    # latest price, for gateway images older than schedules
```

- **Prospective, never retroactive.** A tx is judged by the price in force at the height it was
  *mined* at, so a reprice cannot change what any past payment granted. (The original single
  `CVPN_PRICE_FLUX` constant re-judged all history at every backfill: a drop turned every old
  month into more days, and a rise would have silently clawed days back from people who paid.)
- **72 h grace.** For 8,640 blocks after a change, a tx is judged against the *lowest* price in
  force during that window. After a drop the new price applies at once; after a rise, anyone
  quoted the old price mid-flight still gets a full month. Grace only ever favours the payer.
- **Append-only.** A reprice appends one entry a few blocks ahead of the tip. Editing an old
  entry would re-judge history; the tooling refuses to push that
  (`deploy/scripts/update-image.mjs`).
- **Fast propagation.** Each gateway (≥ 0.4.0) re-reads its own spec every 5 min
  (`/apps/appspecifications/$FLUX_APP_NAME` on the host node) and hot-applies a new schedule —
  no need to wait hours for Flux to redeploy the container. Only *appended* entries are
  hot-applied: one starting above the scan cursor is swapped in as-is; one that reached the node
  after its start height rebuilds the map from height 0, and the rebuild is discarded if the
  history it read is missing a tx the node already folded. A spec that *edits* existing entries
  is never hot-applied (it would re-judge history fleet-wide within minutes); it takes effect at
  the next redeploy. `reprice.mjs` dates new entries ~2 h ahead so every gateway has the entry
  before it starts.
- **Capable images only.** A pre-0.4.0 gateway reads only `CVPN_PRICE_FLUX` and re-judges all
  history at it, so `update-image.mjs` refuses a multi-entry schedule on any app whose image
  predates 0.4.0 — the reprice rolls image and price in one update.
- **The bridge** sizes each fiat/voucher settlement at broadcast time from the same schedule: the
  highest effective price anywhere in the window the tx can be mined in (tip … expiry), so a
  settlement never lands short of the days it was bought for.

**Keeping the promise.** `deploy/countries.yaml` holds the canonical schedule and a USD band
(`floorUsd` $0.70, `targetUsd` $0.85, `ceilingUsd` $0.95). Hourly, `.github/workflows/price-watch.yml`
checks the fleet's current price × median FLUX/USD (CoinGecko, Kraken, KuCoin, Gate.io) against
the band, that all specs carry the same schedule, and that the served directory quotes it — and
opens a `price-alert` issue with the exact fix when any of that fails. The fix is one command:

```
cd deploy && node scripts/reprice.mjs --usd 0.85 --apply --broadcast
```

which appends the entry, patches every gateway spec (free app updates, batched), re-signs the
client directory, rebuilds the landing page, and prints the bridge env to set. The $0.95 ceiling
plus a $0.85 target leave ~15% of FLUX appreciation before the next reprice is due.

Clients display the live price with the ceiling: "Send **12 FLUX** (< $0.99) with this exact
message."

### Wallet UX
- Zelcore, SSP Wallet and the explorer all support OP_RETURN messages on sends ("message" field).
- Apps: "Upgrade" screen → shows amount + address + memo + QR + wallet deep links — but ONLY where
  the `inAppUpgrade` flag allows it (web, desktop link-out, direct-APK Android). **Store builds show
  no crypto surface at all** — they sell premium via store-billing subscriptions instead
  (`iapPurchase` flag, settled on-chain by the bridge; see 05 and 18-payments-bridge.md).
- Failure modes handled: wrong/no memo → funds arrive but no entitlement: publish a signed
  refund/claim procedure (prove key ownership by signing a challenge with the WG private key +
  prove payment tx; manual at first, tooling later). Underpayment → ignored, same claim path.

## Privacy analysis (be honest in docs & marketing)

- On-chain observers see: payment address received X FLUX with code `H` at time T. If they later
  obtain `K` (e.g., they run a rogue gateway you enrolled with), they can link your FLUX source
  address to your VPN key. Mitigations, in order of effort:
  1. **v1 (ship):** hash-code memo (done above); advise paying from a fresh address; amounts are
     uniform so amount-fingerprinting is moot.
  2. **v1.5:** per-key *payment keys* — client derives a separate keypair for payment identity;
     gateway accepts `H = hash(payment_pubkey)` where enrollment presents a signature binding
     payment key → WG key. Chain then never contains anything derivable from the tunnel key.
  3. **v2 (Mullvad-style unlinkability):** blind-signature vouchers — user pays with memo of a
     *blinded* token, a quorum of gateways (or a signing service run from the app spec itself)
     signs it, user unblinds and redeems the voucher at any gateway. Removes even the
     pay-tx ↔ key link. Design doc when we get there.
- Multi-chain FLUX (parallel assets on ETH/BSC/SOL/…) has no OP_RETURN — v1 is native-chain only.
  If demand appears: per-chain memo mechanisms or a swap widget, later.

## Free tier

No payment, no enrollment beyond `POST /v1/enroll`. 100 KB/s per key, light PoW at enroll,
aggregate free-pool bandwidth cap per gateway. Free tier is the growth engine and the goodwill
engine — it must genuinely work (browsing, messaging), just not be pleasant for video/torrents.

## Treasury

Payments accumulate at `CVPN_PAYMENT_ADDRESS` (recommend 2-of-3 multisig from day one). Revenue
funds the app-spec renewals — the system pays for its own infrastructure; document this publicly,
it's a great story ("your $0.99 literally buys the network's compute").
