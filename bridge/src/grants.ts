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
  /** Subscription handle for audit (Stripe sub / originalTransactionId / purchaseToken). */
  readonly externalRef: string;
  readonly paymentCode: string;
  readonly months: number;
}

export type GrantResult = 'queued' | 'duplicate' | 'invalid_code';

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
    months: ev.months,
    fluxZats: ev.months * priceZats,
  };
  return payments.insertIdempotent(p) === null ? 'duplicate' : 'queued';
}
