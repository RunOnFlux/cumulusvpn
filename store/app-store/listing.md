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
**CumulusVPN** and describe "powered by the Flux network" in the subtitle/body rather than in
the app name, to keep the name clearable and distinct.

## Subtitle (max 30) — 24 chars
```
Private VPN. No account.
```
Alternate (22): `No-account private VPN`

## Promotional Text (max 170, editable anytime without review) — 162 chars
```
No sign-up, no email, no logs. Generate a key, tap connect. Free tier forever, upgrade with FLUX. Multi-hop so no single server sees who you are and where you go.
```

## Keywords (max 100, comma-separated, no spaces) — 89 chars
```
vpn,wireguard,privacy,no log,decentralized,flux,secure,tunnel,anonymous,crypto,wifi,proxy
```
Rationale: the app name and subtitle already carry "CumulusVPN / private / account", so keywords
avoid repeating them (Apple indexes name+subtitle+keywords together). No competitor brand names
(Apple rejects those).

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
Every install includes a genuinely free tier — no trial, no card, no account. Upgrade to
premium for higher speeds whenever you want.

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

PREMIUM IS MANAGED ON THE WEB
Premium speed is purchased with FLUX cryptocurrency from your own wallet on our website — the
app itself never asks you for money and contains no purchase screen. Once your key is upgraded,
your phone unlocks premium automatically.

Built by the Flux team. Powered by the Flux network. Privacy that is structural, not a slogan.

WireGuard is a registered trademark of Jason A. Donenfeld.
```

## What's New in This Version (release notes, first release)
```
First public release of CumulusVPN.
- One-tap WireGuard connection, no account required
- Free tier included, premium via FLUX on the web
- Server picker with live latency
- Optional multi-hop for maximum privacy
- Zero activity logs, RAM-only server state
```
