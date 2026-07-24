import { describe, expect, it } from 'vitest';
import { applyTransportToEndpoint, selectTransport, transportFallbackChain } from './transport.js';
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
