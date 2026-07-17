import { beforeEach, describe, expect, it } from 'vitest';
import { KEYPAIR_STORAGE_KEY } from '../config';
import { loadOrCreateKeypair, regenerateKeypair } from './keypair';

beforeEach(() => {
  localStorage.clear();
});

function isBase64Key(value: string): boolean {
  // A 32-byte X25519 key encodes to 44 std-base64 chars (with padding).
  return value.length === 44 && /^[A-Za-z0-9+/]+=*$/.test(value);
}

describe('regenerateKeypair', () => {
  it('mints a base64 keypair and persists it', () => {
    const kp = regenerateKeypair();
    expect(isBase64Key(kp.publicKey)).toBe(true);
    expect(isBase64Key(kp.privateKey)).toBe(true);

    const stored = JSON.parse(localStorage.getItem(KEYPAIR_STORAGE_KEY)!);
    expect(stored).toEqual(kp);
  });

  it('replaces any existing key with a fresh one', () => {
    const first = regenerateKeypair();
    const second = regenerateKeypair();
    expect(second.privateKey).not.toBe(first.privateKey);
    expect(JSON.parse(localStorage.getItem(KEYPAIR_STORAGE_KEY)!)).toEqual(second);
  });
});

describe('loadOrCreateKeypair', () => {
  it('generates and stores a key when none exists', () => {
    expect(localStorage.getItem(KEYPAIR_STORAGE_KEY)).toBeNull();
    const kp = loadOrCreateKeypair();
    expect(isBase64Key(kp.publicKey)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEYPAIR_STORAGE_KEY)!)).toEqual(kp);
  });

  it('returns the persisted key on subsequent loads (stable payment code)', () => {
    const created = loadOrCreateKeypair();
    const reloaded = loadOrCreateKeypair();
    expect(reloaded).toEqual(created);
  });

  it('mints a fresh key when stored JSON is corrupt', () => {
    localStorage.setItem(KEYPAIR_STORAGE_KEY, 'not json');
    const kp = loadOrCreateKeypair();
    expect(isBase64Key(kp.privateKey)).toBe(true);
  });

  it('mints a fresh key when stored shape is incomplete', () => {
    localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify({ publicKey: 'x' }));
    const kp = loadOrCreateKeypair();
    expect(isBase64Key(kp.privateKey)).toBe(true);
  });
});
