# 19 — Inbound Port Forwarding (design + plan)

**Status: PLANNED — nothing implemented.** Two hard gates before any code: the abuse-policy
decision (§2) and the FluxOS port-cap change (§4, we control FluxOS so it is ours to ship).
All file/line references below were verified against source 2026-08-12 (`repos/flux` for
FluxOS, this repo for the gateway).

## 1. What it is, who it's for

Let the internet initiate connections **to** a connected peer through the gateway's public
IP: user leases public port N on their exit instance, traffic arriving at `<node_ip>:N` is
tunneled to their device. Drivers: torrent seeding (#1 by far), self-hosting behind CGNAT,
inbound-friendly P2P. Premium-only differentiator — competitors largely dropped it
(Mullvad 2023) or gate it hard (PIA/Proton), so offering it is a real wedge *if* the abuse
posture holds.

## 2. GATE A — the policy decision (decide first, before any engineering)

docs/06-legal-abuse.md:5 cites Mullvad dropping the feature because abuse blacklisted their
IPs — and our exit IPs belong to **third-party Flux node operators** who didn't opt into
hosting inbound services. This is the strongest argument against, independent of code.

Proposed posture (to be accepted/amended before Phase B):
- **Premium (paying) peers only** — gate via `internal/entitle` tier, same as wg-tls premium.
- **Leases expire** (default 30 days paid / renewable; lease dies with entitlement).
- **TCP + UDP both** (Flux publishes both sides of every port anyway); inbound port
  blocklist mirrors network policy: never forward listener ports that pattern-match abuse
  (we choose a clean dedicated range, so this is mostly moot — see §5.2).
- **No SMTP-style carve-outs needed inbound**, but keep outbound 25/465/587 block as is.
- Abuse handling: published abuse contact per docs/06, lease revocation is one API call +
  restart-safe (leases persisted like peers.cache), and the whole feature sits behind a
  dashboard kill switch (§7).
- ToS/docs update: user is responsible for services they expose; we log lease↔pubkey
  mapping (no traffic contents) for abuse response.

If this posture is rejected → stop; nothing else in this doc happens.

## 3. Current state (why this is feasible at all)

No iptables/DNAT anywhere — the data plane is userspace gVisor netstack, and Flux strips
privileges anyway (docs/02:10). Everything needed for a **userspace inbound proxy** already
exists:

| Piece | Where | Note |
|---|---|---|
| Bind public TCP port in container, bridge into WG | `gateway/internal/tlsrelay/relay.go:134` | proven pattern (wg-tls relay) |
| Dial INTO the tunnel to a peer | `gateway/internal/netstack/tun.go:235` `DialContextTCPAddrPort`, `:274` `DialUDPAddrPort` | dial to `10.8.x.y` sources from 10.8.0.1, wireguard-go routes by allowed-ip |
| In-tunnel listener (for authenticated lease API) | `gateway/internal/netstack/tun.go:261` `ListenTCPAddrPort` | listen on `10.8.0.1` inside netstack |
| Per-peer rate-limited splice | `gateway/internal/wg/forward.go:204` `splice`/`rateCopy` | reuse for metering forwarded traffic |
| Peer identity/assignments persisted across restart | `gateway/internal/wg/peercache.go:25` (`/data/peers.cache`) | same pattern for leases |
| Premium tier lookup | `internal/entitle` (used in `api.go` enroll path) | lease eligibility |
| Outbound-only guard that must NOT apply to ingress | `forward.go:152` (rejects non-peer sources), `:346` `destAllowed` SSRF guard | ingress path is separate; do not weaken these |

Current ports: 51820 (WG), 51821 (API/awg) — 2 of Flux's 5-port cap used
(`internal/config/config.go:16-37`). The cap is the blocker → Gate B.

## 4. GATE B — FluxOS changes (`repos/flux`, ours to ship)

### 4.1 The cap
`ZelBack/src/services/appRequirements/appValidator.js:635` and `:767`:
`ports.length > 5` → reject. Raise to **100** per component.

**This is a consensus rule**: every node validates registration/update messages as they
propagate; un-upgraded nodes drop >5-port specs. Ship with an **enforcement-height gate**
(same pattern as min-instances at block 2,176,519): specs with >5 ports valid only after
block H, H chosen after the release has broad adoption.

**Alternative worth serious consideration — port-range syntax** (`"20000-20099"` as a
ports entry): Docker publishes ranges natively, on-chain messages stay small (vs three
100-entry arrays: `ports`/`containerPorts`/`domains` must be equal length,
appValidator.js:629-635), and the validator expands ranges for banned/conflict checks.
Slightly more code, much cleaner spec. Decide in the FluxOS PR; the gateway design below
is identical either way.

### 4.2 Port conflicts — verified NOT global
`appLifecycle/appSpawner.js:433` → `portManager.ensureApplicationPortsNotUsed(...)` checks
only apps **running on the same node IP** (`getRunningAppIpList`). A 100-port app consumes
nothing network-wide; it just needs nodes with the range free. Choose an uncommon high
range to keep placement easy.

### 4.3 Spawn-time verification does not scale to 100 as written
`portManager.checkInstallingAppPortAvailable` publicly probes EVERY port pre-install and
maps each via UPnP on consumer routers first; `restoreAppsPortsSupport`
(`appNetwork/portManager.js:273`) re-maps all ports periodically. 100 UPnP mappings will
fail on many home routers. Required FluxOS-side mitigations (pick in PR):
- restrict >5-port specs to `staticip: true` (and/or datacenter) placements — our specs
  already are (countries.yaml defaults), so this costs us nothing; and/or
- sample-probe (e.g. 5 random of N) above a threshold instead of all N.

### 4.4 Pricing
`utils/appUtilities.js:57` charges only enterprise ports (0-1023, 8080/8081/8443/6667);
high ports are free at any count → no squat deterrent. Add per-port pricing **beyond the
first 5** (small monthly fee per extra port). Discourages lazy 100-port specs, monetizes
the capability for the network, and for us it's just a known line in the cost model.

### 4.5 Rollout checklist (FluxOS)
- [ ] PR: validator cap/range + height gate + extra-port pricing + probe scaling/staticip
      restriction; update `config/default.js` price spec if needed
- [ ] fluxos-frontend: spec editor validation mirrors new rule
- [ ] Release, monitor adoption, then announce enforcement height
- [ ] Docs (flux-docs) + `docs/02-flux-deployment.md` constraint table here (line 14)

## 5. Gateway implementation (this repo, after Gates A+B)

### 5.1 Lease manager — new `gateway/internal/ingress/lease.go`
- State: `pubkey → {port, proto(any), createdAt, expiresAt}`; one lease per pubkey v1.
- Pool = configured forward range minus active leases. Allocation random within range
  (avoids guessable user→port mapping).
- Persist to `/data/leases.cache` (same envelope/pattern as `wg/peercache.go`) — leases
  survive restart; on boot, drop leases whose pubkey lost premium entitlement.
- Expiry sweep alongside the existing peer janitor; on expiry/revocation close listeners
  and active splices immediately.

### 5.2 Ingress proxy — new `gateway/internal/ingress/proxy.go`
- Per lease: `net.Listen("tcp", ":port")` on host (tlsrelay pattern) + UDP socket.
- TCP accept → `tun.DialContextTCPAddrPort(peerIP:port)` → `splice` with the peer's
  token bucket (forward.go rateCopy) so forwarded traffic is metered like egress.
- UDP: host socket ↔ `tun.DialUDPAddrPort(peerIP:port)`, per-remote flow map with idle
  timeout (mirror the egress UDP forwarder's session handling).
- Same external port on the peer side (external N → peer `10.8.x.y:N`) — no remapping,
  simplest client story ("your port is N").
- Caps: per-lease concurrent-connection ceiling + per-peer connection-rate ceiling
  (docs/06:26-30 posture applies inbound too).
- **Do not touch `forward.go`'s source-must-be-peer or destAllowed guards** — ingress is
  a separate path; egress SSRF posture unchanged.

### 5.3 Lease API — extend `gateway/internal/api/api.go`
- **Auth by cryptokey routing**: serve the lease endpoints ONLY on an in-tunnel listener
  (`netstack ListenTCPAddrPort` on `10.8.0.1:51821`). Source IP inside the tunnel is
  unforgeable (wireguard-go only delivers packets matching the peer's allowed-ip), so
  `PeerByAddr(src)` IS the authentication — no new signature scheme, no PoW.
- Endpoints (same signed-response envelope as enroll, docs/10 contract):
  - `POST /v1/portforward` → allocate or renew → `{external_ip, port, expires_at}`;
    403 if not premium, 409/queue if pool exhausted.
  - `DELETE /v1/portforward` → release.
  - `GET /v1/status/<pubkey>` (existing) gains an optional `forward` block.
- Public (out-of-tunnel) API surface unchanged.

### 5.4 Config
- `CVPN_FORWARD_ENABLE` (default off), `CVPN_FORWARD_RANGE` (e.g. `52000-52094`),
  `CVPN_FORWARD_LEASE_DAYS` — via env from spec, hot-reload-safe like other CVPN_ vars.
- Gateway sanity-checks the range against what the spec actually publishes (it can read
  its own spec via `/apps/appspecifications/<name>`, docs/02:150).

### 5.5 Tests
- Unit: lease alloc/expiry/persistence/premium-drop (`gateway/internal/ingress/*_test.go`).
- Integration: two in-process WG peers, external dial → listener on peer side (extend the
  existing netstack harness used by forward/relay tests); UDP echo; rate-cap enforcement;
  restart with live lease → listener restored.

## 6. Spec/deploy changes (after Gate B is live on the network)

- `deploy/countries.yaml`: add forward range to `ports` for **pilot country only** first
  (e.g. `ports: [51820, 51821, 52000-52094]` if range syntax lands, else enumerate).
  NOT in `stealthPorts` (443 group stays minimal-footprint).
- `deploy/scripts/generate.mjs`: emit the expanded arrays / range; `--check` still warns
  on eligible-node shortfall.
- On-chain **paid app update** per country — pilot with one (CZ or DE, existing pilot
  countries), measure, then fleet-wide only after §7 exit criteria.
- Cost note: per-port pricing from §4.4 applies to us too — fold into docs/02 cost model
  before fleet rollout.

## 7. Clients, surfaces, rollout

- **Clients** (mobile/desktop): Settings → "Port forwarding (Premium)": request/renew/
  release via the in-tunnel API; display `ip:port`; **on endpoint migration re-lease
  automatically and notify** (lease is per-instance; migration = new IP and possibly new
  port — docs/02:20 `RestartPolicy: 'no'`, instances migrate; this is inherent, surface it
  honestly in UI copy).
- **Web/dashboard**: feature flag `portForward` in the flags KV (flags.json pattern) as
  the **kill switch** — flag OFF hides client UI and gateways reject new leases (existing
  leases drain to expiry). Dashboard admin page: active leases per instance, revoke button.
- **Docs**: user-facing how-to + abuse/ToS page; update docs/03 (gateway), docs/10 (API
  contract), docs/06 (posture, per §2).
- **Pilot exit criteria** before fleet-wide: ≥2 weeks, zero abuse reports OR all handled
  within SLA, lease-restore-across-restart verified in prod, migration re-lease verified,
  no measurable egress-path regression.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Abuse → node-operator IP blacklisted | Gate A posture: premium-only, expiring leases, revocation + kill switch, datacenter placement (docs/06) |
| FluxOS height-gate fork risk (old nodes drop >5-port specs) | standard release-then-enforce flow; don't register >5-port specs before H |
| Instance migration kills leases | inherent; auto re-lease in clients + honest UX; same class as existing WG endpoint migration (docs/05) |
| Pool exhaustion (95 slots vs 1000 enrolled peers) | fine in practice: ~30-60 concurrently-active users/instance (docs/02:117); queue + expiry if wrong |
| UPnP-node spawn failures with big port sets | §4.3: staticip/datacenter restriction or sample-probe in FluxOS |
| Ingress path weakens egress SSRF guards | separate package; guards untouched (§5.2) |

## 9. Open questions

1. Gate A sign-off — who owns the abuse-posture decision? (blocks everything)
2. FluxOS: plain cap bump vs range syntax? (range recommended; decide in PR review)
3. Extra-port price point (FluxOS §4.4) — needs a number.
4. Lease duration + renewal UX (30d auto-renew while premium? per-session?).
5. Static lease→port stickiness across migration: impossible to keep the IP; is keeping
   the *port number* across instances worth directory-level coordination? (v1: no.)

## 10. Effort (rough)

| Phase | Scope | Estimate |
|---|---|---|
| FluxOS PR + release + enforcement height | §4 | days of code; weeks of network rollout (calendar) |
| Gateway (lease + proxy + API + tests) | §5 | ~1 week |
| Deploy/specs pilot | §6 | ~1 day + tx costs |
| Clients + dashboard + flags + docs | §7 | ~1 week across platforms |

Critical path is the FluxOS network rollout — start §4 first; §5 can be built and tested
locally (env-gated, no spec dependency) in parallel.
