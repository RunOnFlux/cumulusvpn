import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64 } from '@scure/base';
import { publicKeyFromPrivate } from './keys.js';
import type { Keypair } from './types.js';

/** Printed in front of every recovery key so it can't be mistaken for anything else. */
export const RECOVERY_KEY_PREFIX = 'CVPN';

const VERSION = 1;
const KEY_BYTES = 32;
const CHECKSUM_BYTES = 4;
/** Characters per dash-separated group in the printed form. */
const GROUP = 5;

/** Why a recovery key was rejected — lets the UI say something useful. */
export type RecoveryKeyError = 'format' | 'checksum' | 'version';

/** Thrown by {@link decodeRecoveryKey}; `reason` says what was wrong with the input. */
export class InvalidRecoveryKeyError extends Error {
  readonly reason: RecoveryKeyError;

  constructor(reason: RecoveryKeyError) {
    super(`invalid recovery key (${reason})`);
    this.name = 'InvalidRecoveryKeyError';
    this.reason = reason;
  }
}

function checksum(payload: Uint8Array): Uint8Array {
  return sha256(payload).subarray(0, CHECKSUM_BYTES);
}

/**
 * Encode a device's private key as a printable recovery key.
 *
 * `CVPN-` + base58btc( version ‖ key ‖ sha256(version ‖ key)[0:4] ), split into
 * dash-separated groups of five. The checksum catches a mistyped or truncated
 * key before it silently restores a DIFFERENT identity (and a different
 * payment code). Whoever holds this string holds the device's premium — it is
 * the WireGuard private key itself, not a pointer to it.
 *
 * @param privateKeyB64 - Base64 32-byte X25519 private key.
 * @returns The recovery key, e.g. `CVPN-2Ukq4-…`.
 * @throws If the key is not base64 of exactly 32 bytes.
 */
export function encodeRecoveryKey(privateKeyB64: string): string {
  const key = base64.decode(privateKeyB64);
  if (key.length !== KEY_BYTES) {
    throw new Error(`encodeRecoveryKey: expected a 32-byte key, got ${key.length}`);
  }
  const payload = new Uint8Array(1 + KEY_BYTES);
  payload[0] = VERSION;
  payload.set(key, 1);
  const body = new Uint8Array(payload.length + CHECKSUM_BYTES);
  body.set(payload);
  body.set(checksum(payload), payload.length);
  const encoded = base58.encode(body);
  const groups: string[] = [];
  for (let i = 0; i < encoded.length; i += GROUP) {
    groups.push(encoded.slice(i, i + GROUP));
  }
  return [RECOVERY_KEY_PREFIX, ...groups].join('-');
}

/**
 * Decode a recovery key back into the device keypair.
 *
 * Forgiving about presentation — surrounding whitespace, line breaks, a
 * missing or lower-case prefix, missing dashes — and strict about content: the
 * version and checksum must match.
 *
 * @param input - The recovery key as the user pasted or typed it.
 * @returns The {@link Keypair} it encodes; the public key is re-derived.
 * @throws {@link InvalidRecoveryKeyError} with the reason it was rejected.
 */
export function decodeRecoveryKey(input: string): Keypair {
  let s = input.replace(/\s+/g, '');
  if (s.slice(0, RECOVERY_KEY_PREFIX.length).toUpperCase() === RECOVERY_KEY_PREFIX) {
    s = s.slice(RECOVERY_KEY_PREFIX.length);
  }
  s = s.replace(/-/g, '');
  let body: Uint8Array;
  try {
    body = base58.decode(s);
  } catch {
    throw new InvalidRecoveryKeyError('format');
  }
  if (body.length !== 1 + KEY_BYTES + CHECKSUM_BYTES) {
    throw new InvalidRecoveryKeyError('format');
  }
  const payload = body.subarray(0, 1 + KEY_BYTES);
  const expected = checksum(payload);
  const given = body.subarray(1 + KEY_BYTES);
  if (!expected.every((b, i) => b === given[i])) {
    throw new InvalidRecoveryKeyError('checksum');
  }
  if (payload[0] !== VERSION) {
    throw new InvalidRecoveryKeyError('version');
  }
  const privateKey = base64.encode(payload.subarray(1));
  return { privateKey, publicKey: publicKeyFromPrivate(privateKey) };
}
