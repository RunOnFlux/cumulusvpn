import { beforeEach, describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import {
  FLEET_CACHE_MAX_AGE_MS,
  loadDnsChoice,
  loadFleetCache,
  saveDnsChoice,
  saveFleetCache,
} from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('DNS choice', () => {
  it('defaults to Cloudflare, what every gateway advertises', () => {
    expect(loadDnsChoice()).toBe('cloudflare');
  });

  it('persists every option across reads', () => {
    for (const choice of ['quad9', 'adguard', 'family', 'cloudflare'] as const) {
      saveDnsChoice(choice);
      expect(loadDnsChoice()).toBe(choice);
    }
    expect(localStorage.getItem('cvpn.dns.v1')).toBe('cloudflare');
  });

  // Mullvad's public DNS shuts down by 2026-11-02; 1.4.1 offered it.
  it('moves a saved Mullvad choice to Quad9', () => {
    localStorage.setItem('cvpn.dns.v1', 'mullvad');
    expect(loadDnsChoice()).toBe('quad9');
  });

  it('reads a corrupt or unknown value as the default, so it can never block a connect', () => {
    for (const bad of ['opendns', '', 'QUAD9', '"quad9"', '{"id":"quad9"}', 'null']) {
      localStorage.setItem('cvpn.dns.v1', bad);
      expect(loadDnsChoice(), bad).toBe('cloudflare');
    }
  });
});

describe('fleet cache', () => {
  const gw = { ip: '1.2.3.4', country: 'DE', city: 'Frankfurt', load: 0.1 } as GatewayInfo;

  it('is empty on a first launch', () => {
    expect(loadFleetCache()).toBeNull();
  });

  it('round-trips the last good discovery', () => {
    saveFleetCache([gw], { '1.2.3.4': 42 }, 1_000);
    expect(loadFleetCache(2_000)).toEqual({
      gateways: [gw],
      latencyByIp: { '1.2.3.4': 42 },
      savedAt: 1_000,
    });
  });

  it('ignores a snapshot that is too old, empty or corrupt', () => {
    saveFleetCache([gw], {}, 0);
    expect(loadFleetCache(FLEET_CACHE_MAX_AGE_MS + 1)).toBeNull();
    saveFleetCache([], {}, 0);
    expect(loadFleetCache(1)).toBeNull();
    localStorage.setItem('cvpn.fleet.v1', '{not json');
    expect(loadFleetCache()).toBeNull();
  });
});
