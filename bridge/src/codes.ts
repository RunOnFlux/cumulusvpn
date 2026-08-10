/**
 * Payment-code handling — the byte-level contract shared with the gateway's
 * `entitle.PaymentCode()` (Go) and `@cumulusvpn/core`'s `paymentCode()` (TS):
 *
 *   code = base58btc( sha256(rawWgPubkey)[0:20] )   // ~27 chars
 *   memo = "CVPN1:" + code
 *
 * The bridge never sees WireGuard pubkeys — clients send the derived code.
 * Everything here validates and transforms codes; it must stay byte-identical
 * to docs/10-api-contract.md.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';

export const MEMO_PREFIX = 'CVPN1:';

/** sha256 domain-separation prefix for the Apple appAccountToken derivation. */
const APP_ACCOUNT_DOMAIN = 'cvpn-appaccount:';

/**
 * Validate a payment code: must base58-decode (Bitcoin alphabet) to exactly
 * 20 bytes — anything else can never match a real key's code and is rejected
 * before it can reach a memo or a store metadata field.
 */
export function isValidPaymentCode(code: string): boolean {
  if (code.length < 20 || code.length > 40) {
    return false;
  }
  try {
    return base58.decode(code).length === 20;
  } catch {
    return false;
  }
}

/** Build the OP_RETURN memo for a validated payment code. */
export function memoForCode(code: string): string {
  if (!isValidPaymentCode(code)) {
    throw new Error('memoForCode: invalid payment code');
  }
  return MEMO_PREFIX + code;
}

/**
 * Deterministic Apple `appAccountToken` for a payment code.
 *
 * Apple requires a UUID, so the raw ~27-char code cannot ride along directly:
 * take `sha256("cvpn-appaccount:" + code)[0:16]`, force the RFC 4122
 * version-4 nibble and variant bits, and format as lowercase 8-4-4-4-12.
 *
 * MUST stay byte-identical to `appAccountToken()` in
 * `clients/core-ts/src/paymentCode.ts` — the client stamps this UUID on the
 * StoreKit purchase and the bridge recomputes it to bind receipt <-> code
 * (and to map renewal notifications back to a code). The hash is one-way, so
 * `apple_token_map` persists uuid -> code at first verify.
 */
export function uuidForCode(code: string): string {
  const digest = sha256(new TextEncoder().encode(APP_ACCOUNT_DOMAIN + code));
  const b = digest.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
