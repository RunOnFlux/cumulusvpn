import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { generateKeypair, publicKeyFromPrivate } from './keys.js';

describe('generateKeypair', () => {
  it('produces base64 keys that decode to 32 bytes', () => {
    const { publicKey, privateKey } = generateKeypair();
    expect(base64.decode(publicKey)).toHaveLength(32);
    expect(base64.decode(privateKey)).toHaveLength(32);
  });

  it('produces a WireGuard-clamped private scalar', () => {
    const { privateKey } = generateKeypair();
    const k = base64.decode(privateKey);
    expect(k[0]! & 0b0000_0111).toBe(0); // low 3 bits cleared
    expect(k[31]! & 0b1000_0000).toBe(0); // high bit cleared
    expect(k[31]! & 0b0100_0000).toBe(0b0100_0000); // bit 6 set
  });

  it('round-trips: public key derives deterministically from the private key', () => {
    const kp = generateKeypair();
    expect(publicKeyFromPrivate(kp.privateKey)).toBe(kp.publicKey);
  });

  it('generates distinct keypairs', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});
