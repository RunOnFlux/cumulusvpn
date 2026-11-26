import { describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import {
  discoveryRetryDelay,
  DISCOVERY_RETRY_MS,
  sessionHops,
  switchesLocation,
} from './useConnection';
import type { CountryOption } from '../lib/session';
import { cardLatency } from '../lib/liveStats';

function row(id: string, gatewayIp: string, latencyMs: number): CountryOption {
  const code = id.split(':')[0]!;
  return {
    id,
    code,
    name: code,
    flag: '',
    gatewayIp,
    city: id.split(':')[1] ?? '',
    load: 0.1,
    signPubKey: `k-${gatewayIp}`,
    latencyMs,
  };
}

const DE = row('DE', '1.0.0.1', 150);
const DE_BERLIN = row('DE:Berlin', '1.0.0.2', 160);
const DE_FRANKFURT = row('DE:Frankfurt', '1.0.0.1', 150);
const FR = row('FR', '2.0.0.1', 20);
const COUNTRIES = [DE, FR];
const LOCATIONS = [DE_BERLIN, DE_FRANKFURT, FR];

describe('picking a location during a session', () => {
  it('another location switches the tunnel', () => {
    expect(switchesLocation('FR', DE, COUNTRIES, LOCATIONS)).toBe(true);
    expect(switchesLocation('DE:Berlin', DE, COUNTRIES, LOCATIONS)).toBe(true);
  });

  it('re-picking where we are changes nothing', () => {
    expect(switchesLocation('DE', DE, COUNTRIES, LOCATIONS)).toBe(false);
    // The country's best gateway is the city already in use.
    expect(switchesLocation('DE', DE_FRANKFURT, COUNTRIES, LOCATIONS)).toBe(false);
  });

  it('Automatic switches only when the best location is elsewhere', () => {
    expect(switchesLocation(null, FR, COUNTRIES, LOCATIONS)).toBe(false);
    expect(switchesLocation(null, DE, COUNTRIES, LOCATIONS)).toBe(true);
  });
});

describe('multi-hop session hops', () => {
  const fleet = [
    { ip: '1.0.0.1', country: 'DE', city: 'Frankfurt ', load: 0.2, sign_pubkey: 'a' },
    { ip: '1.0.0.9', country: 'DE', city: 'Berlin', load: 0.4, sign_pubkey: 'b' },
  ] as unknown as GatewayInfo[];

  it('shows the gateways actually chosen, keeping the picked entry row id', () => {
    const hops = sessionHops(DE, fleet, { entryGatewayIp: '1.0.0.1', exitGatewayIp: '1.0.0.9' });
    expect(hops.entry).toMatchObject({ id: 'DE', gatewayIp: '1.0.0.1', city: 'Frankfurt' });
    expect(hops.exit).toMatchObject({ code: 'DE', city: 'Berlin', gatewayIp: '1.0.0.9' });
  });

  it('falls back to the picked row when a hop is not in the fleet', () => {
    const hops = sessionHops(DE, [], { entryGatewayIp: '9.9.9.9', exitGatewayIp: '8.8.8.8' });
    expect(hops.entry).toBe(DE);
    expect(hops.exit).toBeNull();
  });
});

describe('discovery retry', () => {
  it('backs off and then keeps trying at the longest interval', () => {
    expect(discoveryRetryDelay(0)).toBe(DISCOVERY_RETRY_MS[0]);
    expect(discoveryRetryDelay(1)).toBeGreaterThan(discoveryRetryDelay(0));
    expect(discoveryRetryDelay(99)).toBe(DISCOVERY_RETRY_MS[DISCOVERY_RETRY_MS.length - 1]);
  });
});

describe('location card latency', () => {
  it('shows the live ping while connected, so it matches the ping tile', () => {
    expect(cardLatency(true, 55, 520)).toBe('55 ms');
  });

  it('shows the discovery probe otherwise, or until the first ping lands', () => {
    expect(cardLatency(false, 55, 48)).toBe('48 ms');
    expect(cardLatency(true, null, 48)).toBe('48 ms');
    expect(cardLatency(false, null, null)).toBeNull();
  });
});
