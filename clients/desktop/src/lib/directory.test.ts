import { describe, expect, it } from 'vitest';
import {
  BUNDLED_DIRECTORY,
  CVPN_DIRECTORY_PUBKEY,
  UPGRADE_URL,
  bundledDirectoryIsValid,
  countryMeta,
} from './directory';

describe('countryMeta', () => {
  it('resolves display metadata for known countries', () => {
    expect(countryMeta('DE')).toEqual({ code: 'DE', name: 'Germany', flag: '🇩🇪' });
    expect(countryMeta('US')).toEqual({ code: 'US', name: 'United States', flag: '🇺🇸' });
  });

  it('maps both UK and GB to the United Kingdom', () => {
    expect(countryMeta('UK').name).toBe('United Kingdom');
    expect(countryMeta('GB').name).toBe('United Kingdom');
  });

  it('falls back to the raw code with a neutral flag for unknown countries', () => {
    expect(countryMeta('ZZ')).toEqual({ code: 'ZZ', name: 'ZZ', flag: '🏳️' });
  });
});

describe('BUNDLED_DIRECTORY', () => {
  it('carries the seed gateways used for the offline cold-start fallback', () => {
    expect(BUNDLED_DIRECTORY.version).toBe(1);
    expect(BUNDLED_DIRECTORY.seed_gateways.length).toBeGreaterThan(0);
    for (const seed of BUNDLED_DIRECTORY.seed_gateways) {
      expect(seed.ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(seed.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('lists a spec per fleet country', () => {
    expect(BUNDLED_DIRECTORY.specs).toContain('cumulusvpnde');
    expect(BUNDLED_DIRECTORY.specs.every((s) => s.startsWith('cumulus'))).toBe(true);
  });

  it('is the real signed snapshot that verifies against the pinned key', () => {
    // Guards against shipping a directory whose signature does not match the
    // pinned CVPN_DIRECTORY_PUBKEY (the whole trust chain hangs off this).
    expect(CVPN_DIRECTORY_PUBKEY).not.toBe('');
    expect(bundledDirectoryIsValid()).toBe(true);
  });
});

describe('UPGRADE_URL', () => {
  it('points at the public https upgrade page', () => {
    expect(UPGRADE_URL).toMatch(/^https:\/\//);
  });
});
