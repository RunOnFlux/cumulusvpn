/**
 * Remote per-platform feature flags.
 *
 * Fetched at launch from the internal dashboard's KV-backed endpoint, so a
 * feature can be flipped on/off per platform from the dashboard
 * (dashboard.cumulusvpn.com/admin) WITHOUT an app update. If the fetch fails
 * for ANY reason, every flag defaults to OFF — the safe state (no purchase
 * UI anywhere). The endpoint returns the same JSON shape as the repo's
 * flags.json (the documented default / KV seed).
 */
import { Platform } from 'react-native';

const FLAGS_URL = 'https://dashboard.cumulusvpn.com/api/flags';

/**
 * Platforms whose builds are allowed to show the CRYPTO purchase UI (QR +
 * wallet hand-off) AT ALL. iOS is excluded at build level, not just by the
 * remote flag: every iOS build goes through the App Store, where a crypto
 * purchase surface violates guideline 3.1.1 — and flipping behavior on
 * remotely after review is itself a violation. Keeping iOS out of this set
 * means a KV misconfiguration can never resurface that UI there. Android
 * stays remote-controlled because direct-APK (off-store) builds legitimately
 * use the flow — but it must stay OFF in KV while the Play build is live,
 * since both are the same binary.
 */
const PURCHASE_UI_PLATFORMS: ReadonlySet<string> = new Set(['android']);

/**
 * Platforms whose builds may show the STORE-BILLING purchase UI (Apple IAP /
 * Google Play Billing subscriptions). Unlike the crypto flow, this UI is
 * store-compliant by construction — the remote flag is a rollout/kill
 * switch, not a compliance shield. It must be ON in KV BEFORE a build
 * containing it is submitted for review (reviewers must be able to find the
 * declared subscriptions), and can be flipped off afterwards if the bridge
 * has an outage.
 */
const IAP_PLATFORMS: ReadonlySet<string> = new Set(['ios', 'android']);

export interface Flags {
  /**
   * In-app FLUX upgrade (QR + wallet deep-link + pay-to details). When OFF —
   * the default, and always the case on iOS — the app shows no crypto
   * purchase UI: no wallet hand-off, no FLUX price, no pay-to details.
   */
  readonly inAppUpgrade: boolean;
  /**
   * In-app store subscription (StoreKit / Play Billing). When OFF — the
   * default — the subscribe section never renders and IAP machinery never
   * initializes. The upgrade route is reachable if EITHER purchase flag is
   * on for this platform.
   */
  readonly iapPurchase: boolean;
}

/** Safe default when the remote flags can't be fetched: everything OFF. */
export const DEFAULT_FLAGS: Flags = { inAppUpgrade: false, iapPurchase: false };

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
  return {
    inAppUpgrade: PURCHASE_UI_PLATFORMS.has(os) && platformFlag(json, 'inAppUpgrade', os),
    iapPurchase: IAP_PLATFORMS.has(os) && platformFlag(json, 'iapPurchase', os),
  };
}

/** Fetch the remote flags; on any failure/timeout, return DEFAULT_FLAGS (all off). */
export async function fetchFlags(signal?: AbortSignal): Promise<Flags> {
  // Bound the request so a hung connection can't leave us on defaults forever.
  const timer = new AbortController();
  const id = setTimeout(() => timer.abort(), 8_000);
  if (signal) {
    signal.addEventListener('abort', () => timer.abort(), { once: true });
  }
  try {
    const r = await fetch(FLAGS_URL, { signal: timer.signal });
    if (!r.ok) {
      return DEFAULT_FLAGS;
    }
    return resolveFlags(await r.json(), Platform.OS);
  } catch {
    return DEFAULT_FLAGS;
  } finally {
    clearTimeout(id);
  }
}
