import { x25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import type { Keypair } from './types.js';

/**
 * Apply the standard Curve25519 scalar clamping WireGuard uses so the stored
 * private key deterministically maps to its public key:
 * clear the 3 low bits of byte 0, clear the high bit and set bit 6 of byte 31.
 */
function clamp(secret: Uint8Array): Uint8Array {
  const k = secret.slice();
  k[0] = (k[0] as number) & 248;
  k[31] = (k[31] as number) & 127;
  k[31] = (k[31] as number) | 64;
  return k;
}

/**
 * Generate a fresh WireGuard-compatible X25519 keypair.
 *
 * The private key is a clamped 32-byte scalar and the public key is derived
 * from it, so the pair round-trips identically through the wire encoding and
 * matches keys produced by `wg genkey | wg pubkey`. Both are standard base64
 * (`base64.StdEncoding`, `=`-padded) as required by the API contract.
 *
 * @returns A {@link Keypair} of base64-encoded public and private keys.
 */
export function generateKeypair(): Keypair {
  const secret = clamp(x25519.utils.randomSecretKey());
  const publicKey = x25519.getPublicKey(secret);
  return {
    privateKey: base64.encode(secret),
    publicKey: base64.encode(publicKey),
  };
}

/**
 * Derive the base64 X25519 public key for a base64-encoded private key.
 * The private key is clamped before derivation for WireGuard compatibility.
 *
 * @param privateKeyB64 - Base64 32-byte X25519 private key.
 * @returns The base64-encoded public key.
 */
export function publicKeyFromPrivate(privateKeyB64: string): string {
  const secret = clamp(base64.decode(privateKeyB64));
  return base64.encode(x25519.getPublicKey(secret));
}
