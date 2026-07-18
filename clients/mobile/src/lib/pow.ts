/**
 * Fast proof-of-work solver for enroll.
 *
 * The enroll PoW is ~1M SHA-256 hashes for the 20-bit difficulty. Running that
 * in JS on Hermes takes many seconds AND saturates the single JS thread — which
 * is exactly what made "Connecting…" drag (and multi-hop, which solves twice,
 * time out) and the UI feel janky mid-connect.
 *
 * This delegates to the native module's `solvePow` (Kotlin `MessageDigest` /
 * Swift `CryptoKit`, looping off the JS thread — ~100x faster, sub-second), and
 * falls back to core's JS `solvePoW` when the native method is unavailable
 * (older native build, or a dev machine with no native module linked).
 */
import { solvePoW } from '@cumulusvpn/core';
import { CumulusTunnel } from '../native/CumulusTunnel';

/** Solve the PoW off the JS thread when possible, else in-JS. */
export async function solvePowFast(publicKeyB64: string, bits: number): Promise<string> {
  const native = CumulusTunnel.solvePow;
  if (typeof native === 'function') {
    try {
      return await native.call(CumulusTunnel, publicKeyB64, bits);
    } catch {
      // Native method missing/threw (e.g. the no-native dev proxy) — fall back
      // to the slower pure-JS solver so connect still works.
    }
  }
  return solvePoW(publicKeyB64, bits);
}
