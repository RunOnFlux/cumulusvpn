import { beforeEach, describe, expect, it } from 'vitest';
import { encodeRecoveryKey, generateKeypair, paymentCode } from '@cumulusvpn/core';
import {
  checkRestore,
  codeOf,
  dismissNudge,
  markRecoveryKeySaved,
  nudgeDismissed,
  recoveryKeyFor,
  recoveryKeySaved,
  shortCode,
} from './recoveryKey';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** Flip one base58 character near the end of a recovery key, keeping it base58. */
function typo(key: string): string {
  let i = key.length - 2;
  while (key[i] === '-') {
    i -= 1;
  }
  return key.slice(0, i) + (key[i] === '2' ? '3' : '2') + key.slice(i + 1);
}

describe('checkRestore', () => {
  const current = generateKeypair();
  const other = generateKeypair();

  it('accepts another identity and names its code', () => {
    const check = checkRestore(encodeRecoveryKey(other.privateKey), current);
    expect(check).toEqual({ ok: true, keypair: other, code: paymentCode(other.publicKey) });
  });

  it('is forgiving about how the key was pasted', () => {
    const key = encodeRecoveryKey(other.privateKey);
    const messy = `  ${key.toLowerCase().slice(0, 4)}${key.slice(4).replace(/-/g, ' ')}\n`;
    expect(checkRestore(messy, current)).toMatchObject({ ok: true, keypair: other });
  });

  // Restoring the key already in use would "succeed" and change nothing — say so.
  it('refuses the identity this browser already has', () => {
    expect(checkRestore(encodeRecoveryKey(current.privateKey), current)).toEqual({
      ok: false,
      error: 'same',
    });
  });

  // The checksum is what stops a typo from restoring a DIFFERENT, valid identity.
  it('reports a typo as a checksum error, not as a different identity', () => {
    expect(checkRestore(typo(encodeRecoveryKey(other.privateKey)), current)).toEqual({
      ok: false,
      error: 'checksum',
    });
  });

  it('rejects input that is not a recovery key at all', () => {
    expect(checkRestore('CVPN1:2RkUfDC55GMndKreXqK7Jruu8Snx', current)).toEqual({
      ok: false,
      error: 'format',
    });
  });
});

describe('recovery key helpers', () => {
  it('round-trips this identity through its recovery key', () => {
    const kp = generateKeypair();
    expect(recoveryKeyFor(kp)).toBe(encodeRecoveryKey(kp.privateKey));
    expect(codeOf(kp)).toBe(paymentCode(kp.publicKey));
  });

  it('degrades to empty for a malformed stored key instead of throwing', () => {
    expect(recoveryKeyFor({ publicKey: 'x', privateKey: 'not-a-key' })).toBe('');
    expect(codeOf({ publicKey: 'not-a-key', privateKey: 'x' })).toBe('');
  });

  it('shortens a code the way the app shows it', () => {
    expect(shortCode('2RkUfDC55GMndKreXqK7Jruu8Snx')).toBe('2RkU…8Snx');
  });
});

describe('nudge persistence', () => {
  it('remembers a saved key only for the identity it belongs to', () => {
    expect(recoveryKeySaved('codeA')).toBe(false);
    markRecoveryKeySaved('codeA');
    expect(recoveryKeySaved('codeA')).toBe(true);
    // A new identity has a new key to save.
    expect(recoveryKeySaved('codeB')).toBe(false);
  });

  it('dismisses per place, for this session only', () => {
    dismissNudge('upgrade');
    expect(nudgeDismissed('upgrade')).toBe(true);
    expect(nudgeDismissed('confirmed')).toBe(false);
    expect(localStorage.length).toBe(0);
  });
});
