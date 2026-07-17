# Google Play Billing vs External Payment — CumulusVPN Stance

## Decision: ship "manage-on-web", no Play Billing, no in-app purchase at launch

Same posture as the iOS build (docs/05 "manage-on-web"): the Android store build is
**connect-only**. It never sells anything inside the app, so Google Play's Payments policy
(which requires Play Billing for in-app digital goods/subscriptions) simply **does not apply** —
there is no in-app transaction to route through any billing system.

### What the app does and does not do
- **Does:** connect/disconnect, pick a server, show the current tier (`free` / `premium`) as a
  neutral status fact returned by the gateway.
- **Does NOT:** contain a "Buy premium" button, a price/checkout screen, a subscription flow, or
  any purchase UI. Premium speed is bought with **FLUX cryptocurrency** on **cumulusvpn.com**
  (web/desktop), from the user's own wallet. Entitlement is chain-based and keyed to the WG
  public key, so the phone unlocks premium automatically (~1 min) with no in-app purchase.

### Why this is compliant
- **Play Payments policy** requires Play Billing when an app sells in-app digital goods or
  subscriptions. CumulusVPN sells nothing in-app; it only reflects a status derived from an
  external (blockchain) event. No digital good is delivered as the result of an in-app purchase,
  so Play Billing is not triggered.
- **Crypto for in-app digital goods is NOT an allowed alternative** to Play Billing — which is
  exactly why we keep the FLUX purchase entirely on the web and never inside the app.
- The store listing declares **In-app purchases: No** (consistent with the app containing none).

### On mentioning the website inside the app
Google is more permissive than Apple about a text mention of an external site. Still, to keep the
iOS and Android builds behaviorally identical and low-risk, the Android build also shows only a
plain informational line for free users (e.g. "Upgrade at cumulusvpn.com"). A non-deceptive
informational link is generally acceptable on Play; keep it non-checkout and non-misleading. Do
not present it as an in-app purchase.

### Fast-follow options (post-launch, if we want fiat reach)
1. **Add Google Play Billing** as an in-app fiat subscription for premium speed (Google's 15–30%
   fee applies). Keep FLUX on the web in parallel. This is the reach play every surviving dVPN
   eventually adds (docs/05, docs/08 #8).
2. **External offers program** (Google's alternative/external-billing programs where available)
   — legally fluid and still commissioned; do not depend on it at launch.

**Net:** launch pure-FLUX / manage-on-web with **no Play Billing integration**, declare no
in-app purchases, and treat Play Billing as an optional fiat fast-follow.
