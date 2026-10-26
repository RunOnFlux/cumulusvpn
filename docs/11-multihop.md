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

The client runs **two stacked WireGuard interfaces**:
- **Outer (wg-entry):** the client key `K`; peer = ENTRY, `AllowedIPs = <EXIT_ip>/32` only.
  Carries everything the client sends to the exit gateway: the inner tunnel's packets and the
  enroll at the exit.
- **Inner (wg-exit):** peer = EXIT, `AllowedIPs = 0.0.0.0/0, ::/0`. Carries all real traffic; its
  packets to `EXIT_ip` are routed *through* the outer interface. Its key is the desktop client's
  per-session exit key `X` (see below); mobile and web use `K` on both hops.

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
| EXIT gateway/operator | no (sees ENTRY's IP) | **yes** | desktop: only the session key X |
| Network observer at entry | yes (you use a VPN) | no | no |
| Any **single** operator | — | — | **never both IP+dest** ✅ |

The invariant holds only if the exit never links the session to the client. `K` is long-lived and
every gateway the client talks to directly (single-hop sessions, the entitlement status check) sees
it with the real IP, so any of them may later be picked as an exit. The desktop client therefore
never presents `K` to the exit and never contacts the exit from the real IP:

1. Choose the pair. The exit is never a gateway the app has sent `K` to since launch (an enroll,
   an entitlement check, a single-hop session): such a gateway could tie the session to the
   client by timing alone. Those gateways remain eligible as the entry.
2. Enroll `K` at the ENTRY, directly (the entry sees the real IP by design).
3. Bring the entry hop up with `<EXIT_ip>/32` routed into it (native `connect_multihop_entry`).
4. Generate a key `X` for this session alone (memory only) and enroll it at the EXIT. The request
   leaves inside the entry tunnel, so its source at the exit is the entry's IP.
5. Bring the exit hop up with `X` (native `connect_multihop_exit`): default route, DNS.

Entitlement is polled at the entry. Cross-jurisdiction hop selection means deanonymizing requires
compelling **two operators in two countries**.

Mobile (`wgnest`) and the web export enroll `K` at both gateways from the real IP; there the exit
learns the real IP and `K` at enroll time.

## Entitlement & cost

Multi-hop is a **premium feature**. Entitlement follows the key on every gateway (chain scan,
`docs/04`).

- **Desktop:** `K` is premium at the entry. The exit key `X` has no payment behind it, so the exit
  hop runs at the exit gateway's **free tier**. Each session enrolls a new `X`, so the exit holds
  one peer per session.
- **Mobile and web:** the same key `K` on both hops, premium at both. An adversary controlling both
  hops could correlate via `K`.
- **Next: payment-key indirection** (`docs/04` §Privacy v1.5): one payment authorizes a family of
  tunnel keys, so a per-session exit key is premium too. It needs gateway support.

Every exit enroll from the desktop client arrives from the entry gateway's IP, so the exit's
per-source-IP enroll limit (a burst of 8, then one per 2 s) is shared by all multi-hop users of
that entry; a refused enroll fails the connect with the gateway's `rate_limited` error.

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

// buildMultihopOuterConfig: the wg-entry .conf from the entry's enroll and the exit's IP alone,
// so the entry hop can be up before the exit is enrolled.
export function buildMultihopOuterConfig(args: {
  privateKey: string;       // the entry hop's key (K)
  entry: EnrollResponse;
  exitIp: string;
  entryTransport?: Transport;
}): { outer: string; entryEndpoint: string; exitEndpoint: string };

// buildMultihopInnerConfig: the wg-exit .conf.
export function buildMultihopInnerConfig(args: {
  privateKey: string;       // the exit hop's key (desktop: the session key X)
  exit: EnrollResponse;
  split?: CompiledSplit;
  dns?: string;
}): { inner: string; exitEndpoint: string; innerMtu: number };

// buildMultihopConfig: both, with ONE key on both hops (mobile, web export).
export interface MultihopConfig {
  outer: string;            // wg-entry .conf: AllowedIPs = <exitIp>/32, MTU 1420, no DNS
  inner: string;            // wg-exit .conf:  AllowedIPs = 0.0.0.0/0,::/0, MTU 1340, DNS = exit dns
  entryEndpoint: string;    // "<entryIp>:<port>" — the only real UDP egress
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
routes 0.0.0.0/0, MTUs are 1420/1340, each half carries the key it is given, the combined builder
equals the two halves for one key, and `selectHops` rejects entry==exit and enforces cross-country
when asked.

## Client implementation notes

- **Desktop (Tauri + wireguard-go):** **two wireguard-go devices**, brought up in two native
  steps (see the threat model above). `connect_multihop_entry` starts wg-entry, pins the entry
  endpoint to the physical gateway and `<exitIp>/32 → wg-entry`; the session stays `connecting`.
  `connect_multihop_exit` refuses unless that entry step is pending for the same entry, exit and
  kill-switch choice and the exit's tunnel address differs from the entry's, then starts wg-exit
  and moves the default route and DNS to it. A failure in either step tears the whole session
  down.
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

The entry gateway must be allowed to forward traffic to another gateway's `:51820/udp` (the inner
tunnel) and `:51821/tcp` (the desktop client's enroll at the exit). The default egress policy
(`CVPN_EGRESS_ALLOW_PORTS` empty = allow-all-minus-SMTP) already permits both. **A restrictive
allowlist must whitelist UDP 51820 and TCP 51821 to the gateway fleet IPs**, or multi-hop breaks. Noted in `config` and `docs/06`.

## Roadmap

- **v1:** core-ts multihop + desktop UI/logic (two-device) + mobile UI + **native nesting**
  (`wgnest`: Android AAR + iOS xcframework, proven against the live fleet) + web export.
- **Payment-key indirection:** premium for the per-session exit key, and distinct keys per hop
  on mobile and web.
- **v2:** 3-hop for the truly paranoid (diminishing returns, more latency); auto route optimization.
