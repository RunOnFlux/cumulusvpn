/**
 * Bundled signed `directory.json` snapshot + the directory Ed25519 pubkey the
 * client ships and pins. Cold-start / all-unreachable fallback per
 * `docs/10-api-contract.md` (order: disk cache → live discovery → this
 * snapshot). Every path is signature-checked via core `directoryVerify`.
 *
 * The snapshot here is the real artifact published from cumulusvpn.com (a copy
 * of `deploy/directory/directory.signed.json`), identical to the one the mobile
 * app ships, so the desktop discovers the same live fleet. Live discovery
 * resolves the `specs` to gateway IPs through Flux; the `seed_gateways` are only
 * the emergency direct-probe fallback.
 */
import { directoryVerify } from '@cumulusvpn/core';
import type { Directory } from '@cumulusvpn/core';
import bundled from '../data/directory.json';

/**
 * Pinned directory Ed25519 public key (`CVPN_DIRECTORY_PUBKEY`), base64.
 * Baked into the binary; the whole trust chain hangs off this constant. Matches
 * the mobile app's pin so both clients trust the same directory signer.
 */
export const CVPN_DIRECTORY_PUBKEY = '1e+42nEpmdjf/cAHs+yE2E2iwmAADpWiLy1VMepsKKw=';

/** Last-known fleet snapshot baked into the release, typed as core `Directory`. */
export const BUNDLED_DIRECTORY: Directory = bundled as Directory;

/** True iff the bundled snapshot verifies against the pinned directory key. */
export function bundledDirectoryIsValid(): boolean {
  return directoryVerify(BUNDLED_DIRECTORY, CVPN_DIRECTORY_PUBKEY);
}

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
  AU: { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  BR: { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  CZ: { code: 'CZ', name: 'Czechia', flag: '🇨🇿' },
  PL: { code: 'PL', name: 'Poland', flag: '🇵🇱' },
};

/** Resolve display metadata for an ISO country code, with a safe fallback. */
export function countryMeta(code: string): CountryMeta {
  return COUNTRY_META[code] ?? { code, name: code, flag: '🏳️' };
}

/** Public upgrade/payment page — desktop may open it freely (no store rules).
 *  The web app (vpn.cumulusvpn.com) serves the prefilled upgrade flow at the
 *  `#/upgrade` hash route; cumulusvpn.com is the asset-only landing (no /upgrade,
 *  it 404s). */
export const UPGRADE_URL = 'https://vpn.cumulusvpn.com/#/upgrade';
