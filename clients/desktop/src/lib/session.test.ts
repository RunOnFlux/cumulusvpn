import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverGateways, enroll } from '@cumulusvpn/core';
import type { EnrollResponse, GatewayInfo, Keypair } from '@cumulusvpn/core';
import type * as CumulusCore from '@cumulusvpn/core';
import { discoverCountries, establish, teardown } from './session';

// Keep everything real except the two network primitives session orchestrates.
vi.mock('@cumulusvpn/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CumulusCore>();
  return { ...actual, discoverGateways: vi.fn(), enroll: vi.fn() };
});

const mockedDiscover = vi.mocked(discoverGateways);
const mockedEnroll = vi.mocked(enroll);

function gateway(overrides: Partial<GatewayInfo>): GatewayInfo {
  return {
    country: 'DE',
    region: 'r',
    city: 'Frankfurt',
    load: 0.5,
    capacity: 100,
    version: '1.0.0',
    min_client_version: '1.0.0',
    server_pubkey: 'srv',
    sign_pubkey: 'sign-de',
    ip: '198.51.100.1',
    controlUrl: 'http://198.51.100.1:51821',
    ...overrides,
  };
}

const keypair: Keypair = { publicKey: 'PUB', privateKey: 'PRIV' };

beforeEach(() => {
  mockedDiscover.mockReset();
  mockedEnroll.mockReset();
});

afterEach(async () => {
  // Stop the browser mock tunnel's byte-counter interval between tests.
  await teardown();
});

describe('discoverCountries', () => {
  it('collapses gateways to one least-loaded row per country, sorted by name', async () => {
    mockedDiscover.mockResolvedValue([
      gateway({ country: 'DE', load: 0.8, ip: '198.51.100.1', city: 'Berlin' }),
      gateway({ country: 'DE', load: 0.2, ip: '198.51.100.2', city: 'Frankfurt' }),
      gateway({
        country: 'NL',
        load: 0.5,
        ip: '198.51.100.3',
        city: 'Amsterdam',
        sign_pubkey: 'sign-nl',
      }),
    ]);

    const options = await discoverCountries();

    expect(options.map((o) => o.code)).toEqual(['DE', 'NL']);
    const de = options[0]!;
    expect(de.name).toBe('Germany');
    expect(de.gatewayIp).toBe('198.51.100.2'); // the least-loaded DE gateway
    expect(de.load).toBe(0.2);
    expect(de.city).toBe('Frankfurt');
    expect(de.signPubKey).toBe('sign-de');
  });

  it('drops 0.0.0.0 placeholder seeds when nothing is reachable', async () => {
    mockedDiscover.mockResolvedValue([]);

    const options = await discoverCountries();

    // The real signed directory ships only placeholder (0.0.0.0) seeds — live
    // discovery resolves the real IPs — so the offline fallback is empty rather
    // than a list of unconnectable gateways (matches the mobile client).
    expect(options).toEqual([]);
  });
});

describe('establish', () => {
  const country = {
    code: 'DE',
    name: 'Germany',
    flag: '🇩🇪',
    gatewayIp: '198.51.100.2',
    city: 'Frankfurt',
    load: 0.2,
    signPubKey: 'sign-de',
  };

  const enrollReply: EnrollResponse = {
    server_pubkey: 'SRVPUB',
    endpoint: '198.51.100.2:51820',
    assigned_ip: '10.8.0.2',
    dns: '10.8.0.1',
    payment_address: 't1addr',
    payment_memo: 'CVPN1:code',
    price_flux: 20,
  };

  it('enrolls the key, pins the gateway sign key, and brings the tunnel up', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);

    const result = await establish(country, keypair, true);

    expect(mockedEnroll).toHaveBeenCalledWith(
      '198.51.100.2',
      'PUB',
      expect.objectContaining({ signPubKey: 'sign-de' }),
    );
    expect(result.gatewayIp).toBe('198.51.100.2');
    expect(result.enroll).toBe(enrollReply);
    expect(result.tunnel.state).toBe('up');
    expect(result.tunnel.assignedIp).toBe('10.8.0.2');
    expect(result.tunnel.country).toBe('DE');
  });
});
