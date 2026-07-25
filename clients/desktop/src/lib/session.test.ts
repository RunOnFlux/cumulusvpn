import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { discoverGateways, enroll } from '@cumulusvpn/core';
import type { EnrollResponse, GatewayInfo, Keypair } from '@cumulusvpn/core';
import type * as CumulusCore from '@cumulusvpn/core';
import { discoverCountries, establish, establishMultihop, teardown } from './session';
import type { CountryOption } from './session';

// Keep everything real except the two network primitives session orchestrates.
vi.mock('@cumulusvpn/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CumulusCore>();
  return { ...actual, discoverGateways: vi.fn(), enroll: vi.fn() };
});

// Exercise the production (in-Tauri) path: isTauri()=true so establish uses the
// real (mocked) enroll rather than the browser demo fallback, and invoke echoes
// a connected status back from the "native" side.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (_cmd: string, args: Record<string, unknown>) => ({
    state: 'up',
    country: (args?.country as string) ?? null,
    endpoint: (args?.endpoint as string) ?? null,
    assignedIp: (args?.assignedIp as string) ?? null,
    rxBytes: 0,
    txBytes: 0,
    lastHandshake: null,
    error: null,
  })),
}));

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

  it('wg-tls (Stealth): bridges over TLS — passes the relay addr + SNI to native connect', async () => {
    mockedEnroll.mockResolvedValue(enrollReply); // endpoint 198.51.100.2:51820
    vi.mocked(invoke).mockClear();
    const tlsCountry = {
      ...country,
      transports: [{ type: 'wg-tls' as const, port: 8443, params: { sni: 'cdn.example.net' } }],
    };

    await establish(tlsCountry, keypair, true, 'stealth');

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    expect(call, 'connect was invoked').toBeDefined();
    // endpoint host comes from the enroll reply, port from the wg-tls transport.
    expect(call?.[1]).toMatchObject({
      endpoint: '198.51.100.2:8443',
      tlsServerAddr: '198.51.100.2:8443',
      tlsSni: 'cdn.example.net',
    });
    // wg-tls carries no [Interface] obfs — the config must be vanilla-shaped.
    expect(String((call?.[1] as { wgConfig: string }).wgConfig)).not.toContain('Jc =');
  });
});

describe('establishMultihop', () => {
  const enrollReply: EnrollResponse = {
    server_pubkey: 'SRVPUB',
    endpoint: '198.51.100.9:51820',
    assigned_ip: '10.8.0.2',
    dns: '10.8.0.1',
    payment_address: 't1addr',
    payment_memo: 'CVPN1:code',
    price_flux: 20,
  };
  const deEntry: CountryOption = {
    code: 'DE',
    name: 'Germany',
    flag: '🇩🇪',
    gatewayIp: '198.51.100.2',
    city: 'Frankfurt',
    load: 0.2,
    signPubKey: 'sign-de',
  };
  const nlExit: CountryOption = {
    code: 'NL',
    name: 'Netherlands',
    flag: '🇳🇱',
    gatewayIp: '198.51.100.3',
    city: 'Amsterdam',
    load: 0.5,
    signPubKey: 'sign-nl',
  };

  it('same-country ("Balanced") picks two distinct in-country gateways from the fleet', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    // Two DE gateways in the fleet; the exit PICK is a different country on
    // purpose — same-country must ignore it and still find a second DE hop
    // rather than throwing (the pre-fix bug, where the collapsed one-per-country
    // list made this structurally impossible).
    const fleet = [
      gateway({ country: 'DE', ip: '198.51.100.1', load: 0.5, sign_pubkey: 'sign-de-a' }),
      gateway({ country: 'DE', ip: '198.51.100.2', load: 0.2, sign_pubkey: 'sign-de-b' }),
    ];

    const result = await establishMultihop(
      fleet,
      deEntry,
      nlExit,
      'multihop-same-country',
      keypair,
      true,
    );

    const enrolledIps = mockedEnroll.mock.calls.map((c) => c[0]).sort();
    expect(enrolledIps).toEqual(['198.51.100.1', '198.51.100.2']);
    expect(result.tunnel.state).toBe('up');
  });

  it('Stealth: obfuscates the ENTRY hop with awg when the entry gateway advertises it', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    const awg = { type: 'awg' as const, port: 51821, params: { jc: '4', h1: '1148746654' } };
    const fleet = [
      gateway({ country: 'DE', ip: '198.51.100.1', load: 0.5, transports: [awg] }),
      gateway({ country: 'DE', ip: '198.51.100.2', load: 0.2, transports: [awg] }),
    ];

    const result = await establishMultihop(
      fleet,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      true,
      'stealth',
    );
    expect(result.tunnel.state).toBe('up');

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect_multihop');
    const args = call?.[1] as { outer: string; inner: string; entryEndpoint: string };
    expect(args.outer).toContain('Jc = 4'); // entry hop obfuscated
    expect(args.entryEndpoint).toMatch(/:51821$/); // dials the awg port
    expect(args.inner).not.toContain('Jc = '); // exit hop stays vanilla
  });

  it('Stealth: refuses (throws) when the entry gateway offers no awg — never downgrades', async () => {
    mockedEnroll.mockClear();
    const fleet = [
      gateway({ country: 'DE', ip: '198.51.100.1', load: 0.5 }), // no transports → no awg
      gateway({ country: 'DE', ip: '198.51.100.2', load: 0.2 }),
    ];

    await expect(
      establishMultihop(fleet, deEntry, deEntry, 'multihop-same-country', keypair, true, 'stealth'),
    ).rejects.toThrow(/Stealth/);
    expect(mockedEnroll).not.toHaveBeenCalled(); // the refusal precedes enrollment
  });
});
