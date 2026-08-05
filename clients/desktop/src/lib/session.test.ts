import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { discoverGateways, enroll, status } from '@cumulusvpn/core';
import type { EnrollResponse, GatewayInfo, Keypair } from '@cumulusvpn/core';
import type * as CumulusCore from '@cumulusvpn/core';
import { discoverCountries, establish, establishMultihop, teardown } from './session';
import type { CountryOption } from './session';

// Keep everything real except the two network primitives session orchestrates.
vi.mock('@cumulusvpn/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CumulusCore>();
  // `status` is mocked too: establish() consults the gateway being dialled for
  // its authoritative tier whenever that gateway advertises a premium-gated
  // transport, and an unmocked call would hit the network.
  return { ...actual, discoverGateways: vi.fn(), enroll: vi.fn(), status: vi.fn() };
});

// Drives the native side's handshake reporting. `establish` probes `status`
// after each `connect` to decide whether that transport actually came up, so the
// mock has to model that: `failAttempts` makes the first N attempts report a
// dead tunnel (state 'down' — the native side gave up, which the probe treats as
// an immediate failure), after which handshakes land.
const nativeState = vi.hoisted(() => ({
  failAttempts: 0,
  connects: 0,
  // The real native manager remembers the active session, so `status` echoes it
  // back; the mock must too, or the probed status looks empty.
  session: {
    country: null as string | null,
    endpoint: null as string | null,
    assignedIp: null as string | null,
  },
}));

// Exercise the production (in-Tauri) path: isTauri()=true so establish uses the
// real (mocked) enroll rather than the browser demo fallback, and invoke echoes
// a connected status back from the "native" side.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'connect' || cmd === 'connect_multihop') {
      nativeState.connects += 1;
      nativeState.session = {
        country: (args?.country as string) ?? (args?.exitCountry as string) ?? null,
        endpoint: (args?.endpoint as string) ?? (args?.entryEndpoint as string) ?? null,
        assignedIp: (args?.assignedIp as string) ?? null,
      };
    }
    const dead = nativeState.connects <= nativeState.failAttempts;
    return {
      state: cmd === 'status' && dead ? 'down' : 'up',
      country: (args?.country as string) ?? nativeState.session.country,
      endpoint: (args?.endpoint as string) ?? nativeState.session.endpoint,
      assignedIp: (args?.assignedIp as string) ?? nativeState.session.assignedIp,
      rxBytes: 0,
      txBytes: 0,
      // A real handshake time is what proves the transport works.
      lastHandshake: dead ? null : 1_700_000_000,
      error: null,
    };
  }),
}));

const mockedDiscover = vi.mocked(discoverGateways);
const mockedEnroll = vi.mocked(enroll);
const mockedStatus = vi.mocked(status);

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
  mockedStatus.mockReset();
  nativeState.failAttempts = 0;
  nativeState.connects = 0;
  nativeState.session = { country: null, endpoint: null, assignedIp: null };
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

  it('premium-gated wg-tls: a FREE user degrades to awg instead of a doomed handshake', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    // The 443 stealth tier the gateway reserves for paying users, alongside the
    // ungated awg it also advertises.
    const gatedCountry = {
      ...country,
      transports: [
        { type: 'wg-tls' as const, port: 443, params: { tier: 'premium', sni: 'x' } },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };

    // The gateway that ENFORCES the gate is the authority on the tier.
    mockedStatus.mockResolvedValue({ tier: 'free', paid_until: '', bytes_used: 0 });

    await establish(gatedCountry, keypair, true, 'stealth', 'free');

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    const args = call?.[1] as { endpoint: string; wgConfig: string; tlsServerAddr: string | null };
    expect(args.endpoint).toMatch(/:51821$/); // dialled awg, not the 443 relay
    expect(args.tlsServerAddr).toBeNull(); // no TLS bridge for a free user
    expect(args.wgConfig).toContain('Jc = 4'); // still obfuscated — Stealth holds
  });

  it('premium-gated wg-tls: the DIALLED gateway is authoritative, overriding a stale cached tier', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    const gatedCountry = {
      ...country,
      transports: [
        { type: 'wg-tls' as const, port: 443, params: { tier: 'premium', sni: 'x' } },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };
    // A user who just paid: the cached fleet-wide tier still says 'free' (cold
    // launch / a node that hasn't caught up), but the gateway we're dialling has
    // seen the payment. Trusting the stale cache would silently sell them the
    // weaker transport; trusting a stale 'premium' would hang the handshake.
    mockedStatus.mockResolvedValue({ tier: 'premium', paid_until: '', bytes_used: 0 });

    await establish(gatedCountry, keypair, true, 'stealth', 'free');

    expect(mockedStatus).toHaveBeenCalledWith(
      '198.51.100.2', // asked the gateway being dialled, not some other node
      'PUB',
      expect.objectContaining({ signPubKey: 'sign-de' }),
    );
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    expect(call?.[1]).toMatchObject({ endpoint: '198.51.100.2:443', tlsSni: 'x' });
  });

  it('premium-gated wg-tls: a failed tier probe falls back to the cached value, never hangs', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    const gatedCountry = {
      ...country,
      transports: [
        { type: 'wg-tls' as const, port: 443, params: { tier: 'premium', sni: 'x' } },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };
    mockedStatus.mockRejectedValue(new Error('gateway unreachable'));

    await establish(gatedCountry, keypair, true, 'stealth', 'free');

    // Conservative: a weaker-but-working transport beats a dead one.
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    expect((call?.[1] as { endpoint: string }).endpoint).toMatch(/:51821$/);
  });

  it('falls back to the next transport when the first never handshakes — one enrollment', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    nativeState.failAttempts = 1; // the first transport comes up but never handshakes
    const both = {
      ...country,
      transports: [
        { type: 'wg' as const, port: 51820 },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };

    const result = await establish(both, keypair, true, 'auto');

    const connects = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'connect');
    expect(connects).toHaveLength(2);
    // Auto is fastest-first, so vanilla is tried before the obfuscated transport.
    expect((connects[0]?.[1] as { endpoint: string }).endpoint).toMatch(/:51820$/);
    expect((connects[1]?.[1] as { endpoint: string }).endpoint).toMatch(/:51821$/);
    // Enrollment is transport-agnostic and rate-limited to 1/IP/2s — re-enrolling
    // per attempt would trip that limit mid-fallback.
    expect(mockedEnroll).toHaveBeenCalledTimes(1);
    // The caller learns which transport actually worked.
    expect(result.transport.type).toBe('awg');
  });

  it('a Disconnect mid-sweep CANCELS it — never re-connects what the user cancelled', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    nativeState.failAttempts = 99; // nothing handshakes, so the sweep would keep going
    const both = {
      ...country,
      transports: [
        { type: 'wg' as const, port: 51820 },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };
    // The user hits Disconnect during the first attempt (onAttempt fires as that
    // attempt begins, so the abort lands while it is being probed).
    const ac = new AbortController();
    const onAttempt = (_t: unknown, i: number) => {
      if (i === 0) {
        ac.abort();
      }
    };

    await expect(
      establish(both, keypair, true, 'auto', 'free', undefined, onAttempt as never, ac.signal),
    ).rejects.toThrow(/cancelled/);

    // Exactly ONE connect: the loop must not start another tunnel (which would
    // silently re-engage the kill switch the user's Disconnect just removed).
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'connect')).toHaveLength(1);
  });

  it('gives up cleanly when every transport fails, and tears the tunnel down', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    nativeState.failAttempts = 99; // nothing ever handshakes
    const both = {
      ...country,
      transports: [
        { type: 'wg' as const, port: 51820 },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };

    await expect(establish(both, keypair, true, 'auto')).rejects.toThrow(/wg → awg/);

    // connect() leaves the manager looking Up with the kill switch engaged and a
    // default route on a dead interface — without this teardown the machine is
    // left with no working internet.
    expect(vi.mocked(invoke).mock.calls.some((c) => c[0] === 'disconnect')).toBe(true);
  });

  it('Stealth fallback NEVER walks outside the mode — no silent downgrade to plain wg', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    nativeState.failAttempts = 99;
    const gw = {
      ...country,
      transports: [
        { type: 'wg' as const, port: 51820 },
        { type: 'wg-tls' as const, port: 443, params: { sni: 'x' } },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };

    await expect(establish(gw, keypair, true, 'stealth')).rejects.toThrow();

    // Even with every stealth transport failing and vanilla available and
    // working, the loop must never dial :51820 — that is the invariant the whole
    // Stealth mode exists to protect.
    const dialled = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === 'connect')
      .map((c) => (c[1] as { endpoint: string }).endpoint);
    expect(dialled).toEqual(['198.51.100.2:443', '198.51.100.2:51821']);
    expect(dialled.some((e) => e.endsWith(':51820'))).toBe(false);
  });

  it('does NOT probe the gateway when nothing it advertises is gated', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    mockedStatus.mockClear();
    const ungated = {
      ...country,
      transports: [{ type: 'awg' as const, port: 51821, params: { jc: '4' } }],
    };

    await establish(ungated, keypair, true, 'stealth', 'free');

    // The extra round-trip is only paid on the rare gated path.
    expect(mockedStatus).not.toHaveBeenCalled();
  });

  it('premium-gated wg-tls: a PREMIUM user gets the 443 TLS tier', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    vi.mocked(invoke).mockClear();
    const gatedCountry = {
      ...country,
      transports: [
        { type: 'wg-tls' as const, port: 443, params: { tier: 'premium', sni: 'x' } },
        { type: 'awg' as const, port: 51821, params: { jc: '4' } },
      ],
    };

    mockedStatus.mockResolvedValue({ tier: 'premium', paid_until: '', bytes_used: 0 });

    await establish(gatedCountry, keypair, true, 'stealth', 'premium');

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    expect(call?.[1]).toMatchObject({ endpoint: '198.51.100.2:443', tlsSni: 'x' });
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
