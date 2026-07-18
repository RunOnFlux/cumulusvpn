import { describe, expect, it } from 'vitest';
import { hasLeadingZeroBits, powHash, solvePoW, verifyPoW } from './pow.js';

describe('hasLeadingZeroBits', () => {
  it('checks whole leading zero bytes', () => {
    expect(hasLeadingZeroBits(new Uint8Array([0, 0, 1]), 16)).toBe(true);
    expect(hasLeadingZeroBits(new Uint8Array([0, 1, 0]), 16)).toBe(false);
  });

  it('checks a partial byte with the correct mask', () => {
    // 20 bits => 2 full zero bytes + top nibble of byte 3 zero.
    expect(hasLeadingZeroBits(new Uint8Array([0, 0, 0x0f]), 20)).toBe(true);
    expect(hasLeadingZeroBits(new Uint8Array([0, 0, 0x10]), 20)).toBe(false);
  });

  it('treats 0 bits as always satisfied', () => {
    expect(hasLeadingZeroBits(new Uint8Array([0xff]), 0)).toBe(true);
  });
});

describe('powHash', () => {
  it('is deterministic and concatenates utf8(pub)||utf8(nonce)', () => {
    const a = powHash('pubkey', '42');
    const b = powHash('pubkey', '42');
    expect(a).toEqual(b);
    expect(a).toHaveLength(32);
    expect(powHash('pubkey', '43')).not.toEqual(a);
  });
});

describe('solvePoW / verifyPoW', () => {
  const pub = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  it('finds a nonce that satisfies the difficulty', () => {
    const nonce = solvePoW(pub, 12);
    expect(nonce).toMatch(/^\d+$/);
    expect(hasLeadingZeroBits(powHash(pub, nonce), 12)).toBe(true);
    expect(verifyPoW(pub, nonce, 12)).toBe(true);
  });

  it('with an explicit start of 0, finds the smallest qualifying nonce', () => {
    const nonce = solvePoW(pub, 10, 0);
    const n = Number(nonce);
    for (let i = 0; i < n; i++) {
      expect(hasLeadingZeroBits(powHash(pub, String(i)), 10)).toBe(false);
    }
  });

  it('uses a random start by default → repeated solves differ but all verify', () => {
    const a = solvePoW(pub, 8);
    const b = solvePoW(pub, 8);
    expect(verifyPoW(pub, a, 8)).toBe(true);
    expect(verifyPoW(pub, b, 8)).toBe(true);
    // Astronomically unlikely to collide across the 2^30 start range.
    expect(a).not.toBe(b);
  });

  it('rejects a wrong nonce and the empty nonce', () => {
    expect(verifyPoW(pub, '0', 20)).toBe(false);
    expect(verifyPoW(pub, '', 8)).toBe(false);
  });
});
