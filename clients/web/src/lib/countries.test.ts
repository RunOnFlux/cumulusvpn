import { describe, expect, it } from 'vitest';
import { cityOf, flagOf, nameOf, specToCountryCode } from './countries';

describe('specToCountryCode', () => {
  it('strips the cumulus prefix and upper-cases the ISO code', () => {
    expect(specToCountryCode('cumulusvpnde')).toBe('DE');
    expect(specToCountryCode('cumulusvpnus')).toBe('US');
  });

  it('upper-cases even when the prefix is absent', () => {
    expect(specToCountryCode('gb')).toBe('GB');
  });
});

describe('flagOf', () => {
  it('maps a 2-letter code to its regional-indicator flag', () => {
    expect(flagOf('DE')).toBe('🇩🇪');
    expect(flagOf('us')).toBe('🇺🇸');
  });

  it('returns a neutral flag for invalid codes', () => {
    expect(flagOf('USA')).toBe('🏳️');
    expect(flagOf('1')).toBe('🏳️');
    expect(flagOf('D3')).toBe('🏳️');
  });
});

describe('nameOf', () => {
  it('resolves an English country name', () => {
    expect(nameOf('DE', 'en')).toBe('Germany');
    expect(nameOf('jp', 'en')).toBe('Japan');
  });

  it('falls back to the upper-cased code when the input is malformed', () => {
    // A non-well-formed region subtag makes Intl.DisplayNames throw; nameOf
    // catches that and returns the code itself.
    expect(nameOf('z1', 'en')).toBe('Z1');
  });

  it('localizes names via Intl.DisplayNames', () => {
    expect(nameOf('DE', 'de')).toBe('Deutschland');
    expect(nameOf('DE', 'fr')).toBe('Allemagne');
    expect(nameOf('DE', 'ja')).toBe('ドイツ');
  });
});

describe('cityOf', () => {
  it('returns the primary datacenter city for a known country', () => {
    expect(cityOf('DE')).toBe('Frankfurt');
    expect(cityOf('nl')).toBe('Amsterdam');
  });

  it('returns an empty string for a country without a mapped city', () => {
    expect(cityOf('ZZ')).toBe('');
  });
});
