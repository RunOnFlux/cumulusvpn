/**
 * Client for the CumulusVPN payments bridge (`bridge/`,
 * docs/18-payments-bridge.md) — the operator service that turns fiat
 * payments (Stripe card, Apple IAP, Google Play Billing) into on-chain FLUX
 * payments carrying the user's `CVPN1:<code>` memo.
 *
 * Unlike the gateway control API, bridge responses are NOT Ed25519-signed
 * (the bridge is a trusted operator service reached over HTTPS), so this
 * module uses plain fetch + the `{status,data}` envelope rather than
 * `fetchSigned`.
 */
import { ApiError } from './http.js';
import type { ApiEnvelope, FetchImpl } from './types.js';

/** Production bridge endpoint. Override via options for staging/tests. */
export const DEFAULT_BRIDGE_URL = 'https://pay.cumulusvpn.com';

export type PaymentPlan = 'monthly' | 'annual';

/** Lifecycle of one fiat-funded chain payment (docs/18-payments-bridge.md). */
export type BridgePaymentStatus = 'pending' | 'broadcast' | 'confirmed' | 'failed';

export interface BridgePayment {
  readonly rail: 'stripe' | 'apple' | 'google';
  readonly months: number;
  readonly status: BridgePaymentStatus;
  readonly txid: string | null;
  readonly created_at: number;
}

export interface PaymentStatusResult {
  readonly code: string;
  readonly payments: readonly BridgePayment[];
}

export interface BridgeOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

async function bridgeFetch<T>(
  fetchImpl: FetchImpl,
  path: string,
  init: RequestInit | undefined,
  opts: BridgeOptions | undefined,
): Promise<T> {
  const base = opts?.baseUrl ?? DEFAULT_BRIDGE_URL;
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}${path}`, { ...init, signal: controller.signal });
    const parsed = (await res.json()) as ApiEnvelope<T>;
    if (parsed.status === 'error') {
      throw new ApiError(parsed.data);
    }
    if (parsed.status !== 'success' || parsed.data === undefined) {
      // Non-envelope body (proxy error page, gateway 502 JSON, …) — fail
      // loudly instead of returning undefined for callers to destructure.
      throw new Error(`bridge ${path}: unexpected response (HTTP ${res.status})`);
    }
    return parsed.data;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`bridge ${path} timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (body: object): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Create a Stripe Checkout Session for a card subscription. Redirect the
 * user to the returned `url`; Stripe sends them back to the web upgrade
 * page, which then polls {@link paymentStatus}. An optional `voucher` (a
 * discount code previously validated via {@link redeemVoucher}) applies the
 * discount at checkout.
 */
export async function createStripeCheckout(
  fetchImpl: FetchImpl,
  params: { code: string; plan: PaymentPlan; voucher?: string },
  opts?: BridgeOptions,
): Promise<{ url: string; session_id: string }> {
  return bridgeFetch(
    fetchImpl,
    '/v1/stripe/checkout',
    postJson({
      payment_code: params.code,
      plan: params.plan,
      ...(params.voucher !== undefined ? { voucher: params.voucher } : {}),
    }),
    opts,
  );
}

/** Outcome of redeeming a code: free time queued on-chain, or a discount to carry into checkout. */
export type RedeemOutcome =
  | { type: 'grant_days'; days: number; state: 'pending' }
  | { type: 'stripe_discount'; percent_off: number };

/**
 * Redeem a voucher / promo code for this device's payment code.
 *
 * `grant_days` outcomes are consumed immediately — the bridge queues the
 * on-chain settlement and {@link paymentStatus} tracks it ("activating…").
 * `stripe_discount` outcomes are NOT consumed: pass the same code as
 * `voucher` to {@link createStripeCheckout} to apply it. Errors surface as
 * {@link ApiError} with slugs `invalid` / `expired` / `exhausted` /
 * `already_redeemed` / `temporarily_unavailable`.
 */
export async function redeemVoucher(
  fetchImpl: FetchImpl,
  params: { code: string; voucher: string },
  opts?: BridgeOptions,
): Promise<RedeemOutcome> {
  return bridgeFetch(
    fetchImpl,
    '/v1/voucher/redeem',
    postJson({ payment_code: params.code, code: params.voucher }),
    opts,
  );
}

/**
 * Verify an Apple StoreKit 2 purchase. `signedTransaction` is the JWS from
 * the purchase result; the bridge checks its signature chain AND that its
 * `appAccountToken` equals `appAccountToken(code)` before granting.
 */
export async function verifyApplePurchase(
  fetchImpl: FetchImpl,
  params: { code: string; signedTransaction: string },
  opts?: BridgeOptions,
): Promise<{ accepted: boolean; months: number; state: string; sandbox: boolean }> {
  return bridgeFetch(
    fetchImpl,
    '/v1/apple/verify',
    postJson({ payment_code: params.code, signed_transaction: params.signedTransaction }),
    opts,
  );
}

/** Verify a Google Play Billing purchase token server-side. */
export async function verifyGooglePurchase(
  fetchImpl: FetchImpl,
  params: { code: string; purchaseToken: string },
  opts?: BridgeOptions,
): Promise<{ accepted: boolean; months: number; state: string; test: boolean }> {
  return bridgeFetch(
    fetchImpl,
    '/v1/google/verify',
    postJson({ payment_code: params.code, purchase_token: params.purchaseToken }),
    opts,
  );
}

/**
 * Recent bridge payments for a code — drives the "Activating…" UX between
 * a fiat payment and the gateways seeing the confirmed chain tx.
 */
export async function paymentStatus(
  fetchImpl: FetchImpl,
  code: string,
  opts?: BridgeOptions,
): Promise<PaymentStatusResult> {
  return bridgeFetch(fetchImpl, `/v1/payment/${encodeURIComponent(code)}/status`, undefined, opts);
}
