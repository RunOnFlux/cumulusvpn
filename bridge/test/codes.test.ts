import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64 } from '@scure/base';

import { isValidPaymentCode, memoForCode, uuidForCode, MEMO_PREFIX } from '../src/codes.js';

/**
 * Byte-exact vectors against docs/10-api-contract.md:
 *   code = base58btc(sha256(rawPub)[0:20])
 * The pubkey here is 32 x 0x01; the derivation below IS the contract, so a
 * regression in @scure/base or our slicing shows up as a vector mismatch.
 */
const PUB_B64 = base64.encode(new Uint8Array(32).fill(1));
const CODE = base58.encode(sha256(new Uint8Array(32).fill(1)).subarray(0, 20));

describe('payment codes', () => {
  it('accepts a real derived code', () => {
    expect(isValidPaymentCode(CODE)).toBe(true);
    expect(base58.decode(CODE).length).toBe(20);
  });

  it('rejects garbage', () => {
    expect(isValidPaymentCode('')).toBe(false);
    expect(isValidPaymentCode('not-base58-0OIl')).toBe(false);
    expect(isValidPaymentCode('abc')).toBe(false);
    // valid base58 but wrong payload length (19 bytes)
    expect(isValidPaymentCode(base58.encode(new Uint8Array(19).fill(7)))).toBe(false);
    expect(isValidPaymentCode(base58.encode(new Uint8Array(21).fill(7)))).toBe(false);
  });

  it('builds the memo with the CVPN1 prefix', () => {
    expect(memoForCode(CODE)).toBe(`CVPN1:${CODE}`);
    expect(MEMO_PREFIX).toBe('CVPN1:');
    expect(() => memoForCode('bogus')).toThrow();
  });

  it('derives a stable RFC 4122 UUID for the Apple appAccountToken', () => {
    const uuid = uuidForCode(CODE);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Deterministic: same code, same token — this is what maps renewals.
    expect(uuidForCode(CODE)).toBe(uuid);
    expect(uuidForCode(base58.encode(new Uint8Array(20).fill(9)))).not.toBe(uuid);
  });

  /**
   * SHARED VECTORS with clients/core-ts/src/paymentCode.test.ts — the client
   * stamps this exact UUID on StoreKit purchases and the bridge recomputes
   * it. If either side changes derivation, both tests must be updated
   * together (and existing subscriptions remapped).
   */
  it('matches the pinned cross-package literals', () => {
    expect(uuidForCode('2RkUfDC55GMndKreXqK7Jruu8Snx')).toBe(
      'd47c7e4b-c0f7-421c-a429-72ad6e9ecaf3',
    );
    expect(uuidForCode('2bmMSbm88eN6MA6RuDiFKjNAZEuk')).toBe(
      'b2cc0e5c-45f5-4846-9d80-1fffa5f63323',
    );
  });

  it('matches the cross-package appAccountToken derivation', () => {
    const vectorCode = base58.encode(sha256(new Uint8Array(32).fill(1)).subarray(0, 20));
    const digest = sha256(new TextEncoder().encode(`cvpn-appaccount:${vectorCode}`));
    const b = digest.slice(0, 16);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    expect(uuidForCode(vectorCode)).toBe(expected);
    expect(PUB_B64).toBe('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=');
  });
});
