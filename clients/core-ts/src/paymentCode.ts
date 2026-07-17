import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64 } from '@scure/base';
import { MEMO_PREFIX } from './types.js';

/**
 * Derive the CumulusVPN payment code for a base64 WireGuard public key.
 *
 * `code = base58btc( sha256(rawPub)[0:20] )` where `rawPub` is the **raw 32
 * decoded key bytes** (not the base64 string). This is the deterministic,
 * server-verifiable identity carried in the payment memo — it must match the
 * gateway's `entitle.PaymentCode()` byte-for-byte.
 *
 * @param publicKeyB64 - Base64 32-byte WireGuard public key.
 * @returns The base58btc payment code (~27 chars).
 * @throws If the key is not base64 of exactly 32 bytes.
 */
export function paymentCode(publicKeyB64: string): string {
  const raw = base64.decode(publicKeyB64);
  if (raw.length !== 32) {
    throw new Error(`paymentCode: expected 32-byte pubkey, got ${raw.length}`);
  }
  return base58.encode(sha256(raw).subarray(0, 20));
}

/**
 * Build the OP_RETURN memo a payment must carry to grant premium:
 * `"CVPN1:" + paymentCode(pubkey)`.
 *
 * @param publicKeyB64 - Base64 32-byte WireGuard public key.
 * @returns The `CVPN1:<code>` memo string.
 */
export function paymentMemo(publicKeyB64: string): string {
  return MEMO_PREFIX + paymentCode(publicKeyB64);
}

/**
 * Build a Flux wallet deep link that pre-fills the premium payment:
 * `flux:<address>?amount=<priceFlux>&message=<memo>`.
 *
 * The memo is embedded verbatim as specified by the API contract.
 *
 * @param address - FLUX payment address (`t1...`).
 * @param priceFlux - Price in FLUX.
 * @param memo - The `CVPN1:<code>` memo from {@link paymentMemo}.
 * @returns A `flux:` URI suitable for a QR code or wallet hand-off.
 */
export function walletDeepLink(address: string, priceFlux: number, memo: string): string {
  return `flux:${address}?amount=${priceFlux}&message=${memo}`;
}
