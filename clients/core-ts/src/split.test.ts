import { describe, expect, it } from 'vitest';
import {
  EMPTY_POLICY,
  LAN_BYPASS_CIDRS,
  compileSplitPolicy,
  complementRoutes,
  normalizeSplitRule,
  sanitizeSplitPolicy,
} from './split.js';
import type { CompileSplitContext, SplitPolicy, SplitRule } from './split.js';
import fixtures from './__fixtures__/split-routes.json';

function policy(overrides: Partial<SplitPolicy>): SplitPolicy {
  return { ...EMPTY_POLICY, ...overrides };
}

function ctx(overrides: Partial<CompileSplitContext> = {}): CompileSplitContext {
  return { platform: 'android', supportsExcludeRoute: true, ...overrides };
}

const rule = (
  kind: SplitRule['kind'],
  value: string,
  extra: Partial<SplitRule> = {},
): SplitRule => ({
  kind,
  value,
  enabled: true,
  ...extra,
});

describe('complementRoutes (shared cross-language vectors)', () => {
  for (const vector of fixtures.vectors) {
    it(vector.name, () => {
      expect(
        complementRoutes(vector.excluded, vector.family as 'v4' | 'v6' | 'both'),
      ).toStrictEqual(vector.expected);
    });
  }

  it('matches the Kotlin single-host shape: exactly 32 routes for a /32', () => {
    expect(complementRoutes(['203.0.113.7/32'], 'v4')).toHaveLength(32);
  });

  it('is deterministic across calls', () => {
    const a = complementRoutes(LAN_BYPASS_CIDRS, 'both');
    const b = complementRoutes(LAN_BYPASS_CIDRS, 'both');
    expect(a).toStrictEqual(b);
  });

  it('throws on garbage input rather than silently skipping it', () => {
    expect(() => complementRoutes(['not-a-cidr'], 'v4')).toThrow(/not a valid/);
  });
});

describe('normalizeSplitRule — cidr', () => {
  it('canonicalizes host bits away (the doc example)', () => {
    expect(normalizeSplitRule(rule('cidr', '192.168.1.5/16')).value).toBe('192.168.0.0/16');
  });

  it('treats a bare IP as a host route', () => {
    expect(normalizeSplitRule(rule('cidr', '1.2.3.4')).value).toBe('1.2.3.4/32');
    expect(normalizeSplitRule(rule('cidr', '2001:db8::1')).value).toBe('2001:db8::1/128');
  });

  it('canonicalizes IPv6 to RFC 5952 text', () => {
    expect(normalizeSplitRule(rule('cidr', '2001:0DB8:0000:0000:ffff::/80')).value).toBe(
      '2001:db8:0:0:ffff::/80',
    );
    // Host bits beyond the prefix are masked away, compressing back to `::`.
    expect(normalizeSplitRule(rule('cidr', '2001:0DB8::ffff:0:0:0/64')).value).toBe(
      '2001:db8::/64',
    );
  });

  it('rejects /0 — that is the mode switch, not a rule', () => {
    expect(() => normalizeSplitRule(rule('cidr', '0.0.0.0/0'))).toThrow(/whole internet/);
    expect(() => normalizeSplitRule(rule('cidr', '::/0'))).toThrow(/whole internet/);
  });

  it('rejects a prefix containing an active gateway endpoint', () => {
    expect(() =>
      normalizeSplitRule(rule('cidr', '203.0.113.0/24'), { endpointIps: ['203.0.113.7'] }),
    ).toThrow(/gateway/);
    // Same prefix is fine against an endpoint outside it.
    expect(
      normalizeSplitRule(rule('cidr', '203.0.113.0/24'), { endpointIps: ['198.51.100.1'] }).value,
    ).toBe('203.0.113.0/24');
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['256.1.1.1', '10.0.0', '10.0.0.0/33', '01.2.3.4', 'fe80::/129', 'hello']) {
      expect(() => normalizeSplitRule(rule('cidr', bad)), bad).toThrow(/not a valid/);
    }
  });
});

describe('normalizeSplitRule — domain', () => {
  it('lowercases and strips the trailing dot', () => {
    expect(normalizeSplitRule(rule('domain', 'NetFlix.COM.')).value).toBe('netflix.com');
  });

  it('keeps the wildcard marker and normalizes the suffix', () => {
    expect(normalizeSplitRule(rule('domain', '*.Internal.Corp')).value).toBe('*.internal.corp');
  });

  it('punycode-encodes IDN labels', () => {
    expect(normalizeSplitRule(rule('domain', 'bücher.example')).value).toBe(
      'xn--bcher-kva.example',
    );
    expect(normalizeSplitRule(rule('domain', '日本.jp')).value).toBe('xn--wgv71a.jp');
  });

  it('rejects IP literals — those are cidr rules', () => {
    expect(() => normalizeSplitRule(rule('domain', '10.0.0.1'))).toThrow(/IP rule/);
    expect(() => normalizeSplitRule(rule('domain', '2001:db8::1'))).toThrow(/IP rule/);
  });

  it('rejects bare TLDs and empty/wildcard-only values', () => {
    expect(() => normalizeSplitRule(rule('domain', 'com'))).toThrow(/bare TLD/);
    expect(() => normalizeSplitRule(rule('domain', '*.'))).toThrow(/not a valid/);
    expect(() => normalizeSplitRule(rule('domain', 'a.*.b.com'))).toThrow(/not a valid/);
  });
});

describe('normalizeSplitRule — app', () => {
  it('requires a platform', () => {
    expect(() => normalizeSplitRule(rule('app', 'com.android.chrome'))).toThrow(/platform/);
  });

  it('trims and preserves the identity', () => {
    const r = normalizeSplitRule(rule('app', '  com.android.chrome ', { platform: 'android' }));
    expect(r.value).toBe('com.android.chrome');
    expect(r.platform).toBe('android');
  });

  it('rejects our own identity on any platform', () => {
    expect(() =>
      normalizeSplitRule(rule('app', 'com.cumulusvpn.app', { platform: 'android' })),
    ).toThrow(/CumulusVPN itself/);
    expect(() =>
      normalizeSplitRule(
        rule('app', 'C:\\Program Files\\CumulusVPN\\cumulusvpn.exe', { platform: 'windows' }),
      ),
    ).toThrow(/CumulusVPN itself/);
  });
});

describe('compileSplitPolicy', () => {
  it('mode off without LAN bypass is a noop — the V1 regression gate', () => {
    const compiled = compileSplitPolicy(EMPTY_POLICY, ctx());
    expect(compiled.isNoop).toBe(true);
    expect(compiled.tunnelRoutes).toStrictEqual([]);
    expect(compiled.bypassRoutes).toStrictEqual([]);
  });

  it('mode off + LAN bypass emits the canned set (bypass on capable platforms)', () => {
    const compiled = compileSplitPolicy(policy({ lanBypass: true }), ctx());
    expect(compiled.isNoop).toBe(false);
    // Merged + canonical, so fc00::/7 and ff00::/8 stay as-is but nothing overlaps.
    expect(compiled.bypassRoutes).toContain('10.0.0.0/8');
    expect(compiled.bypassRoutes).toContain('fe80::/10');
    expect(compiled.tunnelRoutes).toStrictEqual([]);
  });

  it('pre-computes the complement when the platform cannot exclude routes', () => {
    const p = policy({ mode: 'exclude', rules: [rule('cidr', '10.0.0.0/8')] });
    const compiled = compileSplitPolicy(p, ctx({ supportsExcludeRoute: false }));
    expect(compiled.bypassRoutes).toStrictEqual([]);
    expect(compiled.tunnelRoutes).toStrictEqual([...complementRoutes(['10.0.0.0/8'], 'both')]);
  });

  it('exclude mode: rule cidrs merge with the LAN set', () => {
    const p = policy({
      mode: 'exclude',
      lanBypass: true,
      rules: [rule('cidr', '10.1.0.0/16')], // contained in LAN's 10/8 — must merge away
    });
    const compiled = compileSplitPolicy(p, ctx());
    expect(compiled.bypassRoutes.filter((r) => r.startsWith('10.'))).toStrictEqual(['10.0.0.0/8']);
  });

  it('filters app rules to the compiling platform and sorts them', () => {
    const p = policy({
      mode: 'exclude',
      rules: [
        rule('app', 'org.mozilla.firefox', { platform: 'android' }),
        rule('app', 'com.android.chrome', { platform: 'android' }),
        rule('app', '/usr/bin/curl', { platform: 'linux' }),
      ],
    });
    const compiled = compileSplitPolicy(p, ctx({ platform: 'android' }));
    expect(compiled.appsExcluded).toStrictEqual(['com.android.chrome', 'org.mozilla.firefox']);
    expect(compileSplitPolicy(p, ctx({ platform: 'linux' })).appsExcluded).toStrictEqual([
      '/usr/bin/curl',
    ]);
  });

  it('reduces domain rules to matchers with the wildcard split out', () => {
    const p = policy({
      mode: 'exclude',
      rules: [rule('domain', '*.internal.corp'), rule('domain', 'netflix.com')],
    });
    const compiled = compileSplitPolicy(p, ctx());
    expect(compiled.domainsExcluded).toStrictEqual([
      { suffix: 'internal.corp', wildcard: true },
      { suffix: 'netflix.com', wildcard: false },
    ]);
  });

  it('include mode: rules become tunnelRoutes; LAN bypass subtracts from them', () => {
    const p = policy({
      mode: 'include',
      lanBypass: true,
      rules: [rule('cidr', '0.0.0.0/1')], // covers 10/8 — LAN must be carved out
    });
    const compiled = compileSplitPolicy(p, ctx());
    expect(compiled.bypassRoutes).toStrictEqual([]);
    expect(compiled.tunnelRoutes).not.toContain('0.0.0.0/1');
    expect(compiled.tunnelRoutes).toContain('0.0.0.0/5'); // 0-7 intact below 10/8
    // Nothing in the output may cover 10.0.0.0.
    expect(compiled.tunnelRoutes.some((r) => r === '10.0.0.0/8')).toBe(false);
  });

  it('ignores disabled rules', () => {
    const p = policy({
      mode: 'exclude',
      rules: [rule('cidr', '10.0.0.0/8', { enabled: false })],
    });
    expect(compileSplitPolicy(p, ctx()).bypassRoutes).toStrictEqual([]);
  });

  it('drops a cidr rule that contains the fresh session endpoint (§7.4 failover)', () => {
    const p = policy({ mode: 'exclude', rules: [rule('cidr', '203.0.113.0/24')] });
    const moved = compileSplitPolicy(p, ctx({ endpointIps: ['203.0.113.7'] }));
    expect(moved.bypassRoutes).toStrictEqual([]); // fails toward the tunnel
    const fine = compileSplitPolicy(p, ctx({ endpointIps: ['198.51.100.1'] }));
    expect(fine.bypassRoutes).toStrictEqual(['203.0.113.0/24']);
  });

  it('is deterministic: same policy + context → identical output', () => {
    const p = policy({
      mode: 'exclude',
      lanBypass: true,
      rules: [rule('cidr', '1.2.3.4'), rule('domain', 'x.example'), rule('cidr', '10.9.0.0/16')],
    });
    expect(compileSplitPolicy(p, ctx())).toStrictEqual(compileSplitPolicy(p, ctx()));
  });
});

describe('sanitizeSplitPolicy — fail closed', () => {
  it('collapses absent/corrupt/foreign shapes to EMPTY_POLICY', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'hi',
      {},
      { version: 2, mode: 'off', rules: [], lanBypass: false, excludedDns: 'tunnel' },
      { version: 1, mode: 'weird', rules: [], lanBypass: false, excludedDns: 'tunnel' },
      { version: 1, mode: 'off', rules: 'nope', lanBypass: false, excludedDns: 'tunnel' },
    ]) {
      expect(sanitizeSplitPolicy(bad)).toStrictEqual(EMPTY_POLICY);
    }
  });

  it('one invalid rule voids the whole policy — never partially applied', () => {
    const p = {
      version: 1,
      mode: 'exclude',
      lanBypass: false,
      excludedDns: 'tunnel',
      rules: [rule('cidr', '10.0.0.0/8'), rule('cidr', 'garbage')],
    };
    expect(sanitizeSplitPolicy(p)).toStrictEqual(EMPTY_POLICY);
  });

  it('round-trips a valid policy through JSON', () => {
    const p = policy({
      mode: 'exclude',
      lanBypass: true,
      excludedDns: 'system',
      rules: [
        rule('cidr', '10.0.0.0/8'),
        rule('domain', 'netflix.com'),
        rule('app', 'com.android.chrome', { platform: 'android', label: 'Chrome' }),
      ],
    });
    expect(sanitizeSplitPolicy(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
  });
});
