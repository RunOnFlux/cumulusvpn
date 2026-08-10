# Google Play — Data Safety Form Answers (CumulusVPN, Android)

Where: Play Console → App content → **Data safety**. Google requires you to declare data
collection/sharing, security practices, and (for VPN/security apps) may cross-check against an
independent security review. Answer truthfully; since the in-app subscription launched
(2026-08-09), CumulusVPN's honest answer is "purchase history is collected — nothing else, and
nothing is shared."

---

## Section 1 — Overview answers

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** — exactly one type: Financial info → Purchase history (see Section 2). |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — all actual user traffic rides the WireGuard-encrypted tunnel. (The gateway control/discovery API is plain HTTP, but every response is ed25519-signed and verified by the app, and it carries only public gateway metadata plus your public routing key — no private or sensitive data, and no TLS.) Declare "encrypted in transit" since the question concerns collected user data, whose carrier is the encrypted tunnel. |
| Do you provide a way for users to request that their data be deleted? | **Yes** — users can delete their key on-device (fully severs the pseudonymous link); there is no server-side personal-data store to delete. Provide the deletion/contact info: info@cumulusvpn.com and https://cumulusvpn.com/privacy. |

Because purchase history is now collected, the listing will no longer show the blanket
**"No data collected"** badge — it will show the single declared type instead, still with
**"No data shared with third parties."** You still complete the security section below.

## Section 2 — Per data-type declarations (one collected type; everything else NOT collected, NOT shared)

Declare **not collected / not shared** for every category except Financial info. Reference list:

- Location (approximate, precise) — **Not collected**
- Personal info (name, email, user IDs, address, phone, race/ethnicity, political/religious,
  sexual orientation, other) — **Not collected**
- Financial info:
  - **Purchase history — Collected, not shared.** Purpose: **App functionality**. We retain,
    server-side, the Play purchase token / transaction ids for the in-app `premium`
    subscription, keyed to the device's pseudonymous payment code
    (`obfuscatedExternalAccountId`) so premium can be granted and renewed — not linked to an
    identity (no accounts), not used for tracking, never shared.
  - Payment info, credit score, other — **Not collected.** The payment itself is handled by
    Google Play; card/payment-instrument data never reaches us. (FLUX remains a web-only
    option paid from the user's own wallet; the Play build contains no crypto purchase.)
- Health and fitness — **Not collected**
- Messages (emails, SMS, other in-app messages) — **Not collected**
- Photos and videos — **Not collected**
- Audio (voice, music, other) — **Not collected**
- Files and docs — **Not collected**
- Calendar — **Not collected**
- Contacts — **Not collected**
- App activity (interactions, in-app search, installed apps, other user-generated content) —
  **Not collected**
- Web browsing history — **Not collected**
- App info and performance (crash logs, diagnostics, other) — **Not collected** by default
  (crash reporting is opt-in, OFF by default; if you later default it on, declare Crash logs /
  Diagnostics = Collected, purpose App functionality, not linked to user, not shared)
- Device or other IDs — **Not collected** (no advertising ID; the WireGuard public key is a
  transient on-device routing token, not retained as a user identifier)

## Section 3 — Security practices

| Question | Answer |
|---|---|
| Is data encrypted in transit? | **Yes** — WireGuard encrypts the tunnel (all user traffic). The gateway control/discovery API is plain HTTP but ed25519-signed and verified by the app (integrity, not TLS); it carries only public gateway data + your public routing key. |
| Do you provide a way to request data deletion? | **Yes** — on-device key deletion + info@cumulusvpn.com. There is no persistent personal-data store; server peer state is RAM-only. |
| Has your app been independently validated against a security standard? | Optional. Answer **No** unless/until we complete a MASA (App Defense Alliance Mobile App Security Assessment). Recommended before or shortly after launch for a VPN app to strengthen trust. |
| Committed to Play Families policy? | **No** (not a Families/child-directed app). |

## Section 4 — Notes to keep the answer defensible

Google's reviewers may push back on a VPN declaring almost nothing collected. Be ready to
explain (same facts as the privacy policy and Apple label):
- The only collected type is **purchase history** for the in-app subscription (Play purchase
  tokens keyed to a pseudonymous payment code, App functionality, not shared); the payment
  instrument itself is Google's, not ours.
- No accounts, no email, no identifiers requested.
- Real IP is processed transiently to route packets and never logged/retained — Google's
  definition of "collect" excludes transient processing not sent off-device to a persistent
  store. We do not retain it, so it is not "collected."
- Public key is a routing token generated on-device, not tied to identity, not retained as a
  user record.
- No analytics/ads SDKs bundled.
Keep the privacy policy URL live and consistent with these answers before submitting — Google
compares the form to the policy and to a traffic scan of the app.
