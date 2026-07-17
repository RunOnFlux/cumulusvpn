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
});
