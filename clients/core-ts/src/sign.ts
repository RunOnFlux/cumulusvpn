import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';

/**
 * Verify a gateway's signed response over the **exact received body bytes**.
 *
 * Every 2xx control-API body ships with an `X-CVPN-Signature`
 * (`base64(Ed25519_sign(signKey, body))`) and `X-CVPN-Sign-PubKey`
 * (`base64(signKey.public)`). Clients must verify over the raw bytes they
 * received — never over a re-serialized object, whose byte layout may differ.
 *
 * @param bodyBytes - The exact HTTP response body as received.
 * @param signatureB64 - Value of the `X-CVPN-Signature` header.
 * @param signPubKeyB64 - Value of the `X-CVPN-Sign-PubKey` header (or a pinned key).
 * @returns `true` if the signature is valid; `false` on any decode/verify failure.
 */
export function verifySignedResponse(
  bodyBytes: Uint8Array,
  signatureB64: string,
  signPubKeyB64: string,
): boolean {
  try {
    const sig = base64.decode(signatureB64);
    const pub = base64.decode(signPubKeyB64);
    return ed25519.verify(sig, bodyBytes, pub);
  } catch {
    return false;
  }
}
