import { describe, expect, it, vi } from 'vitest';
import { loadDnsChoice, saveDnsChoice } from './dnsChoice';

const KEY = 'cvpn.dns.v1';

describe('DNS choice storage', () => {
  it('defaults to Cloudflare when nothing is stored', () => {
    expect(loadDnsChoice()).toBe('cloudflare');
  });

  it('round-trips a choice as its plain id', () => {
    saveDnsChoice('quad9');
    expect(localStorage.getItem(KEY)).toBe('quad9');
    expect(loadDnsChoice()).toBe('quad9');
  });

  // Corrupt storage, or an option only a newer build knows, must never block
  // generating a config — it falls back to the default.
  it('falls back to the default on an unknown value', () => {
    localStorage.setItem(KEY, '{"oops":1}');
    expect(loadDnsChoice()).toBe('cloudflare');
    localStorage.setItem(KEY, 'nextdns');
    expect(loadDnsChoice()).toBe('cloudflare');
  });

  // Mullvad's public DNS shuts down by 2026-11-02; the web offered it on
  // 2026-10-16, so a browser that saved it moves to Quad9.
  it('moves a saved Mullvad choice to Quad9', () => {
    localStorage.setItem(KEY, 'mullvad');
    expect(loadDnsChoice()).toBe('quad9');
  });

  it('survives storage that throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadDnsChoice()).toBe('cloudflare');
    expect(() => saveDnsChoice('adguard')).not.toThrow();
  });
});
