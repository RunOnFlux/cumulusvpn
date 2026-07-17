# 10 — API contract (byte-level source of truth)

Every component — gateway (Go), `core-ts`, web, desktop, mobile — MUST implement exactly this.
When in doubt, this doc wins. Cross-checked against the gateway source in `gateway/`.

## Ports (fixed by the Flux app spec, host-mapped 1:1)

| Port | Proto | Purpose |
|---|---|---|
| 51820 | UDP (+TCP auto) | WireGuard |
| 51821 | TCP | Control API (HTTP, signed bodies) |

## Keys

- **WireGuard keypair**: Curve25519 / X25519. 32-byte private (clamped scalar) and public.
  Encoded as **standard base64** (`base64.StdEncoding`, with `=` padding) everywhere on the wire.
  JS: `@noble/curves/ed25519`→`x25519`; Swift: Curve25519 (CryptoKit) or WireGuardKit; Kotlin:
  the wireguard-android `KeyPair`.
- **Directory / gateway signing key**: Ed25519, 32-byte public, base64.

## Payment code & memo

```
rawPub   = base64Decode(publicKeyB64)          // 32 bytes
code     = base58btc( sha256(rawPub)[0:20] )   // Bitcoin alphabet, ~27 chars
memo     = "CVPN1:" + code
```
- base58 alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`.
- `sha256` is over the **raw 32 pubkey bytes**, not the base64 string. Take the **first 20 bytes**.
- Reference impl: `gateway/internal/entitle/entitle.go` `PaymentCode()` + `base58Encode()`.

## Proof-of-work (enroll anti-flood)

- Difficulty: **20 leading zero bits** of `sha256(utf8(publicKeyB64) || utf8(nonce))`.
- **`nonce` is the DECIMAL STRING of a counter** (`"0"`, `"1"`, …) so it round-trips through JSON
  and every language hashes identical bytes. Client increments from 0 until the hash qualifies.
- Leading-zero-bits check: `full = bits/8` bytes must be `0x00`; if `rem = bits%8` then the next
  byte AND `(0xff << (8-rem))` must be `0`.
- Reference: `gateway/internal/api/pow.go` (`solvePoW`, `hasLeadingZeroBits`).

## Signed responses

Every 2xx control-API body is:
```json
{ "status": "success", "data": <object> }
```
plus headers:
- `X-CVPN-Signature`: base64( Ed25519_sign(gatewaySignKey, exactResponseBodyBytes) )
- `X-CVPN-Sign-PubKey`: base64(gateway Ed25519 public key)

Clients **verify** the signature over the exact received bytes using the `sign_pubkey` learned from
`/v1/info` (ideally pinned via the signed directory). Errors are:
```json
{ "status": "error", "data": { "code": "<http>", "name": "<slug>", "message": "<human>" } }
```

## Endpoints (base `http://<gatewayIP>:51821`)

### POST /v1/enroll
Request:
```json
{ "pubkey": "<wg pub base64, 32 bytes>", "pow_nonce": "<decimal string>" }
```
Response `data`:
```json
{
  "server_pubkey":   "<wg pub base64>",
  "endpoint":        "<nodeIP>:51820",
  "assigned_ip":     "10.8.x.y",
  "dns":             "1.1.1.1",
  "payment_address": "t1...",
  "payment_memo":    "CVPN1:<code>",
  "price_flux":      4.5
}
```
Errors: `bad_pubkey`, `bad_pow`, `rate_limited` (429, 1 enroll/IP/2s), `at_capacity`,
`free_full`. Re-enrolling the same pubkey is idempotent (returns the existing assigned IP).

### GET /v1/status/{pubkey}
`pubkey` is the base64 WG pubkey, URL-path-escaped. Response `data`:
```json
{ "tier": "free" | "premium", "paid_until": "<RFC3339>", "bytes_used": 0 }
```

### GET /v1/info
Response `data`:
```json
{
  "country": "DE", "region": "HE", "city": "Frankfurt",
  "load": 0.12, "capacity": 1988,
  "version": "0.1.0-poc", "min_client_version": "0.1.0",
  "server_pubkey": "<wg pub base64>", "sign_pubkey": "<ed25519 pub base64>"
}
```

## Discovery (no server of ours)

1. For each spec name (`cumulusde`, `cumulusus`, … from the signed directory): `GET
   https://api.runonflux.io/apps/location/<spec>` → `{status, data: [{ip, ...}]}`. For redundancy
   also query 2–3 random Flux nodes directly at `http://<nodeIP>:16127/apps/location/<spec>`.
2. The `ip` field may be `"1.2.3.4"` or `"1.2.3.4:16127"` — strip any port.
3. Probe each candidate `http://<ip>:51821/v1/info`; keep reachable ones. Group by `country`,
   sort by `load` then latency. Cache to disk with a TTL.
4. Cold-start / all-unreachable fallback: the bundled **signed `directory.json`** (last-known
   endpoints). Order: disk cache → live discovery → bundled snapshot. All signature-checked.

## WireGuard client config (what clients produce)

```ini
[Interface]
PrivateKey = <client wg priv base64>
Address = <assigned_ip>/32
DNS = <dns>

[Peer]
PublicKey = <server_pubkey>
Endpoint = <endpoint>
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```
Wallet deep link for payment: `flux:<payment_address>?amount=<price_flux>&message=<memo>`.

## directory.json (served from cumulusvpn.com, bundled in clients)

```json
{
  "version": 1,
  "updated": "<RFC3339>",
  "payment_address": "t1...",
  "price_flux": 4.5,
  "specs": ["cumulusde", "cumulusus", "cumulusnl", "..."],
  "seed_gateways": [ { "ip": "1.2.3.4", "country": "DE", "sign_pubkey": "..." } ],
  "sig": "<base64 ed25519 over the canonical JSON of everything above minus `sig`>"
}
```
Signed by the directory key (`CVPN_DIRECTORY_PUBKEY`); clients ship the pubkey and verify.

## Entitlement rule (server-side, deterministic from chain)

A FLUX tx grants premium iff it pays `≥ price_flux` to `payment_address` **and** carries exactly one
valid `CVPN1:<code>` OP_RETURN memo **and** has ≥1 confirmation. Effect:
`paid_until[code] = max(now, paid_until[code]) + 30d`, stacking, capped at now + 24 months.
Overpayment grants whole multiples (`floor(amount/price)` months). Reference:
`gateway/internal/entitle/entitle.go`.
