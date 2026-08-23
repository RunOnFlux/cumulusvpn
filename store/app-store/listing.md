# App Store Connect — Listing Copy (CumulusVPN, iOS)

All fields below are ready to paste into App Store Connect. Character limits are Apple's;
counts are noted and were verified to fit. Primary locale: **English (U.S.)**.

Bundle ID: `com.cumulusvpn.app` · Tunnel extension: `com.cumulusvpn.app.PacketTunnel`

---

## App Name (max 30) — 10 chars
```
CumulusVPN
```
Note: The generic "FluxVPN" name is crowded on the stores (see docs/08). We ship as
**CumulusVPN** and describe "powered by Flux Cloud" in the subtitle/body rather than in
the app name, to keep the name clearable and distinct.

## Subtitle (max 30) — 24 chars
```
Private VPN. No account.
```
Alternate (22): `No-account private VPN`

## Promotional Text (max 170, editable anytime without review) — 149 chars
```
No sign-up, no email, no logs. Generate a key, tap connect. Multi-hop routing means no single server ever sees both who you are and where you go.
```

## Keywords (max 100, comma-separated, no spaces) — 90 chars
```
vpn,wireguard,privacy,no log,decentralized,flux,secure,tunnel,anonymous,wifi,proxy,cumulus
```
Rationale: the app name and subtitle already carry "CumulusVPN / private / account", so keywords
avoid repeating them (Apple indexes name+subtitle+keywords together). No competitor brand names
(Apple rejects those).

`cumulus` is the one deliberate exception. Apple indexes name+subtitle+keywords as one token set,
and it is undocumented whether it splits the compound `CumulusVPN` into `cumulus` + `vpn`. If it
does not, the very common query "cumulus vpn" matches only the `vpn` half and we lose our own
brand search. The standalone token costs 8 of the 18 spare characters and removes that risk —
`cumulus` is not a repeat of `cumulusvpn`, it is the token that might otherwise not exist.

## Support URL
```
https://cumulusvpn.com/support
```

## Marketing URL (optional)
```
https://cumulusvpn.com
```

## Privacy Policy URL (required for apps with accounts/data; we still provide it)
```
https://cumulusvpn.com/privacy
```

## In-App Purchases (shown on the product page)

Two auto-renewable subscriptions, App Store Connect subscription group **"Premium"**. Their
display names + prices appear on the product page under "In-App Purchases" once approved:

| Product ID | Display name | Price |
|---|---|---|
| `cvpn.premium.monthly` | Premium Monthly | $1.99 / month |
| `cvpn.premium.annual` | Premium Annual | $14.99 / year |

**Auto-renewable subscription metadata requirements (Guideline 3.1.2):** the app metadata must
carry a functional **Terms of Use (EULA)** link and the **Privacy Policy** link. We use Apple's
standard EULA, so no custom EULA upload — reference it in the description/metadata:

- Terms of Use (EULA): `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`
- Privacy Policy: `https://cumulusvpn.com/privacy`

Both links are also reachable in-app from the subscribe section (alongside Restore Purchases
and the Manage Subscription link) — keep the metadata and in-app links in sync.

## Copyright
```
2026 CumulusVPN
```

## Primary Category
```
Utilities
```
## Secondary Category (optional)
```
Productivity
```

---

## Description (max 4000)

```
CumulusVPN is a decentralized VPN that respects your privacy by design — not by promise.

NO ACCOUNT, EVER
There is no sign-up, no email, no password, no phone number. Open the app and it generates a
private key on your device. That key is your only identity, and it never leaves your phone.

NO LOGS, AND WE MEAN IT
We do not record the sites you visit, your DNS queries, your traffic, or your connection
history. Our servers keep the minimum routing state in memory only — it is erased when the
server restarts. There is no activity database to leak, sell, or hand over, because it does
not exist.

ONE TAP TO CONNECT
Pick a country, tap connect. Modern WireGuard® encryption protects your traffic on public
Wi-Fi, hotels, airports, and untrusted networks. Fast handshakes, automatic reconnection, and
gateway failover keep you online.

FREE TIER FOREVER
Every install includes a genuinely free tier — no trial, no card, no account.

PREMIUM, IF YOU WANT IT
Premium lifts the speed cap and gives you full speed on every server in the network. It is an
optional auto-renewable subscription — Premium Monthly at $1.99/month, or Premium Annual at
$14.99/year — and the free tier never expires if you skip it. Because there is no account,
premium applies to the device you buy it on rather than to a person, so a second device needs
its own subscription. Cancel any time in your App Store subscriptions.

Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://cumulusvpn.com/privacy

RUN ON A DECENTRALIZED NETWORK
CumulusVPN servers run as apps on the Flux decentralized cloud, hosted in commercial
datacenters by independent operators — not on a single company's servers. It is a different,
more resilient shape for a VPN.

OPTIONAL MULTI-HOP FOR MAXIMUM PRIVACY
Turn on multi-hop and your traffic is routed through two servers, so that no single server ever
sees both who you are and where you are going. It is slower — we tell you exactly how much — and
it is your choice, off by default.

HONEST ABOUT WHAT A VPN CAN AND CANNOT DO
CumulusVPN protects you from local-network snooping, ISP logging, and geo-restrictions. It is
not anonymity software like Tor, and we say so plainly. No overselling.

Built by the Flux team. Powered by Flux Cloud. Privacy that is structural, not a slogan.

WireGuard is a registered trademark of Jason A. Donenfeld.
```

## What's New in This Version (release notes, first release)
```
First public release of CumulusVPN.
- One-tap WireGuard connection, no account required
- Free tier included
- Server picker with live latency
- Optional multi-hop for maximum privacy
- Zero activity logs, RAM-only server state
```
