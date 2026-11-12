import { describe, expect, it } from 'vitest';
import { parseKeypair, planBackup, storeName } from './identityBackup';

const A = { publicKey: 'pubA', privateKey: 'privA' };
const B = { publicKey: 'pubB', privateKey: 'privB' };
const blob = (k: typeof A): string => JSON.stringify(k);

describe('planBackup', () => {
  it('backs up this device when the store is empty (first launch mints, then saves)', () => {
    expect(planBackup(null, { ok: true, value: null })).toEqual({
      state: 'saved',
      use: null,
      write: true,
      other: null,
    });
    expect(planBackup(A, { ok: true, value: null })).toMatchObject({ use: A, write: true });
  });

  it('restores the backed-up identity when local storage was wiped', () => {
    expect(planBackup(null, { ok: true, value: blob(A) })).toEqual({
      state: 'restored',
      use: A,
      write: false,
      other: null,
    });
  });

  it('does nothing when both agree', () => {
    expect(planBackup(A, { ok: true, value: blob(A) })).toMatchObject({
      state: 'saved',
      write: false,
    });
  });

  it('NEVER overwrites a different identity — reports it instead', () => {
    expect(planBackup(A, { ok: true, value: blob(B) })).toEqual({
      state: 'other',
      use: A,
      write: false,
      other: B,
    });
  });

  it('never writes when the store could not be read or holds something unparseable', () => {
    expect(planBackup(A, { ok: false })).toMatchObject({ state: 'unavailable', write: false });
    expect(planBackup(null, { ok: false })).toMatchObject({ use: null, write: false });
    expect(planBackup(A, { ok: true, value: '{garbage' })).toMatchObject({
      state: 'unavailable',
      write: false,
    });
  });
});

describe('parseKeypair', () => {
  it('rejects partial blobs', () => {
    expect(parseKeypair(JSON.stringify({ publicKey: 'x' }))).toBeNull();
    expect(parseKeypair(blob(A))).toEqual(A);
  });
});

describe('storeName', () => {
  it('names the platform store', () => {
    expect(storeName('Macintosh')).toBe('the macOS Keychain');
    expect(storeName('Windows NT 10.0')).toBe('Windows Credential Manager');
    expect(storeName('X11; Linux x86_64')).toBe('the system keyring');
  });
});
