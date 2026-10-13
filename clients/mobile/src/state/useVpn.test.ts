/**
 * Unit tests for the pure pieces of `useVpn`.
 *
 * `isMultihop` is the single branch that decides whether `connect()` takes the
 * single-hop (Fast) path or the two-hop onion path, so it is worth pinning, as
 * are the two config builders `connect()` hands to the native tunnel — where
 * the user's DNS choice lands. The native tunnel bridge is mocked out:
 * importing `useVpn` would otherwise construct a `NativeEventEmitter` at module
 * load, which has no place in a pure logic test.
 */
import { buildWgConfig } from '@cumulusvpn/core';
import type { EnrollResponse, RouteStyle, Transport } from '@cumulusvpn/core';

jest.mock('../native/CumulusTunnel', () => ({
  CumulusTunnel: {},
  onTunnelStatus: () => ({ remove: () => undefined }),
}));

import { isMultihop, isTunnelDead, multihopConfigs, singleHopConfig } from './useVpn';

describe('isMultihop', () => {
  it('is false only for the default single-hop style', () => {
    expect(isMultihop('single')).toBe(false);
  });

  it('is true for every multi-hop style', () => {
    const multihopStyles: readonly RouteStyle[] = [
      'multihop-same-country',
      'multihop-cross-jurisdiction',
    ];
    for (const style of multihopStyles) {
      expect(isMultihop(style)).toBe(true);
    }
  });
});

describe('isTunnelDead — the roam backstop', () => {
  const now = (): number => Math.floor(Date.now() / 1000);

  it('is false for a healthy tunnel across the whole rekey sawtooth', () => {
    // A live tunnel's handshake age cycles 0..~120s (REKEY_AFTER_TIME), because
    // keepalives count as sends. Every point on that curve must read healthy or
    // the backstop would tear down working tunnels every two minutes.
    for (const age of [0, 1, 30, 90, 119, 120, 150, 199]) {
      expect(isTunnelDead({ state: 'connected', lastHandshake: now() - age })).toBe(false);
    }
  });

  it('is true once the session is past WireGuard’s reject window', () => {
    expect(isTunnelDead({ state: 'connected', lastHandshake: now() - 201 })).toBe(true);
    expect(isTunnelDead({ state: 'connected', lastHandshake: now() - 3600 })).toBe(true);
  });

  it('ignores a tunnel that has never handshaked', () => {
    // Nothing has come up yet; the connect watchdog owns this window, and
    // treating 0 as "ancient" would kill every tunnel the moment it started.
    expect(isTunnelDead({ state: 'connected', lastHandshake: 0 })).toBe(false);
  });

  it('only applies while connected', () => {
    for (const state of ['disconnected', 'connecting', 'disconnecting', 'error']) {
      expect(isTunnelDead({ state, lastHandshake: now() - 3600 })).toBe(false);
    }
  });
});

/** An enrollment as a gateway returns it (`dns` is what the fleet advertises). */
function enrollment(ip: string, assigned: string, dns = '1.1.1.1'): EnrollResponse {
  return {
    server_pubkey: `srv-${ip}`,
    endpoint: `${ip}:51820`,
    assigned_ip: assigned,
    dns,
    payment_address: 't1pay',
    payment_memo: 'CVPN1:abc',
    price_flux: 12,
  };
}

/** The `DNS =` line of a rendered `.conf`, or null when it has none. */
function dnsLine(conf: string): string | null {
  return conf.split('\n').find((l) => l.startsWith('DNS = ')) ?? null;
}

const WG: Transport = { type: 'wg', port: 51820 };
const AWG: Transport = { type: 'awg', port: 51821, params: { jc: '4', jmin: '40', jmax: '70' } };
const WG_TLS: Transport = { type: 'wg-tls', port: 443 };

describe('singleHopConfig — DNS choice', () => {
  const resp = enrollment('203.0.113.7', '10.8.0.2');

  it('keeps the gateway’s own dns, byte-identical to before, for the default', () => {
    const conf = singleHopConfig({
      privateKey: 'priv',
      enrollment: resp,
      transport: WG,
      dnsChoice: 'cloudflare',
      gatewayIp: '203.0.113.7',
    });
    expect(conf).toBe(
      buildWgConfig({
        privateKey: 'priv',
        assignedIp: '10.8.0.2',
        dns: '1.1.1.1',
        serverPubKey: 'srv-203.0.113.7',
        endpoint: '203.0.113.7:51820',
      }),
    );
  });

  it('lists every server of a non-default choice', () => {
    const conf = singleHopConfig({
      privateKey: 'priv',
      enrollment: resp,
      transport: WG,
      dnsChoice: 'quad9',
      gatewayIp: '203.0.113.7',
    });
    expect(dnsLine(conf)).toBe('DNS = 9.9.9.9, 149.112.112.112');
  });

  it('applies the choice on every transport in the fallback chain', () => {
    for (const transport of [WG, AWG, WG_TLS]) {
      const conf = singleHopConfig({
        privateKey: 'priv',
        enrollment: resp,
        transport,
        dnsChoice: 'family',
        gatewayIp: '203.0.113.7',
      });
      expect(dnsLine(conf)).toBe('DNS = 1.1.1.3, 1.0.0.3');
      expect(conf).toContain(`Endpoint = 203.0.113.7:${transport.port}`);
    }
  });

  it('still carries the transport’s own lines alongside the choice', () => {
    const awg = singleHopConfig({
      privateKey: 'priv',
      enrollment: resp,
      transport: AWG,
      dnsChoice: 'adguard',
      gatewayIp: '203.0.113.7',
    });
    expect(awg).toContain('Jc = 4');
    const tls = singleHopConfig({
      privateKey: 'priv',
      enrollment: resp,
      transport: WG_TLS,
      dnsChoice: 'adguard',
      gatewayIp: '203.0.113.7',
    });
    expect(tls).toContain('CVPN_TLS_SNI = 203.0.113.7');
    expect(dnsLine(tls)).toBe('DNS = 94.140.14.14, 94.140.15.15');
  });
});

describe('multihopConfigs — DNS choice', () => {
  // Distinct dns per hop, so the tests can tell which one the route uses.
  const entry = enrollment('198.51.100.1', '10.8.0.5', '1.0.0.1');
  const exit = enrollment('203.0.113.9', '10.9.0.7', '1.1.1.1');

  it('uses the EXIT’s advertised dns for the default', () => {
    const mh = multihopConfigs({ privateKey: 'priv', entry, exit, dnsChoice: 'cloudflare' });
    expect(dnsLine(mh.inner)).toBe('DNS = 1.1.1.1');
  });

  it('puts a non-default choice on the inner hop, and none on the outer', () => {
    const mh = multihopConfigs({ privateKey: 'priv', entry, exit, dnsChoice: 'adguard' });
    expect(dnsLine(mh.inner)).toBe('DNS = 94.140.14.14, 94.140.15.15');
    expect(dnsLine(mh.outer)).toBeNull();
  });

  it('keeps the choice with an obfuscated (Stealth) entry', () => {
    const mh = multihopConfigs({
      privateKey: 'priv',
      entry,
      exit,
      dnsChoice: 'quad9',
      entryTransport: AWG,
    });
    expect(dnsLine(mh.inner)).toBe('DNS = 9.9.9.9, 149.112.112.112');
    expect(mh.outer).toContain('Jc = 4');
  });
});
