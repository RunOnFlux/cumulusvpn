import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  buildMultihopInnerConfig,
  buildMultihopOuterConfig,
  buildWgConfig,
  discoverGateways,
  enroll,
  status,
} from '@cumulusvpn/core';
import type { EnrollResponse, GatewayInfo, Keypair } from '@cumulusvpn/core';
import type * as CumulusCore from '@cumulusvpn/core';
import {
  KeyedGateways,
  discoverCountries,
  discoverFleetAndCountries,
  establish,
  establishMultihop,
  fetchEntitlement,
  teardown,
} from './session';
import type { CountryOption } from './session';
import { saveDnsChoice } from './storage';

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
    if (cmd === 'connect' || cmd === 'connect_multihop_exit') {
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

  it('reports the fleet so far as each gateway verifies', async () => {
    const a = gateway({ country: 'DE', load: 0.8, ip: '198.51.100.1' });
    const b = gateway({ country: 'DE', load: 0.2, ip: '198.51.100.2' });
    mockedDiscover.mockImplementation(async (_specs, opts) => {
      opts?.onGateway?.(a);
      opts?.onGateway?.(b);
      return [a, b];
    });
    const progress: string[] = [];

    const result = await discoverFleetAndCountries(undefined, (d) =>
      progress.push(`${d.fleet.length}:${d.countries.map((c) => c.gatewayIp).join(',')}`),
    );

    // The second report moves DE to the less-loaded gateway that just arrived.
    expect(progress).toEqual(['1:198.51.100.1', '2:198.51.100.2']);
    expect(result.countries.map((c) => c.gatewayIp)).toEqual(['198.51.100.2']);
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

    const result = await establish(country, keypair, new KeyedGateways(), true);

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

  it('solves the enroll proof-of-work natively, from a random start', async () => {
    mockedEnroll.mockResolvedValue(enrollReply);
    await establish(country, keypair, new KeyedGateways(), true);
    const opts = mockedEnroll.mock.calls[0]?.[2];
    const solver = opts?.powSolver;
    expect(solver).toBeDefined();

    vi.mocked(invoke).mockResolvedValueOnce({ nonce: '987654', hashes: 1234 });
    await expect(solver?.('PUB', 20)).resolves.toBe('987654');
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'solve_pow');
    expect(call?.[1]).toMatchObject({ publicKey: 'PUB', bits: 20 });
    const start = (call?.[1] as { start: number }).start;
    expect(Number.isInteger(start) && start >= 0 && start < 0x40000000).toBe(true);
  });

  it('wg-tls (Stealth): bridges over TLS — passes the relay addr + SNI to native connect', async () => {
    mockedEnroll.mockResolvedValue(enrollReply); // endpoint 198.51.100.2:51820
    vi.mocked(invoke).mockClear();
    const tlsCountry = {
      ...country,
      transports: [{ type: 'wg-tls' as const, port: 8443, params: { sni: 'cdn.example.net' } }],
    };

    await establish(tlsCountry, keypair, new KeyedGateways(), true, 'stealth');

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

    await establish(gatedCountry, keypair, new KeyedGateways(), true, 'stealth', 'free');

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

    await establish(gatedCountry, keypair, new KeyedGateways(), true, 'stealth', 'free');

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

    await establish(gatedCountry, keypair, new KeyedGateways(), true, 'stealth', 'free');

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

    const result = await establish(both, keypair, new KeyedGateways(), true, 'auto');

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
      establish(
        both,
        keypair,
        new KeyedGateways(),
        true,
        'auto',
        'free',
        undefined,
        onAttempt as never,
        ac.signal,
      ),
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

    await expect(establish(both, keypair, new KeyedGateways(), true, 'auto')).rejects.toThrow(
      /wg → awg/,
    );

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

    await expect(establish(gw, keypair, new KeyedGateways(), true, 'stealth')).rejects.toThrow();

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

    await establish(ungated, keypair, new KeyedGateways(), true, 'stealth', 'free');

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

    await establish(gatedCountry, keypair, new KeyedGateways(), true, 'stealth', 'premium');

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    expect(call?.[1]).toMatchObject({ endpoint: '198.51.100.2:443', tlsSni: 'x' });
  });
});

describe('establishMultihop', () => {
  /** A gateway's reply; each gateway assigns `assigned` (distinct by default). */
  const replyFrom = (ip: string, assigned = `10.8.0.${ip.split('.').at(-1)}`): EnrollResponse => ({
    server_pubkey: 'SRVPUB',
    endpoint: `${ip}:51820`,
    assigned_ip: assigned,
    dns: '10.8.0.1',
    payment_address: 't1addr',
    payment_memo: 'CVPN1:code',
    price_flux: 20,
  });
  const distinctReplies = async (ip: string): Promise<EnrollResponse> => replyFrom(ip);
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

  /** The invoke calls for `cmd`, in order. */
  const invoked = (cmd: string): Record<string, unknown>[] =>
    vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === cmd)
      .map((c) => c[1] as Record<string, unknown>);
  /** When `cmd` was first invoked, on vitest's cross-mock call clock. */
  const firstInvoked = (cmd: string): number => {
    const i = vi.mocked(invoke).mock.calls.findIndex((c) => c[0] === cmd);
    return vi.mocked(invoke).mock.invocationCallOrder[i] ?? Number.NaN;
  };
  const twoDe = [
    gateway({ country: 'DE', ip: '198.51.100.1', load: 0.5, sign_pubkey: 'sign-de-a' }),
    gateway({ country: 'DE', ip: '198.51.100.2', load: 0.2, sign_pubkey: 'sign-de-b' }),
  ];

  beforeEach(() => {
    mockedEnroll.mockClear();
    vi.mocked(invoke).mockClear();
  });

  it('same-country ("Balanced") picks two distinct in-country gateways from the fleet', async () => {
    mockedEnroll.mockImplementation(distinctReplies);
    // The exit PICK is a different country on purpose — same-country must
    // ignore it and still find a second DE hop.
    const result = await establishMultihop(
      twoDe,
      deEntry,
      nlExit,
      'multihop-same-country',
      keypair,
      new KeyedGateways(),
      true,
    );

    const enrolledIps = mockedEnroll.mock.calls.map((c) => c[0]).sort();
    expect(enrolledIps).toEqual(['198.51.100.1', '198.51.100.2']);
    expect(result.tunnel.state).toBe('up');
  });

  it('enrolls at the exit only after the entry hop routes the exit through it', async () => {
    mockedEnroll.mockImplementation(distinctReplies);

    const result = await establishMultihop(
      twoDe,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      new KeyedGateways(),
      true,
    );

    const [entryCall, exitCall] = mockedEnroll.mock.calls;
    expect(entryCall?.[0]).toBe(result.entryGatewayIp);
    expect(exitCall?.[0]).toBe(result.exitGatewayIp);
    const exitEnrolledAt = mockedEnroll.mock.invocationCallOrder[1] ?? Number.NaN;
    expect(firstInvoked('connect_multihop_entry')).toBeLessThan(exitEnrolledAt);
    expect(exitEnrolledAt).toBeLessThan(firstInvoked('connect_multihop_exit'));
    // The entry step pins exactly the exit that is then enrolled and dialled.
    const [entryStep] = invoked('connect_multihop_entry');
    const [exitStep] = invoked('connect_multihop_exit');
    expect(entryStep?.exitEndpoint).toBe(`${result.exitGatewayIp}:51820`);
    expect(exitStep?.exitEndpoint).toBe(entryStep?.exitEndpoint);
    expect(exitStep?.entryEndpoint).toBe(entryStep?.entryEndpoint);
  });

  it('the exit never sees the client key: a session key enrolls and runs the exit hop', async () => {
    mockedEnroll.mockImplementation(distinctReplies);

    const result = await establishMultihop(
      twoDe,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      new KeyedGateways(),
      true,
    );

    const [entryCall, exitCall] = mockedEnroll.mock.calls;
    expect(entryCall?.[1]).toBe('PUB');
    expect(exitCall?.[1]).not.toBe('PUB');
    expect(exitCall?.[1]).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    const [entryStep] = invoked('connect_multihop_entry');
    const [exitStep] = invoked('connect_multihop_exit');
    expect(entryStep?.outer).toContain('PrivateKey = PRIV\n');
    expect(exitStep?.inner).not.toContain('PRIV');
    // Entitlement is asked of the entry, the hop that knows the client key.
    expect(result.entrySignPubKey).toBe('sign-de-b');

    // A second session gets a key of its own.
    mockedEnroll.mockClear();
    await establishMultihop(
      twoDe,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      new KeyedGateways(),
      true,
    );
    expect(mockedEnroll.mock.calls[1]?.[1]).not.toBe(exitCall?.[1]);
  });

  it('Stealth: obfuscates the ENTRY hop with awg when the entry gateway advertises it', async () => {
    mockedEnroll.mockImplementation(distinctReplies);
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
      new KeyedGateways(),
      true,
      'stealth',
    );
    expect(result.tunnel.state).toBe('up');

    const [entryStep] = invoked('connect_multihop_entry');
    const [exitStep] = invoked('connect_multihop_exit');
    expect(entryStep?.outer).toContain('Jc = 4'); // entry hop obfuscated
    expect(entryStep?.entryEndpoint).toMatch(/:51821$/); // dials the awg port
    expect(exitStep?.entryEndpoint).toMatch(/:51821$/);
    expect(exitStep?.inner).not.toContain('Jc = '); // exit hop stays vanilla
  });

  it('Stealth: refuses (throws) when the entry gateway offers no awg — never downgrades', async () => {
    const fleet = [
      gateway({ country: 'DE', ip: '198.51.100.1', load: 0.5 }), // no transports → no awg
      gateway({ country: 'DE', ip: '198.51.100.2', load: 0.2 }),
    ];

    await expect(
      establishMultihop(
        fleet,
        deEntry,
        deEntry,
        'multihop-same-country',
        keypair,
        new KeyedGateways(),
        true,
        'stealth',
      ),
    ).rejects.toThrow(/Stealth/);
    expect(mockedEnroll).not.toHaveBeenCalled(); // the refusal precedes enrollment
    expect(invoked('connect_multihop_entry')).toHaveLength(0);
  });

  it('a pair that assigned the same address at both gateways is replaced by the next pair', async () => {
    // Entry .2 and exit .1 both assign 10.8.0.8 (a shared pool on two gateways);
    // .3 assigns a different address, so .2 -> .3 is the route.
    mockedEnroll.mockImplementation(async (ip: string) =>
      replyFrom(ip, ip === '198.51.100.3' ? '10.8.0.9' : '10.8.0.8'),
    );
    const fleet = [...twoDe, gateway({ country: 'DE', ip: '198.51.100.3', load: 0.7 })];

    const result = await establishMultihop(
      fleet,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      new KeyedGateways(),
      true,
    );

    expect([result.entryGatewayIp, result.exitGatewayIp]).toEqual(['198.51.100.2', '198.51.100.3']);
    expect([result.entryEnroll.assigned_ip, result.exitEnroll.assigned_ip]).toEqual([
      '10.8.0.8',
      '10.8.0.9',
    ]);
    // Each gateway enrolled once; the entry's reply is reused for the next pair.
    expect(mockedEnroll.mock.calls.map((c) => c[0])).toEqual([
      '198.51.100.2',
      '198.51.100.1',
      '198.51.100.3',
    ]);
    // The entry step re-pins for the new exit; the exit step runs once.
    expect(invoked('connect_multihop_entry').map((a) => a.exitEndpoint)).toEqual([
      '198.51.100.1:51820',
      '198.51.100.3:51820',
    ]);
    expect(invoked('connect_multihop_exit')).toHaveLength(1);
  });

  it('fails clearly, and tears the entry hop down, when no usable pair is left', async () => {
    mockedEnroll.mockImplementation(async (ip: string) => replyFrom(ip, '10.8.0.8'));

    // .2 -> .1 collides; the reverse pair would make .2, which has seen the
    // client key as the entry, the exit — so nothing is left.
    await expect(
      establishMultihop(
        twoDe,
        deEntry,
        deEntry,
        'multihop-same-country',
        keypair,
        new KeyedGateways(),
        true,
      ),
    ).rejects.toThrow(
      /198\.51\.100\.2 -> 198\.51\.100\.1 assigned the same tunnel address .* that has not seen the client key/,
    );
    expect(invoked('connect_multihop_exit')).toHaveLength(0);
    expect(invoked('disconnect')).toHaveLength(1);
  });

  it('never picks as the exit a gateway that has seen the client key this run', async () => {
    mockedEnroll.mockImplementation(distinctReplies);
    const fleet = [...twoDe, gateway({ country: 'DE', ip: '198.51.100.3', load: 0.7 })];
    // .1 would be the exit for entry .2, but the client key went to it earlier
    // (an entitlement check, a single-hop session).
    const keyed = new KeyedGateways();
    keyed.add('198.51.100.1');

    const result = await establishMultihop(
      fleet,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      keyed,
      true,
    );

    expect([result.entryGatewayIp, result.exitGatewayIp]).toEqual(['198.51.100.2', '198.51.100.3']);
    expect(mockedEnroll.mock.calls.map((c) => c[0])).not.toContain('198.51.100.1');
    // The entry is recorded: it has now seen the key too.
    expect(keyed.list()).toEqual(['198.51.100.1', '198.51.100.2']);
  });

  it('a gateway the key went to may still be the entry', async () => {
    mockedEnroll.mockImplementation(distinctReplies);
    const keyed = new KeyedGateways();
    keyed.add('198.51.100.2');

    const result = await establishMultihop(
      twoDe,
      deEntry,
      deEntry,
      'multihop-same-country',
      keypair,
      keyed,
      true,
    );

    expect([result.entryGatewayIp, result.exitGatewayIp]).toEqual(['198.51.100.2', '198.51.100.1']);
  });

  it('records every gateway the client key is sent to: single-hop enroll and entitlement', async () => {
    const keyed = new KeyedGateways();
    mockedEnroll.mockResolvedValue(replyFrom('198.51.100.2'));
    await establish(deEntry, keypair, keyed, true);
    mockedStatus.mockResolvedValue({ tier: 'free', paid_until: null, bytes_used: 0 } as never);
    await fetchEntitlement('198.51.100.7', 'PUB', 'sign', keyed);
    expect(keyed.list()).toEqual(['198.51.100.2', '198.51.100.7']);
  });

  it('refuses an exit that names a WireGuard endpoint other than the routed one', async () => {
    mockedEnroll.mockImplementation(async (ip: string) =>
      ip === '198.51.100.1' ? { ...replyFrom(ip), endpoint: '203.0.113.99:51820' } : replyFrom(ip),
    );

    await expect(
      establishMultihop(
        twoDe,
        deEntry,
        deEntry,
        'multihop-same-country',
        keypair,
        new KeyedGateways(),
        true,
      ),
    ).rejects.toThrow(/different WireGuard endpoint \(203\.0\.113\.99:51820\)/);
    expect(invoked('connect_multihop_exit')).toHaveLength(0);
    expect(invoked('disconnect')).toHaveLength(1);
  });

  it('tears the entry hop down when the exit enroll fails', async () => {
    mockedEnroll.mockImplementation(async (ip: string) => {
      if (ip === '198.51.100.1') {
        throw new Error('rate_limited');
      }
      return replyFrom(ip);
    });

    await expect(
      establishMultihop(
        twoDe,
        deEntry,
        deEntry,
        'multihop-same-country',
        keypair,
        new KeyedGateways(),
        true,
      ),
    ).rejects.toThrow('rate_limited');
    expect(invoked('connect_multihop_entry')).toHaveLength(1);
    expect(invoked('connect_multihop_exit')).toHaveLength(0);
    expect(invoked('disconnect')).toHaveLength(1);
  });
});

describe('DNS choice (Settings → DNS)', () => {
  // The fleet's real enroll reply: every gateway advertises 1.1.1.1.
  const reply = (endpoint: string): EnrollResponse => ({
    server_pubkey: 'SRVPUB',
    endpoint,
    assigned_ip: '10.8.0.2',
    dns: '1.1.1.1',
    payment_address: 't1addr',
    payment_memo: 'CVPN1:code',
    price_flux: 20,
  });
  const de: CountryOption = {
    code: 'DE',
    name: 'Germany',
    flag: '🇩🇪',
    gatewayIp: '198.51.100.2',
    city: 'Frankfurt',
    load: 0.2,
    signPubKey: 'sign-de',
  };
  const fleet = [
    gateway({ country: 'DE', ip: '198.51.100.1', load: 0.5 }),
    gateway({ country: 'DE', ip: '198.51.100.2', load: 0.2 }),
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockClear();
  });

  async function singleHopConfig(): Promise<string> {
    mockedEnroll.mockResolvedValue(reply('198.51.100.2:51820'));
    await establish(de, keypair, new KeyedGateways(), true);
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect');
    return (call?.[1] as { wgConfig: string }).wgConfig;
  }

  /** A multi-hop gateway's reply: each gateway assigns its own address. */
  const hopReply = (ip: string): EnrollResponse => ({
    ...reply(`${ip}:51820`),
    assigned_ip: `10.8.0.${ip.split('.').at(-1)}`,
  });

  async function multihopConfigs(): Promise<{ outer: string; inner: string }> {
    mockedEnroll.mockClear();
    mockedEnroll.mockImplementation(async (ip: string) => hopReply(ip));
    await establishMultihop(
      fleet,
      de,
      de,
      'multihop-same-country',
      keypair,
      new KeyedGateways(),
      true,
    );
    const entryCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect_multihop_entry');
    const exitCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'connect_multihop_exit');
    return {
      outer: (entryCall?.[1] as { outer: string }).outer,
      inner: (exitCall?.[1] as { inner: string }).inner,
    };
  }

  /** Entry then exit, in the order establishMultihop enrolled them. */
  function enrolledHops(): [EnrollResponse, EnrollResponse] {
    const [entryIp = '', exitIp = ''] = mockedEnroll.mock.calls.map((c) => c[0]);
    return [hopReply(entryIp), hopReply(exitIp)];
  }

  it('single-hop default is byte-identical to the config before the setting existed', async () => {
    const conf = await singleHopConfig();
    expect(conf).toBe(
      buildWgConfig({
        privateKey: 'PRIV',
        assignedIp: '10.8.0.2',
        dns: '1.1.1.1',
        serverPubKey: 'SRVPUB',
        endpoint: '198.51.100.2:51820',
      }),
    );
    expect(conf).toContain('\nDNS = 1.1.1.1\n');
  });

  it('single-hop: a non-default choice names that provider’s resolvers, and only that changes', async () => {
    const before = await singleHopConfig();
    vi.mocked(invoke).mockClear();
    saveDnsChoice('quad9');

    const conf = await singleHopConfig();

    expect(conf).toContain('\nDNS = 9.9.9.9, 149.112.112.112\n');
    expect(conf.replace('DNS = 9.9.9.9, 149.112.112.112', 'DNS = 1.1.1.1')).toBe(before);
  });

  it('a corrupt stored value connects with the default, never fails', async () => {
    localStorage.setItem('cvpn.dns.v1', 'opendns');
    expect(await singleHopConfig()).toContain('\nDNS = 1.1.1.1\n');
  });

  it('multi-hop default: the exit’s advertised DNS, on the inner (exit) hop only', async () => {
    const { outer, inner } = await multihopConfigs();
    const [entry, exit] = enrolledHops();
    // The exit hop's key is the session's own; read it back to compare the rest.
    const exitKey = /PrivateKey = (\S+)/.exec(inner)?.[1] ?? '';
    expect(inner).toBe(buildMultihopInnerConfig({ privateKey: exitKey, exit }).inner);
    expect(outer).toBe(
      buildMultihopOuterConfig({ privateKey: 'PRIV', entry, exitIp: '198.51.100.1' }).outer,
    );
    expect(inner).toContain('\nDNS = 1.1.1.1\n');
    expect(outer).not.toContain('DNS =');
  });

  it('multi-hop: a non-default choice sets the inner hop’s resolvers', async () => {
    saveDnsChoice('adguard');

    const { outer, inner } = await multihopConfigs();

    expect(inner).toContain('\nDNS = 94.140.14.14, 94.140.15.15\n');
    expect(inner).not.toContain('1.1.1.1');
    expect(outer).not.toContain('DNS =');
  });
});
