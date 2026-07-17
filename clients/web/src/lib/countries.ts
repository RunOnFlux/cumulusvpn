/**
 * Country helpers that turn a Flux app-spec name (`cumulusde`) into the display
 * data the country picker needs. Names come from the platform `Intl` catalogue
 * and flags are derived from the ISO code, so only the primary city is a table.
 */

// Spec names are `cumulus<cc>` where `<cc>` is a lowercase ISO-3166-1 alpha-2.
export function specToCountryCode(spec: string): string {
  return spec.replace(/^cumulus/, '').toUpperCase();
}

/** Regional-indicator flag emoji for a 2-letter country code, e.g. `DE` → 🇩🇪. */
export function flagOf(cc: string): string {
  const code = cc.trim().toUpperCase();
  if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) {
    return '🏳️';
  }
  const base = 0x1f1e6;
  const a = base + (code.charCodeAt(0) - 65);
  const b = base + (code.charCodeAt(1) - 65);
  return String.fromCodePoint(a, b);
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** English country name for a code, e.g. `DE` → `Germany`; falls back to the code. */
export function nameOf(cc: string): string {
  try {
    return regionNames.of(cc.toUpperCase()) ?? cc.toUpperCase();
  } catch {
    return cc.toUpperCase();
  }
}

// Primary datacenter city per launch country (from deploy/countries.yaml).
// POC: cosmetic; the live gateway's own `/v1/info` city wins when discovered.
const CITY: Record<string, string> = {
  US: 'Multiple cities',
  CA: 'Toronto',
  DE: 'Frankfurt',
  NL: 'Amsterdam',
  FR: 'Paris',
  GB: 'London',
  CZ: 'Prague',
  PL: 'Warsaw',
  SG: 'Singapore',
  JP: 'Tokyo',
  AU: 'Sydney',
  BR: 'São Paulo',
  ES: 'Madrid',
  IT: 'Milan',
  SE: 'Stockholm',
  CH: 'Zürich',
  AT: 'Vienna',
  FI: 'Helsinki',
  MX: 'Mexico City',
  KR: 'Seoul',
  IN: 'Mumbai',
  ZA: 'Johannesburg',
};

export function cityOf(cc: string): string {
  return CITY[cc.toUpperCase()] ?? '';
}
