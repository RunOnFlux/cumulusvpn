/**
 * Unit tests for the presentation-shaping helpers over core discovery.
 *
 * These are pure functions (no networking): flag derivation, latency banding,
 * and the country grouping/sorting that drives the picker.
 */
import type { GatewayInfo } from '@cumulusvpn/core';
import { flagEmoji, latencyBand, groupByCountry, groupByLocation } from './gateways';

/** Build a minimal GatewayInfo for grouping tests. */
function gw(partial: Partial<GatewayInfo> & Pick<GatewayInfo, 'ip' | 'country'>): GatewayInfo {
  return {
    city: 'Somewhere',
    controlUrl: `https://${partial.ip}:16127`,
    sign_pubkey: 'pk',
    load: 0,
    ...partial,
  } as GatewayInfo;
}

describe('flagEmoji', () => {
  it('maps a valid ISO alpha-2 code to its regional-indicator pair', () => {
    // DE -> 🇩🇪 (U+1F1E9 U+1F1EA)
    expect(flagEmoji('DE')).toBe('\u{1F1E9}\u{1F1EA}');
    expect(flagEmoji('US')).toBe('\u{1F1FA}\u{1F1F8}');
  });

  it('lowercases/trims before mapping', () => {
    expect(flagEmoji(' de ')).toBe(flagEmoji('DE'));
  });

  it('returns the white-flag fallback for invalid input', () => {
    expect(flagEmoji('D')).toBe('🏳️');
    expect(flagEmoji('DEU')).toBe('🏳️');
    expect(flagEmoji('D1')).toBe('🏳️');
  });
});

describe('latencyBand', () => {
  it('classifies unmeasured and high latency as slow', () => {
    expect(latencyBand(null)).toBe('slow');
    expect(latencyBand(180)).toBe('slow');
    expect(latencyBand(500)).toBe('slow');
  });

  it('classifies < 60ms as good and 60..179ms as ok', () => {
    expect(latencyBand(0)).toBe('good');
    expect(latencyBand(59)).toBe('good');
    expect(latencyBand(60)).toBe('ok');
    expect(latencyBand(179)).toBe('ok');
  });
});

describe('groupByCountry', () => {
  it('groups gateways by country, counts nodes and picks the first as best', () => {
    const gateways = [
      gw({ ip: '1.1.1.1', country: 'DE', city: 'Frankfurt' }),
      gw({ ip: '1.1.1.2', country: 'DE', city: 'Berlin' }),
      gw({ ip: '2.2.2.1', country: 'US', city: 'New York' }),
    ];
    const rows = groupByCountry(gateways);
    const de = rows.find((r) => r.code === 'DE');
    const us = rows.find((r) => r.code === 'US');

    expect(de?.nodeCount).toBe(2);
    expect(de?.best.ip).toBe('1.1.1.1');
    expect(de?.city).toBe('Frankfurt');
    expect(de?.name).toBe('Germany');
    expect(us?.nodeCount).toBe(1);
    expect(us?.name).toBe('United States');
  });

  it('falls back to the raw code when the country name is unknown', () => {
    const rows = groupByCountry([gw({ ip: '9.9.9.9', country: 'ZZ', city: '' })]);
    expect(rows[0]?.name).toBe('ZZ');
  });

  it('sets a country-level row id equal to the code', () => {
    const rows = groupByCountry([gw({ ip: '2.2.2.1', country: 'US', city: 'New York' })]);
    expect(rows[0]?.id).toBe('US');
  });

  it('sorts measured (lower-latency) countries ahead of unmeasured ones', () => {
    const gateways = [
      gw({ ip: '1.1.1.1', country: 'DE' }),
      gw({ ip: '2.2.2.1', country: 'US' }),
      gw({ ip: '3.3.3.1', country: 'JP' }),
    ];
    const rows = groupByCountry(gateways, { '2.2.2.1': 20, '1.1.1.1': 90 });
    // US (20ms) < DE (90ms) < JP (unmeasured -> last).
    expect(rows.map((r) => r.code)).toEqual(['US', 'DE', 'JP']);
    expect(rows[0]?.latencyMs).toBe(20);
    expect(rows[2]?.latencyMs).toBeNull();
  });
});

describe('groupByLocation', () => {
  it('splits a country into one selectable row per city, each with a distinct id', () => {
    const gateways = [
      gw({ ip: '2.2.2.1', country: 'US', city: 'New York', load: 0.1 }),
      gw({ ip: '2.2.2.2', country: 'US', city: 'New York', load: 0.2 }),
      gw({ ip: '3.3.3.1', country: 'US', city: 'California' }),
      gw({ ip: '1.1.1.1', country: 'DE', city: 'Frankfurt' }),
    ];
    const rows = groupByLocation(gateways);

    // Same country, two distinct cities → two distinct, selectable rows.
    expect(rows.filter((r) => r.code === 'US').length).toBe(2);
    const ny = rows.find((r) => r.id === 'US:New York');
    const ca = rows.find((r) => r.id === 'US:California');
    expect(ny?.nodeCount).toBe(2);
    expect(ny?.best.ip).toBe('2.2.2.1'); // least-loaded in the city
    expect(ny?.city).toBe('New York');
    expect(ca?.nodeCount).toBe(1);
    expect(rows.find((r) => r.code === 'DE')?.id).toBe('DE:Frankfurt');
  });

  it('collapses to one row per country when no locality is reported', () => {
    // Empty gateway city → falls back to the country city table (one per country).
    const rows = groupByLocation([
      gw({ ip: '1.1.1.1', country: 'DE', city: '' }),
      gw({ ip: '1.1.1.2', country: 'DE', city: '' }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.nodeCount).toBe(2);
  });
});
