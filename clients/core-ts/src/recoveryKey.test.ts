import { describe, expect, it } from 'vitest';
import { generateKeypair } from './keys.js';
import { paymentCode } from './paymentCode.js';
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  InvalidRecoveryKeyError,
  RECOVERY_KEY_PREFIX,
} from './recoveryKey.js';

// Clamped 0..31 sequence key. Pinned so the printed format can never change
// silently — a user's saved recovery key must decode on every future build.
const SEQ_PRIV = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHl8=';
const SEQ_RECOVERY = 'CVPN-2wkH4-kHMn2-WPndf-8Cxms-oFkX9-3ouZM-JUwTB-FSZpD-CeNmX-MrPng';

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof InvalidRecoveryKeyError ? e.reason : 'other';
  }
  return undefined;
}

describe('recovery key', () => {
  it('round-trips a generated keypair, public key and payment code included', () => {
    const kp = generateKeypair();
    const back = decodeRecoveryKey(encodeRecoveryKey(kp.privateKey));
    expect(back).toEqual(kp);
    expect(paymentCode(back.publicKey)).toBe(paymentCode(kp.publicKey));
  });

  it('matches the pinned vector', () => {
    expect(encodeRecoveryKey(SEQ_PRIV)).toBe(SEQ_RECOVERY);
    expect(decodeRecoveryKey(SEQ_RECOVERY).privateKey).toBe(SEQ_PRIV);
  });

  it('prints as the prefix plus dash-separated groups of five', () => {
    const key = encodeRecoveryKey(generateKeypair().privateKey);
    const [prefix, ...groups] = key.split('-');
    expect(prefix).toBe(RECOVERY_KEY_PREFIX);
    groups.slice(0, -1).forEach((g) => expect(g).toHaveLength(5));
  });

  it('forgives whitespace, line breaks, a lower-case prefix and missing dashes', () => {
    const kp = decodeRecoveryKey(SEQ_RECOVERY);
    const messy = `  ${SEQ_RECOVERY.replace('CVPN', 'cvpn').replace(/-/g, ' \n')}\n`;
    expect(decodeRecoveryKey(messy)).toEqual(kp);
    expect(decodeRecoveryKey(SEQ_RECOVERY.replace(/-/g, ''))).toEqual(kp);
    expect(decodeRecoveryKey(SEQ_RECOVERY.slice('CVPN-'.length))).toEqual(kp);
  });

  it('rejects a single mistyped character by checksum', () => {
    const last = SEQ_RECOVERY.at(-2) === 'x' ? 'y' : 'x';
    const typo = SEQ_RECOVERY.slice(0, -2) + last + SEQ_RECOVERY.slice(-1);
    expect(reasonOf(() => decodeRecoveryKey(typo))).toBe('checksum');
  });

  it('rejects truncated keys, non-base58 characters and empty input as format errors', () => {
    expect(reasonOf(() => decodeRecoveryKey(SEQ_RECOVERY.slice(0, -6)))).toBe('format');
    expect(reasonOf(() => decodeRecoveryKey('CVPN-0OIl0-OIl0O'))).toBe('format');
    expect(reasonOf(() => decodeRecoveryKey(''))).toBe('format');
  });

  it('refuses to encode a key that is not 32 bytes', () => {
    expect(() => encodeRecoveryKey('AAAA')).toThrow();
  });
});
