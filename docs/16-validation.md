# 16 — Transport validation runbook

How to prove the DPI-resistant transports (`wg`, `awg`, `wg-tls`) actually work
on a **live** gateway, and how to tell a real pass from a false one.

Everything here has been executed against a running gateway except where marked
**[NOT AUTOMATED]** or **[GAP]**. Those markers are the point: several steps have
no tooling yet, and a runbook that pretended otherwise would be worse than none.

**Order matters.** Stage A costs nothing and catches most breakage before you
spend FLUX on a registration. Do not skip it.

---

## 0. What you are validating

| Transport | Wire | Port | Enabled by |
|---|---|---|---|
| `wg` | UDP, vanilla WireGuard | 51820/udp | always |
| `awg` | UDP, AmneziaWG obfuscation | 51821/udp (free UDP side of the API port) | `CVPN_OBFS_ENABLE=1` |
| `wg-tls` | TCP, WireGuard inside TLS | 51820/tcp standard, **443** on a stealth node | `CVPN_TLS_ENABLE=1` (+ `CVPN_TLS_PORT=443`) |

The 443 tier can additionally be reserved for paying users with
`CVPN_TLS_PREMIUM=1` (see Stage E).

### Two blocking prerequisites

1. **No published image contains this code.** `deploy/countries.yaml` pins
   `ghcr.io/runonflux/cumulusvpn-gateway:0.1.0`, which is vanilla-only. The
   transport work is branch-only until you tag and build (Stage B).
2. **`deploy/scripts/register.sh` implements only 2 of 5 steps.** Verify and
   price are real curls; **sign, broadcast and pay are `echo "TODO"` lines**
   (`register.sh:33-35`). Registration is therefore a **manual** step through
   Zelcore / the RunOnFlux SDK with the owner ZelID from `countries.yaml:10`.
   This is intentional — see `.github/workflows/README.md`, which lists Flux
   registration as manual.

---

## Stage A — Local pre-flight (free, ~5 minutes)

Proves the binary serves all three transports before anything is deployed.

```bash
cd gateway
go build -o /tmp/e2eclient ./cmd/e2eclient
go build -o /tmp/cvpn-gw   ./cmd/gateway

# A gateway with every transport enabled.
CVPN_PRICE_FLUX=20 CVPN_PAYMENT_ADDRESS=t1exampleAddressReplaceMe \
CVPN_KEY_FILE=/tmp/cvpn-test.key \
CVPN_OBFS_ENABLE=1 CVPN_TLS_ENABLE=1 CVPN_TLS_SNI=www.bing.com \
/tmp/cvpn-gw
```

**PASS** — the log must contain all three lines:

```
gateway: WG up on :51820 server_pubkey=<base64>
gateway: obfuscated (AmneziaWG) listener up on :51821/udp
gateway: WG-over-TLS relay up on :51820/tcp (sni="www.bing.com" premium=false)
```

Then, in another shell, run each transport. **Wait ~3 s between runs** — the
gateway rate-limits enrollment to one per source IP per 2 s, and a second run
inside that window fails with `ENROLL HTTP 429`, which looks like a broken
transport but is not.

```bash
/tmp/e2eclient                 # wg      (vanilla)
sleep 3
CVPN_OBFS=1 /tmp/e2eclient     # awg
sleep 3
CVPN_TLS=1  /tmp/e2eclient     # wg-tls
```

**PASS** — each ends with `TUNNEL OK — HTTP 200 via <transport>`. The `wg-tls`
run additionally prints `tls bridge up: relay=… local=…`.

> `CVPN_OBFS` / `CVPN_TLS` are **non-empty** checks: `CVPN_OBFS=0` still enables
> obfuscation. Unset the variable to disable it. They are mutually exclusive.

Also run the in-process suites, which cover what the live path cannot:

```bash
cd gateway && go test ./... -race
```

---

## Stage B — Publish an image containing this code

First bump the version the binary reports, or every 0.3.0 node self-describes as
the previous release. `api.Version` is a **const**, so `-ldflags -X` cannot stamp
it — the Go linker only patches string *variables*, and an `-X` against a const
is silently dropped:

```go
// gateway/internal/api/api.go
const Version = "0.3.0"   // must match the tag you are about to cut
```

Leave `MinClientVersion` alone: nothing enforces it, so bumping it only misleads.

`.github/workflows/gateway-image.yml` then builds and pushes on a tag. Prefer the
**semver-valid** form — `type=semver` only fires for a ref `semver.valid()`
accepts, so `v0.3.0` yields `:0.3.0` *and* the floating `:0.3`, while
`gateway-v0.3.0` matches only the `type=match` rule and yields `:0.3.0` alone.

```bash
git tag v0.3.0 && git push origin v0.3.0
```

Two things to know before pushing the tag. The workflow's `on.push` carries both
`tags:` and `paths:`; path filters are **not** evaluated for tag pushes, so the
tag does fire it — but confirm the run appears in Actions rather than assuming.
And `:latest` moves to whatever commit you tag (metadata-action's auto-latest
fires even though `enable={{is_default_branch}}` is false for a tag ref), so tag
a commit that is on `main` unless you intend `:latest` to point at unmerged code.

The spec pins the **version tag, treated as mutable** (deliberate policy since
2026-08-04 — see the comment block above `repotag:` in `countries.yaml` for the
tradeoff; same release flow the `0.1.0` fleet used):

```yaml
# deploy/countries.yaml
repotag: 'ghcr.io/runonflux/cumulusvpn-gateway:0.2.0'
```

Consequence for THIS stage: shipping a fix to the fleet needs **no spec change**
— move the git tag (delete + recreate `v0.2.0` on the new commit + push) and CI
republishes `:0.2.0`; nodes pick it up when they next pull (soft redeploy /
reinstall / migration — a plain restart may reuse the cached layer), so the
fleet converges gradually. The `Version` string stays `0.2.0` across rebuilds,
so distinguish builds by `/v1/info.build_commit` (git short-SHA). Only a
breaking release (`v0.3.0`) requires editing `repotag` and re-registering.
To see what the tag resolves to right now:

```bash
docker buildx imagetools inspect ghcr.io/runonflux/cumulusvpn-gateway:0.2.0
```

**PASS** — the image exists in GHCR, `:0.2.0` resolves to the build you just
tagged, and `/v1/info.build_commit` on a redeployed node matches the commit.
Note the CI strips a leading `v`, so tag `v0.2.0` → image `:0.2.0`, **not**
`:v0.2.0`.

---

## Stage C — Regenerate and register the DE specs

DE is the stealth pilot (`countries.yaml:49`, `stealth: true`), so it produces
**two** app specs.

```bash
cd deploy
yarn generate --stage beta --check     # --check warns if instances > eligible nodes
yarn validate
```

**PASS** — `specs/onchain/cumulusvpnde.json` and
`specs/onchain/cumulusvpntlsde.json` exist, and:

```bash
# standard: 2 ports, obfs + tls on, NO explicit TLS port, NOT premium
python3 -c "import json;d=json.load(open('specs/onchain/cumulusvpnde.json'));c=d['compose'][0];print(c['ports']);print([e for e in c['environmentParameters'] if 'TLS' in e or 'OBFS' in e])"

# stealth: adds 443 + CVPN_TLS_PORT=443 + CVPN_TLS_PREMIUM=1
python3 -c "import json;d=json.load(open('specs/onchain/cumulusvpntlsde.json'));c=d['compose'][0];print(c['ports']);print([e for e in c['environmentParameters'] if 'TLS' in e])"
```

Expect `[51820, 51821]` / `[51820, 51821, 443]`, and **51822 must never appear**
in any spec — that is the container-internal premium device; publishing it would
let clients bypass the TLS relay entirely. (`deploy/test/generate.test.mjs`
asserts this.)

**[NOT AUTOMATED] Registration.** `bash scripts/register.sh cumulusvpnde` runs
only verify + price:

```bash
bash scripts/register.sh cumulusvpnde       # verify + price quote only
bash scripts/register.sh cumulusvpntlsde
```

**PASS** — the verify call returns success and a price is quoted. **You must
then sign, broadcast and pay manually** with the owner ZelID. Budget for the
443 port: sub-1024 ports are charged extra on Flux (`docs/02`), and enabling
stealth on DE doubles its instance footprint (5 standard + 5 stealth), since
`generate.mjs` gives each group the country's full `instances`.

> **`cumulusvpntlsde` is billed before it is dialable — close the gap right
> after registering.** Desktop and mobile resolve gateways only from their
> **bundled** directory snapshot, and no bundled snapshot lists a
> `cumulusvpntls*` spec, so the 443 nodes are invisible to every installed app
> from the moment you pay for them. Web live-fetches the directory and picks them
> up on a worker redeploy. Nothing else is blocked meanwhile: `awg` and `wg-tls`
> on 51820/tcp are fleet-wide, so Stealth mode works on the standard group — 443
> uniquely buys surviving a 443-only-egress censor.
>
> Follow-up, in order, to make the spend productive:
>
> 1. Rebuild and re-sign the directory so it contains the new spec:
>    ```bash
>    cd deploy
>    node directory/make-directory.mjs build --payment-address <addr> --price 20
>    node directory/make-directory.mjs verify
>    ```
> 2. Copy `deploy/directory/directory.signed.json` over the four bundled
>    snapshots: `clients/desktop/src/data/directory.json`,
>    `clients/mobile/src/data/directory.json`,
>    `clients/web/public/directory.json`, `clients/web/src/directory.bundled.json`.
> 3. Redeploy the web worker (immediate), then cut desktop + mobile builds.
> 4. Teach the fleet dashboard about the group — `clients/dashboard/worker.js`
>    probes only `cumulusvpn<cc>` (see `fleet()`), so stealth instances are
>    missing from monitoring until it also probes `cumulusvpntls<cc>`.
>
> Guard it so the next country can't repeat the gap: assert in
> `deploy/test/make-directory.test.mjs` that every `specs/onchain/cumulus*.json`
> basename appears in the built directory's `specs[]`.

Confirm placement once it settles:

```bash
curl -s https://api.runonflux.io/apps/location/cumulusvpntlsde | jq '.data[].ip'
```

---

## Stage D — Verify the deployed gateway

Substitute a real node IP from the previous step.

### D1. Advertised transports

```bash
curl -s "http://<NODE_IP>:51821/v1/info" | jq '.data.transports'
```

**PASS** — three entries (`wg`, `awg`, `wg-tls`). **FAIL** — one entry or the
field missing means the node is still running the old `:0.1.0` image.

Signature headers `X-CVPN-Signature` / `X-CVPN-Sign-PubKey` are present on every
response. **[GAP]** there is no in-repo tool that verifies them.

### D2. The TLS relay looks like HTTPS

```bash
openssl s_client -connect <NODE_IP>:443 -servername www.bing.com </dev/null 2>&1 | head -20
```

**PASS** — a completed handshake with a self-signed `CN=www.bing.com` and
`Verify return code: 18 (self signed certificate)`. **The verify error is the
expected result** — the cert is camouflage only and clients never check it;
trust is anchored in the inner WireGuard handshake.

Confirm it is the relay and not a web server:

```bash
curl -k --max-time 8 -sv "https://<NODE_IP>:443/" ; echo "exit=$?"
```

**PASS** — TLS completes, then the request **times out** (`exit=28`). The relay
reads length-prefixed WireGuard frames, so `GET` is parsed as a frame header and
never answered. An actual HTTP body here means you are not talking to the relay.

> UDP transports cannot be confirmed by probing. `nmap -sU` reports
> `open|filtered` whether or not a listener exists, because WireGuard never
> answers unauthenticated datagrams. **Do not record that as a pass** — only a
> real handshake (D3) proves a UDP transport.

### D3. Each transport carries real traffic

```bash
CONTROL=http://<NODE_IP>:51821 ENDPOINT=<NODE_IP>:51820 /tmp/e2eclient
sleep 3
CVPN_OBFS=1 CONTROL=http://<NODE_IP>:51821 ENDPOINT=<NODE_IP>:51821 /tmp/e2eclient
sleep 3
CVPN_TLS=1  CONTROL=http://<NODE_IP>:51821 ENDPOINT=<NODE_IP>:443   /tmp/e2eclient
```

**PASS** — `TUNNEL OK — HTTP 200`, **and the printed exit IP is the node's
public IP, not yours**. That last part is the actual proof the exit works; the
tool prints it but cannot check it for you.

> **Always set `ENDPOINT` for a remote node.** `e2eclient` ignores the enroll
> response's endpoint, so omitting it silently dials localhost — enroll succeeds
> and only the tunnel fails, which reads like a data-plane bug.

`ENDPOINT` is per transport: `:51820` vanilla, `:51821` awg, and the TLS port
(`:51820` standard / `:443` stealth) for wg-tls.

### D4. The gateway agrees traffic flowed

```bash
PUB='<pubkey printed by e2eclient>'
curl -s "http://<NODE_IP>:51821/v1/status/$(printf %s "$PUB" | jq -sRr @uri)" | jq .
```

**PASS** — `bytes_used > 0`. The pubkey **must** be percent-encoded (base64
contains `+` and `/`); an unencoded key returns `400 bad_pubkey`.

---

## Stage E — The premium gate (443 tier only)

With `CVPN_TLS_PREMIUM=1` the relay fronts a dedicated WireGuard device whose
peer set holds only entitled keys. The relay bridges opaque frames and cannot
read the key, so the gate is only observable through behaviour:

```bash
curl -s "http://<NODE_IP>:51821/v1/info" \
  | jq -r '.data.transports[] | select(.type=="wg-tls") | "port=\(.port) tier=\(.params.tier // "ungated")"'
```

**PASS** — `port=443 tier=premium`. This proves *advertisement*, not enforcement.

To prove enforcement, run **both** of these with an unpaid key:

```bash
CVPN_TLS=1 CONTROL=http://<NODE_IP>:51821 ENDPOINT=<NODE_IP>:443 /tmp/e2eclient
sleep 3
CONTROL=http://<NODE_IP>:51821 ENDPOINT=<NODE_IP>:51820 /tmp/e2eclient
```

**PASS** — the first **fails** at the tunnel step (enroll returns 200, the TLS
bridge comes up, then the inner handshake never completes and the fetch times
out), while the second **succeeds**. The pair matters: the vanilla run is what
proves the node is healthy and the failure is the gate, not a broken gateway.

Verified locally; the observed failure line is:

```
tls bridge up: relay=…:443 sni=www.bing.com local=127.0.0.1:…
TUNNEL FAILED: … i/o timeout
```

**[GAP]** proving the *upgrade* path — that `syncTiers` adds a key to the gated
device within ~15 s of a payment confirming — needs a real on-chain payment to
the node's `CVPN_PAYMENT_ADDRESS`. There is no harness for it.

---

## Stage F — The client apps

**[NOT AUTOMATED].** There is no supported way to pin a client to one gateway;
discovery resolves the whole fleet from the signed directory. To test a specific
node you must edit the bundled directory and rebuild.

Physical hardware is required: **iOS packet-tunnel extensions do not run on the
Simulator**, and Android's VpnService needs a device for a real tunnel.

Per platform, connect with Stealth on and confirm the chosen transport in logs:

| Platform | Where to read | Look for |
|---|---|---|
| Desktop | tauri stdout | `wg-tls` bridge / awg endpoint port in the connect args |
| iOS | Console.app, subsystem `com.cumulusvpn.tunnel` | `wg-tls bridge up: relay=… local=…` or `single-hop up: server=…` |
| Android | `adb logcat -s CumulusObfs:* WgTlsBridge:* CumulusVpn:*` | `wg-tls bridge up: …` / `wgnest single-hop up: … tls=true` |

**PASS** — the tunnel connects, the log shows the expected transport, and an
IP-check site reports the gateway's address.

The highest-value client check is **Stealth on a UDP-blocked network** (block
outbound UDP at your router/firewall): `wg` and `awg` must fail and `wg-tls`
must still connect. That is the entire reason the TLS tier exists.

---

## Stage G — Split tunneling (docs/17)

**[NOT AUTOMATED — physical hardware, same constraints as Stage F.]** Runs
entirely client-side: no gateway or spec change is involved, so this stage
needs only a working gateway from Stage D and a premium key (split tunneling is
premium-gated at activation; a free key must yield a full-tunnel session with
the "premium required" notice, which is itself row V17's cousin and worth one
manual check).

Every row runs on every platform that claims support for that rule kind
(docs/17 §2 — per-app is Android-only until desktop app rules ship; web is
CIDR + LAN bypass only). "Sees real IP" / "sees gateway IP" checks use any
IP-echo site; "egresses physically" is confirmed with `tcpdump`/Wireshark on
the physical interface (desktop) or the router (mobile).

| # | Scenario | Expected |
|---|---|---|
| V1 | Mode `off` | Config and routes **byte-identical** to pre-feature output. Regression gate — covered by unit tests (core `wgconfig`/`multihop`, Kotlin `SplitRoutesTest`); spot-check one generated `.conf` anyway. |
| V2 | `exclude` + app rule (Android) | Excluded app sees real IP; every other app sees gateway IP. |
| V3 | `include` + app rule (Android) | Only listed app sees gateway IP; all others see real IP. |
| V4 | `exclude` + CIDR | `curl` to an address in the prefix egresses physically; everything else tunnels. |
| V5 | LAN bypass on | LAN host (printer/NAS) reachable; no route to LAN when off. |
| V6 | Kill switch + any bypass rule | Bypassed traffic **works**; all other non-tunnel traffic blocked. Assert BOTH halves. |
| V7 | Kill switch + tunnel down | Bypassed traffic still works; everything else blocked. |
| V8 | IPv6 | No v6 leak in `exclude` mode; v6 rules honoured where declared (Android nested tun swaps the `::/0` blackhole for the compiled v6 list — verify an excluded v6 prefix actually bypasses). |
| V9–V10 | DNS / domain rules | **Deferred with the domain-rule engine** (docs/17 open question 1) — not testable, nothing shipped. |
| V11 | Rule change while connected | Applied on the next reconnect ("applies on next connect" is the shipped behaviour); no stuck half-state. |
| V12 | Gateway failover with rules active | Rules recompiled against the new endpoint; a rule containing the new endpoint is dropped (traffic tunnels); kill switch re-engaged with fresh bypass holes. |
| V13 | Multi-hop + rules | Exit-hop routes correct; entry/exit pins intact (`<exitIp>/32` outer, entry bypass). |
| V14 | Uninstalled app in rule list | No crash on connect (service skips it); rule pruned next time the app picker opens. |
| V15 | Corrupt policy on disk | Falls back to full tunnel (`off`), never a partial policy. Covered by unit tests; corrupt the stored JSON by hand once per storage backend. |
| V16 | Complement-route vectors | TS and Kotlin agree with `clients/core-ts/src/__fixtures__/split-routes.json` — **automated** (`yarn test` in core-ts, `gradlew :app:testDebugUnitTest`). iOS/desktop consume pre-computed lists and have no port to diverge. |
| V17 | Premium lapse with rules active | Effective mode falls to `off` (full tunnel); stored policy untouched; reactivates on re-payment; connect-screen indicator disappears. |

**PASS** — V1, V15, V16 green in CI; V4–V8 clean on desktop + one mobile
platform; V2/V3/V14 clean on Android; V6/V7 asserted in both directions.
V1, V6, V7, V8 and V15 belong in the CI leak-test suite committed to in
`docs/07-roadmap.md` before public launch.

---

## Stage H — Roaming, sleep/wake and network changes

**[NOT AUTOMATED — physical hardware; two networks and a phone hotspot.]**
Nothing here is reachable from CI: every row needs a real interface to actually
go away. Runs client-side against any working gateway from Stage D.

**Why this stage exists.** WireGuard's server half relearns a peer's endpoint
from any authenticated packet, so the *gateway* survives a roam for free. The
client half does not, and every one of its failure modes is silent: the OS keeps
the interface up, no error is raised, and the UI keeps saying "protected" over a
tunnel carrying nothing. A roam bug never announces itself — you have to go
looking, which is what these rows are.

Three things must be repaired for a client to survive a roam, and all three are
easy to miss because any one of them alone looks like a fix:

1. **The socket** — bound to an interface that no longer exists (`Rebind` on
   mobile, `Sidecar::rebind` on desktop).
2. **The endpoint route** — the `<gateway>/32` host route points at the router
   that was default at connect time; on the new network that next hop is
   unreachable and packets are blackholed no matter what the socket is bound to.
3. **The kill switch** — must not be scoped to an interface. Scoped to the
   connect-time NIC it fails *open* on the new one, which is the dangerous
   direction: traffic flows, everything looks healthy, and the protection is
   gone. Rows H6/H7 are the ones that catch this, so do not skip them.

Every row runs on **each platform** (macOS, Windows, Linux, iOS, Android). Run
each one twice: once with the kill switch **on** and once **off**.

| # | Scenario | Expected |
|---|---|---|
| H1 | Wi-Fi A → Wi-Fi B while connected | Tunnel resumes without user action. Handshake age resets; byte counters keep climbing from their old values (a reset to zero means it reconnected instead of roamed — weaker, still a pass for H1, but note it). |
| H2 | Wi-Fi → phone hotspot / USB tether | As H1. This is the row that catches an endpoint route pinned to the old router. |
| H3 | Ethernet dock → undock to Wi-Fi (and back) | As H1. Desktop equivalent of H2; also exercises the interface disappearing entirely rather than changing address. |
| H4 | Sleep/wake, same network | Tunnel resumes. If the address is unchanged nothing detects a "change", so this rides on the handshake watchdog — expect recovery within ~200s worst case, not instantly. |
| H5 | Sleep/wake, different network | As H1, on wake. |
| H6 | **Kill switch on, roam, tunnel still down** | **No traffic egresses on the NEW interface.** Confirm with `tcpdump -ni <new_if>` while forcing traffic — the failure is silent, so absence of packets is the only evidence. A leak here is the interface-scoped-block regression. |
| H7 | Kill switch on, roam, after recovery | Tunnel traffic flows again; plaintext still blocked on the new interface. Assert **both** halves — H6 passing because everything is blocked is not a pass. |
| H8 | Roam with split-tunneling rules active | Bypass prefixes still egress directly on the new interface; everything else tunnels. Composes H2 with Stage G row V6. |
| H9 | Multi-hop roam | Entry tunnel repairs; exit stays up. Only the outer device holds a socket on the physical network, so the inner one must not be touched. |
| H10 | `wg-tls` roam | Reconnects rather than rebinds — a TCP connection to the relay cannot migrate. Expect a visible reconnect, not a seamless resume. |
| H11 | Gateway dies while connected (kill the container) | Watchdog fires within ~200s; client surfaces the drop and auto-reconnects with backoff. Distinguishes "dead tunnel" from "idle tunnel". |
| H12 | Roam with the window closed / app in tray (desktop) | Identical to H1. Repair runs on a native thread, not the webview: in the helper daemon on macOS, on a thread in the app on Linux/Windows (`spawn_repair_loop`). If this fails but H1 passes, the poll has been moved back into the UI. |
| H13 | Quit the app while connected | Kill switch removed, routes cleared, sidecar reaped. Verify with `pfctl -a com.cumulusvpn -sr` (macOS), `nft list table inet cumulusvpn` (Linux), `Get-NetFirewallProfile` (Windows) — all must show no leftovers, and the machine must have working internet. |
| H14 | **macOS:** force-kill the **app** while connected (`kill -9`) | The helper daemon survives and keeps the tunnel up. Relaunch the app: it reattaches to the live session and shows the tunnel still connected, **not** a fresh disconnected state. |
| H14L | **Linux / Windows:** force-kill the app while connected | No daemon exists to survive it: the tunnel lives in the app. Record what is left behind. Kill switch on: the rules stay engaged (fail-closed), so the machine is offline until the app is relaunched and connects or disconnects. The `wireguard-go` sidecar may be orphaned holding `cvpn0`. This is a known gap (see below), not a pass condition; note the behaviour so a fix can be measured against it. |
| H15 | **macOS:** force-kill the **helper** while connected (`sudo kill -9`) | `KeepAlive` restarts it within seconds. The restarted daemon has no tunnel state, so the app must show a drop and auto-reconnect rather than reporting a tunnel that no longer exists. |

**PASS** — H1–H3 and H6/H7 clean on all five platforms; H12 and H13 clean on all
three desktop platforms; H14 and H15 clean on macOS. H6 and H7 belong in the CI leak-test suite alongside
Stage G's V6/V7 as soon as there is a harness that can fake an interface change.

---

## Stage I — The privileged helper (macOS)

**[NOT AUTOMATED — needs a Developer ID signed build.]** On macOS the app holds
no privileges: the `cumulusvpn-helper` LaunchDaemon owns the tunnel, the routing
table and the kill switch, and the app drives it over a Unix socket. That is
what removes the `sudo` requirement — but it also means the socket is a
privilege boundary, and these rows are how you check it holds.

macOS only. On Linux and Windows the app runs the same tunnel crate in-process,
so there is no helper to approve: the app reports `notNeeded`, never shows the
setup banner, and Connect is enabled from launch (row I11).

Requires a real signing identity from the team in `APPLE_TEAM_ID`
(`clients/desktop/src-tauri/helper/src/peer.rs`). An ad-hoc build **cannot**
pass I1 or I4, by design: `SMAppService` refuses to register an unsigned daemon,
and the helper refuses peers that do not satisfy its designated requirement.

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)" \
  bash clients/desktop/scripts/sign-macos.sh
```

| # | Scenario | Expected |
|---|---|---|
| I1 | First launch of a signed build | App shows "Allow the CumulusVPN network helper…"; the helper appears in System Settings → General → Login Items & Extensions. Approving it makes the banner disappear **without a relaunch** and Connect becomes enabled. |
| I2 | Connect / disconnect after approval | Works with **no password prompt at any point**. This is the whole feature: if macOS asks for credentials, something has fallen back to the old path. |
| I3 | App launched from `/Applications` vs. a random folder | Registration succeeds from `/Applications`. Elsewhere it may register but is not supported — check the failure is legible, not silent. |
| I4 | **A different process connects to the socket** | Refused. `nc -U /var/run/cumulusvpn-helper.sock` (or any unsigned binary) must get "not authorised" and be dropped **before** any request is served. This is the privilege boundary — a pass here is the difference between a helper and a local root exploit. |
| I5 | Tampered app binary | Refused, same as I4: modifying the app breaks its signature, so it no longer satisfies the requirement. |
| I6 | Team ID mismatch | Sign the app with an identity from a team other than `APPLE_TEAM_ID` in `helper/src/peer.rs`. `sign-macos.sh` refuses to do this, so run `codesign` by hand. The app must fail to talk to its own daemon. This confirms the requirement is actually enforced rather than incidentally satisfied. |
| I7 | User removes the helper in Settings | App detects it within ~3s and shows the setup banner again; Connect is disabled. |
| I8 | Reboot with the tunnel up | `RunAtLoad` brings the daemon back. It starts with no tunnel (state is not persisted), so the machine must have working internet and no leftover kill-switch rules. |
| I9 | Upgrade over an installed version | The new helper replaces the old one; no duplicate entries in Login Items, no stale socket. |
| I10 | Unsigned / ad-hoc build (what CI ships while Apple signing is off) | The setup banner shows, typically the `notFound` text "macOS could not verify CumulusVPN's network helper — try reinstalling.", and Connect is disabled. Launched as root (`sudo …/Contents/MacOS/cumulusvpn-desktop`), the same build shows no banner and connects through the in-process tunnel. That is the pre-helper behaviour. |
| I11 | Linux and Windows | No banner at any point; Connect is enabled as soon as a location is selected. Connecting unelevated fails with the platform's "needs root" / "run as Administrator" error, not a helper message. |

**PASS** — I1, I2, I4 and I7 are the minimum before anyone outside the team runs
this build. I4 and I6 belong in the security review; I5 is what notarization and
the hardened runtime are protecting.

---

## Known gaps

- **`register.sh` is 2/5 steps** — sign/broadcast/pay are TODO echoes.
- **No signature verification tool** for `X-CVPN-Signature`.
- **`e2eclient` leaks a peer slot per run** (fresh keypair each time, and there
  is no deregister endpoint). Repeatedly validating a production node walks it
  toward `CVPN_MAX_PEERS_FREE=400`. Since 0.2.0 the peer table **persists across
  restarts**, so bouncing the container no longer clears the leak — the hourly
  reaper (`reapIdlePeers`) drops a free peer only after **30 days** with no
  handshake. Check the headroom with `/v1/info` (`capacity`) rather than
  assuming a restart reset it.
- **No throughput/rate-limit harness** — nothing measures the free 100 KB/s cap.
- **No multi-hop validation path** — `e2eclient` talks to one gateway only.
- **Private-IP test targets fail opaquely.** The SSRF guard blocks
  loopback/RFC1918/CGNAT destinations, so a `TEST_URL` on your LAN is dropped and
  looks like a broken tunnel. Deployed specs never set
  `CVPN_ALLOW_PRIVATE_EGRESS`.
- **Verbose WireGuard logs are not reachable** from `e2eclient` (pinned to
  error level), so a failed handshake cannot be distinguished from blocked
  egress without editing source.
- **No harness can fake a network change**, so all of Stage H is manual on real
  hardware with two networks and a hotspot. The rows that matter most for safety
  (H6/H7, kill switch across a roam) are exactly the ones with no automation —
  the pf/nft/WFP rule *text* is unit-tested, but nothing proves the loaded
  ruleset behaves on an interface that appears after it.
- **The privileged helper is macOS-only.** Windows (a service registered by the
  installer) and Linux (polkit, or setcap on the helper) still have no
  unprivileged path. The app runs the shared tunnel crate in-process there and
  must be elevated, as before the helper existed. The helper binary builds on
  those platforms but only prints that it is macOS-only and exits. Peer
  authentication (`peer.rs`) and the daemon entry point are compiled only for
  macOS, so no socket can be served there at all.
- **Linux/Windows: a force-killed app strands the kill switch** (row H14L). With
  no daemon to outlive the app, `kill -9` leaves the firewall rules engaged
  (fail-closed) and can orphan the `wireguard-go` sidecar. A clean quit
  disconnects first, so only a hard kill does this. Same as before the helper.
- **Peer authentication is untested against a real signature.** The code path
  exists (`helper/src/peer.rs`) but every local build so far is ad-hoc signed,
  where the check is skipped in debug and cannot pass in release. Stage I rows
  I4–I6 are the first real exercise of it. A real signed build needs a
  *Developer ID Application* certificate from the `APPLE_TEAM_ID` team
  (`URVD95GYQ7`); confirm one exists before the first signed release. Unit tests
  already check that the requirement string parses (`SecRequirementCreateWithString`)
  and that a refused peer never reaches dispatch (`helper/src/server.rs`).
