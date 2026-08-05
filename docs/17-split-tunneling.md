# 17 — Split tunneling (app / domain / IP rules)

"Everything through the VPN" is the right default and the wrong absolute. Users need their banking
app to see their real IP, their NAS to stay reachable, their work VPN client to not fight ours, and
their game to not eat a transatlantic hop. Split tunneling is the escape hatch that keeps those
users on the product instead of toggling us off — and toggling us off is the failure mode we are
actually competing against.

This document is the complete design and build plan for that feature: **inclusion/exclusion rules
by application, by domain, and by IP/CIDR**, across every client we ship.

> **Scope.** `docs/05-clients.md` owns the overall client product shape. `docs/10-api-contract.md`
> owns the gateway wire format — **this feature does not touch it**. `docs/11-multihop.md` owns the
> nested-tunnel data plane, `docs/15-transports.md` the transport negotiation; this document says
> how split rules interact with both but does not redefine them. `docs/16-validation.md` owns the
> live-gateway runbook; the leak matrix in §11 is written to be folded into it. Where those docs
> overlap with this one, they are authoritative.

---

## 0. Decisions, up front

| # | Decision | Value | Rationale |
|---|---|---|---|
| D1 | Gateway/API changes required | **None** | Split tunneling is entirely client-side route/filter policy. No new enroll field, no new `/v1/*` surface, no image release. |
| D2 | Rules sync between a user's devices | **Never** | We have no accounts. Rules are device-local, on-disk, and never transmitted. See §10. |
| D3 | Default state | **Off**, with LAN bypass **off** too | A VPN that silently excludes traffic is a lie. Every exclusion is user-initiated. |
| D4 | Per-app rules on iOS | **Not shipping — impossible** | Apple restricts `NEAppRule` to MDM-managed per-app VPN. No consumer App Store VPN can do it. §4.5. |
| D5 | Domain rules status | **Best-effort, never a security boundary** | DNS-learned routing has structural holes (§6.6). The UI must say so. |
| D6 | Rule authority | **`clients/core-ts`** | One policy model, one CIDR algorithm, four enforcement backends. §3. |
| D7 | Free or premium | **Premium-only** | Power-user feature as a paid hook; free tier keeps full-tunnel VPN untouched. Gating mechanics in §7.6. |

---

## 1. What we are building

Three **rule kinds**, one global **mode**, applied to every rule at once.

| Rule kind | Value | Example |
|---|---|---|
| `app` | Platform-scoped application identity | `com.android.chrome`, `C:\Program Files\...\chrome.exe` |
| `domain` | Hostname or `*.`-prefixed suffix | `netflix.com`, `*.internal.corp` |
| `cidr` | IPv4/IPv6 network | `192.168.0.0/16`, `2001:db8::/32` |

| Mode | Meaning |
|---|---|
| `off` | Everything through the tunnel. Today's behaviour, byte-identical. |
| `exclude` | Everything through the tunnel **except** what matches a rule ("split exclude" / bypass). |
| `include` | **Only** what matches a rule goes through the tunnel; everything else is direct ("inverse split"). |

Plus one convenience flag that is really just a canned CIDR set, because it is the single most
requested case and deserves a checkbox rather than typing:

- `lanBypass` — RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`),
  ULA (`fc00::/7`), and multicast/broadcast. Lets printers, NAS, Chromecast, and local dev survive.

**Mode is global, not per-rule.** Every VPN that has tried per-rule direction (some rules include,
some exclude, in one policy) has produced a UI users cannot reason about and a route table with
ambiguous precedence. One mode, one list.

---

## 2. Feasibility — what each platform can actually enforce

| Client | `app` | `cidr` | `domain` |
|---|---|---|---|
| **Android** | ✅ native, kernel-enforced | ✅ | ⚠️ DNS-learned |
| **Desktop — Linux** | ⚠️ cgroup v2 + fwmark policy routing | ✅ trivial | ⚠️ DNS-learned |
| **Desktop — macOS** | ⚠️ pf `route-to` + run-as-GID launcher | ✅ trivial | ⚠️ DNS-learned |
| **Desktop — Windows** | ⚠️ packet-redirect driver (WFP callout or WinDivert) | ✅ trivial | ⚠️ DNS-learned |
| **iOS** | ❌ **impossible** (D4) | ✅ | ⚠️ limited, see §4.5 |
| **Web (`.conf`)** | ❌ | ✅ via `AllowedIPs` | ❌ |

Read the ⚠️ in the `app` column as "a real project each", not "a flag". Read `cidr` as "days".

---

## 3. The rule model (`clients/core-ts`)

One canonical model, compiled per platform. New module `clients/core-ts/src/split.ts`, exported
from `index.ts` alongside the existing `transport` / `multihop` exports.

### 3.1 Types

```ts
/** Global direction of the policy. */
export type SplitMode = 'off' | 'exclude' | 'include';

/** What a rule matches on. */
export type SplitRuleKind = 'app' | 'domain' | 'cidr';

/**
 * Which platform an `app` rule's value is meaningful on. App identity is not
 * portable (a package name means nothing on Windows), so app rules carry the
 * platform they were authored on and are ignored everywhere else.
 */
export type SplitPlatform = 'android' | 'ios' | 'macos' | 'windows' | 'linux';

export interface SplitRule {
  readonly kind: SplitRuleKind;
  /** Package name / absolute exe path / bundle id / hostname / CIDR. Normalized. */
  readonly value: string;
  /** Human label for the UI ("Google Chrome"). Never used for matching. */
  readonly label?: string;
  /** Required for `kind: 'app'`, absent otherwise. */
  readonly platform?: SplitPlatform;
  /** User can disable a rule without deleting it. Defaults true. */
  readonly enabled?: boolean;
}

export interface SplitPolicy {
  /** Schema version. Bump on any breaking change; migrate on load. */
  readonly version: 1;
  readonly mode: SplitMode;
  readonly rules: readonly SplitRule[];
  /** Canned RFC1918/link-local/ULA/multicast bypass. Independent of `mode`. */
  readonly lanBypass: boolean;
  /**
   * Where excluded traffic resolves names. `'tunnel'` keeps every lookup private
   * but means an excluded destination is still *revealed by* its DNS query going
   * to the gateway; `'system'` sends those lookups to the local resolver, which
   * leaks them to the network but is what most users expect. See §6.5.
   */
  readonly excludedDns: 'tunnel' | 'system';
}

export const EMPTY_POLICY: SplitPolicy = {
  version: 1, mode: 'off', rules: [], lanBypass: false, excludedDns: 'tunnel',
};
```

### 3.2 The compiler

The platform backends must never interpret a `SplitPolicy` themselves — they consume a
**`CompiledSplit`**, which is already reduced to primitives each OS understands.

```ts
export interface CompiledSplit {
  /** Destination prefixes that MUST be routed into the tunnel. */
  readonly tunnelRoutes: readonly string[];
  /** Destination prefixes that MUST bypass the tunnel (physical egress). */
  readonly bypassRoutes: readonly string[];
  /** App identities for this platform, in the direction implied by `mode`. */
  readonly appsIncluded: readonly string[];
  readonly appsExcluded: readonly string[];
  /** Domain matchers for the resolver engine (§6), already lowercased. */
  readonly domainsIncluded: readonly DomainMatcher[];
  readonly domainsExcluded: readonly DomainMatcher[];
  /** True when the policy has no effect — backends can take the fast path. */
  readonly isNoop: boolean;
}

export interface DomainMatcher {
  /** Bare hostname, or the suffix for a `*.` rule (without the `*.`). */
  readonly suffix: string;
  /** True when the rule was `*.example.com` (matches subdomains, not the apex). */
  readonly wildcard: boolean;
}

export function compileSplitPolicy(
  policy: SplitPolicy,
  ctx: { readonly platform: SplitPlatform; readonly supportsExcludeRoute: boolean },
): CompiledSplit;
```

`supportsExcludeRoute` is the key portability knob: platforms that can express "route everything
except X" natively (Android 13+, iOS, desktop route tables) get `bypassRoutes` verbatim; platforms
that can only express inclusion (Android < 13, a stock WireGuard client reading a `.conf`) get
`tunnelRoutes` pre-computed as the **complement** of the bypass set. §5.

### 3.3 Normalization and validation

Enforced at rule-creation time, not at compile time — a bad rule must be rejected in the UI:

- `cidr` — parse and canonicalize (`192.168.1.5/16` → `192.168.0.0/16`); reject overlapping
  duplicates by merging; reject `0.0.0.0/0` and `::/0` (that is the mode switch, not a rule);
  **reject any prefix containing the active gateway endpoint** — that rule would either kill the
  tunnel or create a routing loop, depending on direction.
- `domain` — lowercase, strip trailing dot, IDNA/punycode-encode, reject bare TLDs and anything
  that parses as an IP (that is a `cidr` rule); `*.x.y` sets `wildcard`.
- `app` — trim; platform-specific normalization in §4; reject our own identity (excluding
  CumulusVPN from its own tunnel is meaningless and confusing — the control plane is already
  outside the tun by construction).

### 3.4 Persistence

Device-local only (D2). Not secret, but **sensitive**: the rule list is a precise fingerprint of
which apps and services a user runs. It must never leave the device, never appear in a crash
report, and never be included in a support bundle without an explicit, separate consent step.

| Client | Location | Key |
|---|---|---|
| Mobile | `AsyncStorage` via `clients/mobile/src/state/storage.ts` | `cvpn:splitPolicy` |
| Desktop | `localStorage` via `clients/desktop/src/lib/storage.ts` | `cvpn.split.v1` |
| Web | `localStorage` (only affects the generated `.conf`) | `cvpn.split.v1` |

Load path must tolerate absent/corrupt/older-version JSON by falling back to `EMPTY_POLICY` —
same defensive shape as `loadActiveRoute()` in `storage.ts`. A policy that fails to parse must
**fail closed to "off"** (full tunnel), never to a partially-applied policy.

---

## 4. Enforcement, per platform

### 4.1 Android — the good case

Android is the only platform where per-app split is a first-class, kernel-enforced OS feature.

**Apps.** `VpnService.Builder.addAllowedApplication(pkg)` / `.addDisallowedApplication(pkg)`.
The two are **mutually exclusive** — calling both throws. That maps exactly onto our global mode,
which is one reason mode is global.

Three code paths, all of which must be updated together:

| Path | File | How |
|---|---|---|
| Vanilla single-hop (library owns the tun) | `CumulusVpnService.kt` → `CumulusTunnelController.startTunnel` | Emit `IncludedApplications = …` / `ExcludedApplications = …` into the `[Interface]` block of the wg-quick config; `com.wireguard.config.Interface` parses them and applies them to the builder. Free. |
| Obfuscated (`awg`/`wg-tls`) | `CumulusObfsVpnService.kt:91` | Explicit `builder.addAllowedApplication` / `addDisallowedApplication`. |
| Multi-hop | `CumulusMultihopVpnService.kt:105` | Same as above. |

Because the vanilla path renders its config through core `buildWgConfig`, the cleanest split is:
`buildWgConfig` gains an optional `split?: CompiledSplit` param and emits the two Android keys plus
the `AllowedIPs` adjustment (§5) — keeping the native Kotlin free of policy logic.

**Gotchas that will bite:**
- `addDisallowedApplication` throws `NameNotFoundException` for an uninstalled package. Catch
  per-package, skip it, and prune the rule from storage so the list self-heals.
- Rule changes require a **new `establish()`** — the tun cannot be re-scoped in place. The UI must
  either say "applies on reconnect" or auto-reconnect. Recommend auto-reconnect with a toast.
- **Listing installed apps.** `PackageManager.getInstalledApplications` returns only visible
  packages on Android 11+. The full list needs `QUERY_ALL_PACKAGES`, which is a **Play Console
  sensitive-permission declaration** with a review attached. Avoid it: declare a `<queries>` element
  matching `android.intent.action.MAIN` + `CATEGORY_LAUNCHER` instead. That covers every
  user-launchable app, which is exactly what belongs in the picker, and needs no declaration form.
  Cross-reference this into `docs/12-store-submission.md`.
- Excluded apps are outside the tun entirely, so **their DNS goes to the system resolver**
  regardless of `excludedDns`. Unavoidable on Android; state it in the UI copy.

**CIDR.** `Builder.excludeRoute()` exists on API 33+. Below that, install the complement set from
`CompiledSplit.tunnelRoutes` — we already have this arithmetic in
`CumulusMultihopVpnService.routesExcluding()`, which becomes a caller of the shared algorithm (§5).

### 4.2 Desktop — Linux

**CIDR** is trivial: `routing.rs` already programs the split-default pair
(`0.0.0.0/1` + `128.0.0.0/1`). A bypass prefix is a more-specific route via the physical default
gateway; a tunnel prefix is a more-specific route via the tun. Both fall out of the existing
`add_host_route` / `default_gateway` machinery.

**Apps** need policy routing, because Linux has no per-app route API:

1. Create a cgroup v2 (`/sys/fs/cgroup/cumulusvpn/bypass`).
2. nftables marks packets from that cgroup:
   `socket cgroupv2 level 2 "cumulusvpn/bypass" meta mark set 0x2ec`.
3. `ip rule add fwmark 0x2ec lookup 51820` + a table containing only the physical default route.
4. Move the app's PIDs into the cgroup — either by launching it from our UI, or by moving an
   already-running process tree (racy for apps that fork after we scan; document it).

`include` mode inverts: default table is physical, marked cgroup routes into the tun.

All of this needs root and therefore rides the same privileged-helper seam already documented at the
top of `routing.rs` and `killswitch.rs`. No new privilege model.

### 4.3 Desktop — macOS

**CIDR**: same as Linux, via `route(8)` — already the shape of `add_host_route`.

**Apps**: macOS has no supported per-app routing API for non-MDM apps. Two candidate mechanisms:

- **(Recommended for v1) pf + dedicated GID.** macOS `pf` can match on `user` / `group` and act
  with `route-to`. The helper launches an excluded app under a dedicated supplementary group; a pf
  rule in our existing `com.cumulusvpn` anchor does
  `pass out route-to (<physical-if> <gateway>) group cvpnbypass`.
  - Limits, all of which must be surfaced in the UI: the app must be **launched by us** (already-
    running instances keep their old routing until restarted); sandboxed/App-Store-distributed apps
    and Apple system daemons may resist the group change; some apps re-exec helpers that escape the
    group.
- **(Long term) `NETransparentProxyProvider` system extension.** Supports app rules without MDM on
  macOS, and is the direction Apple is pushing. But it moves the split path from the route table
  into a userspace flow proxy — a genuine data-plane redesign, plus a notarized system extension and
  the Network Extension entitlement. Not a v1 move.

Prior art exists (several commercial VPNs ship macOS split tunneling); **spike both mechanisms
against a shortlist of real apps before committing** — this is the estimate most likely to be wrong.

### 4.4 Desktop — Windows

**CIDR**: trivial once the Windows route seam in `routing.rs` is filled in (it is currently a
marked `// POC:` returning `Err`, keyed to the wireguard-nt interface LUID). Split tunneling by IP
should not be shipped on Windows before that seam is real.

**Apps**: this is the single biggest lift in the whole feature.

- The robust mechanism is a **WFP callout driver** doing bind-redirect at `ALE_BIND_REDIRECT` /
  `ALE_CONNECT_REDIRECT`, keyed on `FWPM_CONDITION_ALE_APP_ID`. User-mode WFP filters can *permit or
  block* per app but **cannot reroute**, so a kernel component is unavoidable for a true bypass.
- Shipping a driver means an **EV code-signing certificate plus Microsoft attestation signing**,
  a driver-update channel independent of the app updater, and an ongoing fight with AV heuristics.
  Budget this as its own project with its own release process, not as a feature ticket.
- **Shortcut worth evaluating first:** WinDivert ships a Microsoft-signed driver and exposes packet
  interception/reinjection to user mode, which several products use for exactly this. It trades the
  signing project for a dependency and an AV-false-positive surface. Evaluate before writing a
  driver — the delta is measured in months.

Until one of those lands, Windows gets `cidr` + `domain` rules and the app tab is hidden. Say so in
release notes rather than shipping a disabled control.

### 4.5 iOS — the wall

**Apps: not possible, and not a matter of effort.** Per-app VPN on iOS is expressed through
`NEAppRule`, which the OS honours only for MDM-managed apps under a per-app VPN payload. A
consumer App Store app cannot obtain it. No shipping iOS VPN has per-app split tunneling. The UI
must state this plainly rather than omit the section — users arrive from Android expecting it, and
an honest sentence converts better than a mystery.

**CIDR: already 90% there.** `PacketTunnelProvider.swift:192` already sets
`ipv4.excludedRoutes` for the multi-hop entry pin. User bypass prefixes are the same call with a
longer array; tunnel-only prefixes go in `includedRoutes` instead of `NEIPv4Route.default()`.

**Two iOS-specific constraints to design around:**

1. **`includeAllNetworks` vs excluded routes.** Our iOS kill switch uses `includeAllNetworks`
   (see the `killSwitch` parameter documented in `clients/mobile/src/native/CumulusTunnel.ts`).
   Apple documents that when `includeAllNetworks` is on, excluded routes are disregarded for most
   traffic. **Verify this on the minimum supported iOS version during the spike**; if it holds — and
   it is expected to — then *kill switch and IP exclusions are mutually exclusive on iOS*, and the
   UI must enforce that with an explanatory message rather than letting a user set both and silently
   get one.
2. **Route changes are not cheap.** Updating routes means another `setTunnelNetworkSettings`, which
   briefly disrupts the tun. That rules out per-DNS-answer route churn (§6) on iOS; the domain
   engine there must batch, debounce hard (≥5 s), and prefer a precomputed coarse set.

### 4.6 Web

The web client hands a `.conf` to a stock WireGuard app, so the only lever is `AllowedIPs` — which
is inclusion-only. `buildWgConfig` therefore takes `CompiledSplit.tunnelRoutes` (already
complement-computed by §5) and emits them in place of `0.0.0.0/0, ::/0`. No app or domain rules;
the UI offers a CIDR list and the LAN-bypass checkbox only.

---

## 5. The complement-CIDR algorithm (one algorithm, four implementations)

"Route everything except these prefixes" has to be expressed as an explicit inclusion list on:
Android < 13, a stock WireGuard `.conf`, and anywhere else `supportsExcludeRoute` is false. That is
a small, exact, easy-to-get-subtly-wrong piece of arithmetic — and we already have one copy of it in
Kotlin (`CumulusMultihopVpnService.routesExcluding()`).

**Plan:** promote it to `clients/core-ts/src/split.ts` as the canonical implementation, and treat
the Kotlin/Swift/Rust copies as ports validated against a shared vector file.

```ts
/**
 * Every prefix covering `0.0.0.0/0` (and `::/0`) minus `excluded`, as a minimal
 * set. Deterministic and sorted, so configs are byte-stable across runs.
 */
export function complementRoutes(
  excluded: readonly string[],
  family: 'v4' | 'v6' | 'both',
): readonly string[];
```

- Test vectors live in `clients/core-ts/src/__fixtures__/split-routes.json` and are consumed by the
  TS tests, an Android instrumentation test, a Swift test, and a Rust `#[test]`. **A port that
  disagrees with the vectors is a build failure, not a bug report** — divergence here means a
  silently leaking route on one platform only, which is the worst class of bug this feature can
  produce.
- Existing callers migrate: `routesExcluding()` becomes a thin wrapper so the multi-hop entry pin
  and user rules go through one code path.
- Edge cases the vectors must cover: excluding `0.0.0.0/0`; adjacent prefixes that must merge;
  a `/32` and its containing `/24` both listed; the full RFC1918 set; empty input; v6-only input;
  an excluded prefix that contains the gateway endpoint (must be rejected upstream by §3.3, but the
  algorithm must still behave).

---

## 6. Domain rules — the DNS-learned-route engine

### 6.1 Why this is the only viable mechanism

Routing is by IP; domains are not. The bridge is the DNS answer. We already terminate DNS (the
tunnel's `DNS =` points at the gateway's resolver), so we are structurally in the right place.

### 6.2 Design

A local resolver in front of the tunnel's DNS setting:

```
app ──DNS──► local resolver (127.0.0.1 / tun DNS addr)
                 │
                 ├── name matches an EXCLUDE matcher ──► system resolver (direct)
                 │        └─► install bypass host routes for every A/AAAA in the answer
                 │
                 └── otherwise ──► gateway resolver (in-tunnel)
                          └─► if name matches an INCLUDE matcher, pin tunnel routes
```

- **Placement.** Desktop: in the Rust core beside `tlsbridge.rs`, as `tunnel/dnsproxy.rs`.
  Android: in the VpnService process. iOS: in the extension, with the batching from §4.5.
- **Route lifetime.** Refcount per IP (several names legitimately share one address), expire on
  the answer's TTL with a floor (60 s) and a ceiling (1 h), cap the table (~2 000 entries, LRU),
  and drop everything on disconnect.
- **Also parse HTTPS/SVCB records** for `ipv4hint` / `ipv6hint`. Modern clients connect on the hint
  without ever issuing an A query, so a domain-rule engine that only watches A/AAAA silently misses
  them.
- **Wildcards** match by suffix; `*.example.com` covers subdomains but not the apex, matching user
  expectation from every other tool that uses that syntax.

### 6.3 Holes — state these in the UI, not just here

| Hole | Effect |
|---|---|
| Browser-native DoH/DoT (Chrome, Firefox default-on in some regions) | Our resolver never sees the query. The rule silently does nothing. |
| ECH / encrypted SNI | Kills any future SNI-inspection upgrade path too. |
| CDN address sharing | Excluding one site excludes every neighbour on that IP. Cloudflare/Fastly-hosted rules are close to useless. |
| Hardcoded IPs / IP literals | No DNS query, no rule. |
| Connection reuse | An open QUIC/TCP connection keeps its old path after a rule change until it is torn down. |
| DNS caching in the app or OS | A cached answer bypasses the engine until TTL expiry. |

**Optional mitigation, default off:** block the well-known DoH resolver endpoints while connected so
clients fall back to plaintext DNS through us. It works, and it is exactly what a corporate
middlebox does — so it ships off, behind an explicit toggle, with honest copy.

### 6.4 Consequence for the UI

Domain rules must be labelled **best effort** at the point of entry, with a one-tap explanation.
Presenting them as equivalent to app or CIDR rules would be a security misrepresentation (D5).

### 6.5 DNS for excluded traffic

`SplitPolicy.excludedDns` picks the tradeoff:

- `'tunnel'` (default) — every lookup still goes to the gateway resolver. Excluded traffic bypasses
  the tunnel but its *names* do not leak locally. Note the honest caveat: the gateway then sees a
  query for a destination it never carries.
- `'system'` — excluded lookups go to the local resolver. Matches user expectation for
  split-horizon/corporate DNS, and leaks those names to the local network and ISP.

On Android, apps excluded via `addDisallowedApplication` are outside the tun and always behave as
`'system'`, whatever the setting says. Reflect that in the UI when app rules exist.

---

## 7. Interaction with existing subsystems

### 7.1 Kill switch — the trap

`killswitch.rs` blocks all non-tunnel egress. **Every exclusion must punch a matching hole or split
tunneling silently does nothing while appearing configured** — the single most likely integration
bug in this feature, and one that fails in the "user thinks it works" direction.

Signature change (`engage` currently takes `backend, endpoint, interface, proto`):

```rust
pub struct LeakPolicy<'a> {
    pub endpoint: &'a str,
    pub interface: &'a str,
    pub proto: Proto,
    /// Prefixes allowed to egress on the physical interface (from CompiledSplit).
    pub bypass_cidrs: &'a [String],
    /// Platform app identities allowed to egress directly, where the backend can
    /// express it (pf group, nft cgroup, WFP app id). Empty elsewhere.
    pub bypass_apps: &'a [String],
}

pub fn engage(backend: Backend, policy: &LeakPolicy<'_>) -> Result<(), TunnelError>;
```

Each backend extends its existing scoped ruleset (pf anchor `com.cumulusvpn`, nft table
`inet cumulusvpn`, firewall group `CumulusVPN`) — the self-contained/removable property in the
`killswitch.rs` module docs must be preserved exactly.

On Android the OS lockdown toggle ("Block connections without VPN") is reached via
`openVpnSettings()` and **is not aware of our rules** — Android's own always-on lockdown allows
disallowed apps through by design, so the combination behaves correctly. Verify per OS version.

### 7.2 Multi-hop

Rules apply to the **inner (exit)** device — that is where the default route lives. Constraints:

- The outer device already pins `AllowedIPs = <exitIp>/32` and the host route `<exitIp> → wg-entry`
  (`routing.rs`, `docs/11`). A user bypass prefix that contains `exitIp` or `entryIp` must be
  rejected at rule-creation time (§3.3) — it breaks the tunnel, not just the rule.
- Android multi-hop route arithmetic (`CumulusMultihopVpnService.routesExcluding(entryIp)`) becomes
  `routesExcluding(entryIp ∪ userBypassPrefixes)` through the shared algorithm (§5).
- Kill-switch `bypass_cidrs` must not shadow the entry endpoint allowance.

### 7.3 Transports (`awg`, `wg-tls`)

Mostly orthogonal, with two notes:

- `wg-tls` egresses **TCP**, and the kill switch already parameterizes that via `Proto`. Bypass
  rules must not accidentally re-block the relay address.
- The local UDP↔TLS bridge (`tlsbridge.rs`) only ever carries tun traffic, so excluded apps never
  touch it. No interaction.

### 7.4 Reconnect, failover and gateway churn

Discovery failover re-enrolls at a different gateway with a **different endpoint IP**. On every
reconnect the client must: recompute `CompiledSplit` against the new endpoint, re-validate that no
rule contains it, and re-engage the kill switch with the fresh `LeakPolicy`. The policy is
user state; the compiled output is session state. Never cache the latter across a reconnect.

### 7.5 MTU

Unchanged. Bypassed traffic uses the physical path MTU, which is strictly larger than the tunnel's —
no new PMTU concerns.

### 7.6 Premium gating (D7)

Split tunneling is **premium-only**. Entitlement is the existing one — `GET /v1/status/{pubkey}`
returns `tier`, keyed to the WireGuard public key; no new server surface, consistent with D1.

- **Gate at activation, not at storage.** Rules can be authored and saved on any tier; setting
  `mode` to anything but `off` requires `tier: premium`. A free user sees the full screen with an
  upsell instead of the mode selector — the feature sells itself better visible than hidden.
- **Lapse behaviour.** If `paid_until` expires (checked at connect time and on the periodic status
  refresh), the client sets the *effective* mode to `off` — full tunnel — while leaving the stored
  policy intact. Fail toward *more* protection, never toward a stale bypass. On re-payment the
  stored policy reactivates as-is. Surface it as a non-blocking notice ("Split tunneling paused —
  premium expired"), not a modal.
- **Offline grace.** When `/v1/status` is unreachable, honour the last known entitlement (the
  gateway enforces the real tier server-side anyway; the client gate is UX, not security).
- **Enforcement honesty.** The gate is client-side by necessity — the feature is client-side (D1)
  and the client is open source, so a determined free user can build it out. That is acceptable:
  premium's hard enforcement remains bandwidth at the gateway; this gate is a product boundary,
  not a security one.
- The web client's `.conf` generator applies the same gate before emitting a non-default
  `AllowedIPs` set.

---

## 8. UX specification

**Placement.** Settings → **Advanced** → "Split tunneling". Not on the main connect screen. The
existing settings rows (`clients/mobile/src/screens/SettingsScreen.tsx`,
`clients/desktop/src/components/Settings.tsx`) get one new navigation row, disabled with an
explanatory subtitle on platforms where nothing is supported.

**Screen structure.**

```
Split tunneling                                        [ Off | Exclude | Only these ]

  ⚠ Excluded traffic leaves your device unprotected and shows your real IP address.

  ☐  Allow local network access (printers, NAS, casting)

  ── Apps ─────────────────────────────  [ + Add ]
     (iOS)     Not available on iPhone and iPad — Apple restricts per-app VPN
               routing to devices managed by an organisation.
     (Windows) Coming soon — app rules need a system driver we haven't shipped yet.
     [icon] Google Chrome                                              [ × ]

  ── Domains ──────────────────────────  [ + Add ]
     ⓘ Best effort. Sites behind shared CDNs, and browsers using their own
       secure DNS, may not follow this rule. Not a security boundary.
     netflix.com                                                       [ × ]

  ── IP addresses ─────────────────────  [ + Add ]
     10.0.0.0/8                                                        [ × ]
```

**Rules for the copy and behaviour:**

- The mode selector uses **"Only these"**, never "include" — users read "include" as "also include".
- The amber warning above is permanent in `exclude` mode and permanent-and-stronger in
  `include` mode (where the default is *unprotected*). It is not dismissible.
- When rules are active and the tunnel is up, the connect screen shows a persistent secondary
  indicator ("Split tunneling on · 3 rules"). A user must never be unsure whether they are fully
  protected — this is the difference between a feature and a liability.
- App picker: launchable apps only, searchable, icons, system apps behind a "Show system apps"
  toggle. Sorted by name; recently-used first is a nice-to-have.
- Rule changes while connected: apply immediately where the OS allows, otherwise auto-reconnect with
  a toast ("Reconnecting to apply changes"). Never leave rules staged invisibly.
  - **Shipped as "applies on next connect" instead** (v1 decision): no platform we ship can
    re-scope a live tun in place, and the mobile Settings screen already uses the
    locked-while-connected pattern for Stealth and Node diversity — a third behaviour for split
    rules would be less predictable, not more. The editor says so explicitly ("Rules apply the
    next time you connect"), which satisfies the real requirement — never staged invisibly.
    Auto-reconnect remains a candidate polish once rule edits prove frequent enough to earn it.
- Every unsupported combination (iOS kill switch + IP rules, §4.5) is explained inline at the point
  of conflict, not in a general help page.

---

## 9. Threat model impact

Split tunneling **weakens** the guarantee, by user instruction. Document it honestly:

- **What an observer on the local network / ISP sees:** excluded flows in the clear, with real
  source and destination. Correlating them with tunnel activity may narrow who the tunnel user is.
- **What the destination sees:** the real IP for excluded destinations. That is the point.
- **New fingerprint surface:** the *set* of excluded destinations is itself identifying over time.
- **What does not change:** the gateway still sees only what it saw before; entitlement is still
  keyed to the WireGuard public key; no new data reaches us or the network. We still hold nothing.
- **Rules never leave the device** (D2, §3.4), so this does not create a new collection surface —
  provided the support-bundle and crash-report exclusions are actually implemented and tested.

Add a short paragraph to the public threat-model page when this ships.

---

## 10. Store and policy compliance

- **Google Play.** Use `<queries>` rather than `QUERY_ALL_PACKAGES` (§4.1) to stay out of the
  sensitive-permission review. The existing VpnService declaration must describe split tunneling as
  a user-controlled feature; Play requires that redirecting other apps' traffic is disclosed and
  consented, which our explicit opt-in UI satisfies.
- **Apple.** Do not ship a non-functional Apps section (D4). The explanatory row in §8 is the
  compliant and honest form. No other guideline is engaged — this adds no purchase or data flow.
- Fold both into `docs/12-store-submission.md` when the feature enters review.

---

## 11. Validation

**Folded into `docs/16-validation.md` as Stage G** — that copy is the live runbook (with per-row
automation status); this table remains the design reference. Every row runs on every platform that
claims support for that rule kind.

| # | Scenario | Expected |
|---|---|---|
| V1 | Mode `off` | Config and routes **byte-identical** to pre-feature output. Regression gate. |
| V2 | `exclude` + app rule | Excluded app sees real IP; every other app sees gateway IP. |
| V3 | `include` + app rule | Only listed app sees gateway IP; all others see real IP. |
| V4 | `exclude` + CIDR | `curl` to an address in the prefix egresses physically; everything else tunnels. |
| V5 | LAN bypass on | LAN host reachable; no route to LAN when off. |
| V6 | Kill switch + any bypass rule | Bypassed traffic **works**; all other non-tunnel traffic blocked. Both halves asserted. |
| V7 | Kill switch + tunnel down | Bypassed traffic still works; everything else blocked. |
| V8 | IPv6 | No v6 leak in `exclude` mode; v6 rules honoured where declared. |
| V9 | DNS | `excludedDns: 'tunnel'` → no plaintext DNS on the wire; `'system'` → only excluded names. |
| V10 | Domain rule | Excluded domain resolves and connects directly; route expires after TTL. |
| V11 | Rule change while connected | Applied within one reconnect; no stuck half-state. |
| V12 | Gateway failover with rules active | Rules recompiled against the new endpoint; kill switch re-engaged. §7.4. |
| V13 | Multi-hop + rules | Exit-hop routes correct; entry/exit pins intact. §7.2. |
| V14 | Uninstalled app in rule list | No crash; rule pruned. |
| V15 | Corrupt policy on disk | Falls back to full tunnel (`off`), never to a partial policy. |
| V16 | Complement-route vectors | TS, Kotlin, Swift and Rust all agree with the fixture. §5. |
| V17 | Premium lapse with rules active | Effective mode falls to `off` (full tunnel); stored policy untouched; reactivates on re-payment. §7.6. |

V1, V6, V7, V8 and V15 belong in the **CI leak-test suite** already committed to in
`docs/07-roadmap.md` ("leak-test suite in CI ... before public launch"). They are cheap to automate
and they are exactly the failures that matter.

---

## 12. Build plan

Ordered by value per unit of risk. Each phase is independently shippable.

> **Status:** Phases 0–2 are **code-complete** (core model + vectors; CIDR/LAN enforcement on all
> five clients incl. kill-switch `LeakPolicy`; Android app rules + picker; settings UI, premium
> gate and connected-state indicators). Outstanding before ship: the Stage G on-device runs in
> `docs/16-validation.md`. Phases 3–4 remain deferred per §13.

### Phase 0 — Model and math (3–5 days)
- `clients/core-ts/src/split.ts`: types, `compileSplitPolicy`, `complementRoutes`, normalization.
- `clients/core-ts/src/split.test.ts` + `__fixtures__/split-routes.json`.
- Export from `index.ts`. Storage load/save on mobile, desktop, web.
- **No UI, no enforcement.** Pure, tested, reviewable in isolation.

### Phase 1 — IP/CIDR rules + LAN bypass, everywhere (≈2 weeks)
Ships on all five clients including iOS. Highest value per day of work in the whole document.
- Desktop: `routing.rs` bypass/tunnel prefixes; `killswitch.rs` → `LeakPolicy`; `commands.rs`
  + `src/lib/tauri.ts` carry the compiled split.
- Android: `excludeRoute` on API 33+, complement below; all three services.
- iOS: `excludedRoutes`/`includedRoutes` in `PacketTunnelProvider.swift`; resolve the
  `includeAllNetworks` conflict (§4.5) and enforce it in the UI.
- Web: `buildWgConfig` emits computed `AllowedIPs`.
- Settings UI: mode selector, LAN checkbox, CIDR list, warning banner, connect-screen indicator.
- Validation V1, V4–V8, V15, V16.

### Phase 2 — Android app rules (5–8 days)
The cheapest per-app win and a real differentiator against every iOS-only competitor.
- `<queries>` manifest entry; app picker with icons; all three Kotlin paths; stale-package pruning;
  auto-reconnect on change. Validation V2, V3, V11, V14.

### Phase 3 — Domain rules (2–3 weeks desktop + Android; +1 week iOS)
- `tunnel/dnsproxy.rs` and the mobile equivalents; TTL/refcount route table; HTTPS/SVCB hints;
  `excludedDns` switch; best-effort UI copy. Validation V9, V10.
- Ship desktop + Android first; iOS only once the batching in §4.5 is measured on device.

### Phase 4 — Desktop app rules (per-OS projects)
| OS | Mechanism | Estimate |
|---|---|---|
| Linux | cgroup v2 + fwmark + `ip rule` | 1–2 weeks |
| macOS | pf `route-to` + GID launcher (spike first) | 3–4 weeks |
| Windows | WinDivert **or** WFP callout driver | 6–10 weeks + signing lead time |

Windows should not start until the Windows route seam in `routing.rs` is real, and should begin with
a one-week WinDivert spike before any decision to write a driver.

### Never
iOS per-app rules (D4).

---

## 13. Open questions

1. **Ship domain rules at all in v1?** Given §6.3, an argument exists for app + CIDR only, and for
   telling users plainly why domain rules are not offered. Cheaper and more honest; also less
   competitive on a feature-comparison table.
2. **Does `include` mode ship at the same time as `exclude`?** It is nearly free in the model and on
   Android, but it inverts the safety story (default unprotected) and doubles the UX-copy surface.
3. **Windows: buy, borrow, or build?** Licensing an existing split-tunnel driver may beat 6–10 weeks
   plus an EV certificate and permanent AV maintenance.
4. **macOS mechanism** — pf+GID vs `NETransparentProxyProvider`. Decide after the spike in §4.3;
   this is the largest estimate uncertainty in the document.

Resolved: free-vs-premium (D7, §7.6) — premium-only.

---

## 14. Non-goals

- Per-rule direction (§1). One global mode.
- Rule sync across devices (D2) — would require accounts, which is the one thing we will not build.
- SNI-based routing. ECH is closing that door; do not build on it.
- Per-app *bandwidth* or per-app *gateway selection* ("Chrome via Germany, Steam via Japan"). The
  model in §3 could grow to it, but it multiplies the tunnel count and the support surface.
- Split tunneling as a security boundary. It is a convenience feature that removes protection by
  request; every piece of copy must reflect that.
