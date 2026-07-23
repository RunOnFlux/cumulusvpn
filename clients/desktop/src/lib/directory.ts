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

/** Legacy alias the fleet has used for Great Britain. */
const CODE_ALIASES: Record<string, string> = { UK: 'GB' };

const REGION_NAMES =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

/** Regional-indicator flag emoji derived from the ISO code — covers every
 *  country the fleet can ever grow into, so this file can't fall behind it. */
function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🏳️';
  const A = 0x1f1e6;
  const u = code.toUpperCase();
  return String.fromCodePoint(A + u.charCodeAt(0) - 65, A + u.charCodeAt(1) - 65);
}

/** Resolve display metadata for an ISO country code, with a safe fallback.
 *  Name and flag are derived (Intl.DisplayNames + regional indicators), same
 *  approach as the web client — no hardcoded per-country table to go stale. */
export function countryMeta(code: string): CountryMeta {
  const iso = CODE_ALIASES[code.toUpperCase()] ?? code.toUpperCase();
  let name: string | undefined;
  try {
    name = REGION_NAMES?.of(iso);
  } catch {
    // malformed code — fall through to the neutral fallback
  }
  // CLDR names unassigned codes "Unknown Region" (ZZ et al.) — keep the old
  // contract for those: raw code + neutral flag, never a garbled glyph pair.
  if (!name || name === iso || /unknown/i.test(name)) {
    return { code, name: code, flag: '🏳️' };
  }
  return { code, name, flag: flagEmoji(iso) };
}

/** Public upgrade/payment page — desktop may open it freely (no store rules).
 *  The web app (vpn.cumulusvpn.com) serves the prefilled upgrade flow at the
 *  `#/upgrade` hash route; cumulusvpn.com is the asset-only landing (no /upgrade,
 *  it 404s). */
export const UPGRADE_URL = 'https://vpn.cumulusvpn.com/#/upgrade';
