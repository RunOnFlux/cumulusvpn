# 20 — One identity, many devices at once (design)

**Status: PLANNED — nothing implemented.** Parked on 2026-10-12 by owner decision: ship it
once demand justifies it ("once we have a lot of users"). Until then, multi-device means
_restore the recovery key on the other device_ (shipped on mobile; web + desktop in
progress), which shares Premium but not a connection to the same server — see §1.

## 1. The problem it solves

Today the identity **is** one WireGuard keypair. Its payment code
(`base58(sha256(pub)[0:20])`, `gateway/internal/entitle/entitle.go` `PaymentCode`) is what
on-chain payments name (`CVPN1:<code>`), and `Tier(pubkey)` is decided from that code alone.
Restoring the recovery key on a second device **copies** that key, so:

|                                             | today (copy the key)                                                         | this design (link a new key)     |
| ------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| Premium on every device                     | ✅ same code                                                                 | ✅ same identity code            |
| Two devices on the **same gateway** at once | ❌ one WG peer = one endpoint; they evict each other and share one tunnel IP | ✅ separate keys, separate peers |
| Phone + laptop on "best server" at once     | ❌ usually the same gateway → flapping                                       | ✅                               |
| Lost/stolen device                          | keeps Premium forever (it holds the identity key)                            | stops within the cert lifetime   |
| Sharing                                     | unlimited, one device per server at a time                                   | capped per server (§5)           |

## 2. Model

- **Identity key** = the existing WireGuard X25519 keypair the user already has (the one
  inside the recovery key). Its payment code is the **identity code**; all existing Premium
  and every payment rail (FLUX memo, Stripe, Apple/Google, vouchers) keep targeting it. No
  migration, no change for single-device users.
- **Device key** = a fresh X25519 keypair generated on each additional device. Never leaves
  that device. The first device may keep using the identity key directly (backward compatible).
- **Link certificate** = the identity's signature over a device key, presented to gateways.

Restoring the recovery key on a new device therefore becomes "unlock the identity, mint a
device key, self-issue a cert" instead of "clone the key".

## 3. Certificate

```
payload  = "CVPN-LINK-1" ‖ identity_pub(32) ‖ device_pub(32) ‖ not_after(u64 BE, unix s)
cert     = { v: 1, identity: b64(identity_pub), device: b64(device_pub),
             not_after: <unix s>, sig: b64(XEdDSA(identity_priv, payload)) }
```

- **XEdDSA** (Signal's spec) signs with an X25519 private key and verifies against the X25519
  public key, so existing random WireGuard keys sign as-is — no Ed25519 key to derive, store
  or bind. JS: `@noble/curves` (montgomery→edwards conversion); Go: a small vetted XEdDSA
  verifier. Shared test vectors in both (`core-ts` + `gateway`), same pattern as the pinned
  recovery-key/appAccountToken vectors.
- **Lifetime 30 days.** The app re-signs automatically while it holds the identity secret;
  a device whose cert lapses falls back to free. That is the revocation story for v1.
- Domain-separation tag `CVPN-LINK-1` prevents reuse of the signature anywhere else.

## 4. Gateway changes (release 0.5.0)

- `POST /v1/enroll` and `GET /v1/status/<pubkey>` accept an optional `link` (the cert). Old
  clients send none → behaviour identical to today.
- Verify: tag, `device == the enrolling pubkey`, `now < not_after` (≤ 31 d ahead, small skew),
  XEdDSA signature against `identity`. On success remember `device → identity code`
  (persist with the peer table, which already survives restarts since 0.2.0).
- `Tier(device)` = `Tier(identity)` when a valid link is known, else today's rule.
- **Ordering:** gateways must run 0.5.0 before any client sends links; an old gateway ignores
  the field and shows a linked device as free. Roll out with `deploy/scripts/update-image.mjs`
  (free update), `tlsde` by hand.

## 5. Abuse and limits

- Per gateway, at most **5 concurrently enrolled devices per identity** (configurable env);
  the oldest idle link is evicted. Industry norm is 5–10 devices per account.
- Global sharing across gateways can't be counted without coordination — accepted; sharing a
  recovery key is already possible today (one device per server at a time).
- Certs carry no personal data; the identity code is already public on-chain.

## 6. Client changes

- **core-ts:** cert encode/verify, XEdDSA sign, vectors.
- **Apps (web, desktop, mobile):** store identity and device key separately; "Add this device"
  = paste the recovery key (or scan it as a QR from the phone); attach `link` to
  enroll/status; renew the cert in the background; show "Identity code" where "Device code"
  is today. The identity secret stays in the existing backups (Keychain / Block Store /
  recovery key); the device key never needs backing up.
- **Payments:** unchanged — always pay to the identity code (Upgrade pages already pass the
  code explicitly).
- **Copy:** only after 0.5.0 is fleet-wide, the site/FAQ can say "use it on all your devices
  at the same time"; until then keep "restore it on any device; one device per server at a
  time".

## 7. Effort and order

Gateway 1–2 days → core-ts 1 day → apps 2–3 days → gateway release + fleet roll → app
releases. Roughly a week. No bridge or dashboard changes needed (the admin "Move" support
action keeps working on identity codes).

## 8. Open questions (decide when picking this up)

- Instant revocation (a signed revocation list served by gateways) vs. the 30-day expiry only.
- Whether the first device should migrate to its own device key too (cleaner, but changes
  its payment code display).
- Per-server cap value (5?) and whether Premium tiers ever differ in device count.
