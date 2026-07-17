# 09 — Build plan & current state of the monorepo

This is the "what exists now and what to build next" doc. Strategy/architecture live in 01–08;
the phased timeline lives in 07-roadmap. This is the concrete on-ramp.

## Build status (2026-07-16) — first full build done, all green

| Component | State | Verified by |
|---|---|---|
| `gateway/` (Go) | **compiles + tests pass** | `go build ./...` · `go vet ./...` · `go test ./...` (api+entitle green) |
| `clients/core-ts` | **typecheck + 33 tests, 97% cov** | `tsc --noEmit` · `vitest run` (7 files) |
| `clients/web` (Vite MVP) | **builds green** | `vite build` · `tsc` · `eslint` |
| `clients/desktop` (Tauri) | **frontend builds green**; native tunnel = // POC seams | `tsc` · `vite build` · `eslint` |
| `clients/mobile` (RN) | **typechecks green**; native modules = // POC stubs | `tsc --noEmit` |
| `deploy/` | **generate/validate/directory-sign run** | `node generate.mjs --stage beta` → 12 specs; signed directory ok |
| `design/mockups.html` + landing | static, self-contained | opens; no broken refs |

All built against `docs/10-api-contract.md` (byte-level source of truth). The remaining `// POC:`
markers are the runtime-hardening + native-integration seams listed below — not build blockers.

## What's in the repo today (scaffold)

```
fluxvpn/                        # monorepo (rename to cumulusvpn on the new GitHub org)
├── README.md                   # product overview + how it works
├── docs/                       # 01–09 — the full plan (this file is 09)
├── design/
│   ├── mockups.html            # client UI mockups (connect / picker / payment / desktop / tiers)
│   └── README.md               # design language
├── gateway/                    # Go userspace WireGuard gateway (PoC being built)
├── clients/                    # web (MVP) + desktop (Tauri) + mobile (RN) + shared TS core
└── deploy/
    ├── countries.yaml          # fleet manifest (enterprise + datacenter, per-country)
    ├── specs/{template, plain/template}.json
    └── scripts/                # generate · encrypt · register · renew · scale · price-update
```

Decisions locked (see 08): brand **CumulusVPN — Powered by RunOnFlux**, single domain
cumulusvpn.com, **enterprise + datacenter** specs, userspace **WireGuard** gateway, **$0.99/mo in
FLUX** via OP_RETURN memo, no accounts (key = identity), first-party self-updating clients.

## The unknowns to retire first (M0)

Throughput is **no longer the critical unknown**: a Flux node's uplink is ~100 Mbit/s and userspace
WireGuard does several hundred Mb/s/core, so the link — not netstack — is the ceiling. Capacity is
bandwidth-bound; each user is capped at 50 Mbit/s (`CVPN_PREMIUM_RATE_MBPS`). What still needs
proving on real Flux nodes is **reachability** (UDP ingress across node types) and the
**end-to-end tunnel** actually carrying packets. SoftEther v0 remains the fallback if the userspace
forwarder proves troublesome in practice.

**M0 sprint (2 weeks), in order:**
1. **Gateway PoC** (`gateway/`): wireguard-go device in netstack mode + TCP/UDP exit forwarder in
   an unprivileged container. Real browsing + iperf3 through it. → **Check: netstack saturates
   ~100 Mbit/s with CPU headroom; free 100 KB/s + premium 50 Mbit/s caps behave.**
2. **Flux reachability probe:** register a tiny 3-instance **enterprise+datacenter** test spec
   (short `expire`); confirm from inside the container: UDP 51820 reachable from the internet,
   `http://fluxnode.service:16101/hostinfo` returns IP+geo, host daemon API reachable on 16127.
   → **Gate: ≥90% instance reachability + confirm enough enterprise nodes exist per country.**
3. **Payment scan PoC:** send FLUX with a `CVPN1:` memo from Zelcore/SSP; detect it via the host
   node's insight/daemon API within ~60 s. Validates the entitlement engine end to end.

If all three gates pass, the risk is gone and M1 (gateway v1) + M2 (web MVP + first deployment)
are execution, not research.

## Build order after M0

Backend first, then the thin rails, then apps (matches SSP house style):
1. **Gateway v1** (`gateway/`) — rate limiter, entitlement engine, enroll/status/info API, abuse
   controls, reproducible image → push to `registry.cumulusvpn.com`.
2. **Deploy pipeline** (`deploy/`) — wire the real enterprise encryption (encrypt.mjs) and the
   sign+broadcast+pay steps (register.sh) to the RunOnFlux SDK; register the beta 12-country fleet.
3. **Web MVP** (`clients/web/`) — browser keygen → enroll → .conf/QR + the payment page + signed
   `directory.json`, served from cumulusvpn.com (itself a Flux app). Public beta with zero app
   stores.
4. **Shared TS core** (`clients/core-ts/`) — discovery, enroll, status, payment-code, directory
   verification — reused by desktop and mobile.
5. **Desktop** (Tauri) then **Mobile** (RN) — start the Apple org account + Network Extension
   entitlement paperwork during step 1 (long lead time).

## Prerequisites to line up in parallel (non-code)

- RunOnFlux **enterprise app-owner whitelist** for our ZelID (required to register enterprise specs).
- **`registry.cumulusvpn.com`** private Docker registry (repoauth target).
- **Payment address** — 2-of-3 multisig t-address; its pubkey drives the directory + memos.
- **`directory.json` signing key** (ed25519) — kept offline; pubkey ships in specs + clients.
- github.com/cumulusvpn org, @cumulusvpn socials; the trademark knockout (docs/08).
- Legal: entity/jurisdiction + the host-liability opinion (docs/06) before public beta.

## How to run the PoC (once the gateway lands)

```
cd gateway
go build ./...            # or: docker build -t cumulusvpn-gateway .
go test ./...             # memo parsing + entitlement math unit tests
# local smoke: run the gateway, generate a WG keypair, POST /v1/enroll, bring up a wg client,
# curl through it; then throttle-check (should cap ~100 KB/s until a mock payment flips the key).
```
See `gateway/README.md` for the exact commands and the throughput-gate harness.
