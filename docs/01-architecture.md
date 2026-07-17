# 01 — System Architecture

## Design goals

1. **No accounts, no central authority.** Nothing to sign up for, nothing we can be compelled to
   hand over. The system must keep working if every server we personally operate goes away.
2. **Free tier for everyone** (100 KB/s), paid full speed at $0.99/month equivalent in FLUX.
3. **Enforcement server-side.** Users of the official WireGuard clients get the same deal as users
   of our apps — the speed limit is applied by the gateway per WireGuard key, not by client code.
4. **Everything open source.** Gateway, clients, deployment specs, this plan.
5. **Runs entirely on Flux.** Gateways are ordinary Flux apps; discovery and payment verification
   use only public Flux infrastructure (node APIs, the blockchain, explorer endpoints).

## Components

### 1. Gateway (the Flux app) — `gateway/`

One Go binary in one container, deployed as N instances of a few region-scoped Flux app specs.
Three subsystems in one process:

- **WireGuard engine** — `wireguard-go` device in netstack mode (no TUN, no NET_ADMIN — see
  `03-gateway.md`). Terminates client tunnels, forwards TCP/UDP flows to the internet via host
  sockets, applies a per-peer token-bucket rate limit: 100 KB/s for free keys, unlimited (fair-use
  capped) for entitled keys.
- **Entitlement engine** — scans the Flux blockchain for payments to the payment address whose
  OP_RETURN memo names a WireGuard key (see `04-payments.md`). Maintains a local map
  `pubkey → paid_until`. Deterministic: every gateway derives the same entitlement state from the
  same chain, so a paying user is premium on *every* gateway with one payment.
- **Control API** (HTTPS on a second port) — tiny JSON API:
  - `POST /v1/enroll {pubkey}` → adds the peer, returns `{server_pubkey, endpoint, assigned_ip,
    dns, payment_address, payment_memo, price_flux}`. Rate-limited + lightweight proof-of-work to
    stop enrollment flooding.
  - `GET /v1/status/{pubkey}` → `{tier: free|premium, paid_until, bytes_used}`.
  - `GET /v1/info` → `{country, region, city, load, capacity, version}` (self-reported from
    `http://fluxnode.service:16101/hostinfo`, the FluxOS in-container node-info service).

### 2. Discovery — no server of ours at all

Clients list gateway instances with the public Flux API:

```
GET https://api.runonflux.io/apps/location/<appname>     → [{ip, ...}, ...]
```

(and the same endpoint on any Flux node, `http://<any-node>:16127/apps/location/<appname>`, so
there is no single point of failure). The client then calls each candidate's `/v1/info` to get its
country and load, caches the list, and presents a country picker. Multiple app specs
(`fluxvpn-eu`, `fluxvpn-us`, `fluxvpn-asia`, …) are all queried; the spec names ship in the
clients and in a signed `directory.json` we publish (see below).

### 3. Clients — `clients/`

Thin, beautiful, boring: country picker + one connect button + payment screen. Desktop
(Tauri + wireguard-go sidecar), mobile (React Native + WireGuardKit / wireguard-android), and a
web onboarding page that produces a QR/.conf for the official WireGuard apps (this is also the
zero-app-development MVP). Details in `05-clients.md`.

### 4. Payment flow — `04-payments.md`

FLUX transaction to a fixed transparent address with an OP_RETURN memo identifying the key.
Verified independently by every gateway against the chain. No callback, no webhook, no server.

## Identity & trust model

- **Identity = WireGuard public key**, generated on-device. We never learn who a key belongs to.
  Payment links a FLUX address to a key *on a public chain* — privacy implications and the
  blinded-token upgrade path are covered in `04-payments.md`.
- **What the user must trust:**
  - The gateway binary (open source, reproducible container build, image digest pinned in the
    published app spec — anyone can verify what is running).
  - Flux node operators can observe traffic *volume/timing* of instances on their node, like any
    host. Traffic content is protected by end-to-end TLS as usual; the WireGuard tunnel protects
    against local-network observers. We are honest in marketing: this is a privacy/geo-shift tool
    with a decentralized operator model — not Tor.
  - **Single-hop caveat (be honest):** in the default single-hop mode, the gateway sees both your
    key (identity) *and* your destination — so "no logs" is a RAM-only *policy*, not an
    architectural guarantee. Users who need the guarantee turn on **multi-hop** (`docs/11`), where
    no single node sees both — that is an *architectural* property, not a promise. Marketing must
    not overclaim single-hop as if it were multi-hop.
- **What we control (and should minimize):**
  - The app specs (we are the app owner ZelID; we pay for deployments and set env parameters like
    the FLUX price constant).
  - The payment address (funds land there — this funds the deployments).
  - A signed `directory.json` (list of official app spec names + payment address + current price),
    served from the website *and* mirrored inside the app specs' env parameters, signature checked
    by clients. This is configuration, not a runtime dependency: clients work from cache if it is
    unreachable.

## Scaling model

- One app spec = up to 100 instances (v8), each geolocation-scoped (`acEU`, `acUS`, …), each a
  single-tenant-capable shared gateway sized ~0.5–1 core / 512 MB–1 GB / 5 GB.
- Cost basis ≈ $1–2/instance/month at Flux prices (see `02-flux-deployment.md`) → 40 instances
  worldwide ≈ $40–80/month infrastructure. Break-even at ~50–80 paying users. Add instances per
  region as load grows; clients load-balance by gateway-reported load.
- Free-tier capacity is bounded per gateway (max free peers + aggregate free-tier bandwidth cap)
  so free usage can never starve paying users.

## What is deliberately NOT in the system

- No user database, no email, no analytics service, no logging of traffic or connections
  (memory-only peer state; standard no-logs posture, documented and auditable in source).
- No custom protocol: standard WireGuard on the wire means official clients work and our attack
  surface stays small.
- No multi-hop/mixnet in v1 (possible later: gateway-to-gateway chaining is straightforward since
  every gateway is also a WireGuard endpoint).
