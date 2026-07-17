/**
 * Unit tests for the persistence seam.
 *
 * The POC uses an in-memory Map behind the real async signatures, so these
 * tests exercise the observable contract every screen relies on: keypair
 * round-trips, route-style validation/defaulting, and the null-clears-auto-pick
 * behaviour of the entry/exit country setters.
 */
import type { Keypair } from '@cumulusvpn/core';
import {
  loadKeypair,
  saveKeypair,
  loadSelectedCountry,
  saveSelectedCountry,
  loadRouteStyle,
  saveRouteStyle,
  loadEntryCountry,
  saveEntryCountry,
  loadExitCountry,
  saveExitCountry,
} from './storage';

const KP: Keypair = { publicKey: 'pub-abc', privateKey: 'priv-xyz' };

describe('keypair persistence', () => {
  it('returns null before anything is saved', async () => {
    // Reset the shared in-memory store by clearing the selected key too.
    await expect(loadKeypair()).resolves.toBeNull();
  });

  it('round-trips a saved keypair', async () => {
    await saveKeypair(KP);
    await expect(loadKeypair()).resolves.toEqual(KP);
  });
});

describe('selected country', () => {
  it('defaults to null and round-trips a saved code', async () => {
    await expect(loadSelectedCountry()).resolves.toBeNull();
    await saveSelectedCountry('DE');
    await expect(loadSelectedCountry()).resolves.toBe('DE');
  });
});

describe('route style', () => {
  it('defaults to single-hop (multi-hop off) when unset', async () => {
    await expect(loadRouteStyle()).resolves.toBe('single');
  });

  it('round-trips each valid route style', async () => {
    await saveRouteStyle('multihop-same-country');
    await expect(loadRouteStyle()).resolves.toBe('multihop-same-country');
    await saveRouteStyle('multihop-cross-jurisdiction');
    await expect(loadRouteStyle()).resolves.toBe('multihop-cross-jurisdiction');
    await saveRouteStyle('single');
    await expect(loadRouteStyle()).resolves.toBe('single');
  });
});

describe('multi-hop entry/exit country', () => {
  it('round-trips a code and clears back to auto-pick on null', async () => {
    await saveEntryCountry('NL');
    await expect(loadEntryCountry()).resolves.toBe('NL');
    await saveEntryCountry(null);
    await expect(loadEntryCountry()).resolves.toBeNull();

    await saveExitCountry('JP');
    await expect(loadExitCountry()).resolves.toBe('JP');
    await saveExitCountry(null);
    await expect(loadExitCountry()).resolves.toBeNull();
  });
});
