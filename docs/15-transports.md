# 15 — DPI-resistant transports (`wg`, `awg`, `wg-tls`)

Vanilla WireGuard has a constant, trivially-matched fingerprint: a 148-byte handshake initiation
and a 92-byte response, each with a fixed type byte at a fixed offset. A censor blocks it **without
decrypting anything**, and blocks it fleet-wide — so having ~15k heterogeneous Flux exit IPs buys us
nothing against it. That is the problem this document solves.

The answer is **pluggable transports with capability negotiation**: one enrollment, one WireGuard
identity, several ways to carry the packets. The gateway advertises what it can serve; the client
picks the best one it also implements.

> **Scope.** `docs/10-api-contract.md` owns the *wire format* of the `transports` array (JSON shape,
> the legacy-omission rule, `params.tier` semantics). `docs/16-validation.md` owns how to *verify* a
> live gateway. This document owns the **design**: what each transport is, why it exists, what it
> defeats, and the invariants an implementer must not break. Where the three overlap, those docs are
> authoritative — don't duplicate them here or they will drift.

---

## 1. The three transports

| Slug | Carries WG over | Port | Enabled by | Costs a Flux port? |
|---|---|---|---|---|
| `wg` | UDP, unmodified | **51820/udp** | always on | yes (the one we already pay for) |
| `awg` | UDP, AmneziaWG obfuscation | **51821/udp** | `CVPN_OBFS_ENABLE` | **no** — free UDP side of the API port |
| `wg-tls` | TCP, inside a TLS session | **51820/tcp** (or **443** on a stealth node) | `CVPN_TLS_ENABLE` | **no** on 51820 — free TCP side of the WG port |

`awg` does **not** get a port of its own. FluxOS publishes every port listed in an app spec on *both*
TCP and UDP, and we only used 51820/udp and 51821/tcp — so the obfuscated listener rides the unused
UDP side of the control-API port, and the TLS relay rides the unused TCP side of the WireGuard port.
Two listed ports carry four listeners. This is the whole reason the DPI work costs nothing to deploy
fleet-wide.

There is a fourth port, **51822**, which is *never* listed in a spec — see §5.

### Backward compatibility

Every transport beyond `wg` is **additive and off by default**. A gateway with `CVPN_OBFS_ENABLE`
and `CVPN_TLS_ENABLE` unset advertises nothing extra and behaves exactly like a 0.1.0 image. A
pre-negotiation gateway omits the `transports` field entirely, and clients treat that as "vanilla
WireGuard on 51820". Old apps keep working against new gateways, and new apps against old ones —
there is no flag day in either direction.

---

## 2. `awg` — AmneziaWG obfuscation

### The engine swap

The gateway, the mobile `wgnest` core and the desktop sidecar all run
**`github.com/amnezia-vpn/amneziawg-go v0.2.19`** instead of upstream `wireguard-go`. AmneziaWG's
**cryptography is byte-identical to WireGuard's**; it adds framing knobs on top. With no parameters
set, a device is wire-compatible with stock WireGuard — which is why one engine can serve both the
vanilla and the obfuscated listener, and why swapping the engine was safe for existing users.

> **Pin all three in lockstep** (`gateway/go.mod`, `clients/native/wgnest/go.mod`,
> `clients/desktop/scripts/fetch-wireguard-go.sh`). We hold the **AWG-1.5 line (v0.2.x)** because the
> AWG-2.0 line (v1.x) drags gVisor forward to a version whose `stack.PacketBuffer` dropped `IsNil()`,
> which breaks our vendored `internal/netstack`. Bumping to 2.0 is a coordinated netstack re-vendor,
> not a version bump.

### The profile

Nine parameters, advertised by the gateway in `transports[].params` and applied identically on both
ends. **Every field must match exactly** or the handshake fails.

| Field | Meaning |
|---|---|
| `Jc` | number of junk packets sent before the handshake |
| `Jmin`, `Jmax` | size bounds for those junk packets |
| `S1`, `S2` | bytes of junk prepended to the handshake init / response headers |
| `H1`–`H4` | custom message-type magic values, replacing WireGuard's 1/2/3/4 |

The v1 fleet profile is a single hard-coded constant (`wg.DefaultObfsParams`):

```
Jc=4  Jmin=40  Jmax=70  S1=50  S2=100
H1=1148746654  H2=1148746655  H3=1148746656  H4=1148746657
```

`H1`–`H4` must be pairwise distinct and outside the reserved range 1–4; `S1+148 ≠ S2+92` so the
obfuscated init and response keep distinguishable sizes. **None of this touches the cryptography** —
it only reshapes the framing so the fixed-size, fixed-type-byte fingerprint disappears.

**Deferred:** the profile is one fleet-wide constant. There is no rotation, no per-gateway profile,
and no negotiation of the profile itself. That is adequate for v1 — it defeats the static
vanilla-WG signature — but per-gateway or rotating profiles are a known later refinement.

### Implementation rule

Obfuscation parameters are **device-level** UAPI settings and must be written **before the first
`public_key=` peer line**. In a rendered `.conf` they belong in `[Interface]`, before `[Peer]`. Every
platform re-emits them in the same fixed order (`jc, jmin, jmax, s1, s2, h1, h2, h3, h4`). Getting
this ordering wrong makes the device reject them or treat them as peer keys.

---

## 3. `wg-tls` — WireGuard inside TLS

`awg` defeats the WireGuard *signature*, but it is still UDP. It does nothing against a censor who
simply drops UDP, or one who allows only 80/443. `wg-tls` is the answer to that: the tunnel rides an
ordinary-looking TLS session over TCP.

### Framing

WireGuard datagrams are carried over the TLS byte stream with a **2-byte big-endian length prefix**
per datagram (max 65535, matching the prefix). Each datagram is written with a **single write**, so
it becomes one TLS record — two records per packet would itself be a tell.

### The client bridge contract

All three clients implement the same shape, mirroring the Go reference `tlsrelay.ClientBridge`:

1. Bind a **local UDP socket** on loopback; that address is what the WireGuard engine dials as its
   peer endpoint (the config's `Endpoint` is rewritten to it).
2. Open **one TLS connection** to the gateway's relay.
3. Pump: UDP → length-framed → TLS, and TLS → de-framed → UDP back to the engine's source.

| Platform | Bridge |
|---|---|
| Desktop | `tunnel/tlsbridge.rs` — rustls (ring), own tokio runtime |
| iOS | `WgTlsBridge.swift` — `NWListener` (UDP) ↔ `NWConnection` (TLS) |
| Android | `WgTlsBridge.kt` — `DatagramSocket` ↔ `SSLSocket` |

**Routing requirement:** the bridge's TLS socket must be routed *outside* the tun, or it loops back
through the tunnel it is carrying. Desktop pins a host route to the gateway; Android and iOS route
`0.0.0.0/0` **minus the gateway IP** into the tun.

### TLS here adds no security — read this before changing anything

The certificate is **self-signed and no client verifies it**. Every bridge disables verification
deliberately (Rust `NoVerify`, Swift's verify block accepts everything, Kotlin's trust manager
accepts everything). This is the Shadowsocks/obfs model: **the outer layer hides, the inner layer
secures.** Trust is anchored entirely in the inner WireGuard handshake, whose server key the client
pins from the signed directory — so a TLS man-in-the-middle still cannot complete the inner
handshake and learns nothing.

Do not describe this as "double encryption" or "TLS-authenticated"; both would be materially wrong.
And note the limit it implies: a self-signed cert does **not** survive an active-probing censor that
validates the chain (§7).

The cert's CN/SNI comes from `CVPN_TLS_SNI`. The gateway has **no default** for it — unset produces a
`localhost` certificate, which is poor camouflage. The deploy layer supplies `www.bing.com`.

---

## 4. Negotiation and client selection

The gateway advertises; the client decides. Selection lives in `@cumulusvpn/core`
(`clients/core-ts/src/transport.ts`) and is pure — it dials nothing.

### Modes

| Mode | Preference order | Notes |
|---|---|---|
| `auto` | `wg` → `awg` → `wg-tls` | default; fastest first, vanilla is its floor |
| `speed` | `wg` → `awg` | fast tiers only (not exposed in either UI today) |
| `stealth` | **`wg-tls` → `awg`** | the user-facing "Stealth" toggle |

**The load-bearing invariant:** `stealth` deliberately omits `wg`. If no permitted transport is
available, selection **throws** — Stealth is never silently downgraded to fingerprintable plain
WireGuard. `auto` always resolves against any normal gateway, so the throw only ever surfaces for an
explicit Stealth/Speed request.

Note the ordering: **Stealth prefers `wg-tls` over `awg`**, because `wg-tls` survives strictly more
censorship. (This is the reverse of the order they were built in.)

### What each client implements

`IMPLEMENTED_TRANSPORTS` in core-ts is `{wg}` only — the shared library deliberately claims nothing.
Each client passes its own set:

- **Desktop:** `{wg, awg, wg-tls}`
- **iOS / Android:** `{wg, awg, wg-tls}`
- Anything else (browser demo): `{wg}`

### Fallback

A tunnel *starting* is not a tunnel *working*: the native layer returns as soon as the interface is
configured, long before any handshake. So clients walk the whole ordered chain, attempting each
transport until one actually completes a handshake.

- **"Up" means** `lastHandshake` is set, or `rxBytes > 0` — i.e. the gateway answered.
- **`txBytes` is NOT a valid signal.** WireGuard re-sends handshake initiations forever, so it climbs
  steadily on a completely dead tunnel.
- **One enrollment serves the whole chain.** Enrollment is transport-agnostic, and the gateway rate
  limits it to one per source IP per 2s — re-enrolling per attempt would trip that limit mid-sweep.
- **Don't tear down between attempts** where the platform replaces a tunnel atomically (desktop):
  disconnecting would drop the kill switch and open a plaintext gap. **Do** tear down on exhaustion,
  or the machine is left with a live kill switch and a route to a dead interface.
- Fallback can only walk **within the mode's own preference list**, which is what makes it safe:
  Stealth can never fall through to `wg`, because `wg` is not in its chain.

### Selection happens before enrollment

Clients resolve the transport *first*, so a Stealth request against a vanilla-only gateway fails
immediately without spending a proof-of-work, and without marking the gateway bad — it isn't a node
failure.

---

## 5. The premium (443) tier

The scarce, expensive 443 listener is reserved for paying users via `CVPN_TLS_PREMIUM`. It is **off
by default** and is set only on the 443 spec group — the standard group's wg-tls rides the free TCP
side of 51820, so gating that would cost free users their stealth for no saving.

### Two shapes of the same transport

| `CVPN_TLS_PREMIUM` | Relay fronts | Peer set | Advertised as |
|---|---|---|---|
| `0` (default) | the **vanilla** device on 51820/udp | shared — any enrollment works | `wg-tls` |
| `1` | a **dedicated** device on **51822/udp** | entitled keys only | `wg-tls` + `params.tier=premium` |

In the default shape the relay has **no device of its own** — it simply bridges into the vanilla
listener, so nothing is mirrored and any existing enrollment just works.

### Why enforcement lives in the peer set

The relay bridges **opaque** WireGuard frames. It cannot read the peer key, so it cannot check
entitlement itself. Instead, the gated device's peer set *is* the gate: a free key is never mirrored
onto it, so it can reach the listener, complete TLS, and then never complete the inner handshake.

**51822 must never appear in a spec's `ports[]`.** FluxOS publishes only listed ports, and that
unreachability is precisely what makes the relay the sole way in. Publishing it would let clients
bypass the relay entirely and defeat the gate. A deploy test asserts it never appears.

### Entitlement moves, so membership is reconciled

A payment confirms minutes after enrollment, and expiry is **eventless** — nothing fires when a
subscription lapses. So a 15-second `syncTiers` loop reconciles membership in both directions: a key
that pays gets added without re-enrolling, and a lapsed one is removed.

### The client half

The gate is advertised to everyone (`/v1/info` is unauthenticated) but tagged, so clients **skip** a
gated transport rather than walking into a doomed handshake. Because Stealth's chain is
`wg-tls → awg`, a free user simply lands on `awg` — still obfuscated, just not the 443 tier.

Two deliberately opposite defaults, easy to confuse:

- **Unknown `params.tier` values fail OPEN** — an old client still works against a gateway that
  later introduces further tiers.
- **The `tier` argument to selection defaults to `'free'` — fail CLOSED** — a caller that hasn't been
  taught about tiers can never dial a transport it may not be entitled to.

**A wrong guess does not error, it hangs.** Because the relay can't reject by key, guessing
"premium" wrongly means TLS connects and the inner handshake silently never lands. Entitlement is
chain-derived and each gateway evaluates it independently, so a fleet-wide cached tier can disagree
with the node actually enforcing the gate. Clients therefore resolve the tier **against the gateway
they are about to dial**, and fall back to the cached value if that probe fails.

---

## 6. Multi-hop

Stealth composes with multi-hop, but only partially: the **entry hop** is obfuscated and the exit hop
stays vanilla. That is the right shape — the local censor only ever sees the entry handshake; the
inner hop travels encapsulated inside it.

**The multi-hop entry uses `awg` only.** `wg-tls` is not wired for it. See `docs/11-multihop.md`.

---

## 7. Threat model — what each transport actually defeats

Be precise here; overclaiming in user-facing copy would be dishonest.

| Censorship technique | `wg` | `awg` | `wg-tls` |
|---|---|---|---|
| Passive signature DPI (match the 148/92-byte handshake) | ❌ | ✅ | ✅ |
| Statistical / ML flow classification | ❌ | ⚠️ partial, eroding | ✅ rides real TLS |
| Blanket UDP blocking, or 80/443-only networks | ❌ | ❌ still UDP | ✅ TCP |
| SNI allow-listing | n/a | n/a | ⚠️ needs a plausible SNI |
| **Active probing** (censor handshakes the port to confirm a VPN) | ❌ | ❌ | ❌ |

Reading it plainly:

- **`awg`** clears the common case — static DPI in RU/corporate/ISP filtering — at full UDP speed.
  It is *partially* effective against statistical classifiers and that margin erodes over time.
- **`wg-tls`** is the workhorse: it survives UDP-blocking and looks like HTTPS. It is the only
  transport that helps on a network where UDP simply doesn't leave.
- **Neither defeats active probing.** A censor that connects to the port and validates the
  certificate chain sees a self-signed cert answering nothing like a real web server. Defeating that
  requires a decoy-site handshake (VLESS+REALITY), which is **deferred** — it is a separate proxy
  stack on every gateway *and* a full client implementation on three platforms, and its only marginal
  win is against GFW-grade probing, which is not a market we serve today.

---

## 8. Rollout (this document's M-series)

> These milestone numbers are **local to this document** and are *not* the M0–M7 in
> `docs/07-roadmap.md` (where M4 is "Public beta"). Where code comments say "docs/15 M4" they mean
> the deploy rollout below.

| | |
|---|---|
| **M0** | Negotiation + backward compatibility — gateway advertises `transports[]`, clients select and fall back. No new transport. |
| **M1** | `awg` gateway listener + Go end-to-end proof. |
| **M2** | `wg-tls` gateway relay + end-to-end proof. |
| **M3** | Clients — core selection, native data paths on desktop / iOS / Android, the Stealth toggle. |
| **M4** | Deploy rollout — advertise `awg` + `wg-tls` fleet-wide, add the 443 stealth spec group. |

### The two spec groups

`deploy/countries.yaml` enables the transports fleet-wide (`obfs`, `tls`, `tlsSni`). Every country
gets a standard `cumulusvpn<cc>` spec with ports `[51820, 51821]` — which, per §1, is enough for all
three transports.

A country flagged `stealth: true` **also** gets a separate `cumulusvpntls<cc>` spec with ports
`[51820, 51821, 443]`, `CVPN_TLS_PORT=443` and `CVPN_TLS_PREMIUM=1`. It is a separate spec because a
Flux spec's port list applies to all its instances, so 443 can only be scoped to *some* nodes by
giving them their own spec — and 443 is worth scoping: sub-1024 ports cost extra on Flux, and each
stealth country **doubles its instance footprint** (each group gets the country's full `instances`).

Client discovery strips the `tls` infix, so `cumulusvpntlsde` maps to country `DE`; both groups
coexist in a country and a client picks per-gateway from the advertised `transports[]`.

**DE is the pilot** — currently the only country with `stealth: true`.

### Current state

**Nothing above is live yet.** `deploy/countries.yaml` still pins the gateway image `:0.1.0`, which
is vanilla-only, and the registration path is partly manual. Treat every statement about fleet
behaviour as "once tagged and rolled out". `docs/16-validation.md` is the runbook for getting there
and for proving each transport against a live node.

---

## 9. Invariants for implementers

1. **Stealth never becomes plain WireGuard.** `PREFERENCE.stealth` omits `wg`; selection throws
   rather than downgrading; fallback stays inside the mode's chain.
2. **Obfuscation params go in `[Interface]`, before the first peer.** Device-level, fixed order.
3. **Never publish 51822.** It would bypass the premium relay entirely.
4. **TLS is camouflage, not security.** Never verify the cert; never rely on it for confidentiality.
5. **`txBytes` never proves a tunnel is up.** Only a handshake or received bytes do.
6. **One enrollment per connect attempt sequence.** It is transport-agnostic and rate-limited.
7. **A param-less AmneziaWG device must stay byte-identical to vanilla WireGuard** — that is what
   keeps the engine swap invisible to existing users.
8. **Bump amneziawg-go and gVisor together, in all three components.**
