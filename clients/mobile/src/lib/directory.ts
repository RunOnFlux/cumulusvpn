/**
 * Bundled signed-directory snapshot + trust anchor.
 *
 * Every release ships `directory.json` (a copy of the artifact published at
 * cumulusvpn.com) and the directory's Ed25519 public key. On cold start —
 * captive portal, censored network, first launch — this is the fallback the
 * client trusts after the disk cache and live discovery both fail (see
 * `docs/05-clients.md`, discovery order: disk cache → live → bundled snapshot).
 *
 * The snapshot is verified with core `directoryVerify` against the pinned key;
 * a directory that does not verify is rejected outright.
 */
import { directoryVerify } from '@cumulusvpn/core';
import type { Directory } from '@cumulusvpn/core';
import bundled from '../data/directory.json';

/**
 * Pinned directory Ed25519 public key (`CVPN_DIRECTORY_PUBKEY`), base64.
 * Baked into the binary; the whole trust chain hangs off this constant.
 */
export const CVPN_DIRECTORY_PUBKEY = 'IhvN6OfPIjw1y+I+zK3Z/63gsgL1qEt7f8M9UZqRzIU=';

/** The bundled snapshot, typed as the core `Directory`. */
export const bundledDirectory: Directory = bundled as Directory;

/** True iff the bundled snapshot verifies against the pinned directory key. */
export function bundledDirectoryIsValid(): boolean {
  return directoryVerify(bundledDirectory, CVPN_DIRECTORY_PUBKEY);
}

/** Flux app-spec names to resolve gateways from (from the signed snapshot). */
export function bundledSpecs(): readonly string[] {
  return bundledDirectory.specs;
}

/** Fallback Flux node IPs to query directly at `:16127` for discovery redundancy. */
export function seedNodeIps(): readonly string[] {
  return bundledDirectory.seed_gateways.map((g) => g.ip).filter((ip) => ip !== '0.0.0.0');
}
