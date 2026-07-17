# 05 — Clients (desktop, mobile, web)

## Product bar

One screen. Country picker, one big connect button, tier indicator ("Free · 100 KB/s — Upgrade
$0.99"). Dark/light. Zero onboarding friction: first launch generates a key and connects to the
nearest free gateway in < 5 seconds. No fancy shit — but the few elements there are must be
genuinely beautiful (motion on the connect state, map-flavored country picker, live latency dots).

## Positioning (decided): our own branded clients are THE product

We ship first-party, Flux-branded apps on every platform. Stock WireGuard apps are **not** part of
the user story — WireGuard is the wire protocol under the hood, invisible to users. (Server-side
per-key enforcement still means a power user extracting a .conf gains nothing — they get the same
free/paid tiers. We just don't advertise or document that path.)

Three client-platform pillars:

1. **Discovery from the Flux network itself, with bundled fallback.** The client resolves the
   gateway fleet live from Flux (`/apps/location/<spec>` on api.runonflux.io *and* on 2–3 random
   Flux nodes directly), probes `/v1/info`, caches to disk. If the network APIs are unreachable
   (captive portal, censored network, cold start), it falls back to the **bundled signed
   `directory.json`** — a snapshot of spec names + last-known gateway endpoints + payment
   address + our signing pubkey, baked into every release and refreshed with every app update.
   Order: disk cache → live discovery → bundled snapshot. All three are ed25519-signature-checked.
2. **Self-updating.** Desktop: built-in updater (Tauri updater, signed manifests, staged rollout;
   the bundled directory snapshot rides along). Mobile: store updates + remote signed directory
   refresh in-app (no binary needed for fleet changes — only discovery data updates OTA, never
   code, keeping store compliance clean). Gateways report `min_client_version` in `/v1/info` so we
   can sunset broken versions gracefully.
3. **Flux branding.** Flux design language, "powered by the Flux network" identity, amber where it
   fits. Being first-party also unblocks `flux*` app-spec names (FluxOS reserves the prefix — as
   the Flux team we whitelist our own) — though the consumer brand-name collision check in
   `08-open-questions.md` still applies to *store* listings ("FluxVPN" is crowded there).

## Phase 0 — Web onboarding (internal beta rail, ships with gateway MVP)

`clients/web/` — static React/Vite site. Generates a WireGuard keypair **in the browser**, lists
gateways via the public Flux API + `/v1/info`, calls `/v1/enroll`, renders a `.conf` + QR; hosts
the upgrade/payment page (address + memo + QR + wallet deep links) and the signed
`directory.json`. Role (revised): **beta/testing rail and payment page**, not the advertised
product — it lets us validate gateways and payments before the branded apps land, and remains a
quiet power-user escape hatch.

## Phase 1 — Desktop: **Tauri (Rust shell) + wireguard-go sidecar**

- Windows / macOS / Linux from one codebase; ~10 MB installers (vs Electron's 150 MB) and a
  proper system-tray-first UX.
- Tunnel: bundled `wireguard-go` (userspace TUN on desktop — desktops DO allow TUN with the
  standard elevation flows: wintun driver on Windows, utun on macOS, /dev/net/tun on Linux) driven
  over its UAPI socket; privileged helper installed once (Windows service / macOS
  SMAppService helper / Linux polkit or setcap).
- Alternative considered: Electron (rejected: weight), pure native ×3 (rejected: team size),
  Mullvad-style Rust daemon (right long-term shape — the Tauri app already gives us the Rust core
  to grow into it).
- Features v1: country picker, connect/disconnect, auto-reconnect + gateway failover (re-resolve
  discovery when endpoint dies), kill switch (platform firewall rules), launch at login, upgrade
  screen → opens web payment page.

## Phase 1 — Mobile: **React Native + native WireGuard modules**

- iOS: Network Extension (`NEPacketTunnelProvider`) + **WireGuardKit** (official wireguard-apple).
  Requires org Apple developer account (Apple 5.4 mandates org accounts for VPN apps) + NE
  entitlement. Note wireguard-apple's Go cross-compile step in CI.
- Android: `com.wireguard.android:tunnel` library over `VpnService`. Play Console VpnService
  declaration form required.
- RN gives us shared UI/state with near-identical screens to desktop (shared design system,
  shared TypeScript core for discovery/enrollment/status logic — publish as `clients/core-ts`).

## Store policy — can the pay-to-address screen live inside the iOS/Android apps?

**Short answer: on web and desktop, yes — freely. Inside the iOS/Android store builds, no, not as
a live "send FLUX to unlock premium" screen — it would very likely be rejected.** The FLUX payment
buys *app functionality* (premium speed), which puts it squarely under in-app-purchase rules:
- **Apple 3.1.1(a):** apps must use IAP to unlock features/functionality; **3.1.5(b)** lets apps
  facilitate crypto *transactions/exchange*, but NOT to sell their own digital goods. A pay-to-FLUX-
  address upgrade screen is the disallowed case.
- **Google Play (Payments policy):** digital subscriptions must use Play Billing; crypto for
  in-app digital goods isn't an allowed alternative.

So the payment mockup screen is the **web + desktop** flow. For the store apps, three compliant
options (Mullvad's playbook), in order of recommendation:
1. **Manage-on-web (ship first, cleanest).** Store apps are connect-only: show tier status
   (`/v1/status` is a neutral fact) and, when free, a plain line — "Upgrade at cumulusvpn.com" —
   with **no in-app purchase UI and no tappable external link on iOS**. User pays with FLUX on the
   website (or desktop), and because entitlement is chain-based and keyed to the WG pubkey, the
   phone unlocks automatically within ~1 min. This fully sidesteps 3.1.1 and needs zero store
   billing integration. Slightly worse conversion (user leaves the app to pay).
2. **Add IAP / Play Billing** as an in-app fiat option later (Apple/Google take 15–30%). Keep FLUX
   on web. This is also the fiat rail every surviving dVPN eventually added — good for reach.
3. **External-purchase link** (Apple's post-Epic US entitlement / Google external-offer programs).
   Legally fluid as of 2026, commission still applies — don't depend on it at launch.

Net: build the beautiful pay-to-address screen once, ship it on **web/desktop**; on mobile, launch
with option 1 and treat IAP as a fast-follow. Never call it "buy" in iOS builds regardless — it's a
wallet transfer in the user's own wallet.

- Apple 5.4 additionally: no selling user data (trivially true — we have none), VPN must use
  NEVPNManager APIs (WireGuardKit does), available only where legal (regional availability list:
  exclude China/UAE/etc. from store listings — decide list at launch).
- Apple 5.4 additionally: no selling user data (trivially true), VPN must use NEVPNManager APIs
  (WireGuardKit does), available only where legal (regional availability list: exclude
  China/UAE/etc. from store listings — decide list at launch).

## Client-side behaviors that keep the decentralized model working

- **Discovery**: query 2–3 random Flux nodes' `/apps/location/<spec>` (not only
  api.runonflux.io), union results, probe `/v1/info`, cache with TTL; ship a seed node list +
  signed directory for cold start.
- **Failover**: WireGuard handshake timeout (~15 s) triggers re-discovery + re-enroll at the next
  best gateway in the same country. Because enrollment is just a pubkey POST, failover is cheap
  and invisible.
- **Same key everywhere**: one keypair per device enrolls at many gateways; entitlement follows
  the key on all of them via the chain. (Multi-device = pay per device in v1 — simple and honest —
  or share the key across your own devices; both work, document the tradeoff. v2: payment-key
  indirection in 04 enables N tunnel keys per one payment identity.)
- **Privacy defaults**: DNS through the tunnel to the gateway's DoH resolver; no analytics,
  opt-in crash reports only.

## Effort estimate

| Deliverable | Estimate (1–2 strong devs) |
|---|---|
| Web onboarding + payment page | 2–3 weeks |
| Desktop (Tauri, 3 OS, signed installers) | 6–8 weeks |
| Mobile (RN, both stores, NE/VpnService plumbing) | 8–10 weeks (store review adds 2–4) |
| Shared TS core + design system | 2 weeks (parallel) |
