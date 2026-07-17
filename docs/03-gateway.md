# 03 — Gateway design (the core engineering)

The gateway is one Go binary. Go is the only sane choice here: `wireguard-go` and gVisor's
`netstack` are Go-native, this is exactly Tailscale's production stack, and we get a static
~15 MB container image.

## Why userspace, restated precisely

FluxOS containers have **no** NET_ADMIN, no /dev/net/tun, no sysctls, no privileged mode
(unconditionally — even enterprise apps). So we cannot create a TUN device or touch kernel
routing/NAT. Only userspace data planes work — **proven in production**: the `openvpn` app on
Flux (spec v7, `siomiz/softethervpn`) runs SoftEther with SecureNAT, its userspace virtual
NAT/TCP-IP stack, serving OpenVPN/L2TP/SSTP clients with no privileges. That app is our
existence proof for UDP+TCP ingress and userspace egress at scale on Flux.

We build the same shape with modern parts:

```
UDP 51820 (host-mapped by Flux, TCP+UDP)
        │
        ▼
┌────────────────────────────────────────────────────────┐
│ gateway (single Go process, unprivileged)              │
│                                                        │
│  wireguard-go device (conn.Bind on ordinary UDP sock)  │
│        │  decrypted IP packets                         │
│        ▼                                               │
│  gvisor netstack (golang.zx2c4.com/wireguard/tun/      │
│                   netstack) — userspace TCP/IP stack   │
│        │  terminated flows                             │
│        ▼                                               │
│  forwarder: for each netstack flow, net.Dial() an      │
│  ordinary host socket outward (TCP splice / UDP relay) │
│  == userspace NAT. DNS: in-process resolver → upstream │
│  DoH/DoT (so client DNS never leaks via node resolver) │
└────────────────────────────────────────────────────────┘
```

This is the documented `wireguard/tun/netstack` package + a TCP/UDP forwarder (the tun2socks /
Tailscale-tsnet pattern). No kernel anything. Outbound connections originate from the container's
network namespace and exit with the node's public IP — which is exactly what a VPN exit needs.

**Performance envelope — the node uplink is the bottleneck, not netstack.** A Flux node's uplink
caps at ~100 Mbit/s (and is shared with other apps on the node). netstack userspace WireGuard does
several hundred Mb/s per core — comfortably more than the link — so CPU throughput is *not* the
limiter here and the original "≥150 Mb/s/core" worry is moot. The gateway just needs to saturate
~100 Mbit/s, which is easy. The M0 check shrinks from a make-or-break benchmark to a quick sanity
test (confirm netstack ≥ ~100 Mbit/s and CPU headroom for crypto). Capacity per gateway is therefore
**bandwidth-bound**: scale horizontally with instances, and enforce a per-peer cap (below) so the
shared link degrades gracefully rather than being monopolized.

## Why WireGuard over SoftEther/OpenVPN for the target gateway

SoftEther-on-Flux works today and is the zero-server-dev **v0 option** (see below). We still build
the WireGuard gateway as the product core:

| | WireGuard (wireguard-go + netstack) | SoftEther SecureNAT (OpenVPN et al.) |
|---|---|---|
| Identity | **Public key = account** — plugs directly into chain entitlements, no credentials to distribute or leak | User/password (or certs); needs user provisioning via `vpncmd` automation; shared creds are copyable |
| Free/paid enforcement | Native: our process owns every packet → per-key token buckets, instant tier flip on payment | Possible via per-user policies (MaxUpload/MaxDownload bps) set through `vpncmd` — workable but bolted on |
| Performance | netstack: hundreds of Mb/s per core, modern crypto (ChaCha20-Poly1305), 1-RTT handshake | SecureNAT is the known bottleneck (~100–300 Mb/s, higher CPU per Mb/s); OpenVPN protocol adds per-packet overhead |
| Mobile/battery/roaming | Excellent — silent protocol, survives IP changes (great on mobile), tiny state | Heavier keepalives, TCP modes suffer TCP-over-TCP |
| Clients | Official WG apps everywhere + QR/.conf onboarding; kernel-fast on user devices | OpenVPN clients everywhere too, config files clunkier |
| Censorship resistance | UDP-only → blockable (fallback: wstunnel later) | **Better**: TCP 443/SSTP modes look like TLS |
| Auditability | ~4k LOC protocol, our gateway is small readable Go | Large C++ codebase, config surface huge |
| Industry direction | Mullvad, NordLynx, Tailscale, Cloudflare WARP — all WG | Legacy/compat |

Verdict: **WireGuard is better for this product** — primarily because the key-based identity is
what makes the accountless, on-chain payment model clean, and because we need in-process per-peer
rate limiting for the free tier. SoftEther's wins (TCP-443 fallback, protocol breadth) are
fallback features, not core.

### Optional v0: SoftEther-based launch (fast-to-market path)

Since SoftEther already runs on Flux: a v0 could ship in ~2–3 weeks as `siomiz/softethervpn` + a
sidecar container (same app spec, component 2) that (a) scans the chain for `CVPN1:` payments,
(b) drives `vpncmd` to create per-payment users with premium policy, and (c) maintains a shared
throttled `free` user. Tradeoffs: credential distribution instead of keys, SecureNAT throughput
ceiling, weaker no-logs story (SoftEther logs need disabling/verifying). Decide at M0: if the
netstack PoC hits its gate, skip v0; if it slips, v0 buys time in market.

## Subsystem details

### Peer management
- Peers live only in memory + optional `/data/peers.cache` (pubkey, assigned 10.x address,
  paid_until) so restarts are seamless; loss of the cache is fine — clients auto-re-enroll.
- Address plan: `10.8.0.0/16` per gateway (no cross-gateway coordination needed — tunnels are
  point-to-point per gateway). IPv6 ULA later.
- Idle eviction: free peers evicted after 30 days idle, premium after paid_until + 35 days.
- Capacity guards: `MAX_PEERS_FREE`, `MAX_PEERS_TOTAL`, aggregate free-tier bandwidth ceiling
  (e.g. free pool ≤ 30% of instance throughput) so freeloaders can't starve subscribers.

### Rate limiting (the free/paid mechanism)
- Token bucket per peer applied on both directions at the netstack boundary:
  - **free = 100 KB/s** (`CVPN_FREE_RATE_KBPS`, burst ~1 MB so pages still feel snappy).
  - **premium = 50 Mbit/s per peer** (`CVPN_PREMIUM_RATE_MBPS`, default 50, burst ~4 MB).
    Sized at *half* the node's ~100 Mbit/s uplink so one premium peer can never monopolize the
    link — at least two premium users run flat-out simultaneously, and the shared link degrades
    fairly under load. 50 Mbit/s is plenty for 4K streaming (~25 Mbit/s) and everything lighter;
    honest positioning is "fast enough + cheap + private," not "blazing fastest."
- Tier lookup is just `entitlements[pubkey].paid_until > now` — flips instantly when the chain
  scanner sees a payment, no reconnect needed.
- Both limits are config-driven (app-spec env), so we can raise the premium cap later if nodes with
  faster uplinks become the norm, without a code change.

### Entitlement engine (chain scanner)
See `04-payments.md` for the protocol. Implementation notes:
- On boot: page through payment-address history (host node insight/daemon API, explorer fallback),
  filter txs with valid `CVPN1:` OP_RETURN memos and amount ≥ `CVPN_PRICE_FLUX`, build
  `keyhash → paid_until` map (payments stack: each valid payment appends 30 days,
  capped at +24 months prepaid).
- Then poll `getblockcount` every 15 s; on new block, scan its txs for the payment address.
  Optional 0-conf fast path via `getsingleaddressmempool` marks "pending" and unlocks premium
  optimistically ≤ 2 min, confirmed at 1 conf (30 s blocks make this nearly instant anyway).
- Entirely deterministic from chain state → all gateways agree without talking to each other.

### Control API (HTTPS :51821)
- Endpoints: `POST /v1/enroll`, `GET /v1/status/{pubkey}`, `GET /v1/info` (see 01).
- TLS: self-signed cert, pinned by SPKI hash published in `/v1/info` of every other gateway and in
  signed directory — v1 pragmatic option: serve over plain HTTP but sign response bodies with the
  gateway's WireGuard private key (clients already learn the WG pubkey via discovery; signature
  proves you're talking to the real gateway; enrollment request contains only a public key, nothing
  secret). Decide in 08-open-questions.
- Anti-abuse on enroll: per-IP rate limit + small PoW (hashcash-style, ~1 s of client work) —
  prevents peer-table exhaustion.

### Abuse controls (see 06 for policy)
- Outbound port policy: block 25/465/587 (SMTP) always; v1 launches with a conservative exit
  allowlist (~80/443/8080/DNS/QUIC/common app ports, expand over time — the Tor playbook).
- Per-peer connection-rate ceilings (SYN/s, new-flows/s) to blunt scanners and DDoS-via-us.
- No traffic logging. Volume counters per peer in memory only (for rate limiting and `/v1/status`).

### Self-description
- On boot, read `http://fluxnode.service:16101/hostinfo` → node public IP, geo
  (continent/country/region), benchmark scores → served at `/v1/info` and used to pick the
  advertised WG endpoint.
- Watch own app spec (`/apps/appspecifications/$FLUX_APP_NAME`) for env changes (price updates).

## Container image
- `FROM scratch` (or alpine for debuggability) + static Go binary. ~15–20 MB.
- Public repo `runonflux/cumulusvpn-gateway` (or final brand org), tag + digest pinned in app spec,
  reproducible build via CI (`SOURCE_DATE_EPOCH`, `-trimpath`) so anyone can verify digest ↔ source.

## Testing strategy
- Unit: memo parsing, entitlement math, rate limiter.
- Integration: docker-compose sim — gateway + `fluxd`-mock (canned insight responses) + WG client
  container; assert throttle at 100 KB/s, payment → unthrottled within one poll cycle.
- Load: iperf3 through the tunnel; soak with 500 simulated peers.
- On-network: deploy 3-instance test spec on Flux testnet/mainnet with tiny expire; validate
  UDP reachability across Cumulus/Nimbus/Stratus and UPnP-NAT'd nodes (some consumer-hosted nodes
  may have broken UPnP UDP — measure the real success rate; this informs whether we filter for
  datacenter/static-ip nodes only).

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Netstack throughput below expectation | Benchmark at M1; size instances/counts accordingly; wireguard-go batching + gVisor tuning; worst case raise per-instance CPU. |
| UDP blocked on some client networks | Phase-2: wstunnel-style WebSocket transport option on 51821 (userspace-safe). Never udp2raw (needs raw sockets). |
| Node operator observes traffic | Documented threat model; E2E TLS is the norm; roadmap: two-hop mode (entry gateway → exit gateway) reusing the same infrastructure. |
| Instance migration breaks sessions | staticip flag + client auto-failover via discovery refresh (05). |
