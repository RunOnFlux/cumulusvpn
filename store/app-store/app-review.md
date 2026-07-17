# App Store — App Review Package (CumulusVPN, iOS)

Everything a reviewer needs, plus the exact answers for the technical/compliance forms.

---

## 1. Network Extension / NEVPNManager justification (for App Review Notes + entitlement request)

Apple requires (Guideline 5.4) that VPN apps come from an **organization** developer account,
use the official **Personal VPN (NEVPNManager) / Packet Tunnel Provider** APIs, and request the
Network Extension entitlement. Use this text both in the entitlement request and in the review
notes.

```
CumulusVPN is a consumer VPN client. It uses Apple's Network Extension framework
(NEPacketTunnelProvider, class com.cumulusvpn.app.PacketTunnel) driven via NEVPNManager /
NETunnelProviderManager to establish a WireGuard tunnel from the device to a user-chosen VPN
gateway. We use the official WireGuardKit (wireguard-apple) implementation on top of the
Packet Tunnel Provider — no private APIs.

Purpose of the VPN: encrypt the user's internet traffic to protect them on untrusted networks
(public Wi-Fi, hotels, etc.), let them choose an exit country, and route DNS through the tunnel.
The extension only carries the user's own traffic to the selected gateway; it does not filter,
inspect, monetize, or redirect third-party app traffic for any purpose other than the VPN the
user explicitly enabled. There is no MDM, content filter, or ad-blocking behaviour.

We do not sell or share user data (Guideline 5.4 / 5.1.1). The service requires no account and
keeps no activity logs; server-side peer state is held in memory only. Entitlements requested:
Personal VPN + Network Extensions (Packet Tunnel Provider). App group is used only to pass tunnel
configuration to the extension on-device.
```

**Entitlements to enable in the App ID / provisioning:**
- `com.apple.developer.networking.networkextension` → value `packet-tunnel-provider`
- `com.apple.developer.networking.vpn.api` → `allow-vpn` (Personal VPN)
- App Group shared by app + extension (e.g. `group.com.cumulusvpn.app`) for on-device config
  hand-off.

The Network Extension entitlement is **request-gated by Apple** — see the runbook
(docs/12) for the exact request flow; it can take several days and must be approved before a
build with the entitlement will validate.

---

## 2. Reviewer Notes (paste into "App Review Information → Notes")

```
WHAT THE APP DOES
CumulusVPN is a WireGuard VPN client. On first launch it generates a WireGuard key locally and
connects to a free gateway. Tap the big button to connect/disconnect; use the country picker to
choose a server. No login is required or possible — there are no accounts.

HOW TO TEST (no credentials needed)
1. Launch the app. It auto-generates a key and connects to a free server within a few seconds.
2. Tap disconnect / connect to toggle the tunnel. iOS will show the standard VPN permission
   prompt on first connect (NEVPNManager) — approve it.
3. Use the country list to switch servers.
4. The "tier" line shows Free. Multi-hop is an optional toggle in settings (off by default).
No account, no test user, and no payment are required to fully exercise the app.

PAYMENTS / IN-APP PURCHASE (Guideline 3.1.1)
This build contains NO in-app purchase and NO purchase UI. The app is "manage-on-web": premium
speed is optional and is purchased on our website (cumulusvpn.com) using FLUX cryptocurrency from
the user's own external wallet. The app only DISPLAYS the current tier (a neutral status fact
returned by the server) and, for free users, a non-interactive line of text: "Upgrade at
cumulusvpn.com". There is no tappable link out to purchase and no "Buy" button anywhere in the
iOS build, consistent with 3.1.1(a) and 3.1.3. We are not using 3.1.5(b) crypto-exchange
provisions; we simply do not sell anything inside the app.

PRIVACY
No account, no email, no logs. The public key shown/used is a routing token, not personal data.
See privacy policy: https://cumulusvpn.com/privacy

NETWORK EXTENSION
Uses NEPacketTunnelProvider + WireGuardKit (official Apple Network Extension APIs). No private
APIs. See the VPN justification we provided with the entitlement request.

CONTACT
Reviewer questions: info@cumulusvpn.com
```

---

## 3. Compliance checklist against the guidelines that matter for VPN + crypto apps

| Guideline | Requirement | How CumulusVPN complies |
|---|---|---|
| 5.4 (VPN) | Org account, NEVPNManager, no data sale, available only where legal | Org account; WireGuardKit over NEVPNManager; no data collected/sold; regional availability list excludes prohibited markets (see below). |
| 5.4 | Explain what user data is collected and how used | "Data Not Collected"; explained in review notes + privacy policy. |
| 3.1.1(a) | Digital goods/functionality must use IAP | No IAP and no purchase UI in-app; premium sold on web with FLUX. App only shows tier status. |
| 3.1.3 | No steering to external purchase inside iOS app | No tappable external purchase link; only a plain text mention of the website. |
| 3.1.5(b) | Crypto apps may facilitate exchange but not sell own goods | We do NOT rely on this; the app performs no crypto transaction and sells nothing in-app. |
| 2.1 (completeness) | App must be testable | Fully testable with no account/credentials; steps above. |
| 4.0 / 4.2 | Not a thin/wrapper app | First-party native client with real UI, tunnel, discovery, failover, multi-hop. |
| 2.5.1 | Public APIs only | Official Network Extension APIs; no private APIs. |

---

## 4. Age Rating questionnaire answers (App Store Connect → Age Rating)

Answer **None / No** to all content-frequency questions. Expected result: **4+**.

| Question | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Contests | None |
| Unrestricted Web Access | **No** — the app is a VPN and does not embed a web browser or provide unrestricted in-app web browsing; it tunnels the device's own traffic. (If Apple's newer questionnaire asks about a VPN specifically, answer honestly that it is a VPN utility.) |
| Gambling and Contests | No |
| Made for Kids / Kids Category | **No** — general audiences, not in the Kids category. |

Note: Apple's current age-rating flow (2025+) may ask capability questions (e.g. "Does your app
provide unrestricted web access?" and "Is your app a VPN?"). Answer **VPN = yes** where asked;
it does not by itself raise the rating. Target rating **4+ / 17+** is acceptable — Apple may
apply 17+ automatically to VPN/unrestricted-access utilities; do not contest it.

---

## 5. Export Compliance (encryption) — ITSAppUsesNonExemptEncryption

The app uses standard, published cryptography (WireGuard: Curve25519, ChaCha20-Poly1305,
BLAKE2s; TLS for discovery). This qualifies for the standard exemption for apps that merely use,
rather than implement proprietary, encryption and that are not designed for the encryption
market itself.

**Recommended approach — declare in Info.plist so App Store Connect stops asking:**
```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```
Set to `false` because the encryption we use is limited to standard algorithms exempt under U.S.
EAR 740.17(b)(1) / mass-market note. This means: **no annual self-classification report (ERN /
CCATS) and no French declaration are required for standard-crypto exemption**, and App Store
Connect will not prompt for export compliance on each build.

If App Store Connect still prompts, answer:
- "Does your app use encryption?" → **Yes**
- "Does it qualify for any exemptions?" → **Yes** (uses only standard/exempt encryption; not
  proprietary; not designed to run in the encryption market).
- "Do you use encryption that is not exempt?" → **No** → no CCATS/ERN needed.

Keep a note on file that this determination is for standard WireGuard/TLS crypto only; revisit
if we ever add proprietary or non-standard cryptography.

---

## 6. Regional availability (Guideline 5.4 "available only where legal")

Set **Availability** in App Store Connect to exclude markets where consumer VPN apps are illegal
or require a government license we do not hold. At minimum exclude:

- **China mainland**, **Russia**, **United Arab Emirates**, **Oman**, **Iran**, **North Korea**,
  **Turkmenistan**, **Belarus**, and any market our launch legal review flags.

Rationale and cross-reference: docs/05 (Apple 5.4 regional availability) and docs/06 (legal &
abuse — datacenter-only placement, no-logs posture). Finalize the exact exclusion list with
counsel at launch (docs/08 open question #10). Keep the list identical on Play where possible.
