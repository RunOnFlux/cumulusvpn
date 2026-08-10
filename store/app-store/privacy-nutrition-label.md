# App Store — App Privacy "Nutrition Label" Answers (CumulusVPN, iOS)

Where to enter: App Store Connect → your app → **App Privacy**. Apple asks, per data type,
whether you collect it, and if so how it is used and whether it is linked to identity / used for
tracking. "Collect" in Apple's definition means transmitting data off the device **and
retaining it** beyond the transient processing needed to perform an action the user requested.

## Top-level answer (updated 2026-08-09 — IAP subscriptions added)

> **"Do you or your third-party partners collect data from this app?"** → **Yes, we collect
> data from this app.**

We now sell auto-renewable subscriptions via Apple IAP, and we retain — server-side, keyed to
the pseudonymous payment code — the store transaction identifiers (purchase history) needed to
grant and renew premium. That is "collected" under Apple's definition, so **exactly one** data
type is declared:

| Data type | Collected | Purpose | Linked to identity | Used for tracking |
|---|---|---|---|---|
| **Purchases → Purchase History** | **Yes** | **App Functionality** | **No** | **No** |

Everything else remains **Not collected**. **Financial Info stays "No"** — Apple processes the
payment; card/payment-instrument data never reaches us.

Result: the product page **no longer shows the "Data Not Collected" badge** — that badge is
lost by design with the IAP launch. It instead shows "Data Not Linked to You: Purchases."

### Why this is the correct and truthful answer

- **No account data:** no name, email, phone, user ID, or credentials are ever requested.
- **The WireGuard public key** is a locally generated pseudonymous routing token, not tied to
  identity, and is used transiently to route the tunnel — it is not retained as a user record.
  (If a reviewer questions it, explain it is analogous to a session token used only to provide
  the service the user requested; the private key never leaves the device.)
- **Real IP address** is processed transiently at the network layer to route packets, as any
  server must, and is **not logged or retained** — so it is not "collected" under Apple's
  definition.
- **Server-side peer state is RAM-only** and erased on disconnect/restart; nothing is written to
  a persistent store or shipped to a central server.
- **No analytics or advertising SDKs** are embedded. No IDFA/IDFV is requested; App Tracking
  Transparency is not triggered because we do not track.
- **Payments:** Apple processes the in-app subscription; we never see card or
  payment-instrument data (Financial Info = No). What we do retain is the **purchase history**
  (store transaction identifiers) keyed to the pseudonymous payment code — declared above as
  Purchases, App Functionality, not linked to identity, not used for tracking. The
  `appAccountToken` on each purchase is a UUID one-way derived from that code, not an identity.
- **Optional crash reports** are strictly opt-in and off by default; if a reviewer considers
  opt-in diagnostics as "Diagnostics collected," see the fallback table at the bottom — but as
  shipped with crash reporting disabled by default, no diagnostics are collected.

## Per-category answers (as presented in App Store Connect)

| Data type category | Collected? | Notes |
|---|---|---|
| Contact Info (name, email, phone, address, other) | **No** | No accounts. |
| Health & Fitness | **No** | — |
| Financial Info (payment, credit, other financial) | **No** | Apple processes the IAP payment; we never receive card/payment-instrument data. (FLUX remains web-only, paid from the user's own wallet.) |
| Location (precise, coarse) | **No** | Server country is a user choice, not device location. |
| Sensitive Info | **No** | — |
| Contacts | **No** | — |
| User Content (photos, audio, messages, other) | **No** | — |
| Browsing History | **No** | Never recorded. |
| Search History | **No** | — |
| Identifiers (User ID, Device ID) | **No** | No IDFA/IDFV/user ID collected. WG public key is transient routing token, not retained. |
| Purchases (purchase history) | **Yes** | Store transaction ids / purchase tokens retained server-side, keyed to the pseudonymous payment code. Purpose: App Functionality. **Not linked to identity** (no accounts, no email), **not used for tracking**. |
| Usage Data (product interaction, ads, other) | **No** | No analytics SDK. |
| Diagnostics (crash, performance, other) | **No** (default) | Crash reporting is opt-in and OFF by default; if enabled by user, see fallback below. |
| Surroundings / Body / Other Data | **No** | — |

## ATT (App Tracking Transparency)
- We do **not** track users across apps/websites owned by other companies.
- We do **not** call `requestTrackingAuthorization` and include no ad/attribution SDKs.
- No `NSUserTrackingUsageDescription` key is needed.

## Fallback (only if you later enable crash reporting by DEFAULT)
If a future build turns crash reporting on by default, update the label to:

| Data type | Collected | Linked to you | Used for tracking | Purpose |
|---|---|---|---|---|
| Diagnostics → Crash Data | Yes | **No** | **No** | App Functionality (bug fixing) |

As currently designed (opt-in, default off), Diagnostics stays **No** — the only declared data
type remains Purchases → Purchase History.
