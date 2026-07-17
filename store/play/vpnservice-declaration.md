# Google Play — VpnService Declaration & Content Rating (CumulusVPN, Android)

## 1. VpnService declaration form

Where: Play Console → App content → **VPN service** (shown because the app uses the
`android.net.VpnService` API / holds `BIND_VPN_SERVICE`). Google requires apps that use
`VpnService` to declare it and to comply with the VPN policy (the app's core purpose must be VPN
functionality, it must use `VpnService` as the foundation, and it must be transparent about data
handling).

| Form field | Answer |
|---|---|
| Does your app use the VpnService API? | **Yes** |
| Is VPN functionality the app's core purpose? | **Yes** — CumulusVPN is a VPN client; the tunnel is the product. |
| Primary purpose of using VpnService | **To create a secure/encrypted WireGuard tunnel between the user's device and a user-chosen VPN gateway**, encrypting the device's internet traffic. |
| Does the app use VpnService to collect user data or monitor traffic? | **No.** The tunnel carries the user's own traffic to their chosen gateway. The app does not inspect, log, filter for profit, or redirect third-party traffic; no activity logs are kept. |
| Does the app manipulate/redirect ads or user traffic for benefit? | **No.** |
| Is it a local/on-device VPN (no remote server)? | **No** — it is a remote-server VPN (encrypts to remote gateways). |

**Declaration statement to paste (if a free-text box is provided):**
```
CumulusVPN is a consumer VPN client whose core purpose is to establish an encrypted WireGuard
tunnel from the device to a VPN gateway the user selects, protecting the user's traffic on
untrusted networks and letting them choose an exit country. It uses Android's VpnService
(BIND_VPN_SERVICE) as the foundation of this functionality via the official
com.wireguard.android:tunnel library. The app does not use VpnService to collect, log, or
monitor user traffic, does not manipulate ads, and does not redirect traffic for any purpose
other than the VPN the user explicitly enables. No account is required and no activity logs are
kept. Privacy policy: https://cumulusvpn.com/privacy
```

**Policy compliance checklist (Google VPN policy):**
- [x] Core purpose is VPN — yes.
- [x] Uses `VpnService` as the foundation — yes (wireguard-android over `VpnService`).
- [x] Declares in Data safety how it handles data — declared "no data collected" (see data-safety.md).
- [x] Does not use VPN to collect data / manipulate ads / redirect traffic for benefit — correct.
- [x] Discloses non-standard on-device data access — none.
- [x] Runs a foreground service with an ongoing notification while connected (VpnService best
      practice / Android FGS requirements) — ensure the tunnel service posts the required
      persistent notification.
- [x] Targets a recent `targetSdkVersion` per Play's current requirement (see runbook).

## 2. Content Rating questionnaire (IARC)

Where: Play Console → App content → **Content rating**. Category: **Utility / Productivity /
Communication (Tools)** — NOT a game. Answer **No** to all content questions.

| Question | Answer |
|---|---|
| Does the app contain violence? | No |
| Sexuality / nudity? | No |
| Profanity / crude humor? | No |
| Controlled substances (drugs, alcohol, tobacco)? | No |
| Gambling (simulated or real)? | No |
| Does the app share the user's current physical location with other users? | No |
| Does the app allow users to interact or exchange content / communicate? | No (no user-to-user messaging/social features) |
| Does the app allow purchase of digital goods? | No (no in-app purchase; premium is external via FLUX on the web) |
| Is the app a web browser / does it allow unrestricted internet content? | It is a **VPN**: it tunnels the device's own traffic; it is not a browser and provides no in-app content feed. Answer per IARC's VPN/utility wording; a VPN does not by itself raise the rating. |
| User-generated content? | No |
| Does it contain digital purchases with randomized/loot mechanics? | No |

Expected IARC output: **Everyone / PEGI 3 / rated for general audiences.** Some regions may
attach a VPN/utility note; that is expected and acceptable.

**Content-rating notes to keep on file:** CumulusVPN is a network utility with no in-app content,
no user interaction features, no ads, and no purchasable digital goods inside the app. All rating
questions are answered "No" truthfully.
