/**
 * Test-only helpers: a fake gateway signing key and a builder for signed
 * `Response` objects, so tests can exercise the discovery/enroll flows against
 * a mocked `fetch` without a real gateway. Excluded from the build.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';

const encoder = new TextEncoder();

/** A throwaway Ed25519 signing keypair for signing fixture responses. */
export interface SignKeypair {
  readonly secretKey: Uint8Array;
  readonly publicKeyB64: string;
}

/** Create a fresh Ed25519 signing keypair. */
export function makeSignKeypair(): SignKeypair {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKeyB64 = base64.encode(ed25519.getPublicKey(secretKey));
  return { secretKey, publicKeyB64 };
}

/**
 * Build a signed success `Response` exactly like the gateway does: a
 * `{status:'success', data}` body plus `X-CVPN-Signature` /
 * `X-CVPN-Sign-PubKey` headers over the exact bytes.
 */
export function signedResponse(data: unknown, signer: SignKeypair): Response {
  const body = JSON.stringify({ status: 'success', data });
  const bytes = encoder.encode(body);
  const sig = base64.encode(ed25519.sign(bytes, signer.secretKey));
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-CVPN-Signature': sig,
      'X-CVPN-Sign-PubKey': signer.publicKeyB64,
    },
  });
}

/** Build an (unsigned) error `Response`, matching the gateway's `writeErr`. */
export function errorResponse(status: number, name: string, message: string): Response {
  const body = JSON.stringify({
    status: 'error',
    data: { code: String(status), name, message },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a plain (unsigned) JSON `Response`, e.g. a Flux location index. */
export function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
