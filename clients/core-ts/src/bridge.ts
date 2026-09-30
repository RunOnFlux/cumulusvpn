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
  readonly rail: 'stripe' | 'apple' | 'google' | 'voucher';
  /** Entitlement granted, pro-rata by the day (a month is 30). */
  readonly days: number;
  /** Derived floor(days/30) — kept for older consumers. */
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

/**
 * Open a Stripe billing portal so a card subscriber can change their payment
 * method, switch plan, or cancel. Redirect the user to the returned `url`.
 *
 * `sessionId` is the Checkout Session id from the purchase
 * ({@link createStripeCheckout}, or the `?session=` the bridge redirects back
 * with) and it is what AUTHORIZES the portal — the payment code alone must
 * never be enough, because it is derived from the device pubkey that every
 * gateway a client enrolls with receives. Callers should persist the session
 * id locally at purchase time; there is no account to recover it from.
 *
 * Throws {@link ApiError} with slug `no_subscription` when the session is
 * unknown, has no customer, or belongs to a different payment code.
 */
export async function openBillingPortal(
  fetchImpl: FetchImpl,
  params: { code: string; sessionId: string },
  opts?: BridgeOptions,
): Promise<{ url: string }> {
  return bridgeFetch(
    fetchImpl,
    '/v1/stripe/portal',
    postJson({ payment_code: params.code, session_id: params.sessionId }),
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
 * Result of a claim or a transfer: the verify shape plus `transferred`
 * (true when the subscription just moved to this code and `days` is the rest
 * of its current period, false when it was simply claimed).
 */
export interface ClaimResult {
  readonly accepted: boolean;
  readonly days: number;
  readonly months: number;
  readonly state: string;
  readonly transferred: boolean;
  /** Store sandbox / license-tester / Stripe test mode (bounded or no grant). */
  readonly test: boolean;
}

/**
 * Claim a Google Play subscription for this device — Restore Purchases after
 * a reinstall (a reinstall is a new key, so a new code), or a promo code
 * redeemed in the Play Store (which carries no account id at all). Unlike
 * {@link verifyGooglePurchase}, the purchase need not have been bought for
 * `code`: the bridge binds it to the first claimant when it is unbound, and
 * behaves exactly like verify when it is already this code's.
 *
 * When the subscription belongs to ANOTHER device the call throws
 * {@link ApiError} with `slug === 'owned_by_other_device'` (HTTP 409): ask the
 * user, then call again with `transfer: true` to move it here. A transfer
 * hands this code the rest of the current period and all future renewals, at
 * most once per subscription per 30 days — otherwise the slug is
 * `transfer_too_soon` (409), and the message ends in the ISO-8601 date it
 * becomes possible ({@link transferAvailableAt} parses it). Store verification
 * failures surface as `verify_failed` (422), as for verify.
 */
export async function claimGooglePurchase(
  fetchImpl: FetchImpl,
  params: { code: string; purchaseToken: string; transfer?: boolean },
  opts?: BridgeOptions,
): Promise<ClaimResult> {
  return bridgeFetch(
    fetchImpl,
    '/v1/google/claim',
    postJson({
      payment_code: params.code,
      purchase_token: params.purchaseToken,
      ...(params.transfer === true ? { transfer: true } : {}),
    }),
    opts,
  );
}

/**
 * Claim an Apple subscription for this device — Restore Purchases after a
 * reinstall, or an offer code redeemed in the App Store (no
 * `appAccountToken`). `signedTransaction` must be the subscription's CURRENT
 * transaction: the bridge rejects expired or revoked ones (`verify_failed`).
 * Same ownership rules, transfer flow and error slugs as
 * {@link claimGooglePurchase}. `sandbox` mirrors {@link verifyApplePurchase}.
 */
export async function claimApplePurchase(
  fetchImpl: FetchImpl,
  params: { code: string; signedTransaction: string; transfer?: boolean },
  opts?: BridgeOptions,
): Promise<ClaimResult & { sandbox: boolean }> {
  return bridgeFetch(
    fetchImpl,
    '/v1/apple/claim',
    postJson({
      payment_code: params.code,
      signed_transaction: params.signedTransaction,
      ...(params.transfer === true ? { transfer: true } : {}),
    }),
    opts,
  );
}

/**
 * Move a card subscription to another device (e.g. the user's new phone),
 * which gets the rest of the current period and every future renewal.
 *
 * Authorized like {@link openBillingPortal}: `sessionId` is the Checkout
 * Session of the purchase and is the capability; `code` is the NEW device's
 * payment code and authorizes nothing on its own. At most once per
 * subscription per 30 days. Throws {@link ApiError} with slug
 * `transfer_too_soon` (409; message ends in the ISO-8601 date, see
 * {@link transferAvailableAt}), `already_bound` (409, that device already has
 * it) or `no_subscription` (404: unknown session, or no active subscription).
 */
export async function transferStripeSubscription(
  fetchImpl: FetchImpl,
  params: { sessionId: string; code: string },
  opts?: BridgeOptions,
): Promise<ClaimResult> {
  return bridgeFetch(
    fetchImpl,
    '/v1/stripe/transfer',
    postJson({ session_id: params.sessionId, payment_code: params.code }),
    opts,
  );
}

/**
 * When a subscription refused with `transfer_too_soon` can move again, read
 * from the ISO-8601 date the bridge ends that error's message with. Null for
 * any other error, or a message without a date.
 */
export function transferAvailableAt(err: unknown): Date | null {
  if (!(err instanceof ApiError) || err.slug !== 'transfer_too_soon') {
    return null;
  }
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/.exec(err.message)?.[1];
  const at = iso === undefined ? NaN : Date.parse(iso);
  return Number.isNaN(at) ? null : new Date(at);
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
