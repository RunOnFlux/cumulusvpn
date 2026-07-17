# App Store — App Privacy "Nutrition Label" Answers (CumulusVPN, iOS)

Where to enter: App Store Connect → your app → **App Privacy**. Apple asks, per data type,
whether you collect it, and if so how it is used and whether it is linked to identity / used for
tracking. "Collect" in Apple's definition means transmitting data off the device **and
retaining it** beyond the transient processing needed to perform an action the user requested.

## Top-level answer

> **"Do you or your third-party partners collect data from this app?"** → **No, we do not
> collect data from this app.**

Result: the product page shows **"Data Not Collected."**

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
- **Payments** are made in FLUX on a public blockchain, on the web/desktop, from the user's own
  wallet — the app does not collect payment info, card data, or purchase history.
- **Optional crash reports** are strictly opt-in and off by default; if a reviewer considers
  opt-in diagnostics as "Diagnostics collected," see the fallback table at the bottom — but as
  shipped with crash reporting disabled by default, nothing is collected.

## Per-category answers (as presented in App Store Connect)

| Data type category | Collected? | Notes |
|---|---|---|
| Contact Info (name, email, phone, address, other) | **No** | No accounts. |
| Health & Fitness | **No** | — |
| Financial Info (payment, credit, other financial) | **No** | FLUX paid from user's own wallet on the web; app takes no payment data. |
| Location (precise, coarse) | **No** | Server country is a user choice, not device location. |
| Sensitive Info | **No** | — |
| Contacts | **No** | — |
| User Content (photos, audio, messages, other) | **No** | — |
| Browsing History | **No** | Never recorded. |
| Search History | **No** | — |
| Identifiers (User ID, Device ID) | **No** | No IDFA/IDFV/user ID collected. WG public key is transient routing token, not retained. |
| Purchases (purchase history) | **No** | No in-app purchase; entitlement derived from public chain, keyed to public key only. |
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

As currently designed (opt-in, default off), **Data Not Collected** stands.
