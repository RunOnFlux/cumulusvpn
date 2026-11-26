import { describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import { bestLocation, gatewayOption, toCityRows, toCountryRows } from './locations';

function gw(ip: string, country: string, load: number, capacity: number): GatewayInfo {
  return {
    ip,
    country,
    city: 'Town',
    load,
    capacity,
    sign_pubkey: `k-${ip}`,
    controlUrl: `http://${ip}:51821`,
  } as unknown as GatewayInfo;
}

describe('gateways with no room left', () => {
  it('a full gateway is passed over for one with room, however idle it looks', () => {
    const rows = toCountryRows([gw('1.0.0.1', 'DE', 0.0, 0), gw('1.0.0.2', 'DE', 0.6, 12)]);
    expect(rows[0]?.gatewayIp).toBe('1.0.0.2');
    expect(rows[0]?.full).toBeUndefined();
  });

  it('a location where every gateway is full stays listed but is marked full', () => {
    const rows = toCountryRows([gw('2.0.0.1', 'AT', 0.1, 0)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.full).toBe(true);
    expect(toCityRows([gw('2.0.0.1', 'AT', 0.1, 0)])[0]?.full).toBe(true);
  });

  it('Automatic never picks a full location while another has room', () => {
    const rows = toCountryRows([gw('2.0.0.1', 'AT', 0.0, 0), gw('3.0.0.1', 'FR', 0.7, 5)], {
      '2.0.0.1': 5,
      '3.0.0.1': 200,
    });
    expect(bestLocation(rows)?.code).toBe('FR');
  });

  it('with everything full, Automatic still offers the best of them', () => {
    const rows = toCountryRows([gw('2.0.0.1', 'AT', 0.2, 0), gw('3.0.0.1', 'FR', 0.9, 0)]);
    expect(bestLocation(rows)?.code).toBe('AT');
  });
});

describe('gatewayOption', () => {
  it('describes one gateway as a location', () => {
    const o = gatewayOption(gw('4.0.0.1', 'SE', 0.3, 9), 42);
    expect(o).toMatchObject({
      code: 'SE',
      name: 'Sweden',
      gatewayIp: '4.0.0.1',
      city: 'Town',
      latencyMs: 42,
    });
  });
});
