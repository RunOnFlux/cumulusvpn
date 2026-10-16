import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DEFAULT_DNS, DNS_OPTIONS, dnsOption, dnsServersFor, parseDnsChoice } from './dns.js';

describe('DNS choice', () => {
  it('keeps the gateway-advertised resolver for the default', () => {
    expect(dnsServersFor('cloudflare', '1.1.1.1')).toBe('1.1.1.1');
    // Whatever the gateway advertises wins for the default, not a hard-coded value.
    expect(dnsServersFor(DEFAULT_DNS, '1.0.0.1')).toBe('1.0.0.1');
  });

  it("lists the chosen provider's addresses otherwise", () => {
    expect(dnsServersFor('quad9', '1.1.1.1')).toBe('9.9.9.9, 149.112.112.112');
    expect(dnsServersFor('adguard', '1.1.1.1')).toBe('94.140.14.14, 94.140.15.15');
    expect(dnsServersFor('family', '1.1.1.1')).toBe('1.1.1.3, 1.0.0.3');
    expect(dnsServersFor('google', '1.1.1.1')).toBe('8.8.8.8, 8.8.4.4');
    expect(dnsServersFor('dns4eu', '1.1.1.1')).toBe('86.54.11.1, 86.54.11.201');
  });

  it('falls back to the default for anything it does not know', () => {
    for (const bad of [undefined, null, '', 'opendns', 42, {}, 'QUAD9']) {
      expect(parseDnsChoice(bad)).toBe(DEFAULT_DNS);
    }
    for (const o of DNS_OPTIONS) expect(parseDnsChoice(o.id)).toBe(o.id);
  });

  it('moves a withdrawn choice to its replacement', () => {
    // Mullvad's public DNS shuts down by 2026-11-02; mobile 1.3.1 offered it.
    expect(parseDnsChoice('mullvad')).toBe('quad9');
    expect(DNS_OPTIONS.some((o) => (o.id as string) === 'mullvad')).toBe(false);
    expect(parseDnsChoice('toString')).toBe(DEFAULT_DNS);
  });

  it('lists the default first, with unique ids and addresses', () => {
    expect(DNS_OPTIONS[0]?.id).toBe(DEFAULT_DNS);
    expect(new Set(DNS_OPTIONS.map((o) => o.id)).size).toBe(DNS_OPTIONS.length);
    const all = DNS_OPTIONS.flatMap((o) => o.servers);
    expect(new Set(all).size).toBe(all.length);
    expect(dnsOption('quad9').provider).toBe('Quad9');
  });

  // Every address an app can put in `DNS =` must be one the gateway encrypts;
  // one missing from its provider table would silently go out as plain DNS.
  it("offers only addresses the gateway's DNS proxy encrypts", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const providers = readFileSync(
      join(here, '../../../gateway/internal/dnsproxy/providers.go'),
      'utf8',
    );
    for (const o of DNS_OPTIONS) {
      for (const ip of o.servers) {
        expect(providers, `${o.id} ${ip}`).toContain(`"${ip}"`);
      }
    }
  });
});
