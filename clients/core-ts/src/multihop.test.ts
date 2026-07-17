import { describe, expect, it } from 'vitest';
import { buildMultihopConfig, selectHops } from './multihop.js';
import type { EnrollResponse, GatewayInfo } from './types.js';

function gateway(overrides: Partial<GatewayInfo>): GatewayInfo {
  return {
    ip: '1.1.1.1',
    controlUrl: 'http://1.1.1.1:51821',
    country: 'US',
    region: 'CA',
    city: 'SF',
    load: 0.1,
    capacity: 100,
    version: '1.0.0',
    min_client_version: '1.0.0',
    server_pubkey: 'PUB',
    sign_pubkey: 'SIGN',
    ...overrides,
  };
}

function enrollResp(overrides: Partial<EnrollResponse>): EnrollResponse {
  return {
    server_pubkey: 'SERVER_PUB',
    endpoint: '1.2.3.4:51820',
    assigned_ip: '10.8.0.2',
    dns: '1.1.1.1',
    payment_address: 'addr',
    payment_memo: 'CVPN1:code',
    price_flux: 1,
    ...overrides,
  };
}

describe('buildMultihopConfig', () => {
  const entry = enrollResp({
    server_pubkey: 'ENTRY_PUB',
    endpoint: '9.9.9.9:51820',
    assigned_ip: '10.8.0.5',
    dns: '10.8.0.1',
  });
  const exit = enrollResp({
    server_pubkey: 'EXIT_PUB',
    endpoint: '5.6.7.8:51820',
    assigned_ip: '10.8.9.9',
    dns: '9.9.9.9',
  });

  it('pins the outer AllowedIPs to <exitIp>/32', () => {
    const { outer } = buildMultihopConfig({ privateKey: 'K', entry, exit });
    expect(outer).toContain('AllowedIPs = 5.6.7.8/32');
    // The outer peer is the ENTRY gateway.
    expect(outer).toContain('PublicKey = ENTRY_PUB');
    expect(outer).toContain('Endpoint = 9.9.9.9:51820');
    expect(outer).toContain('Address = 10.8.0.5/32');
    // Outer carries no DNS.
    expect(outer).not.toContain('DNS =');
  });

  it('routes all traffic on the inner interface', () => {
    const { inner } = buildMultihopConfig({ privateKey: 'K', entry, exit });
    expect(inner).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(inner).toContain('PublicKey = EXIT_PUB');
    expect(inner).toContain('Endpoint = 5.6.7.8:51820');
    expect(inner).toContain('Address = 10.8.9.9/32');
    expect(inner).toContain('DNS = 9.9.9.9');
  });

  it('sets outer MTU 1420 and inner MTU 1340', () => {
    const cfg = buildMultihopConfig({ privateKey: 'K', entry, exit });
    expect(cfg.outer).toContain('MTU = 1420');
    expect(cfg.inner).toContain('MTU = 1340');
    expect(cfg.innerMtu).toBe(1340);
  });

  it('uses the same private key on both interfaces', () => {
    const cfg = buildMultihopConfig({ privateKey: 'SAME_KEY', entry, exit });
    expect(cfg.outer).toContain('PrivateKey = SAME_KEY');
    expect(cfg.inner).toContain('PrivateKey = SAME_KEY');
  });

  it('derives exitEndpoint as <exitIp>:51820 from the exit endpoint', () => {
    const cfg = buildMultihopConfig({ privateKey: 'K', entry, exit });
    expect(cfg.exitEndpoint).toBe('5.6.7.8:51820');
  });
});

describe('selectHops', () => {
  const us1 = gateway({ ip: '1.0.0.1', country: 'US', load: 0.1 });
  const us2 = gateway({ ip: '1.0.0.2', country: 'US', load: 0.5 });
  const de1 = gateway({ ip: '2.0.0.1', country: 'DE', load: 0.3 });

  it('single style returns entry only, no exit', () => {
    const { entry, exit } = selectHops([us1, us2, de1], 'single');
    expect(entry.ip).toBe('1.0.0.1'); // least loaded
    expect(exit).toBeUndefined();
  });

  it('rejects entry == exit (same-country picks a distinct exit)', () => {
    const { entry, exit } = selectHops([us1, us2, de1], 'multihop-same-country');
    expect(entry.country).toBe('US');
    expect(exit).toBeDefined();
    expect(exit?.country).toBe('US');
    expect(exit?.ip).not.toBe(entry.ip);
  });

  it('throws when same-country has no distinct exit', () => {
    expect(() => selectHops([us1, de1], 'multihop-same-country')).toThrow();
  });

  it('enforces cross-country for cross-jurisdiction', () => {
    const { entry, exit } = selectHops([us1, us2, de1], 'multihop-cross-jurisdiction');
    expect(entry.country).toBe('US');
    expect(exit).toBeDefined();
    expect(exit?.country).not.toBe(entry.country);
    expect(exit?.ip).not.toBe(entry.ip);
  });

  it('throws cross-jurisdiction when only one country exists', () => {
    expect(() => selectHops([us1, us2], 'multihop-cross-jurisdiction')).toThrow();
  });

  it('honors explicit entry/exit country picks', () => {
    const { entry, exit } = selectHops([us1, us2, de1], 'multihop-cross-jurisdiction', {
      entryCountry: 'DE',
      exitCountry: 'US',
    });
    expect(entry.country).toBe('DE');
    expect(exit?.country).toBe('US');
  });

  it('throws when the fleet is empty', () => {
    expect(() => selectHops([], 'single')).toThrow();
  });

  it('is deterministic: tie-breaks by load then country', () => {
    const a = gateway({ ip: '9.9.9.9', country: 'US', load: 0.2 });
    const b = gateway({ ip: '1.1.1.1', country: 'CA', load: 0.2 });
    // Equal load -> country tie-break: CA before US.
    const { entry } = selectHops([a, b], 'single');
    expect(entry.country).toBe('CA');
  });
});
