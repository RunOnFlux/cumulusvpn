import { beforeEach, describe, expect, it } from 'vitest';
import type { Transport } from '@cumulusvpn/core';
import { preferTransport, rememberTransport } from './session';
import { loadTransportPref, saveTransportPref, TRANSPORT_PREF_MAX_AGE_MS } from './storage';

const WG: Transport = { type: 'wg', port: 51820 };
const AWG: Transport = { type: 'awg', port: 51821 };
const TLS: Transport = { type: 'wg-tls', port: 443 };
const IP = '198.51.100.7';

beforeEach(() => {
  localStorage.clear();
});

describe('preferTransport', () => {
  it('moves the remembered transport to the front, keeping the rest in order', () => {
    expect(preferTransport([WG, AWG, TLS], 'wg-tls').map((t) => t.type)).toEqual([
      'wg-tls',
      'wg',
      'awg',
    ]);
  });

  it('never adds a transport the chain does not have (Stealth stays Stealth)', () => {
    expect(preferTransport([AWG, TLS], 'wg')).toEqual([AWG, TLS]);
  });

  it('leaves the chain alone with nothing remembered', () => {
    const chain = [WG, AWG];
    expect(preferTransport(chain, null)).toBe(chain);
  });
});

describe('rememberTransport', () => {
  it('remembers a fallback that got through', () => {
    rememberTransport(IP, WG, [WG, AWG], AWG);
    expect(loadTransportPref(IP)).toBe('awg');
  });

  it('forgets it once the usual first choice works again', () => {
    saveTransportPref(IP, 'awg');
    rememberTransport(IP, WG, [WG, AWG], WG);
    expect(loadTransportPref(IP)).toBeNull();
  });

  it('does not refresh it when the remembered one works, so it can expire', () => {
    saveTransportPref(IP, 'awg', 1_000);
    rememberTransport(IP, WG, [AWG, WG], AWG);
    expect(loadTransportPref(IP, 1_000 + TRANSPORT_PREF_MAX_AGE_MS + 1)).toBeNull();
  });
});

describe('transport preference storage', () => {
  it('expires after its maximum age', () => {
    saveTransportPref(IP, 'awg', 0);
    expect(loadTransportPref(IP, TRANSPORT_PREF_MAX_AGE_MS)).toBe('awg');
    expect(loadTransportPref(IP, TRANSPORT_PREF_MAX_AGE_MS + 1)).toBeNull();
  });

  it('reads a corrupt value as nothing remembered', () => {
    localStorage.setItem('cvpn.transportPref.v1', '{not json');
    expect(loadTransportPref(IP)).toBeNull();
    saveTransportPref(IP, 'awg');
    expect(loadTransportPref(IP)).toBe('awg');
  });
});
