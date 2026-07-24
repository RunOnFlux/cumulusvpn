import { describe, expect, it } from 'vitest';
import { buildWgConfig } from './wgconfig.js';

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
});
