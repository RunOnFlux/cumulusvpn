/**
 * Remote per-platform feature flags.
 *
 * Fetched at launch from the internal dashboard's KV-backed endpoint, so a
 * feature can be flipped on/off per platform from the dashboard
 * (dashboard.cumulusvpn.com/admin) WITHOUT an app update. If the fetch fails
 * for ANY reason, every flag defaults to OFF — the safe state (no purchase
 * UI anywhere). The endpoint returns the same JSON shape as the repo's
 * flags.json (the documented default / KV seed).
 *
 * Every flag is remote-controlled on BOTH platforms. There is deliberately no
 * build-level platform allowlist: iOS used to be excluded from the crypto and
 * voucher surfaces in code, which meant the only way to change that decision
 * was to ship a new binary. The per-platform KV keys already express it —
 * `{"voucherRedeem":{"ios":false}}` is the same gate, editable in seconds,
 * and it fails closed when the fetch fails. The operator owns the
 * store-compliance call per platform; see the warnings in the admin UI.
 */
import { Platform } from 'react-native';

const FLAGS_URL = 'https://dashboard.cumulusvpn.com/api/flags';

export interface Flags {
  /**
   * In-app FLUX upgrade (QR + wallet deep-link + pay-to details). When OFF —
   * the default — the app shows no crypto purchase UI: no wallet hand-off,
   * no FLUX price, no pay-to details.
   */
  readonly inAppUpgrade: boolean;
  /**
   * In-app store subscription (StoreKit / Play Billing). When OFF — the
   * default — the subscribe section never renders and IAP machinery never
   * initializes. The upgrade route is reachable if EITHER purchase flag is
   * on for this platform.
   */
  readonly iapPurchase: boolean;
  /**
   * In-app voucher/promo-code redeem box for OUR codes. When OFF — the
   * default — no code-entry surface renders. The store-sanctioned offer-code
   * sheets (Apple/Play) are NOT gated by this flag; they ride with
   * `iapPurchase`.
   */
  readonly voucherRedeem: boolean;
}

/** Safe default when the remote flags can't be fetched: everything OFF. */
export const DEFAULT_FLAGS: Flags = {
  inAppUpgrade: false,
  iapPurchase: false,
  voucherRedeem: false,
};

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
    inAppUpgrade: platformFlag(json, 'inAppUpgrade', os),
    iapPurchase: platformFlag(json, 'iapPurchase', os),
    voucherRedeem: platformFlag(json, 'voucherRedeem', os),
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
