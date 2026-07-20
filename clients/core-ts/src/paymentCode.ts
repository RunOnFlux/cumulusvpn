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
 * URI schemes that Flux-ecosystem wallets register for BIP21-style payment
 * hand-offs. Ordered by how likely a scanned/tapped link is to open a wallet
 * the user actually has installed:
 *  - `zel`  — Zelcore (the reference Flux wallet).
 *  - `flux` — Flux-branded wallets / generic BIP21 handlers.
 *  - `ssp`  — SSP Wallet.
 * All three carry the identical `<address>?amount=&message=` payload, so a
 * wallet that registers any one of them receives the pre-filled payment.
 */
export const WALLET_SCHEMES = ['zel', 'flux', 'ssp'] as const;
export type WalletScheme = (typeof WALLET_SCHEMES)[number];

/**
 * Build a wallet deep link that pre-fills the premium payment for a given URI
 * scheme: `<scheme>:<address>?amount=<priceFlux>&message=<memo>`.
 *
 * The memo is embedded verbatim as specified by the API contract. Defaults to
 * the `zel:` scheme (Zelcore); pass a different scheme for a fallback link.
 *
 * @param address - FLUX payment address (`t1...`).
 * @param priceFlux - Price in FLUX.
 * @param memo - The `CVPN1:<code>` memo from {@link paymentMemo}.
 * @param scheme - Wallet URI scheme (default `'zel'`).
 * @returns A `<scheme>:` URI suitable for a QR code or wallet hand-off.
 */
export function walletDeepLink(
  address: string,
  priceFlux: number,
  memo: string,
  scheme: WalletScheme = 'zel',
): string {
  return `${scheme}:${address}?amount=${priceFlux}&message=${memo}`;
}

/**
 * All wallet deep links for a payment, one per {@link WALLET_SCHEMES} entry, in
 * preference order. Useful for "try each installed wallet in turn" hand-off.
 */
export function walletDeepLinks(
  address: string,
  priceFlux: number,
  memo: string,
): readonly { scheme: WalletScheme; uri: string }[] {
  return WALLET_SCHEMES.map((scheme) => ({
    scheme,
    uri: walletDeepLink(address, priceFlux, memo, scheme),
  }));
}
