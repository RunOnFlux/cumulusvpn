# 07 — Roadmap

## M0 — Feasibility spikes (2 weeks) ← the remaining unknowns
- [ ] **Netstack gateway sanity check** (downgraded from a hard gate): wireguard-go + netstack +
      forwarder in a plain unprivileged container; real browsing + iperf3 through it. Since a Flux
      node's uplink is ~100 Mbit/s and netstack does several hundred Mb/s/core, throughput is not
      the limiter — just **confirm netstack saturates ~100 Mbit/s with CPU headroom for crypto**,
      and that the per-peer 50 Mbit/s cap and free 100 KB/s throttle behave correctly.
- [ ] **Flux reachability test**: deploy PoC as a cheap 3-instance spec; measure UDP handshake
      success across node tiers/UPnP NAT nodes; test `fluxnode.service/hostinfo`, daemon RPC from
      inside container. **Gate: ≥90% instance reachability (else restrict to staticip nodes).**
- [ ] **Payment scan PoC**: send FLUX with `CVPN1:` memo from Zelcore/SSP; detect via host-node
      insight API within 60 s.
- [ ] **Decision: SoftEther v0?** The existing `openvpn` (SoftEther/SecureNAT) app on Flux proves
      the userspace pattern in production. If the netstack PoC misses its gate, ship the
      SoftEther + chain-scanner-sidecar v0 (docs/03) while the WG gateway matures.

## M1 — Gateway v1 (4–6 weeks, parallel with M2)
Rate limiter (free/paid), entitlement engine, enroll/status/info API, abuse controls
(SMTP block, port allowlist, flow-rate caps), peer cache, spec self-watch, reproducible image,
integration test rig, load/soak tests.

## M2 — Web MVP + first deployment (2–3 weeks, overlaps M1)
Web onboarding (browser keygen → .conf/QR for official WG apps), payment page, signed
directory.json, deploy EU+US specs (~10 instances), whitelist image repo, renewal automation.
**→ This is a usable public beta with zero app-store involvement.**

## M3 — Legal & abuse readiness (parallel, before public beta)
Entity + jurisdiction, written legal opinion (host-liability question), abuse desk + templates +
notice page, transparency page, threat-model page, coordinate operator opt-out flag with Flux team.

## M4 — Public beta (free tier + payments live)
~37 instances across 6 regions (see 02), monitoring (public status page fed only from gateway
`/v1/info` — no private telemetry), Flux community launch. KPIs: reachability %, throughput,
abuse complaints/week, free→paid conversion.

## M5 — Desktop apps (6–8 weeks)
Tauri + wireguard-go sidecar, 3 OS, signed/notarized, auto-update, kill switch.

## M6 — Mobile apps (8–10 weeks + store review)
RN + WireGuardKit / wireguard-android, org Apple account + NE entitlement early (long lead time —
start the paperwork during M1), store-compliant payment flows.

## M7 — v1.5/v2 (post-launch, priority by demand)
Payment-key privacy indirection → blind-signature vouchers (Mullvad-level unlinkability),
WebSocket fallback transport, country-level specs where demand concentrates,
IAP/Play Billing as fiat rail, multi-chain payment bridge.

## Adopted from the competitive-plan review (docs review, 2026-07-16)
- **Multi-hop mode (`docs/11`) — BUILDING NOW** as an opt-in "ultimate privacy" feature: nested
  client-side onion (entry + exit), one payment covers both hops, no gateway protocol change.
  v1 = same key both hops; v1.5 = distinct key per hop (rides payment-key indirection).
- **Obfuscation / DPI-resistance (borrow #4):** pluggable obfuscated transport (AmneziaWG /
  shadowsocks-style + the WebSocket fallback) for censored networks — a core VPN use case we had
  under-weighted. Target M5/M6 alongside clients.
- **Trust rigor (borrow #3):** published third-party **no-logs audit**, **warrant canary**, bug
  bounty, and a **leak-test suite in CI** (DNS/IPv6/WebRTC/kill-switch) before public launch (M4).
- **Legal + market depth (borrow #5):** adopt the country-tier launch matrix, entity-jurisdiction
  + data-retention geofencing, MiCA/treasury scoping, and a proper market-sizing/GTM pass — folded
  into `docs/06` and a GTM doc during M3.

## Timeline & budget summary
- **Critical path: M0 → M1 → M2 → M4 ≈ 3 months to public beta** with 2 engineers;
  apps bring it to ~6 months for full cross-platform GA.
- Infra at launch ≈ **$80/mo** (37 instances); break-even ≈ 85 subscribers.
- Biggest schedule risks: M0 gates failing (throughput / UDP reachability) and Apple NE
  entitlement lead time. Both are front-loaded on purpose.
