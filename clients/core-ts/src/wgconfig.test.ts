import { describe, expect, it } from 'vitest';
import { buildWgConfig } from './wgconfig.js';
import { EMPTY_POLICY, compileSplitPolicy } from './split.js';

describe('buildWgConfig', () => {
  it('renders the exact contract .conf', () => {
    const conf = buildWgConfig({
      privateKey: 'CLIENT_PRIV_B64',
      assignedIp: '10.8.0.2',
      dns: '1.1.1.1',
      serverPubKey: 'SERVER_PUB_B64',
      endpoint: '1.2.3.4:51820',
    });
    expect(conf).toBe(
      `[Interface]
PrivateKey = CLIENT_PRIV_B64
Address = 10.8.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = SERVER_PUB_B64
Endpoint = 1.2.3.4:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`,
    );
  });

  it('appends /32 to the assigned address', () => {
    const conf = buildWgConfig({
      privateKey: 'p',
      assignedIp: '10.8.5.9',
      dns: '1.1.1.1',
      serverPubKey: 's',
      endpoint: 'e:51820',
    });
    expect(conf).toContain('Address = 10.8.5.9/32');
  });

  it('emits AmneziaWG [Interface] lines when obfs params are given', () => {
    const conf = buildWgConfig({
      privateKey: 'CLIENT_PRIV_B64',
      assignedIp: '10.8.0.2',
      dns: '1.1.1.1',
      serverPubKey: 'SERVER_PUB_B64',
      endpoint: '1.2.3.4:51821',
      obfs: {
        jc: '4',
        jmin: '40',
        jmax: '70',
        s1: '50',
        s2: '100',
        h1: '1148746654',
        h2: '1148746655',
        h3: '1148746656',
        h4: '1148746657',
      },
    });
    expect(conf).toBe(
      `[Interface]
PrivateKey = CLIENT_PRIV_B64
Address = 10.8.0.2/32
DNS = 1.1.1.1
Jc = 4
Jmin = 40
Jmax = 70
S1 = 50
S2 = 100
H1 = 1148746654
H2 = 1148746655
H3 = 1148746656
H4 = 1148746657

[Peer]
PublicKey = SERVER_PUB_B64
Endpoint = 1.2.3.4:51821
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`,
    );
  });

  it('omits obfs keys that are absent or empty', () => {
    const conf = buildWgConfig({
      privateKey: 'p',
      assignedIp: '10.8.0.2',
      dns: '1.1.1.1',
      serverPubKey: 's',
      endpoint: 'e:51821',
      obfs: { jc: '4', jmin: '', h1: '9' },
    });
    expect(conf).toContain('Jc = 4');
    expect(conf).toContain('H1 = 9');
    expect(conf).not.toContain('Jmin');
    expect(conf).not.toContain('S1');
  });

  const BASE = {
    privateKey: 'p',
    assignedIp: '10.8.0.2',
    dns: '1.1.1.1',
    serverPubKey: 's',
    endpoint: '1.2.3.4:51820',
  };
  const CONF_CTX = { platform: 'linux', supportsExcludeRoute: false } as const;

  it('a noop split keeps the config byte-identical (V1 regression gate)', () => {
    const noop = compileSplitPolicy(EMPTY_POLICY, CONF_CTX);
    expect(buildWgConfig({ ...BASE, split: noop })).toBe(buildWgConfig(BASE));
  });

  it('an exclude-mode split replaces AllowedIPs with the complement', () => {
    const split = compileSplitPolicy(
      {
        ...EMPTY_POLICY,
        mode: 'exclude',
        rules: [{ kind: 'cidr', value: '10.0.0.0/8', enabled: true }],
      },
      CONF_CTX,
    );
    const conf = buildWgConfig({ ...BASE, split });
    expect(conf).not.toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(conf).toContain('AllowedIPs = 0.0.0.0/5, 8.0.0.0/7, 11.0.0.0/8,');
    expect(conf).toContain('::/0'); // v6 stays fully tunneled
  });

  it('an include-mode split emits exactly the listed prefixes', () => {
    const split = compileSplitPolicy(
      {
        ...EMPTY_POLICY,
        mode: 'include',
        rules: [{ kind: 'cidr', value: '198.51.100.0/24', enabled: true }],
      },
      CONF_CTX,
    );
    expect(buildWgConfig({ ...BASE, split })).toContain('AllowedIPs = 198.51.100.0/24\n');
  });

  it('emits Android app keys only for the compiling platform', () => {
    const policy = {
      ...EMPTY_POLICY,
      mode: 'exclude' as const,
      rules: [{ kind: 'app' as const, value: 'com.android.chrome', platform: 'android' as const }],
    };
    const android = compileSplitPolicy(policy, {
      platform: 'android',
      supportsExcludeRoute: false,
    });
    expect(buildWgConfig({ ...BASE, split: android })).toContain(
      'ExcludedApplications = com.android.chrome',
    );
    // Same policy compiled for another platform: the app rule is filtered out
    // (app identity is not portable), so the config stays clean for wg-quick.
    const linux = compileSplitPolicy(policy, CONF_CTX);
    expect(buildWgConfig({ ...BASE, split: linux })).not.toContain('Applications');
  });

  it('an active split with no routes falls back to the full tunnel', () => {
    const split = compileSplitPolicy({ ...EMPTY_POLICY, mode: 'include' }, CONF_CTX);
    expect(split.isNoop).toBe(false);
    expect(buildWgConfig({ ...BASE, split })).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
  });
});
