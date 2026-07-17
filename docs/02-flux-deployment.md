# 02 — Running on Flux: constraints, specs, costs

Everything here is verified against FluxOS source (`repos/flux`, ZelBack) and live APIs as of
2026-07. File references point into the `flux` repo.

## Hard constraints that shape the whole design

| Constraint | Source | Consequence |
|---|---|---|
| No `Privileged`, no `CapAdd` (NET_ADMIN), no `Devices` (/dev/net/tun), no `Sysctls` in app containers; `--privileged` is actively stripped | `ZelBack/src/services/dockerService.js` (appDockerCreate, HostConfig ~line 940; strip at ~824) | **Kernel WireGuard / OpenVPN impossible.** Gateway must be userspace (wireguard-go + netstack). |
| Every app port is published **both TCP and UDP** automatically | `dockerService.js` ~734–754 | WireGuard UDP ingress just works; no special config. |
| Banned ports: 16100–16299, 26100–26299, 30000–30099, 8384, 27017, 22, 23, **25**, 3389, 5900/5901, 5800, 161, 512, 513, 3388, 4444, 123, 53 | `ZelBack/config/default.js` (bannedPorts) | Pick e.g. 51820/udp+tcp (WG) and 51821 (control API). Inbound 25 already banned network-wide (good for abuse posture). |
| Enterprise ports (0–1023, 8080, 8081, 8443, 6667) cost extra | `default.js` enterprisePorts | Avoid; use high ports. |
| Max 5 public ports per component, ports/containerPorts/domains arrays must match lengths | `appValidator.js` | We need only 2. |
| Image ≤ 5 GB, must pass repo whitelist (`/apps/whitelistedrepositories`) | `imageManager.js` | Our image is tiny (static Go binary, scratch/alpine ~20 MB). Submit repo for whitelisting early. |
| Spec v8; instances 1–100 (min 1 since block 2,176,519); expire up to ~1 year | `appValidator.js`, `default.js` | Region-scoped specs with many instances; renew via app update. |
| Geolocation: `acEU`, `acEU_CZ`, `acEU_CZ_PRG` allow; `a!c…` forbid; max 10 entries/spec | `appSystem/systemIntegration.js` ~159–193 | One app spec per region/country group. |
| Container gets `FLUX_NODE_HOST_IP` + `FLUX_APP_NAME` env, and `http://fluxnode.service:16101/hostinfo` → `{ip, geo, id, benchmark}` | `dockerService.js` ~1043; `fluxNodeService.js` | Gateway learns its own public IP + country without any external lookup. |
| Full FluxOS API on node port 16127 (daemon RPC proxy, `/apps/location/...`, insight-style address index) | `routes.js` | Chain scanning + discovery with zero infrastructure of ours. |
| `RestartPolicy: 'no'` — FluxOS manages lifecycle; instances migrate between nodes over time | `dockerService.js` | Gateway must be stateless-restart-safe: peers re-enroll automatically (clients handle endpoint changes; see 05). |
| containerData supports `s:` (Syncthing-replicated) volumes | validator/docs | We do NOT want replicated state; use plain volume or none. Entitlements rebuild from chain on boot. |

## The app spec (v8) — public image on GHCR; enterprise/datacenter optional

**Image (decided):** the gateway is a **public image on GHCR**,
`ghcr.io/runonflux/cumulusvpn-gateway`, auto-built by CI (`.github/workflows/gateway-image.yml`):
`:latest` + `:sha-…` on every push to main, `:X.Y.Z` on tags. No private registry, no `repoauth` —
Flux pulls the public image directly. This fits the open/decentralized stance ("anyone can verify,
anyone can deploy") and removes the `registry.cumulusvpn.com` dependency.

**Enterprise + datacenter (now OPTIONAL — a legal choice, not an image-hiding one).** With a public
image, the only remaining reason to use `enterprise` + `datacenter: true` is **placement on KYC'd
datacenter nodes instead of homes**, for the abuse/legal posture (docs/06). That is now decoupled
from the image:
- **Open variant** (simplest, cheapest, most nodes, matches the openness stance): a plain v8 spec
  with `staticip: true`, public GHCR image, no `enterprise`, no encryption. Anyone can read the
  spec; anyone could run their own gateway. Accepts residential nodes (weaker legal posture).
- **Datacenter variant** (stronger legal posture): still `enterprise` + `datacenter: true` for
  node placement, but the encrypted blob now just wraps a **public** image + env (nothing secret to
  hide) — so encryption buys only placement, at the +0.8 scope surcharge.

Decision pending in docs/08 #1a. The example below shows the datacenter variant; the open variant
drops `datacenter`/`enterprise` and inlines the public `compose`.

On-chain wrapper `deploy/specs/onchain/cumulusvpnde.json`:

On-chain wrapper `deploy/specs/onchain/cumulusvpnde.json` (top-level fields are public; components
are encrypted):

```jsonc
{
  "version": 8,
  "name": "cumulusvpnde",                  // ≤63 chars; "cumulus" prefix fine (only flux/zel reserved)
  "description": "CumulusVPN — decentralized VPN gateway",
  "owner": "<our enterprise ZelID>",    // must be on the Flux enterprise-owner whitelist
  "instances": 5,
  "geolocation": ["acEU_DE"],
  "expire": 264000,                      // block-denominated; recompute vs 30s blocks (see note)
  "staticip": true,                      // stable WG endpoints  (+0.4 FLUX/mo)
  "datacenter": true,                    // enterprise-only v8 flag → datacenter nodes only
  "enterprise": "<AES+per-node-RSA ciphertext of {contacts, components}>",   // +0.8 scope surcharge
  "compose": [{                          // shape only; real image/env live encrypted above
    "name": "gateway", "description": "gateway",
    "repotag": "ghcr.io/runonflux/cumulusvpn-gateway:v0.1.0",
    "ports": [51820, 51821], "containerPorts": [51820, 51821], "domains": ["", ""],
    "environmentParameters": [], "commands": [],
    "containerData": "/data", "cpu": 1.0, "ram": 1000, "hdd": 5
  }]
}
```

The encrypted inner spec (`deploy/specs/plain/cumulusvpnde.json`, gitignored) carries the private
`repotag`, `repoauth`, and the `CVPN_*` env (`CVPN_PRICE_FLUX`, `CVPN_PAYMENT_ADDRESS`,
`CVPN_DIRECTORY_PUBKEY`, `CVPN_FREE_RATE_KBPS`, peer caps).

Notes:
- **Enterprise coverage caution:** datacenter/enterprise nodes are a subset of the fleet and vary
  by country — `generate.mjs --check` warns when a country's `instances` exceeds eligible nodes.
  Countries with too few enterprise nodes get dropped or relaxed to staticip-only (decide in 08).
- **`expire` units:** block-denominated. Pre-PON figures (22,000 blocks ≈ 1 month) assumed 2-min
  blocks; post-PON (block 2,020,000, Oct 2025) blocks are 30 s and `postPonMaxBlocksAllowance`
  is 1,056,000. Recompute month/year durations against current block time before registering.
- **Static IP** matters: WireGuard clients pin `endpoint = ip:51820`; instance migration to a new
  node breaks the session until the client re-resolves from discovery. `staticip: true` restricts
  scheduling to static-IP nodes and reduces churn. Clients still must handle migration (05).
- **Image not digest-pinned in public spec** now (it's encrypted); pin the digest inside the
  encrypted component and verify via the open-source reproducible build instead.
- **Image pinning by digest** in the public spec = verifiable deployments.

## Spec fan-out: many country-scoped specs

Strategy (decided): **one app spec per country** (`acEU_DE`, `acEU_NL`, `acNA_US`, …) rather than
few big regional specs. Benefits: guaranteed presence per country, clean capacity steering
(bump `instances` only where demand is), hundreds of distinct exit IPs, and the client's country
list maps 1:1 to specs. Specs are generated from a manifest (`deploy/countries.yaml`) by script —
we never hand-edit hundreds of JSONs. Naming: `cumulus<cc>` (e.g. `cumulusvpnde`, `cumulusvpnus`).

### Scale-out ladder (fleet grows with demand — adding instances is just a paid spec update;
clients discover new instances automatically, no release needed)

| Stage | Countries | Instances | Infra cost (~$3.5/inst/mo, enterprise) | Supports (subs, ~50 active/inst) |
|---|---|---|---|---|
| Beta | 12 core (US, CA, DE, NL, FR, GB, CZ, PL, SG, JP, AU, BR) | ~50 (3–6/country) | ~$175/mo | ~2–5k |
| GA | 30 | ~200 | ~$700/mo | ~10–20k |
| Scale | 60+ | ~1000 | ~$3,500/mo | ~50k+ |

Rules of thumb: min 3 instances per offered country (redundancy for failover), scale a country
when p95 gateway load (`/v1/info`) exceeds ~60%, retire countries with zero traffic after 90 days.
Watch per-country node availability: some countries have few Flux nodes — the spec's instance
count silently under-fills if fewer eligible nodes exist (`/daemon/viewdeterministicfluxnodelist`
tells us node counts per country up front; the manifest generator checks this).

### Capacity is bandwidth-bound, not CPU-bound

A Flux node's uplink is ~100 Mbit/s (shared with the node's other apps), and userspace WireGuard
saturates that easily — so a gateway's ceiling is **bandwidth**, not netstack throughput. With the
per-peer **premium cap of 50 Mbit/s** and typical bursty consumer usage (~1–3 Mbit/s average per
active user), ~100 Mbit/s supports roughly **30–60 concurrently-active users per gateway** before
the shared link is the constraint — the "~50 active/inst" figure in the ladder above. Enrolled
(not-simultaneously-active) users are many multiples of that. Two levers when a country saturates:
add instances (each brings its own node + uplink), and the free-pool cap (≤30% of the link) keeps
free traffic from eating premium headroom.

## Cost model

Flux pricing (current epoch, `default.js`; USD via FluxCloud): CPU $1.50/core/mo, RAM $0.50/GB/mo,
HDD $0.02/GB/mo; FLUX payments get 5% off. Per gateway at 1 core / 1 GB / 5 GB:

```
compute:   $1.50 (cpu) + $0.50 (ram) + $0.10 (hdd)        ≈ $2.10/instance/mo
surcharges (per spec-month, amortized over instances):
           enterprise scope $4  + static-ip $2            ≈ $6/spec ÷ ~4 inst ≈ $1.5/instance/mo
→ enterprise+datacenter ≈ ~$3.5/instance/month
```

The enterprise + datacenter posture costs ~1.6× a plain spec (the +0.8 scope and +0.4 staticip
surcharges) — a deliberate trade for datacenter placement, private image, and the legal upside.
~50 instances ≈ **~$175/month** at beta; ~1000 ≈ ~$3.5k/mo at scale. Break-even ≈ ~180 subscribers
at $0.99. (dVPN market clearing price is $1.50–4/mo — $0.99 still undercuts everyone.)

## Registration & operations flow

1. Build + push image, get repo whitelisted (`/apps/whitelistedrepositories`).
2. `POST /apps/verifyappregistrationspecifications` → `POST /apps/calculateprice` → sign spec with
   owner ZelID → `POST /apps/appregister` → pay quoted FLUX to the apps address with the returned
   64-char hash in OP_RETURN (Zelcore "message" field or raw tx). Scripted in `deploy/scripts/`.
3. Renewals = paid app updates before `expire`. Automate with a cron + alerting (the one
   "ops" task that genuinely matters — if specs lapse, the network shrinks).
4. Price-constant updates (`CVPN_PRICE_FLUX`) = app update; gateways watch their own spec via
   `/apps/appspecifications/<name>` and hot-reload env-derived config.

## Chain access from inside the gateway

- Preferred: the host node's own API — `http://$FLUX_NODE_HOST_IP:16127/daemon/<rpc>` for
  `getblockcount`, `getrawtransaction`, address deltas, etc. Zero external dependency and spreads
  load across the network naturally.
- Fallbacks (tried in order): a shortlist of other Flux nodes from
  `/daemon/viewdeterministicfluxnodelist`, then `explorer.runonflux.io/api/txs?address=…`
  (insight API returns OP_RETURN asm — verified live).
- The gateway needs ~last 35 days of txs for the payment address at boot to rebuild entitlements,
  then tails new blocks (30 s cadence).
