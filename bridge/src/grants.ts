/**
 * The single funnel every rail's "verified payment event" goes through:
 * validate the code, size the chain payment, and enqueue it idempotently.
 */
import { isValidPaymentCode } from './codes.js';
import type { NewPayment, PaymentsRepo, Rail } from './db/payments.js';

export interface GrantEvent {
  readonly rail: Rail;
  /** Rail-specific idempotency key — one chain tx max per (rail, key). */
  readonly eventKey: string;
  /** Subscription handle for audit (Stripe sub / originalTransactionId / purchaseToken / voucher). */
  readonly externalRef: string;
  readonly paymentCode: string;
  readonly days: number;
}

export type GrantResult = 'queued' | 'duplicate' | 'invalid_code';

/**
 * Zat payout for a day grant: ceil(priceZats * days / 30). CEIL is
 * load-bearing — the gateway grants floor(30 * amount / price) days, and a
 * floored payout (e.g. 66_666_666 zats for one day at price 20) computes to
 * 0.99999999 days and grants NOTHING. Ceiling overshoots by at most 1 zat,
 * which can never reach days+1. Whole months (days % 30 == 0) come out to
 * exact price multiples — byte-identical to the original month payouts.
 * Cross-tested against gateway TestProRataDayGrants.
 */
export function zatsForDays(priceZats: number, days: number): number {
  return Math.ceil((priceZats * days) / 30);
}

export function recordGrant(
  payments: PaymentsRepo,
  priceZats: number,
  ev: GrantEvent,
): GrantResult {
  if (!isValidPaymentCode(ev.paymentCode)) {
    return 'invalid_code';
  }
  const p: NewPayment = {
    rail: ev.rail,
    eventKey: ev.eventKey,
    externalRef: ev.externalRef,
    paymentCode: ev.paymentCode,
    days: ev.days,
    fluxZats: zatsForDays(priceZats, ev.days),
  };
  return payments.insertIdempotent(p) === null ? 'duplicate' : 'queued';
}
