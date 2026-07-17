# CumulusVPN — Decentralized VPN on the Flux Network

**Powered by RunOnFlux.** Home: cumulusvpn.com (single domain, itself deployed on Flux).
Name committed 2026-07-16 (cumulusvpn.com registered); see `docs/08-open-questions.md` for the
naming trail and the remaining trademark knockout.

A fully decentralized VPN that runs entirely as **enterprise Flux apps** on datacenter nodes
across the Flux network (6,500+ nodes worldwide). No accounts, no central server, no cards.
Client and gateway **source are open**; the _deployment_ (image, private registry, which nodes)
is enterprise-encrypted — deployment privacy, not closed source.

## The pitch

- **Free for everyone** at 100 KB/s.
- **$0.99/month** (paid in FLUX on the native chain) for full speed.
- **No accounts.** Your WireGuard public key _is_ your identity. You generate it on your device;
  we never see an email, name, or card.
- **No central authority.** Gateways are enterprise Flux app instances on datacenter nodes across
  dozens of countries. Payments are verified by every gateway independently by scanning the Flux
  blockchain. If our company disappears, the deployed gateways keep working until their spec expires.
- **Open source** — gateway and client source, fully. (Deployment image/registry are private; the
  build is reproducible so anyone can verify the source matches.)

## How it works (30 seconds)

```
┌──────────────┐  WireGuard (UDP)   ┌─────────────────────────────┐
│ Client app   │ ─────────────────► │ Gateway (Flux app instance) │ ──► Internet
│ (or official │                    │ • userspace WireGuard        │
│  WG client)  │                    │ • per-key rate limiter       │
└──────┬───────┘                    │ • chain scanner (entitle-    │
       │                            │   ments from FLUX payments)  │
       │ discovery:                 └──────────────┬──────────────┘
       │ GET api.runonflux.io/apps/location/<app>  │ daemon RPC / insight API
       ▼                                           ▼
  Flux network APIs                          Flux blockchain
```

1. Client generates a WireGuard keypair locally and fetches the gateway list from the public Flux
   API (`/apps/location/<appname>`), grouped by country.
2. Client calls the chosen gateway's small HTTP API to enroll its public key → gets a standard
   WireGuard config. Connects. Free tier: throttled to 100 KB/s **by the gateway**.
3. To upgrade: send the displayed amount of FLUX to the payment address with an OP_RETURN memo
   containing the key's payment code. Every gateway sees the payment on-chain within ~30 s
   (30-second blocks) and unlocks full speed for 30 days. No activation step needed.

Because enforcement is server-side and keyed to the WireGuard public key, users of the _official_
WireGuard apps get exactly the same free/paid treatment as users of our apps — there is nothing to
bypass. Our apps just make it seamless (one-tap connect, country picker, payment deep link).

## Protocol: userspace-only, WireGuard preferred

FluxOS creates app containers **without** `NET_ADMIN`, `/dev/net/tun`, privileged mode, or sysctl
access (verified in `flux/ZelBack/src/services/dockerService.js` — it actively strips
`--privileged`). So only VPN servers with a **userspace data plane** can run on Flux. Proven in
production today: SoftEther with SecureNAT (its userspace virtual NAT) — a SoftEther app serving
OpenVPN-protocol clients already runs on Flux. Our target gateway uses the same architecture with
modern parts: a **userspace WireGuard server** (`wireguard-go` + gVisor `netstack`) — same
technique as Tailscale's userspace mode — because WireGuard's key-is-the-identity model is what
makes accountless on-chain entitlements work. Flux publishes every app port as TCP **and** UDP
automatically, so WireGuard's UDP ingress works out of the box. SoftEther remains a credible
fast-to-market v0 and a TCP-fallback option. Full comparison and design: `docs/03-gateway.md`.

## Repository layout (monorepo)

| Path               | What                                                                            | Stack                            |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------- |
| `docs/`            | Complete plan: architecture, Flux deployment, payments, legal, roadmap          | —                                |
| `gateway/`         | The Flux app: userspace WireGuard gateway + chain scanner + enrollment API      | Go                               |
| `clients/desktop/` | Windows / macOS / Linux app                                                     | Tauri + wireguard-go sidecar     |
| `clients/mobile/`  | iOS / Android app                                                               | React Native + native WG modules |
| `clients/web/`     | Onboarding site: keygen in browser, QR/.conf for official WG apps, payment page | React/Vite                       |
| `deploy/`          | Flux app specs (per-region), Docker build, registration scripts                 | JSON / shell                     |

## Read the plan

1. [`docs/01-architecture.md`](docs/01-architecture.md) — full system architecture and trust model
2. [`docs/02-flux-deployment.md`](docs/02-flux-deployment.md) — Flux app specs, constraints, costs, geolocation
3. [`docs/03-gateway.md`](docs/03-gateway.md) — the userspace WireGuard gateway (core engineering)
4. [`docs/04-payments.md`](docs/04-payments.md) — on-chain payments, memo format, entitlements
5. [`docs/05-clients.md`](docs/05-clients.md) — client apps for all platforms + store policy
6. [`docs/06-legal-abuse.md`](docs/06-legal-abuse.md) — exit liability, abuse handling (read this early)
7. [`docs/07-roadmap.md`](docs/07-roadmap.md) — phases, milestones, effort estimates
8. [`docs/08-open-questions.md`](docs/08-open-questions.md) — decisions we still need to make
