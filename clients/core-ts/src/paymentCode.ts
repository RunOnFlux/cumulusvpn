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
 * Wallet URI schemes we hand a prefilled payment off to, in the order we try
 * them (first one a wallet has registered wins):
 *  - `zel`  — Zelcore (the reference Flux wallet). Uses the **Zelcore `zel:`
 *    protocol** (`zel:?action=pay&coin=flux&…`, see ZelProtocolSpecifications).
 *  - `flux` — generic BIP21 (`flux:<address>?amount=&message=`).
 *  - `ssp`  — SSP Wallet, BIP21 form (best-effort — SSP has no documented pay
 *    URI today; kept so it works if/when SSP registers one).
 */
export const WALLET_SCHEMES = ['zel', 'flux', 'ssp'] as const;
export type WalletScheme = (typeof WALLET_SCHEMES)[number];

/** Zelcore coin identifier for Flux (coin "zelcash", uri `["flux","zelcash","zel"]`). */
const FLUX_COIN = 'flux';

/**
 * Build a wallet deep link that pre-fills the premium payment.
 *
 * The URI shape depends on the scheme:
 *  - `zel`  → Zelcore's protocol: `zel:?action=pay&coin=flux&address=…&amount=…&message=…`.
 *    A `?` right after `zel:` is mandatory and every value is URI-encoded, per
 *    `ZelProtocolSpecifications.md`. This is the form Zelcore registers with the
 *    OS and the one its in-app scanner parses.
 *  - `flux`/`ssp` → BIP21: `<scheme>:<address>?amount=…&message=…`.
 *
 * **The message is always URI-encoded.** The memo is `CVPN1:<code>` and that
 * `:` is load-bearing: wallets (Zelcore included) that split the raw URI on `:`
 * otherwise treat the fragment after the memo colon as the destination address
 * and send to the wrong place. Encoding it to `%3A` — which the wallet
 * `decodeURIComponent`s back to `:` before signing — keeps the on-chain memo
 * exactly `CVPN1:<code>`, so no gateway/consensus change is needed.
 *
 * @param address - FLUX payment address (`t1…`/`t3…`).
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
  const amount = String(priceFlux);
  if (scheme === 'zel') {
    const query = [
      'action=pay',
      `coin=${FLUX_COIN}`,
      `address=${encodeURIComponent(address)}`,
      `amount=${encodeURIComponent(amount)}`,
      `message=${encodeURIComponent(memo)}`,
    ].join('&');
    return `zel:?${query}`;
  }
  return `${scheme}:${address}?amount=${encodeURIComponent(amount)}&message=${encodeURIComponent(memo)}`;
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
