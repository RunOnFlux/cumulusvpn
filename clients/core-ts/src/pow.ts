import { sha256 } from '@noble/hashes/sha2.js';
import { POW_BITS } from './types.js';

const utf8 = new TextEncoder();

/**
 * The proof-of-work digest for a candidate nonce:
 * `sha256(utf8(publicKeyB64) || utf8(nonce))`.
 *
 * The nonce is hashed as its **decimal string** so the bytes are identical in
 * every client language and the value round-trips unchanged through JSON.
 *
 * @param publicKeyB64 - Base64 WireGuard public key (hashed as its UTF-8 bytes).
 * @param nonce - Decimal-string counter, e.g. `"0"`, `"1"`.
 * @returns The 32-byte SHA-256 digest.
 */
export function powHash(publicKeyB64: string, nonce: string): Uint8Array {
  const pub = utf8.encode(publicKeyB64);
  const non = utf8.encode(nonce);
  const buf = new Uint8Array(pub.length + non.length);
  buf.set(pub, 0);
  buf.set(non, pub.length);
  return sha256(buf);
}

/**
 * Report whether `digest` begins with at least `bits` zero bits.
 *
 * Mirrors the gateway's `hasLeadingZeroBits`: the first `bits/8` bytes must be
 * `0x00`, and if `bits % 8` is non-zero the next byte AND `(0xff << (8-rem))`
 * must be `0`.
 *
 * @param digest - Bytes to check (typically a SHA-256 output).
 * @param bits - Required number of leading zero bits.
 * @returns `true` if the digest satisfies the difficulty.
 */
export function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  const full = Math.floor(bits / 8);
  for (let i = 0; i < full; i++) {
    if (digest[i] !== 0) {
      return false;
    }
  }
  const rem = bits % 8;
  if (rem !== 0) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if (((digest[full] as number) & mask) !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Solve the enroll anti-flood proof-of-work: find a counter whose
 * {@link powHash} has at least `bits` leading zero bits.
 *
 * The search starts at a RANDOM offset by default so repeated solves for the
 * same key yield DIFFERENT valid nonces. The gateway single-uses each
 * `(pubkey, nonce)` pair, so a fixed start (always 0) makes re-enrolling the
 * same key fail as a replay ("invalid or missing proof-of-work"). Pass an
 * explicit `startFrom` for a deterministic search (tests).
 *
 * @param publicKeyB64 - Base64 WireGuard public key.
 * @param bits - Difficulty in leading zero bits; defaults to {@link POW_BITS} (20).
 * @param startFrom - Counter to start the search at; defaults to a random offset.
 * @returns The winning nonce as a decimal string.
 */
export async function solvePoW(
  publicKeyB64: string,
  bits: number = POW_BITS,
  startFrom: number = Math.floor(Math.random() * 0x40000000),
): Promise<string> {
  for (let i = startFrom; ; i++) {
    const nonce = i.toString();
    if (hasLeadingZeroBits(powHash(publicKeyB64, nonce), bits)) {
      return nonce;
    }
    // Yield to the event loop periodically. A 20-bit solve is ~1M hashes —
    // seconds on a phone's JS engine (Hermes) — and running it synchronously
    // freezes the UI thread ("stuck connecting", unresponsive controls). This
    // keeps the app responsive during the solve; the total time is unchanged.
    if ((i & 0x3fff) === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * Verify a proof-of-work solution.
 *
 * @param publicKeyB64 - Base64 WireGuard public key.
 * @param nonce - Candidate decimal-string nonce.
 * @param bits - Required difficulty; defaults to {@link POW_BITS} (20).
 * @returns `true` if `nonce` satisfies the difficulty for the key.
 */
export function verifyPoW(publicKeyB64: string, nonce: string, bits: number = POW_BITS): boolean {
  if (nonce === '') {
    return false;
  }
  return hasLeadingZeroBits(powHash(publicKeyB64, nonce), bits);
}
