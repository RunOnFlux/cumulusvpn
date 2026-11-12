/**
 * Remote feature flags for desktop — the `desktop` column of the dashboard's
 * per-platform flags (dashboard.cumulusvpn.com/admin, served at /api/flags;
 * see the repo's flags.json and clients/mobile/src/lib/flags.ts).
 *
 * Unlike mobile these are KILL SWITCHES, not opt-ins. Mobile fails closed
 * because a store build must not show a non-compliant purchase surface; desktop
 * ships in no store, so hiding Upgrade whenever the dashboard is unreachable
 * would only lose sales. So a surface is ON unless the dashboard explicitly
 * says `desktop: false`. A failed fetch reuses the last answer we got (an
 * operator's "off" survives a flaky network), and falls back to ON.
 */
import { useEffect, useState } from 'react';

const FLAGS_URL = 'https://dashboard.cumulusvpn.com/api/flags';
const CACHE_KEY = 'cvpn.flags.v1';
const TIMEOUT_MS = 5_000;

export interface DesktopFlags {
  /** In-app FLUX checkout (QR, wallet hand-off, pay-to details). */
  readonly fluxCheckout: boolean;
  /** Card checkout on the website, opened with this device's code. */
  readonly cardCheckout: boolean;
  /** Voucher / promo-code redeem box. */
  readonly voucherRedeem: boolean;
}

export const DEFAULT_DESKTOP_FLAGS: DesktopFlags = {
  fluxCheckout: true,
  cardCheckout: true,
  voucherRedeem: true,
};

function on(json: unknown, key: string): boolean {
  if (!json || typeof json !== 'object') {
    return true;
  }
  const node = (json as Record<string, unknown>)[key];
  if (!node || typeof node !== 'object') {
    return true;
  }
  return (node as Record<string, unknown>).desktop !== false;
}

/** The desktop surfaces a parsed `/api/flags` document allows. */
export function resolveDesktopFlags(json: unknown): DesktopFlags {
  return {
    fluxCheckout: on(json, 'inAppUpgrade'),
    cardCheckout: on(json, 'webPayLink'),
    voucherRedeem: on(json, 'voucherRedeem'),
  };
}

function cached(): DesktopFlags {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? resolveDesktopFlags(JSON.parse(raw)) : DEFAULT_DESKTOP_FLAGS;
  } catch {
    return DEFAULT_DESKTOP_FLAGS;
  }
}

/** Fetch the flags; on any failure, the last answer (or all ON). */
export async function fetchDesktopFlags(fetchImpl: typeof fetch = fetch): Promise<DesktopFlags> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(FLAGS_URL, { signal: controller.signal });
    if (!res.ok) {
      return cached();
    }
    const json: unknown = await res.json();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(json));
    } catch {
      /* storage unavailable: still use the answer this session */
    }
    return resolveDesktopFlags(json);
  } catch {
    return cached();
  } finally {
    clearTimeout(timer);
  }
}

/** Flags for this session: the cached answer at once, refreshed at launch. */
export function useDesktopFlags(): DesktopFlags {
  const [flags, setFlags] = useState<DesktopFlags>(cached);
  useEffect(() => {
    let alive = true;
    void fetchDesktopFlags().then((f) => {
      if (alive) {
        setFlags(f);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return flags;
}
