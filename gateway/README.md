# gateway — CumulusVPN exit gateway

The Flux app: a **userspace** WireGuard exit gateway + on-chain entitlement
engine + control API, in one static Go binary. It runs as an ordinary Flux
container **without** `NET_ADMIN`, `/dev/net/tun`, sysctls, or privileged mode,
so the whole data plane is userspace: `wireguard-go` bound to a normal UDP
socket, feeding a gVisor **netstack** TCP/IP stack, with a TCP/UDP forwarder
that `net.Dial`s the real destination on the host network (the tun2socks /
Tailscale-tsnet exit pattern).

Design docs: [`../docs/03-gateway.md`](../docs/03-gateway.md) (data plane),
[`../docs/04-payments.md`](../docs/04-payments.md) (entitlements),
[`../docs/01-architecture.md`](../docs/01-architecture.md) (system).

> Status: **proof of concept.** Real, idiomatic structure; not yet pinned to
> exact gVisor/wireguard-go API revisions. Search the tree for `// POC:` for
> every spot that needs hardening before production. See "API-shape
> assumptions" below.

## Layout

```
gateway/
  go.mod
  cmd/gateway/main.go        # wiring: config, WG device, forwarder, scanner, API, shutdown
  internal/
    config/                  # CVPN_* env + FluxOS-injected vars
    fluxnode/                # hostinfo (:16101) + chain client (:16127, explorer fallback)
    wg/
      device.go              # wireguard-go userspace device on netstack
      forward.go             # TCP/UDP exit forwarder (the crux) + egress policy
    limiter/                 # per-peer token buckets (free 100 KB/s / premium)
    entitle/                 # chain scanner, CVPN1 memo parse, paid_until stacking (+tests)
    api/
      api.go                 # /v1/enroll /v1/status /v1/info, signed bodies
      pow.go                 # hashcash-style enroll PoW
  Dockerfile                 # multi-stage, static, reproducible, distroless
```

## Build & test

```bash
# From gateway/
go mod tidy          # resolve the real transitive deps (gvisor, x/net, ...)
go build ./...       # compile everything
go test ./...        # unit tests (memo parse, entitlement stacking/cap math)
go vet ./...
```

Only `internal/entitle` currently ships tests (`entitle_test.go`): memo
parsing, payment-code determinism, and the 30-day stacking + 24-month cap math
against a mock tx source. `go test ./internal/entitle/` runs them in isolation.

## Docker

```bash
docker build \
  --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  -t runonflux/cumulusvpn-gateway:0.1.0 .
```

Multi-stage: static `CGO_ENABLED=0 -trimpath -ldflags "-s -w"` binary on
`gcr.io/distroless/static:nonroot`. Image is ~15–20 MB. Reproducible with a
pinned `SOURCE_DATE_EPOCH` + base digests so the published digest verifiably
matches source (per docs/03-gateway.md).

## Configuration (env)

FluxOS injects `FLUX_*`; the rest come from the app spec env (the single
chain-anchored source of truth all gateways share).

| Var | Required | Default | Purpose |
|---|---|---|---|
| `CVPN_PRICE_FLUX` | yes | — | Monthly price in FLUX (e.g. `20`) |
| `CVPN_PAYMENT_ADDRESS` | yes | — | Transparent FLUX address payments go to |
| `CVPN_DIRECTORY_PUBKEY` | no | — | ed25519 key that signs `directory.json` (republished) |
| `CVPN_FREE_RATE_KBPS` | no | `100` | Free-tier rate limit (KB/s) |
| `CVPN_PREMIUM_RATE_MBPS` | no | `50` | Premium per-peer ceiling (Mbit/s); < node ~100 Mbit/s uplink |
| `CVPN_MAX_PEERS_FREE` | no | `500` | Max enrolled free peers |
| `CVPN_MAX_PEERS_TOTAL` | no | `2000` | Max enrolled peers total |
| `CVPN_EGRESS_ALLOW_PORTS` | no | (all) | Comma list; empty = allow-all minus SMTP |
| `CVPN_KEY_FILE` | no | `/data/server.key` | Server WG key persistence |
| `CVPN_BIND` | no | `:51821` | Override control-API bind addr (dev) |
| `FLUX_NODE_HOST_IP` | injected | — | Host node public IP (endpoint + daemon API) |
| `FLUX_APP_NAME` | injected | — | Flux app name (spec self-watch) |

Fixed ports: WireGuard UDP **51820**, control API TCP **51821**.

## Run the PoC locally (against a mock)

```bash
CVPN_PRICE_FLUX=20 \
CVPN_PAYMENT_ADDRESS=t1exampleAddressReplaceMe \
CVPN_KEY_FILE=/tmp/cvpn.key \
CVPN_BIND=:51821 \
go run ./cmd/gateway
```

With no `FLUX_NODE_HOST_IP`, the chain client uses the public explorer
(`explorer.runonflux.io/api`) and hostinfo is skipped — enough to exercise the
control API. Then:

```bash
# /v1/info (signed body; verify X-CVPN-Signature with X-CVPN-Sign-PubKey)
curl -s localhost:51821/v1/info | jq

# Enroll needs a valid base64 32-byte WG pubkey + a hashcash PoW nonce.
# See internal/api/pow.go solvePoW() for the reference solver a client runs.
```

A full docker-compose sim (gateway + `fluxd`-mock with canned insight
responses + a WireGuard client container) is the integration target — assert
throttling at 100 KB/s and payment → unthrottled within one poll cycle
(docs/03-gateway.md "Testing strategy"). Not included in this PoC.

## M0 throughput gate

The netstack data plane must clear **≥ 150 Mb/s per core** through the tunnel
(iperf3 through WireGuard) in an unprivileged Flux-style container. That number
drives instance sizing and the go/no-go on skipping the SoftEther v0 path
(docs/03-gateway.md, docs/07-roadmap.md). Benchmark early; the per-32-KiB
`WaitN` copy loop in `forward.go` is the first thing to batch if it falls short.

## API-shape assumptions to verify

These are the spots most likely to drift against upstream — a Go engineer
finishing this should confirm each:

- **`Device.Stack()`** (`wg/device.go`): `netstack.Net` does not export the
  underlying `*stack.Stack`. Vendor the one netstack file and add the
  accessor, or upstream a getter. Everything else uses exported wireguard-go.
- **gVisor forwarder wiring** (`wg/forward.go`): `tcp.NewForwarder` /
  `udp.NewForwarder` signatures, `SetTransportProtocolHandler`,
  `SetPromiscuousMode` + `SetSpoofing` per NIC, and `gonet.NewTCPConn` /
  `NewUDPConn` — all track the pinned gvisor pseudo-version wireguard-go uses.
- **NIC id** is assumed `1` (what `CreateNetTUN` uses today).
- **`tcpip.Address.AsSlice()`** → `netip.Addr` conversion for v4/v6.
- **fluxnode endpoint shapes** (`fluxnode/fluxnode.go`): hostinfo field names
  and the node-local vs. insight address-tx routes differ across FluxOS
  versions; explorer paths are the reference.
