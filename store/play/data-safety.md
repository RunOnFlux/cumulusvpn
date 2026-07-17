# Google Play — Data Safety Form Answers (CumulusVPN, Android)

Where: Play Console → App content → **Data safety**. Google requires you to declare data
collection/sharing, security practices, and (for VPN/security apps) may cross-check against an
independent security review. Answer truthfully; CumulusVPN's honest answer is "no data collected
or shared."

---

## Section 1 — Overview answers

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (traffic is WireGuard-encrypted; discovery/API use TLS) — declare "encrypted in transit" even though we collect nothing, since Google asks about the transport. |
| Do you provide a way for users to request that their data be deleted? | **Yes** — users can delete their key on-device (fully severs the pseudonymous link); there is no server-side personal-data store to delete. Provide the deletion/contact info: info@cumulusvpn.com and https://cumulusvpn.com/privacy. |

Because the answer to "collect or share" is **No**, Google will show **"No data collected"** and
**"No data shared with third parties"** on the listing. You still complete the security section
below.

## Section 2 — Per data-type declarations (all NOT collected, NOT shared)

Declare **not collected / not shared** for every category. Reference list:

- Location (approximate, precise) — **Not collected**
- Personal info (name, email, user IDs, address, phone, race/ethnicity, political/religious,
  sexual orientation, other) — **Not collected**
- Financial info (payment info, purchase history, credit score, other) — **Not collected**
  (FLUX is paid from the user's own wallet on the web; app takes no payment data)
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
| Is data encrypted in transit? | **Yes** — WireGuard for the tunnel; TLS for discovery and API calls. |
| Do you provide a way to request data deletion? | **Yes** — on-device key deletion + info@cumulusvpn.com. There is no persistent personal-data store; server peer state is RAM-only. |
| Has your app been independently validated against a security standard? | Optional. Answer **No** unless/until we complete a MASA (App Defense Alliance Mobile App Security Assessment). Recommended before or shortly after launch for a VPN app to strengthen trust. |
| Committed to Play Families policy? | **No** (not a Families/child-directed app). |

## Section 4 — Notes to keep the answer defensible

Google's reviewers may push back on a VPN declaring "no data collected." Be ready to explain
(same facts as the privacy policy and Apple label):
- No accounts, no email, no identifiers requested.
- Real IP is processed transiently to route packets and never logged/retained — Google's
  definition of "collect" excludes transient processing not sent off-device to a persistent
  store. We do not retain it, so it is not "collected."
- Public key is a routing token generated on-device, not tied to identity, not retained as a
  user record.
- No analytics/ads SDKs bundled.
Keep the privacy policy URL live and consistent with these answers before submitting — Google
compares the form to the policy and to a traffic scan of the app.
