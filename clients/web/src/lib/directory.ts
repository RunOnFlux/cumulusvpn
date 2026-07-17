import { directoryVerify } from '@cumulusvpn/core';
import type { Directory } from '@cumulusvpn/core';
import bundled from '../directory.bundled.json';
import { DIRECTORY_PUBKEY, DIRECTORY_URL } from '../config';

/**
 * The signed directory carries an extra `sign_pubkey` field and may carry
 * `//`-prefixed comment keys; the signature (per docs/10 and
 * deploy/directory/make-directory.mjs) covers only the seven core fields.
 * `directoryVerify` in core canonicalises everything except `sig`, so we must
 * project the raw JSON down to exactly those fields before verifying.
 */
function toDirectory(raw: unknown): Directory {
  const r = raw as Record<string, unknown>;
  return {
    version: Number(r['version']),
    updated: String(r['updated']),
    payment_address: String(r['payment_address']),
    price_flux: Number(r['price_flux']),
    specs: (r['specs'] as string[] | undefined) ?? [],
    seed_gateways: (r['seed_gateways'] as Directory['seed_gateways'] | undefined) ?? [],
    sig: String(r['sig']),
  };
}

/** Where a resolved directory came from — surfaced in the UI for transparency. */
export type DirectorySource = 'live' | 'bundled';

export interface ResolvedDirectory {
  readonly directory: Directory;
  readonly source: DirectorySource;
  readonly verified: boolean;
}

/**
 * Resolve the signed directory: try the live copy this site serves, fall back
 * to the snapshot bundled into the build. Both are Ed25519-verified against the
 * shipped {@link DIRECTORY_PUBKEY}; an unverifiable live copy is discarded in
 * favour of the trusted bundle.
 *
 * POC: the on-disk cache tier from docs/10 (disk → live → bundled) is native
 * only; in the browser the served copy plays the "live" role and the compiled
 * snapshot the "bundled" role.
 */
export async function resolveDirectory(
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedDirectory> {
  try {
    const res = await fetchImpl(DIRECTORY_URL, { cache: 'no-store' });
    if (res.ok) {
      const directory = toDirectory(await res.json());
      if (directoryVerify(directory, DIRECTORY_PUBKEY)) {
        return { directory, source: 'live', verified: true };
      }
    }
  } catch {
    // Offline / captive portal / cold start — fall through to the bundle.
  }

  const directory = toDirectory(bundled);
  const verified = directoryVerify(directory, DIRECTORY_PUBKEY);
  return { directory, source: 'bundled', verified };
}
