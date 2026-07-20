/**
 * Remote per-platform feature flags.
 *
 * Fetched at launch from a simple JSON file in the public repo, so a feature can
 * be flipped on/off per platform WITHOUT an app update (e.g. keep the in-app
 * crypto-pay upgrade off on iOS for App Store review, on for Android). If the
 * fetch fails for ANY reason, every flag defaults to OFF — the safe, store-
 * compliant state (upgrade falls back to "manage on the web").
 */
import { Platform } from 'react-native';

const FLAGS_URL = 'https://raw.githubusercontent.com/RunOnFlux/cumulusvpn/main/flags.json';

export interface Flags {
  /**
   * In-app FLUX upgrade (QR + wallet deep-link + pay-to details). When OFF, the
   * upgrade screen shows the store-compliant "upgrade on the web" copy instead.
   */
  readonly inAppUpgrade: boolean;
}

/** Safe default when the remote flags can't be fetched: everything OFF. */
export const DEFAULT_FLAGS: Flags = { inAppUpgrade: false };

/** Read a `{ android, ios }` boolean flag from a parsed doc for the given OS. */
function platformFlag(json: unknown, key: string, os: string): boolean {
  if (!json || typeof json !== 'object') {
    return false;
  }
  const node = (json as Record<string, unknown>)[key];
  if (!node || typeof node !== 'object') {
    return false;
  }
  return (node as Record<string, unknown>)[os] === true;
}

/** Resolve the flags a parsed JSON doc grants for `os`. Unknown shape → all OFF. */
export function resolveFlags(json: unknown, os: string): Flags {
  return { inAppUpgrade: platformFlag(json, 'inAppUpgrade', os) };
}

/** Fetch the remote flags; on any failure/timeout, return DEFAULT_FLAGS (all off). */
export async function fetchFlags(signal?: AbortSignal): Promise<Flags> {
  try {
    const r = await fetch(FLAGS_URL, signal ? { signal } : {});
    if (!r.ok) {
      return DEFAULT_FLAGS;
    }
    return resolveFlags(await r.json(), Platform.OS);
  } catch {
    return DEFAULT_FLAGS;
  }
}
