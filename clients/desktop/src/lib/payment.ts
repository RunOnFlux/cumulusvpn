/**
 * What the in-app Upgrade screen needs to take a payment — ported from mobile
 * (clients/mobile/src/state/useVpn.ts `payment`, lib/gateways.ts
 * `fleetPriceFlux`, screens/UpgradeScreen.tsx `formatExpiry`).
 *
 * Entitlement is chain-based and keyed to this device: a FLUX transfer to the
 * pay-to address carrying this device's memo, a card payment on the web
 * checkout opened with this device's code, or a redeemed voucher all unlock
 * Premium on every gateway within about a minute. No account anywhere.
 */
import { paymentCode, paymentMemo } from '@cumulusvpn/core';
import type { GatewayInfo } from '@cumulusvpn/core';
import { BUNDLED_DIRECTORY } from './directory.js';

export interface PaymentIdentity {
  /** Neutral device code, shown in Settings and prefilled on the web checkout. */
  readonly code: string;
  /** Memo a FLUX transfer must carry to credit this device. */
  readonly memo: string;
  readonly address: string;
  /** FLUX for 30 days. */
  readonly priceFlux: number;
}

/**
 * The price the fleet quotes right now: the majority of gateways' signed
 * `/v1/info` `price_flux`, ties to the HIGHER price (overpaying buys extra
 * days; an under-quote would sell a fraction of a month). Undefined when no
 * gateway reports one.
 */
export function fleetPriceFlux(gateways: readonly GatewayInfo[]): number | undefined {
  const votes = new Map<number, number>();
  for (const g of gateways) {
    const p = (g as GatewayInfo & { readonly price_flux?: unknown }).price_flux;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      votes.set(p, (votes.get(p) ?? 0) + 1);
    }
  }
  let best: number | undefined;
  let bestVotes = 0;
  for (const [price, n] of votes) {
    if (n > bestVotes || (n === bestVotes && best !== undefined && price > best)) {
      best = price;
      bestVotes = n;
    }
  }
  return best;
}

/**
 * Pay-to details for this device. The address comes from the signed
 * directory (always available, before any connect); the price prefers the
 * live fleet quote over the directory's, which is frozen at build time.
 */
export function paymentIdentity(publicKey: string, livePrice?: number): PaymentIdentity {
  return {
    code: paymentCode(publicKey),
    memo: paymentMemo(publicKey),
    address: BUNDLED_DIRECTORY.payment_address,
    priceFlux: livePrice ?? BUNDLED_DIRECTORY.price_flux,
  };
}

/** `paid_until` → a display date and whole days left (0 once past). */
export function formatExpiry(
  iso: string | null | undefined,
  now: number = Date.now(),
): { date: string; daysLeft: number } | null {
  if (!iso) {
    return null;
  }
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  const date = new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return { date, daysLeft: Math.max(0, Math.ceil((t - now) / 86_400_000)) };
}

/** Bridge voucher error slug → what to tell the user. */
export function voucherErrorText(slug: string): string {
  switch (slug) {
    case 'expired':
      return 'This code has expired.';
    case 'exhausted':
      return 'This code has already been fully used.';
    case 'already_redeemed':
      return 'This device has already redeemed this code.';
    case 'temporarily_unavailable':
    case 'rate_limited':
      return 'Redemption is briefly unavailable — try again in a few minutes.';
    default:
      return 'That code isn’t valid. Check for typos and try again.';
  }
}
