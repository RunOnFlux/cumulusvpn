import { afterEach, describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import { FLEET_CACHE_MAX_AGE_MS, loadFleetCache, saveFleetCache } from './fleetCache';

const gw = {
  country: 'SG',
  region: 'r',
  city: 'Singapore',
  load: 0.2,
  capacity: 100,
  version: '0.4.5',
  min_client_version: '1.0.0',
  server_pubkey: 'srv',
  sign_pubkey: 'sign',
  ip: '198.51.100.2',
  controlUrl: 'http://198.51.100.2:51821',
} satisfies GatewayInfo;

afterEach(() => localStorage.clear());

describe('fleet cache', () => {
  it('round-trips a discovered fleet with its probe times', () => {
    saveFleetCache({ at: 1_000, gateways: [gw], times: { '198.51.100.2': 35 } });
    const c = loadFleetCache(2_000);
    expect(c?.gateways[0]?.ip).toBe('198.51.100.2');
    expect(c?.times['198.51.100.2']).toBe(35);
  });

  it('ignores a cache that is too old, empty, or not ours', () => {
    saveFleetCache({ at: 0, gateways: [gw], times: {} });
    expect(loadFleetCache(FLEET_CACHE_MAX_AGE_MS + 1)).toBeNull();
    saveFleetCache({ at: 0, gateways: [], times: {} });
    expect(loadFleetCache(1)).toBeNull();
    localStorage.setItem('cvpn.web.fleet.v1', '{"at":1,"gateways":[{"nope":1}],"times":{}}');
    expect(loadFleetCache(2)).toBeNull();
    localStorage.setItem('cvpn.web.fleet.v1', 'not json');
    expect(loadFleetCache(2)).toBeNull();
  });
});
