import { describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import {
  bestLocation,
  citiesOf,
  countryOfId,
  optionId,
  resolveSelection,
  toCityRows,
  toCountryRows,
} from './locations';

function gw(ip: string, country: string, city: string, load: number): GatewayInfo {
  return {
    ip,
    country,
    city,
    load,
    sign_pubkey: `k-${ip}`,
    controlUrl: `http://${ip}:51821`,
  } as unknown as GatewayInfo;
}

const FLEET = [
  gw('1.1.1.1', 'DE', 'Frankfurt', 0.5),
  gw('1.1.1.2', 'DE', 'Frankfurt', 0.1),
  gw('1.1.1.3', 'DE', 'Berlin', 0.2),
  // Nearly idle and nearest in the selection tests: the clear overall best.
  gw('2.2.2.1', 'FR', 'Paris', 0.05),
  gw('3.3.3.1', 'US', '', 0.1),
];

describe('location rows', () => {
  it('builds one row per country with the best gateway and a node count', () => {
    const rows = toCountryRows(FLEET);
    expect(rows.map((r) => optionId(r))).toEqual(['FR', 'DE', 'US']);
    const de = rows.find((r) => r.code === 'DE');
    expect(de?.gatewayIp).toBe('1.1.1.2');
    expect(de?.nodeCount).toBe(3);
  });

  it('builds city rows, and a gateway without a city counts as the country', () => {
    const ids = toCityRows(FLEET).map(optionId);
    expect(ids).toEqual(['FR:Paris', 'DE:Berlin', 'DE:Frankfurt', 'US']);
    const frankfurt = toCityRows(FLEET).find((r) => optionId(r) === 'DE:Frankfurt');
    expect(frankfurt?.nodeCount).toBe(2);
    expect(frankfurt?.gatewayIp).toBe('1.1.1.2');
  });

  it('prefers a measured, nearby gateway over an unmeasured idle one', () => {
    const latency = { '1.1.1.1': 20 };
    const de = toCountryRows(FLEET, latency).find((r) => r.code === 'DE');
    expect(de?.gatewayIp).toBe('1.1.1.1');
    expect(de?.latencyMs).toBe(20);
  });

  it('lists a country’s cities A–Z', () => {
    expect(citiesOf(toCityRows(FLEET), 'DE').map((r) => r.city)).toEqual(['Berlin', 'Frankfurt']);
    expect(citiesOf(toCityRows(FLEET), 'US')).toEqual([]);
  });
});

describe('selection', () => {
  const latency = { '2.2.2.1': 15, '1.1.1.2': 80, '3.3.3.1': 140 };
  const countries = toCountryRows(FLEET, latency);
  const cities = toCityRows(FLEET, latency);

  it('Automatic resolves to the best location overall', () => {
    expect(bestLocation(countries)?.code).toBe('FR');
    expect(resolveSelection(null, countries, cities)?.code).toBe('FR');
  });

  it('resolves a city, a country, and falls back when a city disappears', () => {
    expect(optionId(resolveSelection('DE:Berlin', countries, cities)!)).toBe('DE:Berlin');
    expect(optionId(resolveSelection('DE', countries, cities)!)).toBe('DE');
    expect(optionId(resolveSelection('DE:Munich', countries, cities)!)).toBe('DE');
    expect(resolveSelection('JP', countries, cities)?.code).toBe('FR');
  });

  it('splits ids', () => {
    expect(countryOfId('DE:Frankfurt')).toBe('DE');
    expect(countryOfId('DE')).toBe('DE');
  });
});
