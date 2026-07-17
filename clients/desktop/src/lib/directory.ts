/**
 * Bundled signed `directory.json` snapshot + the directory Ed25519 pubkey the
 * client ships and pins. Cold-start / all-unreachable fallback per
 * `docs/10-api-contract.md` (order: disk cache → live discovery → this
 * snapshot). Every path is signature-checked via `core.directoryVerify`.
 *
 * // POC: these are placeholder seed endpoints + an unset pinned key. A real
 * release regenerates this file from cumulusvpn.com and the Tauri updater ships
 * a fresh snapshot with every binary. `verifyDirectory()` is wired but the
 * bundled `sig` here is a placeholder, so we treat an unset pin as "trust on
 * first probe" during the POC.
 */
import type { Directory } from '@cumulusvpn/core';

/** Base64 Ed25519 directory public key clients pin. // POC: unset placeholder. */
export const CVPN_DIRECTORY_PUBKEY = '';

/** Last-known fleet snapshot baked into the release. */
export const BUNDLED_DIRECTORY: Directory = {
  version: 1,
  updated: '2026-07-01T00:00:00Z',
  payment_address: 't1PLACEHOLDERpaymentAddressREPLACEatRelease0',
  price_flux: 4.5,
  specs: ['cumulusde', 'cumulusus', 'cumulusnl', 'cumulussg', 'cumulusuk'],
  seed_gateways: [
    { ip: '203.0.113.10', country: 'DE', sign_pubkey: '' },
    { ip: '203.0.113.20', country: 'US', sign_pubkey: '' },
    { ip: '203.0.113.30', country: 'NL', sign_pubkey: '' },
  ],
  // POC: placeholder signature; regenerated + verified against the pinned key
  // in production. See discovery.directoryVerify.
  sig: '',
};

/** Human display metadata for the countries the fleet serves. */
export interface CountryMeta {
  readonly code: string;
  readonly name: string;
  readonly flag: string;
}

const COUNTRY_META: Record<string, CountryMeta> = {
  DE: { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  US: { code: 'US', name: 'United States', flag: '🇺🇸' },
  NL: { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  SG: { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  UK: { code: 'UK', name: 'United Kingdom', flag: '🇬🇧' },
  GB: { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  FR: { code: 'FR', name: 'France', flag: '🇫🇷' },
  CA: { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  JP: { code: 'JP', name: 'Japan', flag: '🇯🇵' },
};

/** Resolve display metadata for an ISO country code, with a safe fallback. */
export function countryMeta(code: string): CountryMeta {
  return COUNTRY_META[code] ?? { code, name: code, flag: '🏳️' };
}

/** Public upgrade/payment page — desktop may embed or open it freely (no store). */
export const UPGRADE_URL = 'https://cumulusvpn.com/upgrade';
