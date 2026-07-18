/**
 * Unit tests for the persistence seam (AsyncStorage-backed; the native module is
 * swapped for its in-memory jest mock in jest.setup.js). These exercise the
 * observable contract every screen relies on: keypair round-trips, route-style
 * validation/defaulting, the null-clears-auto-pick behaviour of the entry/exit
 * setters, and the discovery (fleet) cache round-trip + corruption guard.
 */
import type { GatewayInfo, Keypair } from '@cumulusvpn/core';
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
  loadFleet,
  saveFleet,
} from './storage';

const KP: Keypair = { publicKey: 'pub-abc', privateKey: 'priv-xyz' };

const GW: GatewayInfo = {
  ip: '1.2.3.4',
  controlUrl: 'http://1.2.3.4:51821',
  country: 'DE',
  region: 'EU',
  city: 'Frankfurt',
  load: 0.1,
  capacity: 90,
  version: '0.1.0',
  min_client_version: '0.1.0',
  server_pubkey: 'srv-pub',
  sign_pubkey: 'sign-pub',
};

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

describe('fleet cache', () => {
  it('is null before anything is cached', async () => {
    await expect(loadFleet()).resolves.toBeNull();
  });

  it('round-trips a saved snapshot with gateways + latency', async () => {
    await saveFleet([GW], { [GW.ip]: 42 }, 1_700_000_000_000);
    const got = await loadFleet();
    expect(got?.gateways).toEqual([GW]);
    expect(got?.latencyByIp).toEqual({ [GW.ip]: 42 });
    expect(got?.savedAt).toBe(1_700_000_000_000);
  });

  it('treats an empty gateway list as no cache', async () => {
    await saveFleet([], {}, 1_700_000_000_000);
    await expect(loadFleet()).resolves.toBeNull();
  });
});
