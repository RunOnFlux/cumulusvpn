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

### F-DNS — Desktop DNS leaks

**[NOT AUTOMATED — physical hardware, all three desktop OSes.]** The rule text
and command lines are unit-tested (`tunnel/src/dns.rs`, `tunnel/src/killswitch.rs`),
but nothing in CI changes a real resolver. What each OS does is in
`clients/desktop/README.md` → *DNS*. The gateway hands out `1.1.1.1`, so "the
gateway's resolver" below is Cloudflare, reached from the gateway's country.

Capture the "before" state first, so N7 has something to compare against:

```bash
# macOS
scutil --dns | sed -n '1,12p'
printf 'show ^(State|Setup):/Network/Service/[^/]+/DNS$ pattern\n' | scutil > /tmp/dns-before.txt
# Linux
resolvectl status > /tmp/dns-before.txt 2>/dev/null; cat /etc/resolv.conf >> /tmp/dns-before.txt
```

```powershell
# Windows
Get-DnsClientServerAddress | Format-Table -AutoSize | Out-File $env:TEMP\dns-before.txt
```

Run every row twice — kill switch **on** and **off** — unless it says otherwise.

| # | Scenario | Expected |
|---|---|---|
| N1 | Connected, browse, then run dnsleaktest.com → *Extended test* | Only the gateway's resolver (Cloudflare, gateway country). **No** ISP or router resolver. |
| N2 | Connected: is the system resolver the tunnel's? | **macOS:** `scutil --dns` resolver #1 `nameserver[0] : 1.1.1.1` and nothing else; `printf 'show ^(State\|Setup):/Network/Service/[^/]+/DNS$ pattern\n' \| scutil` shows `CumulusVPNOverride : 1.1.1.1` in every entry. **Linux (resolved):** `resolvectl status cvpn0` → `DNS Servers: 1.1.1.1`, `DNS Domain: ~.`, `Default Route: yes`. **Linux (resolvconf):** `/etc/resolv.conf` has only `nameserver 1.1.1.1`. **Windows:** `Get-DnsClientServerAddress -InterfaceAlias cvpn0` → `1.1.1.1`; `Get-NetIPInterface -InterfaceAlias cvpn0 -AddressFamily IPv4` → metric `1`; `Get-NetFirewallRule -Group CumulusVPN-DNS` → 4 rules. |
| N3 | Connected: watch the physical interface while browsing | `sudo tcpdump -ni en0 'port 53 or port 853'` (Linux: your NIC) prints **nothing**. Windows: `pktmon filter add -p 53` + `pktmon start --etw -c` on the Wi-Fi adapter, or Wireshark `udp.port==53 \|\| tcp.port==53` — nothing. |
| N4 | **Kill switch on:** ask other resolvers directly | `dig +time=2 +tries=1 @<router-ip> example.com`, `dig @8.8.8.8 example.com` and `dig @<router-ip> example.com +tcp` all **time out**; `dig @1.1.1.1 example.com` answers. Windows: `Resolve-DnsName example.com -Server <router-ip> -DnsOnly` fails, `-Server 1.1.1.1` answers. Also with **LAN bypass** on: the router is reachable (`ping <router-ip>`) but `dig @<router-ip>` still times out. |
| N5 | **Kill switch off**, Windows only | `Resolve-DnsName example.com -Server <router-ip> -DnsOnly` **fails** — the `CumulusVPN-DNS` rules stop smart multi-homed resolution regardless of the kill switch. (macOS/Linux with the switch off: an explicit `dig @<router-ip>` works — only the *system* resolver is changed; N1–N3 must still pass.) |
| N6 | Roam: Wi-Fi A → Wi-Fi B / phone hotspot / dock → undock, while connected | Within ~2 s of the new network coming up, N2 holds again (macOS: the repair loop re-takes the new service's DNS — watch `scutil --dns` flip back to `1.1.1.1`), and N1/N3 pass on the new network. Also force a DHCP renewal (macOS `sudo ipconfig set en0 DHCP`) — same result. |
| N7 | Disconnect | The "before" state is back exactly: macOS `scutil --dns` and the `show … pattern` output equal `/tmp/dns-before.txt` (including the user's manual servers in `Setup:`), and `printf 'list State:/Network/CumulusVPN/.*\n' \| scutil` says `no keys`. Linux: `resolvectl status` has no `cvpn0` link / `/etc/resolv.conf` is the original. Windows: `Get-NetFirewallRule -Group CumulusVPN-DNS` returns nothing; physical adapters untouched. Names resolve. |
| N8 | Crash while connected | **Kill the daemon** — macOS `sudo kill -9 $(pgrep cumulusvpn-helper)`, Linux `sudo kill -9 $(pidof cumulusvpn-helper)`, Windows (elevated) `taskkill /F /IM cumulusvpn-helper.exe` → launchd / systemd / the SCM restarts it and it restores DNS on start (N7 holds within seconds, before the app reconnects). **Kill only the app** (`kill -9`, `taskkill /F`) → nothing changes: the daemon keeps DNS tunnelled with the tunnel (H14). **In-process fallback** (Linux/Windows app run elevated without the service): kill the app → the DNS rules / resolvconf record remain (on Windows the `CumulusVPN-DNS` group then blocks every lookup, so record that names fail) → relaunch the app → cleaned up at launch, before connecting (N7 holds). |
| N9 | Multi-hop | N1–N4 pass. DNS is on the exit device: `resolvectl status cvpn-exit` (Linux), `Get-DnsClientServerAddress -InterfaceAlias cvpn-exit` (Windows). |
| N10 | Split tunneling: exclude a prefix that **contains the resolver** (e.g. `1.0.0.0/8`) + LAN bypass; separately, include mode | DNS still tunnelled: `route -n get 1.1.1.1` (macOS) / `ip route get 1.1.1.1` (Linux) / `Find-NetRoute -RemoteIPAddress 1.1.1.1` (Windows) names the tunnel interface; N1 and N3 pass. Bypassed destinations still connect directly. |
| N11 | IPv6 network (dual stack, router advertises a v6 resolver) | N2 lists no IPv6 nameserver; `tcpdump -ni en0 'ip6 and port 53'` silent. Kill switch on: `dig @<router-v6-link-local>%en0 example.com` times out. |
| N12 | Linux with neither systemd-resolved nor resolvconf | Tunnel connects, and the UI shows the DNS warning banner ("DNS could not be pointed at the VPN …") — not a clean "protected". |
| N13 | Rule syntax on the real tools (once, after any rule change) | The strings pinned in `killswitch.rs` tests `the_anchor_text_is_exactly_this` / `the_table_text_is_exactly_this` load: `sudo pfctl -vnf anchor.txt` (macOS, parse only), `sudo nft -c -f table.txt` (Linux, check only). Windows: connect with the kill switch on and `Get-NetFirewallRule -Group CumulusVPN \| Get-NetFirewallAddressFilter` shows the complement ranges. |

**PASS** — N1–N4, N6, N7 clean on all three desktop OSes with the kill switch
on and off; N5 on Windows; N8 (daemon kill) on all three; N13 before the first
build that ships these rules.

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
| V9 | DNS with split rules (desktop) | Tunnel DNS for **everything**, bypassed prefixes included — `excludedDns: 'system'` has nothing to act on until domain/app rules exist, so the private default holds. Covered by Stage F-DNS N10 (resolver pinned through the tunnel in exclude and include mode). Mobile `excludedDns` and domain rules: **deferred with the domain-rule engine** (docs/17 open question 1). |
| V10 | Domain rules | **Deferred with the domain-rule engine** (docs/17 open question 1) — not testable, nothing shipped. |
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
| H12 | Roam with the window closed / app in tray (desktop) | Identical to H1. Repair runs on a native thread, not the webview: in the helper daemon on all three desktop OSes, or on a thread in the app in the elevated in-process fallback (`spawn_repair_loop`). If this fails but H1 passes, the poll has been moved back into the UI. Also roam with the app **killed** (after H14): the daemon still repairs. |
| H13 | Quit the app while connected | Kill switch removed, routes cleared, sidecar reaped. Verify with `pfctl -a com.cumulusvpn -sr` (macOS), `nft list table inet cumulusvpn` (Linux), `Get-NetFirewallProfile` (Windows) — all must show no leftovers, and the machine must have working internet. |
| H14 | Force-kill the **app** while connected — macOS/Linux `kill -9 $(pgrep -x cumulusvpn-desktop)`, Windows `taskkill /F /IM cumulusvpn-desktop.exe` (with the helper daemon: macOS approved helper, Linux .deb/.rpm, Windows installer) | The helper daemon survives and keeps the tunnel up — kill switch, DNS and repair loop included; traffic keeps flowing through `cvpn0`/`utunN`. Relaunch the app: it reattaches to the live session and shows the tunnel still connected (location, counters), **not** a fresh disconnected state, and does not start a second session even with auto-connect on. Disconnect then clears everything (H13). If the tunnel died while the app was gone, the relaunched app shows the drop and auto-reconnects. |
| H14L | **Linux / Windows, elevated in-process fallback** (AppImage run with `sudo`; Windows without its service, run as Administrator): force-kill the app while connected | No daemon outlives the app. Kill switch on: the rules stay engaged (fail-closed) and the machine is offline until the app is relaunched. The relaunched app cleans up **at launch**, before anything connects: no `inet cumulusvpn` table / `CumulusVPN` rule group (Windows `DefaultOutboundAction` back to Allow), DNS restored (N7), the orphaned `wireguard-go` gone (`pgrep -a wireguard-go`, `Get-Process wireguard-go`). Record how long the machine was offline. |
| H15 | **macOS:** force-kill the **helper** while connected (`sudo kill -9`) | `KeepAlive` restarts it within seconds. The restarted daemon has no tunnel state, so the app must show a drop and auto-reconnect rather than reporting a tunnel that no longer exists. The pf anchor stays loaded meanwhile (fail-closed). |
| H15L | **Linux / Windows:** force-kill the **daemon** while connected — `sudo kill -9 $(pidof cumulusvpn-helper)`; elevated `taskkill /F /IM cumulusvpn-helper.exe` | systemd (`Restart=always`, 1 s) / the SCM (failure action: restart after 1 s) restarts it, and the new instance cleans up before serving anyone: no nft table / `CumulusVPN` rule group, DNS restored, no `wireguard-go` left (Linux: systemd killed the cgroup; Windows: reaped by path). The app shows the drop and auto-reconnects, which re-engages the kill switch. **Unlike macOS this fails open** for the seconds between the restart and the reconnect: measure that window with the kill switch on (`ping -i 0.2 1.1.1.1` on the physical interface). |
| H16 | Roam, then check DNS (desktop) | DNS is still tunnelled on the new network — Stage F-DNS row N6. A roam is exactly when macOS republishes the new network's resolver over ours; the repair loop must take it back within ~2 s. |

**PASS** — H1–H3 and H6/H7 clean on all five platforms; H12, H13 and H14 clean on
all three desktop platforms; H15 clean on macOS, H15L and H14L on Linux and
Windows. H6 and H7 belong in the CI leak-test suite alongside
Stage G's V6/V7 as soon as there is a harness that can fake an interface change.

---

## Stage I — The privileged helper (macOS)

**[NOT AUTOMATED — needs a Developer ID signed build.]** On macOS the app holds
no privileges: the `cumulusvpn-helper` LaunchDaemon owns the tunnel, the routing
table and the kill switch, and the app drives it over a Unix socket. That is
what removes the `sudo` requirement — but it also means the socket is a
privilege boundary, and these rows are how you check it holds.

macOS. Linux and Windows have their own daemon and their own stages: J (the
systemd service) and K (the Windows service).

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
| I11 | Linux and Windows | See Stages J and K. The macOS setup states never appear there: their banners are `serviceNotInstalled`, `serviceNotRunning` and `serviceDenied`, plus the non-blocking `elevated` note for the in-process fallback. |

**PASS** — I1, I2, I4 and I7 are the minimum before anyone outside the team runs
this build. I4 and I6 belong in the security review; I5 is what notarization and
the hardened runtime are protecting.

---

## Stage J — The privileged helper (Linux)

**[PARTLY AUTOMATED.]** On Linux the app runs as a normal user: the
`cumulusvpn-helper` systemd service (root) owns the tunnel, the routes, the
nftables kill switch and DNS, and the app drives it over
`/run/cumulusvpn/helper.sock`. The socket is `root:cumulusvpn` mode 0660, so
group membership is the boundary; the daemon also re-checks the peer's
credentials (`SO_PEERCRED`) and that it runs `/usr/bin/cumulusvpn-desktop`.
desktop-release's Linux leg installs the .deb on the runner and checks J1, the
socket in J1, J4 (a)/(b)/(d) and J11 on every build (no tunnel, so no traffic);
everything else needs hardware. Run on Ubuntu 24.04 (.deb) and Fedora (.rpm) at
least, in a desktop session.

| # | Scenario | Expected |
|---|---|---|
| J1 | Install: `sudo apt install ./CumulusVPN_*_amd64.deb` / `sudo dnf install ./CumulusVPN-*.x86_64.rpm` | `systemctl status cumulusvpn-helper` → active (running), enabled. `sudo ls -l /run/cumulusvpn/helper.sock` → `srw-rw---- root cumulusvpn`; `/run/cumulusvpn` is `root:root 755`. `getent group cumulusvpn` lists the installing user, and the install printed the log-out notice. |
| J2 | Launch the app before logging out | Banner "Almost there: log out and back in…" (`serviceDenied`), Connect disabled. Log out and in: the banner is gone and Connect works. |
| J3 | **Unprivileged connect** | The app runs as you (`ps -o user= -C cumulusvpn-desktop`), never asks for a password, and connects with the kill switch on and off: `sudo nft list table inet cumulusvpn` shows the table while connected, `ip link show cvpn0` exists, an IP-check site shows the gateway. Stages F, F-DNS (N1–N4, N7) pass. |
| J4 | **Peer authentication refuses a foreign process** | (a) as a user **not** in the group: `cumulusvpn-helper --ping` → `Permission denied` (the kernel refuses the socket). (b) as a member: `cumulusvpn-helper --ping` (any binary but the app) → `refused: not authorised`; `journalctl -u cumulusvpn-helper` logs `rejected peer: pid … runs /usr/bin/cumulusvpn-helper, not the CumulusVPN app`. (c) as a member, a raw client — `python3 -c 'import socket;s=socket.socket(socket.AF_UNIX);s.connect("/run/cumulusvpn/helper.sock");print(s.recv(64));print(s.recv(64))'` → the refusal frame, then `b''`; nothing it sends is served. (d) `sudo cumulusvpn-helper --ping` → served (root). |
| J5 | Force-kill the app while connected | H14. |
| J6 | Quit from the tray while connected | H13: no nft table, no `cvpn0`, DNS restored — and the service is still running. |
| J7 | Kill the daemon while connected | H15L. |
| J8 | `sudo systemctl stop cumulusvpn-helper` while connected, kill switch on | It disconnects before it exits: machine online, no nft table, no `cvpn0`, no `wireguard-go`, DNS restored. The app shows "background service isn't running" and disables Connect; `sudo systemctl start cumulusvpn-helper` clears the banner within ~3 s. |
| J9 | Reboot while connected | The service is up at boot (enabled). No stale state; the app at login shows disconnected and connects. |
| J10 | Upgrade: install a newer package over the old one while connected | The postinst restarts the service on the new binary (`systemctl status` shows the new start time): the tunnel drops once and the app auto-reconnects. Group membership is kept. |
| J11 | **Uninstall** while connected, kill switch on: `sudo apt remove cumulus-vpn` / `sudo dnf remove cumulus-vpn` | Service stopped and disabled, unit gone, `/run/cumulusvpn` gone; machine online; no nft table, no `cvpn0`, no `wireguard-go`, DNS restored (N7). The `cumulusvpn` group remains (by design). |
| J12 | AppImage | Without the package: banner "background service isn't installed…". `sudo -E ./CumulusVPN_*.AppImage`: no blocking banner, the "Running as root…" note, connects in-process (H14L applies). With the package installed, the AppImage run unprivileged is refused (`serviceDenied`: not the installed app). |
| J13 | Install from a graphical store (GNOME Software / Discover) | Service installed and running, but the user is **not** added to the group (no `SUDO_USER`): banner `serviceDenied`; `sudo usermod -aG cumulusvpn $USER` and a re-login fix it. Record whether this is acceptable for launch. |
| J14 | A second account on the same machine | Not in the group → refused (banner) until added. Once added it can connect — and sees and can disconnect the first account's tunnel: one daemon, one tunnel, as on macOS. |

**PASS** — J1, J3, J4, J5 (= H14), J8 and J11 on both package formats before
anyone outside the team installs a Linux build; J4 belongs in the security
review.

---

## Stage K — The privileged helper (Windows)

**[PARTLY AUTOMATED.]** On Windows the app runs as a normal user: the
`CumulusVPNHelper` service (LocalSystem) owns the tunnel, the routes, the
Windows Firewall kill switch and DNS, and the app drives it over
`\\.\pipe\CumulusVPN.Helper`. The pipe admits SYSTEM, Administrators and
interactive users (no right to create pipe instances); the service serves an
elevated administrator, or a process whose image is `cumulusvpn-desktop.exe`
next to the service in Program Files. The app in turn refuses a pipe not owned
by SYSTEM or Administrators. Both installers are per-machine. ci-ts runs the
pipe server's own tests on a Windows runner, and desktop-release's Windows leg
installs and uninstalls the NSIS and the MSI build on the runner (K1, the
elevated half of K3, K9) on every build; everything else needs hardware with a
**standard (non-administrator) account**.

| # | Scenario | Expected |
|---|---|---|
| K1 | Install the NSIS `CumulusVPN_*_x64-setup.exe`; separately the `.msi` | One UAC prompt. `C:\Program Files\CumulusVPN\` holds `cumulusvpn-desktop.exe`, `cumulusvpn-helper.exe`, `wireguard-go.exe`, `wintun.dll`. `Get-Service CumulusVPNHelper` → Running, Automatic; `sc.exe qc CumulusVPNHelper` → `LocalSystem` and a **quoted** `BINARY_PATH_NAME`; `sc.exe qfailure CumulusVPNHelper` → restart actions. |
| K2 | **Unprivileged connect**: launch from the Start menu as a standard user | No banner, no UAC prompt at any point; connects with the kill switch on and off. `Get-Process cumulusvpn-desktop -IncludeUserName` shows the user. Stages F, F-DNS (N1–N5, N7) pass. |
| K3 | **Peer authentication refuses a foreign process** | From a **non-elevated** prompt: `& "$env:ProgramFiles\CumulusVPN\cumulusvpn-helper.exe" --ping` → `refused: not authorised`. Copy `cumulusvpn-desktop.exe` to `%TEMP%` and run the copy → banner "only works with the installed app" (`serviceDenied`). A raw client — `$p=[IO.Pipes.NamedPipeClientStream]::new('.','CumulusVPN.Helper','InOut'); $p.Connect(2000); $b=New-Object byte[] 64; $p.Read($b,0,64); $p.Read($b,0,64)` → the refusal frame, then 0. From an **elevated** prompt `--ping` → served. |
| K4 | Pipe security | `[IO.Directory]::GetAccessControl('\\.\pipe\CumulusVPN.Helper')` (or Sysinternals `accesschk -l \pipe\CumulusVPN.Helper`): owner SYSTEM; SYSTEM and Administrators full control; INTERACTIVE `0x12008b` only — no `FILE_CREATE_PIPE_INSTANCE`. As a standard user, `[IO.Pipes.NamedPipeServerStream]::new('CumulusVPN.Helper')` → access denied (no impersonating the service). Stop the service and do the same: the app now refuses that user-owned pipe ("cannot trust the network helper"). |
| K5 | Force-kill the app while connected | H14: `Get-NetFirewallProfile` still `DefaultOutboundAction Block`, `CumulusVPN` and `CumulusVPN-DNS` rule groups intact, traffic flows through `cvpn0`; relaunch reattaches. |
| K6 | Quit from the tray while connected | H13: `DefaultOutboundAction` back to Allow, no `CumulusVPN*` rule groups, no `wireguard-go.exe`; the service is still Running. |
| K7 | Kill the service process while connected | H15L: the SCM restarts it within ~1 s; the new instance restores `DefaultOutboundAction Allow` (only because its own `CumulusVPN` group was there), removes both rule groups and stops the orphaned `wireguard-go.exe`. |
| K8 | `Stop-Service CumulusVPNHelper` while connected, kill switch on | It disconnects before it stops: machine online, no rules, no `wireguard-go.exe`. The app shows "background service isn't running"; `Start-Service` clears it. |
| K9 | **Uninstall** while connected, kill switch on (Settings → Apps, for the NSIS and the MSI build) | Service stopped and deleted (`Get-Service CumulusVPNHelper` errors), `cumulusvpn-helper.exe` gone, `DefaultOutboundAction` Allow, no `CumulusVPN*` rule groups, names resolve, machine online. |
| K10 | Upgrade over an installed version (installer, and the updater's `/UPDATE` path) | The service is stopped before files are replaced (no "file in use" error), re-pointed and restarted; the tunnel drops once and the app reconnects. No duplicate service. |
| K11 | Reboot while connected; then a **hard power-off** while connected | The service starts at boot. After the power-off, `DefaultOutboundAction Block` is still in the firewall policy at boot (it is persistent) — the service's startup recovery must lift it before anyone logs in: the machine is online at the login screen. |
| K12 | No service: `Stop-Service CumulusVPNHelper; Set-Service CumulusVPNHelper -StartupType Disabled`, then "Run as administrator" | No blocking banner, the "Running as administrator…" note, connects in-process (H14L applies). Run normally instead: "background service isn't running", Connect disabled. Re-enable the service afterwards. |
| K13 | A second Windows user (fast user switching, or RDP) | Can connect (interactive users are allowed); one shared tunnel, as on macOS. |

**PASS** — K1–K3, K5, K8 and K9 for both installers before anyone outside the
team installs a Windows build; K3, K4 and K11 belong in the security review.

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
- **The Linux and Windows daemons have not run on hardware yet** (Stages J, K).
  What is proven: the request path, the socket server and the Linux peer policy
  in Linux CI; the named-pipe server with its production descriptor on a
  Windows runner; package install / peer refusal / uninstall on the release
  runners. No tunnel has been brought up through either daemon. Known limits,
  by design or for later:
  - **The executable checks are defence in depth, not the boundary.** On Linux
    the boundary is the `cumulusvpn` group (kernel-enforced socket mode), on
    Windows the pipe's descriptor (interactive users). A process of an allowed
    user can always get into that user's own app process (`LD_PRELOAD`,
    `ptrace`, `CreateRemoteThread`), and neither OS has an audit-token
    equivalent that closes pid reuse completely. Every request is shape-checked
    before it touches anything (`tunnel/src/validate.rs`), so what such a user
    can do is connect, disconnect and read status — the same as using the app.
  - **Windows Authenticode is a prepared seam, off.** Builds are unsigned; once
    they are signed, set `REQUIRE_AUTHENTICODE` and implement `signature_policy`
    in `helper/src/peer_windows.rs` (it fails closed if only the flag is set).
  - **Linux needs one re-login after the first install** (group membership
    applies to new sessions), and a graphical installer cannot tell who to add
    to the group (row J13). The app says how to fix both.
  - **A daemon crash fails open for a few seconds** on Linux and Windows (row
    H15L): the restarted daemon lifts the dead session's kill switch rather than
    leaving the machine blocked with nothing to lift it, and the app reconnects.
    macOS keeps its pf anchor until then (H15).
  - **The Windows client has no read timeout**: a synchronous pipe handle cannot
    time out a read, so a wedged service would hang the app's request (the Unix
    clients give up after 45 s). The service answers every request it reads.
  - **Endpoint bypass routes can outlive a daemon crash** (`<gateway>/32` via the
    old router): recovery does not know the old gateway. They are harmless on
    the same network and inert on another, and a reboot clears them.
- **In-process fallback: a force-killed app strands the kill switch** (row
  H14L) until the app is relaunched, whose startup recovery now lifts it. This is
  only the elevated fallback (AppImage with `sudo`; Windows without its
  service); with the helper daemon a killed app leaves the tunnel running (H14).
- **Desktop DNS (Stage F-DNS) is verified only as text.** The scutil scripts,
  resolvectl/resolvconf argv, PowerShell and pf/nft/firewall rules are pinned by
  unit tests; none has run against a real resolver yet, and the new pf anchor and
  nft table lines have not been through `pfctl -n` / `nft -c` (row N13). Known
  limits, by design or for later:
  - **macOS scoped queries** (an app that binds to `en0`, e.g. captive-portal
    probes) still leave on the physical interface — to the tunnel resolver's
    address, but unencrypted on the LAN — unless the kill switch is on.
  - **Windows LLMNR / NetBIOS** (UDP 5355 / 137, single-label names) are not
    DNS and are not blocked by the DNS rules; the kill switch blocks them.
  - **Linux: NetworkManager may put `~.` on the physical link too**, and a LAN
    search domain (`~lan`) routes those names to the router; resolved in
    *uplink* mode (`/etc/resolv.conf` → `/run/systemd/resolve/resolv.conf`)
    lists every link's servers to glibc. The kill switch blocks all three.
  - **Crash recovery:** with the daemon, stale DNS state is cleaned when the
    daemon restarts (within seconds). In the in-process fallback it waits for
    the next app launch (H14L).
- **Peer authentication is untested against a real signature.** The code path
  exists (`helper/src/peer.rs`) but every local build so far is ad-hoc signed,
  where the check is skipped in debug and cannot pass in release. Stage I rows
  I4–I6 are the first real exercise of it. A real signed build needs a
  *Developer ID Application* certificate from the `APPLE_TEAM_ID` team
  (`276MY32G8B`, the US company's team — that certificate now exists; the iOS
  app's `DEVELOPMENT_TEAM` is still the UK team `URVD95GYQ7` until its transfer,
  which does not affect the desktop helper). Unit tests
  already check that the requirement string parses (`SecRequirementCreateWithString`)
  and that a refused peer never reaches dispatch (`helper/src/server.rs`).
