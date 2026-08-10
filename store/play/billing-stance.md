# Google Play Billing vs External Payment — CumulusVPN Stance

## Decision (revised 2026-08-09): Play Billing ADOPTED — the fiat fast-follow was executed

The original launch posture ("manage-on-web", no Play Billing — kept below as history) did its
job: it got the connect-only build through review cleanly. The fast-follow it explicitly
reserved (option 1 in the history section) has now been executed. The Play store build **sells
premium in-app** through Google Play Billing.

### What the store build sells
- One subscription product **`premium`** with two base plans:
  **`premium-monthly`** ($1.99/month) and **`premium-annual`** ($14.99/year).
- Integrated via **react-native-iap** (Play Billing). Each purchase carries
  `obfuscatedExternalAccountId` = the device's pseudonymous **payment code**, so the purchase
  can be credited to the right key with no account and no identity.
- Server side: receipts are verified by the payments bridge (docs/18-payments-bridge.md) at
  `pay.cumulusvpn.com`; on each verified purchase/renewal the bridge broadcasts a FLUX-chain
  transaction carrying the buyer's `CVPN1:<code>` memo from an operator treasury wallet. The
  **chain remains the only entitlement source — gateways were not changed.** Renewals arrive
  via Play **Real-time developer notifications (RTDN)**.

### Why this is compliant
- **Play Payments policy** requires Play Billing when an app sells in-app digital
  subscriptions — and that is exactly what the store build now uses. Google's 15–30% fee is
  the accepted cost of fiat reach.
- **Never present the subscription as "buying crypto."** The subscription IS the premium
  unlock; the chain settlement behind it is an internal fulfillment mechanism the buyer never
  sees. No wallet, exchange, or crypto UI exists in the store build.
- The store listing declares **In-app purchases: Yes ($1.99–$14.99)** (see `listing.md`), and
  the Data safety form declares purchase history collected (see `data-safety.md`).

### Refunds (internal caveat)
Chain grants are irrevocable: once the bridge has settled a period on-chain, that entitlement
cannot be clawed back. A store refund therefore stops **future** renewals; the already-granted
period is a bounded, accepted loss. Do not promise revocation anywhere.

### FLUX stays off the store build
The FLUX crypto purchase path remains **web / direct-APK only** — nothing about it moved into
the store build. Crypto for in-app digital goods is still not an allowed Play Billing
alternative, which is why the two paths stay strictly separated.

### Flag semantics (two flags, two jobs)
- **`iapPurchase`** (new; per-platform, Cloudflare KV, fails closed OFF) gates the Play
  Billing subscribe UI. It **MUST be ON before a build containing the UI is submitted for
  review** — reviewers must be able to find the declared IAPs. After approval it serves as an
  **emergency kill switch only**; never toggle it for merchandising, and never leave it OFF
  through a review of an IAP build.
- **`inAppUpgrade`** (old) still gates the crypto/FLUX UI: still hard-off on iOS at build
  level, still **OFF for Play builds**. Direct-APK Android distribution only.

---

## History — original launch stance (superseded 2026-08-09)

> Kept for the record. This was the launch posture; the "fast-follow option 1" below is what
> was executed.

### Decision: ship "manage-on-web", no Play Billing, no in-app purchase at launch

Same posture as the iOS build (docs/05 "manage-on-web"): the Android store build is
**connect-only**. It never sells anything inside the app, so Google Play's Payments policy
(which requires Play Billing for in-app digital goods/subscriptions) simply **does not apply** —
there is no in-app transaction to route through any billing system.

#### What the app does and does not do
- **Does:** connect/disconnect, pick a server, show the current tier (`free` / `premium`) as a
  neutral status fact returned by the gateway.
- **Does NOT:** contain a "Buy premium" button, a price/checkout screen, a subscription flow, or
  any purchase UI. Premium speed is bought with **FLUX cryptocurrency** on **cumulusvpn.com**
  (web/desktop), from the user's own wallet. Entitlement is chain-based and keyed to the WG
  public key, so the phone unlocks premium automatically (~1 min) with no in-app purchase.

#### Why this is compliant
- **Play Payments policy** requires Play Billing when an app sells in-app digital goods or
  subscriptions. CumulusVPN sells nothing in-app; it only reflects a status derived from an
  external (blockchain) event. No digital good is delivered as the result of an in-app purchase,
  so Play Billing is not triggered.
- **Crypto for in-app digital goods is NOT an allowed alternative** to Play Billing — which is
  exactly why we keep the FLUX purchase entirely on the web and never inside the app.
- The store listing declares **In-app purchases: No** (consistent with the app containing none).

#### On mentioning the website inside the app
Google is more permissive than Apple about a text mention of an external site. Still, to keep the
iOS and Android builds behaviorally identical and low-risk, the Android build also shows only a
plain informational line for free users (e.g. "Upgrade at cumulusvpn.com"). A non-deceptive
informational link is generally acceptable on Play; keep it non-checkout and non-misleading. Do
not present it as an in-app purchase.

#### Fast-follow options (post-launch, if we want fiat reach)
1. **Add Google Play Billing** as an in-app fiat subscription for premium speed (Google's 15–30%
   fee applies). Keep FLUX on the web in parallel. This is the reach play every surviving dVPN
   eventually adds (docs/05, docs/08 #8). ← **Executed 2026-08 — see the current stance above.**
2. **External offers program** (Google's alternative/external-billing programs where available)
   — legally fluid and still commissioned; do not depend on it at launch.

**Net (original):** launch pure-FLUX / manage-on-web with **no Play Billing integration**, declare no
in-app purchases, and treat Play Billing as an optional fiat fast-follow.
