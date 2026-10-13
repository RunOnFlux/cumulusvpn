import { beforeEach, describe, expect, it } from 'vitest';
import { loadDnsChoice, saveDnsChoice } from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('DNS choice', () => {
  it('defaults to Cloudflare, what every gateway advertises', () => {
    expect(loadDnsChoice()).toBe('cloudflare');
  });

  it('persists every option across reads', () => {
    for (const choice of ['quad9', 'adguard', 'family', 'cloudflare'] as const) {
      saveDnsChoice(choice);
      expect(loadDnsChoice()).toBe(choice);
    }
    expect(localStorage.getItem('cvpn.dns.v1')).toBe('cloudflare');
  });

  it('reads a corrupt or unknown value as the default, so it can never block a connect', () => {
    for (const bad of ['opendns', '', 'QUAD9', '"quad9"', '{"id":"quad9"}', 'null']) {
      localStorage.setItem('cvpn.dns.v1', bad);
      expect(loadDnsChoice(), bad).toBe('cloudflare');
    }
  });
});
