# 04 — Payments & entitlements (no accounts, no cards)

## Principle

A payment is a **fact on the Flux blockchain**, not a row in our database. Every gateway derives
the same entitlement state by scanning the chain. There is no activation server, no webhook, no
account. This copies the battle-tested mechanism FluxOS itself uses for app registration payments
(fixed address + 64-char hash in OP_RETURN, scanned by `explorerService.js`).

## The protocol

### Identity
- The client's WireGuard public key `K` (32 bytes) is the identity.
- The memo carries `H = base58(SHA256(K)[0:20])` (~27 chars) — the **payment code** — rather than
  the raw key, so the chain does not directly publish which WG pubkey was bought (weak but free
  privacy; anyone who already knows `K` can link it — see Privacy below).

### Memo format (OP_RETURN, ≤80 bytes standard relay)
```
CVPN1:<payment-code>
e.g. CVPN1:3QJmnh8vzBqoQpuTGDsUCkbFyxVQ
```
- `CVPN1` = protocol tag + version. Anything else in OP_RETURN is ignored by scanners.
- Client apps and the web onboarding page compute and display this string + a QR code.
  The wallet URI **must percent-encode the memo** — Zelcore's `zel:` parser (and the
  BIP21 `flux:` parser) split the raw URI on `:`, so an unencoded `CVPN1:<code>` colon
  makes them treat the fragment after it as the destination address. Two forms (see
  `@cumulusvpn/core` `walletDeepLink`): tap/deep-link uses Zelcore's protocol
  `zel:?action=pay&coin=flux&address=…&amount=20&message=CVPN1%3A<code>`; the QR uses
  BIP21 `flux:t1PayAddress?amount=20&message=CVPN1%3A<code>`. The wallet
  `decodeURIComponent`s the memo back to `CVPN1:<code>` before signing, so the on-chain
  OP_RETURN is exactly `CVPN1:<code>`.

### Payment rule (evaluated identically by every gateway)
A tx grants entitlement iff:
1. it pays `≥ CVPN_PRICE_FLUX` (from app spec env — single source of truth all gateways share)
   to `CVPN_PAYMENT_ADDRESS`, and
2. it carries exactly one valid `CVPN1:` memo, and
3. it has ≥ 1 confirmation (30 s blocks; optional optimistic 0-conf unlock while pending).

Effect: `paid_until[H] = max(now, paid_until[H]) + 30 days`. Payments stack (prepay up to 24
months). Overpayment: multiples of the price grant multiple months (pay 3× → 90 days) — nice UX
for wallets with min-amount quirks, and forgiving of price-drift timing.

### Price in FLUX vs $0.99
FLUX/USD moves; gateways must agree on one number without an oracle. Solution: the canonical price
lives in the app spec env (`CVPN_PRICE_FLUX`), which every gateway reads from its own spec — one
value, chain-anchored, owner-updated. Operational rule: retarget to ≈$0.99 when drift exceeds
±25%. Grace rule so nobody pays the "old" price into a void: gateways accept the previous price
constant for 72 h after a spec update (both values visible in spec history).
Clients display: "Send **20 FLUX** (~$0.99) with this exact message."

### Wallet UX
- Zelcore, SSP Wallet and the explorer all support OP_RETURN messages on sends ("message" field).
- Apps: "Upgrade" screen → shows amount + address + memo + QR + wallet deep links. In-store builds
  this is framed as a **wallet transfer** ("send FLUX with this message"), and per store policy the
  flow lives on the website with the app deep-linking out (see 05).
- Failure modes handled: wrong/no memo → funds arrive but no entitlement: publish a signed
  refund/claim procedure (prove key ownership by signing a challenge with the WG private key +
  prove payment tx; manual at first, tooling later). Underpayment → ignored, same claim path.

## Privacy analysis (be honest in docs & marketing)

- On-chain observers see: payment address received X FLUX with code `H` at time T. If they later
  obtain `K` (e.g., they run a rogue gateway you enrolled with), they can link your FLUX source
  address to your VPN key. Mitigations, in order of effort:
  1. **v1 (ship):** hash-code memo (done above); advise paying from a fresh address; amounts are
     uniform so amount-fingerprinting is moot.
  2. **v1.5:** per-key *payment keys* — client derives a separate keypair for payment identity;
     gateway accepts `H = hash(payment_pubkey)` where enrollment presents a signature binding
     payment key → WG key. Chain then never contains anything derivable from the tunnel key.
  3. **v2 (Mullvad-style unlinkability):** blind-signature vouchers — user pays with memo of a
     *blinded* token, a quorum of gateways (or a signing service run from the app spec itself)
     signs it, user unblinds and redeems the voucher at any gateway. Removes even the
     pay-tx ↔ key link. Design doc when we get there.
- Multi-chain FLUX (parallel assets on ETH/BSC/SOL/…) has no OP_RETURN — v1 is native-chain only.
  If demand appears: per-chain memo mechanisms or a swap widget, later.

## Free tier

No payment, no enrollment beyond `POST /v1/enroll`. 100 KB/s per key, light PoW at enroll,
aggregate free-pool bandwidth cap per gateway. Free tier is the growth engine and the goodwill
engine — it must genuinely work (browsing, messaging), just not be pleasant for video/torrents.

## Treasury

Payments accumulate at `CVPN_PAYMENT_ADDRESS` (recommend 2-of-3 multisig from day one). Revenue
funds the app-spec renewals — the system pays for its own infrastructure; document this publicly,
it's a great story ("your $0.99 literally buys the network's compute").
