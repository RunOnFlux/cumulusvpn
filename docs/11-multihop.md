# 11 — Multi-hop (opt-in "ultimate privacy" mode)

Borrowed from the colleague plan's strongest idea (`docs/` review): **no single node should ever
see both who you are and what you're accessing.** Single-hop CumulusVPN does not meet that bar — the
gateway sees your key (identity) *and* your destination. Multi-hop fixes it, as an **opt-in** mode
(off by default) because it costs latency and throughput.

## Architecture: client-side nested onion (zero gateway protocol change)

```
                 outer tunnel (to ENTRY)         inner tunnel (to EXIT)
 ┌────────┐  encrypt→A  ┌──────────────┐  fwd   ┌──────────────┐  exit  ┌──────────┐
 │ client │ ══════════▶ │ ENTRY gateway│ ═════▶ │ EXIT gateway │ ═════▶ │ internet │
 └────────┘             └──────────────┘        └──────────────┘        └──────────┘
   double-encrypts:      sees: real IP +          sees: destination +
   inner packet for      encrypted-to-EXIT        entry's IP as source
   EXIT, wrapped in       traffic to EXIT's IP      (NOT client's real IP)
   outer for ENTRY        — NOT the destination     — NOT the client's identity
```

The client runs **two stacked WireGuard interfaces** with the same key `K`:
- **Outer (wg-entry):** peer = ENTRY, `AllowedIPs = <EXIT_ip>/32` only. Carries just the inner
  tunnel's packets to the exit's public IP.
- **Inner (wg-exit):** peer = EXIT, `AllowedIPs = 0.0.0.0/0, ::/0`. Carries all real traffic; its
  packets to `EXIT_ip` are routed *through* the outer interface.

Because the inner payload is encrypted to EXIT, the ENTRY gateway can decrypt only the outer layer
— it sees ciphertext destined for a known gateway IP, never the user's real destination. The EXIT
terminates the inner tunnel and egresses; its packets' source is the ENTRY node's IP.

**No gateway protocol change is needed.** Both gateways run exactly as they do for single-hop; the
entry simply happens to be forwarding a premium peer's traffic to another gateway's `:51820`. The
client does all the nesting.

## What each party sees (threat model)

| Party | Sees real IP? | Sees destination? | Sees identity (key)? |
|---|---|---|---|
| ENTRY gateway/operator | **yes** | no (double-encrypted) | yes (key K) |
| EXIT gateway/operator | no (sees ENTRY's IP) | **yes** | yes (key K) |
| Network observer at entry | yes (you use a VPN) | no | no |
| Any **single** operator | — | — | **never both IP+dest** ✅ |

The invariant holds: no single node has `real IP ↔ destination`. Cross-jurisdiction hop selection
means deanonymizing requires compelling **two operators in two countries**.

## Entitlement & cost

Multi-hop is a **premium feature**. Because entitlement follows the key on *every* gateway (chain
scan, `docs/04`), **one $0.99 payment covers both hops** — the same key K is premium at entry and
exit automatically. No double charge, no new gateway logic.

- **v1 (this build): same key K on both hops.** Defeats any *single* operator. Caveat, stated
  honestly in-app: an adversary controlling *both* your chosen hops could correlate via the shared
  key K.
- **v1.5: distinct key per hop** via payment-key indirection (`docs/04` §Privacy v1.5): one payment
  authorizes a family of tunnel keys, so entry and exit see *different* keys → closes the
  both-hops-collude gap. Multi-hop is the forcing function to build that.

## UX (client)

A single toggle, off by default:
- **Fast** (default): single-hop. Best speed.
- **Multi-hop** (on) with a route style:
  - **Balanced — same country:** entry≠exit, same country. ~1.3–1.6× latency; one jurisdiction.
  - **Max privacy — cross-jurisdiction:** entry and exit in different countries/operators. Highest
    latency; strongest correlation resistance.
- Let the user pick entry + exit explicitly, or auto-pick (nearest healthy entry + a well-connected
  exit in the chosen style). Show the honest tradeoff inline ("slower, but no single server sees
  both who you are and where you go").

## Performance (the tradeoff, be honest in copy)

- **Latency:** ≈ RTT(client→entry) + RTT(entry→exit) + RTT(exit→dest). Expect roughly **2× ping**
  vs single-hop; cross-continent hops can be much worse. Pick the exit near the destination and the
  entry near the user for best results.
- **Throughput:** bounded by the slower hop and double crypto; still fine for browsing/streaming,
  below single-hop peak. Per-peer 50 Mbit/s cap still applies at each hop.
- **MTU:** double encapsulation. Outer interface MTU ~1420; **inner interface MTU ~1340** (leave
  headroom for two WireGuard headers). Wrong MTU = mysterious stalls — clients must set this.

## core-ts contract (implement exactly)

Add to `@cumulusvpn/core`:

```ts
export type RouteStyle = 'single' | 'multihop-same-country' | 'multihop-cross-jurisdiction';

export interface Hop { gatewayIp: string; country: string; info: GatewayInfo; enroll: EnrollResponse; }

// selectHops: given discovered gateways + style + optional explicit picks, return the ordered hops.
// Enforces entry.gatewayIp !== exit.gatewayIp; for cross-jurisdiction enforces entry.country !== exit.country.
export function selectHops(gateways: GatewayInfo[], style: RouteStyle, opts?: {
  entryCountry?: string; exitCountry?: string;
}): { entry: GatewayInfo; exit?: GatewayInfo };

// buildMultihopConfig: produce the two nested WireGuard interface configs for hops [entry, exit],
// both using the same client private key. Returns { outer, inner } as .conf strings plus the
// routing facts a programmatic client needs.
export interface MultihopConfig {
  outer: string;            // wg-entry .conf: AllowedIPs = <exitIp>/32, MTU 1420, no DNS
  inner: string;            // wg-exit .conf:  AllowedIPs = 0.0.0.0/0,::/0, MTU 1340, DNS = exit dns
  exitEndpoint: string;     // "<exitIp>:51820" — must route via the outer interface
  innerMtu: number;         // 1340
}
export function buildMultihopConfig(args: {
  privateKey: string;
  entry: EnrollResponse;    // enroll of key K at the ENTRY gateway
  exit: EnrollResponse;     // enroll of key K at the EXIT gateway
}): MultihopConfig;
```
Single-hop `buildWgConfig` is unchanged. Tests: assert outer AllowedIPs pins the exit IP/32, inner
routes 0.0.0.0/0, MTUs are 1420/1340, both interfaces use the same key, and `selectHops` rejects
entry==exit and enforces cross-country when asked.

## Client implementation notes

- **Desktop (Tauri + wireguard-go):** run **two wireguard-go devices**; add a host route
  `<exitIp>/32 → wg-entry` and default route `→ wg-exit`. Straightforward.
- **Mobile:** the NEPacketTunnelProvider (iOS) / VpnService (Android) gives one tun. Inside the
  extension, chain two userspace wireguard-go instances: tun packet → encrypt to EXIT (inner) →
  the resulting UDP-to-EXIT packet → encrypt to ENTRY (outer) → real socket. **Implemented** in
  the shared Go core `clients/native/wgnest` (two stacked wireguard-go devices where the inner
  device's `conn.Bind` is a UDP socket on the outer device's gVisor netstack — no forked
  wireguard-go). It's gomobile-bound to a tiny `Wgmobile.start(…, tunFd)` / `stop` surface:
  `build-android.sh` → `wgmobile.aar` (consumed by `CumulusMultihopVpnService`), `build-ios.sh` →
  `Wgnest.xcframework` (consumed by `PacketTunnelProvider.startMultihop`). Both route
  `0.0.0.0/0` minus the entry IP so the outer device's one real socket bypasses the tun (Android
  synthesises the split routes; iOS uses `NEIPv4Settings.excludedRoutes`). Verified end-to-end
  against the live DE fleet via `clients/native/wgnest/cmd/nesttest` (traffic egresses with the
  exit node's IP).
- **Web / official-client export:** produce both `.conf` files + a short routing note. True nesting
  with the stock WireGuard app is awkward (one tunnel at a time) — multi-hop is really an
  our-apps feature; the web page can still hand out the two configs for advanced users.

## Egress note (gateway)

The entry gateway must be allowed to forward premium traffic to another gateway's `:51820/udp`. The
default egress policy (`CVPN_EGRESS_ALLOW_PORTS` empty = allow-all-minus-SMTP) already permits this.
**If we later ship a restrictive allowlist, it must whitelist UDP 51820 to the gateway fleet IPs**,
or multi-hop breaks. Noted in `config` and `docs/06`.

## Roadmap

- **v1:** core-ts multihop + desktop UI/logic (two-device) + mobile UI + **native nesting**
  (`wgnest`: Android AAR + iOS xcframework, proven against the live fleet) + web export.
- **v1.5:** distinct-key-per-hop (payment-key indirection) for both-hops-collude resistance.
- **v2:** 3-hop for the truly paranoid (diminishing returns, more latency); auto route optimization.
