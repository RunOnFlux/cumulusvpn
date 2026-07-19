import { describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import { buildCountryOptions, healthOf } from './gateways';

function gateway(country: string, load: number, city = 'Somewhere'): GatewayInfo {
  return {
    country,
    region: 'region',
    city,
    load,
    capacity: 100,
    version: '1.0.0',
    min_client_version: '1.0.0',
    server_pubkey: 'srv',
    sign_pubkey: 'sign',
    ip: '203.0.113.1',
    controlUrl: 'http://203.0.113.1:51821',
  };
}

describe('healthOf', () => {
  it('is unknown when no live gateway was discovered', () => {
    const [seed] = buildCountryOptions(['cumulusvpnfr'], []);
    expect(seed).toBeDefined();
    expect(healthOf(seed!)).toBe('unknown');
  });

  it('maps load bands to good / fair / busy', () => {
    const good = buildCountryOptions(['cumulusvpnde'], [gateway('DE', 0.1)])[0]!;
    const fair = buildCountryOptions(['cumulusvpnde'], [gateway('DE', 0.5)])[0]!;
    const busy = buildCountryOptions(['cumulusvpnde'], [gateway('DE', 0.9)])[0]!;
    expect(healthOf(good)).toBe('good');
    expect(healthOf(fair)).toBe('fair');
    expect(healthOf(busy)).toBe('busy');
  });
});

describe('buildCountryOptions', () => {
  it('produces one enriched row per spec', () => {
    const options = buildCountryOptions(['cumulusvpnde', 'cumulusvpnnl'], []);
    expect(options).toHaveLength(2);
    const de = options.find((o) => o.cc === 'DE')!;
    expect(de.name).toBe('Germany');
    expect(de.flag).toBe('🇩🇪');
    expect(de.city).toBe('Frankfurt');
    expect(de.status).toBe('seed');
    expect(de.nodeCount).toBe(0);
    expect(de.bestGateway).toBeNull();
  });

  it('groups same-city gateways into one row, least-loaded as best', () => {
    const options = buildCountryOptions(
      ['cumulusvpnde'],
      [gateway('DE', 0.8, 'Frankfurt'), gateway('DE', 0.2, 'Frankfurt')],
    );
    expect(options).toHaveLength(1);
    const de = options[0]!;
    expect(de.status).toBe('live');
    expect(de.nodeCount).toBe(2);
    expect(de.bestGateway?.load).toBe(0.2);
    // The live gateway's own city wins over the static table.
    expect(de.city).toBe('Frankfurt');
    expect(de.id).toBe('DE:Frankfurt');
  });

  it('splits a country into one selectable row per city', () => {
    const options = buildCountryOptions(
      ['cumulusvpnde'],
      [gateway('DE', 0.8, 'Berlin'), gateway('DE', 0.2, 'Frankfurt')],
    );
    // Two distinct cities → two rows, each with its own least-loaded best.
    expect(options).toHaveLength(2);
    const berlin = options.find((o) => o.id === 'DE:Berlin')!;
    const frankfurt = options.find((o) => o.id === 'DE:Frankfurt')!;
    expect(berlin.nodeCount).toBe(1);
    expect(frankfurt.nodeCount).toBe(1);
    expect(frankfurt.bestGateway?.load).toBe(0.2);
    expect(berlin.cc).toBe('DE');
    expect(frankfurt.cc).toBe('DE');
  });

  it('sorts live countries before seed-only ones, then alphabetically', () => {
    const options = buildCountryOptions(
      ['cumulusvpnde', 'cumulusvpnau', 'cumulusvpnnl'],
      [gateway('NL', 0.3)],
    );
    expect(options.map((o) => o.cc)).toEqual(['NL', 'AU', 'DE']);
  });
});
