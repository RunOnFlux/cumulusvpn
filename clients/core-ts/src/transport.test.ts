import { describe, expect, it } from 'vitest';
import {
  applyTransportToEndpoint,
  obfsForTransport,
  requireTransport,
  selectTransport,
  transportFallbackChain,
} from './transport.js';
import { WG_PORT } from './types.js';
import type { Transport } from './types.js';

const wg: Transport = { type: 'wg', port: 51820 };
const awg: Transport = { type: 'awg', port: 51821 };
const tls: Transport = { type: 'wg-tls', port: 51820 };
const ALL = new Set(['wg', 'awg', 'wg-tls']);

describe('transportFallbackChain / selectTransport', () => {
  it('auto picks vanilla wg when the gateway advertises it', () => {
    expect(selectTransport([wg], 'auto')?.type).toBe('wg');
  });

  it('treats a 0.1.0 gateway (no transports field) as vanilla wg on WG_PORT', () => {
    const t = selectTransport(undefined, 'auto');
    expect(t?.type).toBe('wg');
    expect(t?.port).toBe(WG_PORT);
    // same for an explicitly empty array
    expect(selectTransport([], 'auto')?.port).toBe(WG_PORT);
  });

  it('stealth against a vanilla-only gateway yields nothing (never downgrades to plain wg)', () => {
    expect(transportFallbackChain([wg], 'stealth', ALL)).toHaveLength(0);
    expect(selectTransport([wg], 'stealth', ALL)).toBeNull();
    // and a 0.1.0 gateway is vanilla-only, so stealth is empty there too
    expect(selectTransport(undefined, 'stealth', ALL)).toBeNull();
  });

  it('auto orders fastest-first regardless of advertised order', () => {
    const chain = transportFallbackChain([tls, awg, wg], 'auto', ALL).map((t) => t.type);
    expect(chain).toEqual(['wg', 'awg', 'wg-tls']);
  });

  it('stealth prefers wg-tls over awg and excludes wg', () => {
    const chain = transportFallbackChain([wg, awg, tls], 'stealth', ALL).map((t) => t.type);
    expect(chain).toEqual(['wg-tls', 'awg']);
  });

  it('drops transports this client does not implement', () => {
    // default IMPLEMENTED = {'wg'}: an advertised awg is ignored even in speed mode
    expect(transportFallbackChain([wg, awg], 'speed').map((t) => t.type)).toEqual(['wg']);
  });

  it('drops unknown/unmodelled transport types', () => {
    const weird = { type: 'quux', port: 9 } as Transport;
    expect(transportFallbackChain([weird, wg], 'auto', ALL).map((t) => t.type)).toEqual(['wg']);
  });

  it('drops transports with an invalid port (0, out-of-range, non-integer)', () => {
    const badAwg = [
      { type: 'awg', port: 0 },
      { type: 'awg', port: 99999 },
      { type: 'awg', port: -1 },
      { type: 'awg', port: 51821.5 },
    ] as Transport[];
    for (const t of badAwg) {
      // a bogus awg port is dropped → stealth finds nothing usable here
      expect(transportFallbackChain([wg, t], 'stealth', ALL).map((x) => x.type)).toEqual([]);
    }
    // a valid awg port is kept
    expect(transportFallbackChain([wg, awg], 'stealth', ALL).map((x) => x.type)).toEqual(['awg']);
  });
});

describe('requireTransport (never silently downgrades)', () => {
  it('auto resolves to vanilla wg against any normal gateway', () => {
    expect(requireTransport([wg], 'auto').type).toBe('wg');
    expect(requireTransport(undefined, 'auto').type).toBe('wg'); // 0.1.0 gateway
  });

  it('stealth returns the obfuscated transport the gateway offers (prefers wg-tls, else awg)', () => {
    expect(requireTransport([wg, awg, tls], 'stealth', ALL).type).toBe('wg-tls');
    expect(requireTransport([wg, awg], 'stealth', ALL).type).toBe('awg');
  });

  it('stealth THROWS against a vanilla-only gateway instead of falling back to plain wg', () => {
    expect(() => requireTransport([wg], 'stealth', ALL)).toThrow(/Stealth/);
    // a 0.1.0 gateway is vanilla-only → also throws, never a silent downgrade
    expect(() => requireTransport(undefined, 'stealth', ALL)).toThrow(/Stealth/);
  });

  it('stealth picks awg when the client does not implement wg-tls (mobile/desktop today)', () => {
    const AWG_ONLY = new Set(['wg', 'awg']);
    expect(requireTransport([wg, awg], 'stealth', AWG_ONLY).type).toBe('awg');
    // vanilla-only gateway still throws under the awg-capable client
    expect(() => requireTransport([wg], 'stealth', AWG_ONLY)).toThrow(/Stealth/);
  });

  it('throws for a non-auto mode when the gateway offers nothing compatible', () => {
    const weird = { type: 'quux', port: 9 } as Transport;
    expect(() => requireTransport([weird], 'speed')).toThrow();
  });
});

describe('premium-gated transports (params.tier)', () => {
  // The 443 stealth tier: the gateway advertises it to everyone but keeps free
  // keys out of the listener's peer set, so the client must skip it rather than
  // complete TLS and then fail an opaque inner handshake.
  const premiumTls: Transport = {
    type: 'wg-tls',
    port: 443,
    params: { tier: 'premium', sni: 'cdn.example.net' },
  };

  it('drops a premium transport for a free user, keeps it for a premium user', () => {
    expect(transportFallbackChain([premiumTls], 'stealth', ALL, 'free')).toHaveLength(0);
    expect(
      transportFallbackChain([premiumTls], 'stealth', ALL, 'premium').map((t) => t.type),
    ).toEqual(['wg-tls']);
  });

  it('degrades a free Stealth user to the ungated awg instead of failing', () => {
    // The whole point of gating in the client: Stealth still works, just weaker.
    expect(requireTransport([premiumTls, awg], 'stealth', ALL, 'free').type).toBe('awg');
    // A premium user gets the preferred wg-tls.
    expect(requireTransport([premiumTls, awg], 'stealth', ALL, 'premium').type).toBe('wg-tls');
  });

  it('never turns Auto into an error — a free user falls to vanilla wg', () => {
    expect(requireTransport([wg, premiumTls], 'auto', ALL, 'free').type).toBe('wg');
  });

  it('throws an UPGRADE message when the only fit is premium-gated', () => {
    // "Pick another location" is wrong advice when every location gates it.
    expect(() => requireTransport([premiumTls], 'stealth', ALL, 'free')).toThrow(/Premium-only/);
    // ...but a genuinely empty offering keeps the location-specific message.
    expect(() => requireTransport([wg], 'stealth', ALL, 'free')).toThrow(/Pick another location/);
  });

  it('defaults to free (fail-closed) when the caller supplies no tier', () => {
    expect(selectTransport([premiumTls, awg], 'stealth', ALL)).toEqual(awg);
  });

  it('never gates a legacy (0.1.0) gateway, which advertises nothing', () => {
    expect(requireTransport(undefined, 'auto', ALL, 'free').type).toBe('wg');
  });

  it('fails OPEN on an unknown gate value so old clients survive a future tier', () => {
    const future: Transport = { type: 'awg', port: 51821, params: { tier: 'enterprise' } };
    expect(selectTransport([future], 'stealth', ALL, 'free')).toEqual(future);
  });
});

describe('obfsForTransport', () => {
  it('returns the params for an awg transport', () => {
    expect(obfsForTransport({ type: 'awg', port: 51821, params: { jc: '4' } })).toEqual({
      jc: '4',
    });
  });

  it('returns undefined for wg and wg-tls (no [Interface] obfuscation)', () => {
    expect(obfsForTransport({ type: 'wg', port: 51820 })).toBeUndefined();
    expect(obfsForTransport({ type: 'wg-tls', port: 443, params: { sni: 'x' } })).toBeUndefined();
  });
});

describe('applyTransportToEndpoint', () => {
  it('rewrites the port on an ip:port endpoint', () => {
    expect(applyTransportToEndpoint('1.2.3.4:51820', { type: 'wg-tls', port: 443 })).toBe(
      '1.2.3.4:443',
    );
  });

  it('adds a port to a bare host', () => {
    expect(applyTransportToEndpoint('1.2.3.4', { type: 'wg', port: 51820 })).toBe('1.2.3.4:51820');
  });

  it('keeps a bracketed IPv6 host and swaps its port', () => {
    expect(applyTransportToEndpoint('[2001:db8::1]:51820', { type: 'wg-tls', port: 443 })).toBe(
      '[2001:db8::1]:443',
    );
  });

  it('is a no-op for the vanilla transport (same port)', () => {
    expect(applyTransportToEndpoint('9.9.9.9:51820', { type: 'wg', port: 51820 })).toBe(
      '9.9.9.9:51820',
    );
  });
});

describe('fallback chain safety (the invariant a retry loop must respect)', () => {
  it('stealth chain never contains plain wg, however the gateway orders things', () => {
    // A fallback loop walks this list. If `wg` could ever appear in it, a
    // Stealth user whose obfuscated transports all failed would be silently
    // downgraded to fingerprintable WireGuard — the exact outcome Stealth exists
    // to prevent. Pinning it here means the loop cannot regress into that.
    const gw: Transport[] = [wg, tls, awg];
    const chain = transportFallbackChain(gw, 'stealth', ALL).map((t) => t.type);
    expect(chain).toEqual(['wg-tls', 'awg']);
    expect(chain).not.toContain('wg');
  });

  it('auto walks fastest-first, so a blocked vanilla falls through to obfuscation', () => {
    expect(transportFallbackChain([tls, wg, awg], 'auto', ALL).map((t) => t.type)).toEqual([
      'wg',
      'awg',
      'wg-tls',
    ]);
  });

  it("a premium-gated transport is absent from a free user's chain, so it is never attempted", () => {
    const premium: Transport = { type: 'wg-tls', port: 443, params: { tier: 'premium' } };
    expect(
      transportFallbackChain([premium, awg], 'stealth', ALL, 'free').map((t) => t.type),
    ).toEqual(['awg']);
    expect(
      transportFallbackChain([premium, awg], 'stealth', ALL, 'premium').map((t) => t.type),
    ).toEqual(['wg-tls', 'awg']);
  });
});
