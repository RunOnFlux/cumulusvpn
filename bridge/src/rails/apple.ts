/**
 * Apple IAP rail — StoreKit 2 JWS verification via the official
 * @apple/app-store-server-library (x5c chain to the vendored Apple Root CA).
 *
 * Binding: the client stamps `appAccountToken = uuidForCode(code)` on the
 * purchase; `/v1/apple/verify` recomputes it and REJECTS a mismatch, so a
 * receipt can only ever credit the code it was bought for. The uuid -> code
 * reverse map + originalTransactionId binding persisted there is what lets
 * server-to-server renewal notifications (which carry no client context)
 * find the code later. Grants are keyed by transactionId — unique per
 * renewal, shared across replays.
 *
 * Claims (docs/18 "Claims and transfers") resolve ownership through the
 * originalTransactionId binding instead of the token: a reinstall is a new
 * code, and an offer code redeemed in the App Store carries no token at all.
 * originalTransactionId is the subscription's identity throughout — constant
 * across renewals, and only the Apple ID holding the purchase gets its
 * Apple-signed transactions.
 */
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import type {
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

import type { AppleConfig } from '../config.js';
import { uuidForCode } from '../codes.js';
import { recordGrant, type GrantResult } from '../grants.js';
import type { PaymentsRepo } from '../db/payments.js';
import type { Plan, SubscriptionsRepo, TransferActor } from '../db/subscriptions.js';
import {
  remainingDays,
  transferAvailableAt,
  transferEventKey,
  type ClaimOutcome,
  type RebindOutcome,
} from '../transfers.js';

const GRANT_TYPES = new Set(['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED']);

export interface AppleVerifyOutcome {
  readonly accepted: boolean;
  readonly reason: string;
  readonly days?: number;
  /** True when the payload verified only against the sandbox environment. */
  readonly sandbox?: boolean;
}

export class AppleRail {
  private readonly verifier: SignedDataVerifier;
  private readonly sandboxVerifier: SignedDataVerifier | undefined;

  constructor(
    private readonly cfg: AppleConfig,
    private readonly priceZats: number,
    private readonly payments: PaymentsRepo,
    private readonly subs: SubscriptionsRepo,
    private readonly log: FastifyBaseLogger,
  ) {
    const roots = loadAppleRoots(cfg.rootCaDir);
    const env = cfg.environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
    this.verifier = new SignedDataVerifier(roots, true, env, cfg.bundleId, cfg.appAppleId);
    this.sandboxVerifier =
      cfg.environment === 'Production' && cfg.allowSandbox
        ? new SignedDataVerifier(roots, true, Environment.SANDBOX, cfg.bundleId, cfg.appAppleId)
        : undefined;
  }

  /** Client-initiated verification right after purchase/restore. */
  async verifyPurchase(code: string, signedTransaction: string): Promise<AppleVerifyOutcome> {
    const { txn, sandbox } = await this.decodeTransaction(signedTransaction);
    if (!txn) {
      return { accepted: false, reason: 'verification_failed' };
    }
    const days = this.daysForProduct(txn.productId);
    if (days === null) {
      return { accepted: false, reason: 'unknown_product' };
    }
    const expected = uuidForCode(code);
    if (!txn.appAccountToken || txn.appAccountToken.toLowerCase() !== expected) {
      return { accepted: false, reason: 'app_account_token_mismatch' };
    }
    if (!txn.transactionId || !txn.originalTransactionId) {
      return { accepted: false, reason: 'missing_transaction_ids' };
    }
    this.subs.mapAppleToken(expected, code);
    // Once moved, the token still names the device the subscription was
    // moved AWAY from, and its app re-verifies whatever StoreKit hands it.
    // ownerOf keeps that from undoing the transfer past its 30-day limit.
    return this.settle(
      this.ownerOf(txn, code) ?? code,
      txn.transactionId,
      txn.originalTransactionId,
      txn.expiresDate,
      sandbox,
      days,
    );
  }

  /**
   * Client-initiated claim: Restore Purchases after a reinstall, or an offer
   * code redeemed in the App Store (no appAccountToken). Verified exactly
   * like verifyPurchase, plus the transaction must be live — a claim can move
   * a subscription, so an expired or revoked (refunded / upgraded-away)
   * transaction may not. Ownership is resolved by ownerOf rather than
   * required to match the token:
   *
   * - owned by this code, or by nobody → settle exactly as verify would. An
   *   unbound purchase goes to its first claimant, which is safe because only
   *   the Apple ID holding it has its signed transactions.
   * - owned by another code → `owned_by_other_device`; with `transfer`, a
   *   move (at most one per 30 days) that grants the rest of the period.
   */
  async claimPurchase(
    code: string,
    signedTransaction: string,
    transfer: boolean,
  ): Promise<ClaimOutcome> {
    const { txn, sandbox } = await this.decodeTransaction(signedTransaction);
    if (!txn) {
      return { accepted: false, reason: 'verification_failed' };
    }
    const days = this.daysForProduct(txn.productId);
    if (days === null) {
      return { accepted: false, reason: 'unknown_product' };
    }
    if (!txn.transactionId || !txn.originalTransactionId) {
      return { accepted: false, reason: 'missing_transaction_ids' };
    }
    if (txn.revocationDate !== undefined || txn.isUpgraded === true) {
      return { accepted: false, reason: 'revoked' };
    }
    const expiresMs = txn.expiresDate;
    if (expiresMs === undefined || expiresMs <= Date.now()) {
      return { accepted: false, reason: 'expired' };
    }
    const expected = uuidForCode(code);
    const token = txn.appAccountToken?.toLowerCase();
    // A token that is not this code's names SOME other device. When it was
    // never mapped, the raw uuid stands in as that owner — it can never
    // equal a base58 code, so the claim is correctly treated as a move.
    const purchaser =
      token === undefined
        ? undefined
        : token === expected
          ? code
          : (this.subs.codeForAppleToken(token) ?? token);
    const owner = this.ownerOf(txn, purchaser);
    if (owner === undefined || owner === code) {
      this.subs.mapAppleToken(expected, code);
      const out = this.settle(
        code,
        txn.transactionId,
        txn.originalTransactionId,
        expiresMs,
        sandbox,
        days,
      );
      return { ...out, test: out.sandbox === true, transferred: false };
    }
    if (!transfer) {
      return { accepted: false, reason: 'owned_by_other_device' };
    }
    const known = this.subs.get('apple', txn.originalTransactionId);
    const availableAt = transferAvailableAt(
      known?.transferred_at ?? null,
      Math.floor(Date.now() / 1000),
    );
    if (availableAt !== null) {
      return { accepted: false, reason: 'transfer_too_soon', availableAt };
    }
    this.subs.mapAppleToken(expected, code);
    const plan: Plan = days === 360 ? 'annual' : 'monthly';
    const moved = this.transferTo(
      code,
      txn.originalTransactionId,
      plan,
      expiresMs,
      sandbox,
      'user',
    );
    return {
      accepted: true,
      reason: `transfer:${moved.grant}`,
      days: moved.days,
      test: sandbox,
      transferred: true,
    };
  }

  /**
   * Support override: move a subscription with no 30-day limit, optionally
   * granting the rest of the current period under the SAME per-period key a
   * user transfer uses. There is no App Store Server API key to ask Apple for
   * the live period, so it comes from the last transaction we verified.
   */
  adminRebind(originalTransactionId: string, code: string, grantRemaining: boolean): RebindOutcome {
    const known = this.subs.get('apple', originalTransactionId);
    if (!known) {
      return { ok: false, reason: 'not_found' };
    }
    if (!grantRemaining) {
      const previous = this.subs.rebind(
        'apple',
        originalTransactionId,
        code,
        known.plan,
        'admin',
        0,
      );
      return { ok: true, reason: 'rebound', previousCode: previous, days: 0, grant: 'none' };
    }
    if (known.status !== 'active') {
      return { ok: false, reason: 'not_active' };
    }
    if (known.apple_expires_ms === null || known.apple_expires_ms <= Date.now()) {
      return { ok: false, reason: 'no_current_period' };
    }
    const sandbox = known.apple_sandbox === 1;
    const moved = this.transferTo(
      code,
      originalTransactionId,
      known.plan,
      known.apple_expires_ms,
      sandbox,
      'admin',
    );
    return {
      ok: true,
      reason: 'rebound',
      previousCode: moved.previous,
      days: moved.days,
      grant: moved.grant,
      test: sandbox,
    };
  }

  /** App Store Server Notification V2 (renewals, refunds, expiry). */
  async handleNotification(signedPayload: string): Promise<string> {
    const { payload, sandbox } = await this.decodeNotification(signedPayload);
    if (!payload) {
      return 'notification:verification_failed';
    }
    const signedTxn = payload.data?.signedTransactionInfo;
    if (!signedTxn) {
      return `notification:${payload.notificationType}:no-transaction`;
    }
    const { txn } = await this.decodeTransaction(signedTxn);
    if (!txn?.originalTransactionId) {
      return 'notification:bad-transaction';
    }
    const type = payload.notificationType ?? 'UNKNOWN';

    if (type === 'REFUND') {
      this.subs.setStatus('apple', txn.originalTransactionId, 'refunded');
      return 'notification:refund';
    }
    if (type === 'EXPIRED' || type === 'DID_FAIL_TO_RENEW') {
      this.subs.setStatus(
        'apple',
        txn.originalTransactionId,
        type === 'EXPIRED' ? 'canceled' : 'on_hold',
      );
      return `notification:${type.toLowerCase()}`;
    }
    if (!GRANT_TYPES.has(type)) {
      return `notification:ignored:${type}`;
    }

    const code = this.ownerOf(
      txn,
      txn.appAccountToken ? this.subs.codeForAppleToken(txn.appAccountToken) : undefined,
    );
    if (!code) {
      // First-purchase notification can outrun the client's /verify call;
      // the client-side verify records the grant when it lands.
      return 'notification:code-unknown';
    }
    const days = this.daysForProduct(txn.productId);
    if (days === null || !txn.transactionId) {
      return 'notification:bad-product';
    }
    this.subs.upsert('apple', txn.originalTransactionId, code, days === 360 ? 'annual' : 'monthly');
    if (txn.expiresDate !== undefined) {
      this.subs.noteAppleExpiry(txn.originalTransactionId, txn.expiresDate, sandbox);
    }
    if (sandbox && !this.cfg.sandboxGrants) {
      // Same one-per-subscription key as the client path, so an accelerated
      // sandbox renewal storm settles zero additional times.
      const out = this.sandboxGrant(txn.transactionId, txn.originalTransactionId, code);
      return `notification:${out.reason}`;
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'apple',
      eventKey: txn.transactionId,
      externalRef: txn.originalTransactionId,
      paymentCode: code,
      days,
    });
    this.log.info({ type, transaction: txn.transactionId, result }, 'apple notification grant');
    return `notification:${result}`;
  }

  /**
   * Settle a sandbox purchase for a token amount, at most once per test
   * subscription.
   *
   * App Review buys in the sandbox, and store/app-store/app-review.md tells
   * the reviewer premium activates within a minute. Granting nothing there
   * fails the reviewer's own scripted test. Granting in full is not the
   * answer either: the sandbox clock renews a monthly subscription every few
   * minutes, so full grants would drain the treasury for as long as a tester
   * leaves a device alone.
   *
   * The key is originalTransactionId, not transactionId — it is constant for
   * the life of a subscription, so every renewal and every Restore Purchases
   * collapses onto the one idempotency key recordGrant already enforces.
   * Worst case per test subscription is sandboxGrantDays, once, ever.
   */
  private sandboxGrant(
    transactionId: string,
    originalTransactionId: string,
    code: string,
  ): AppleVerifyOutcome {
    const days = this.cfg.sandboxGrantDays;
    if (days <= 0) {
      this.log.info(
        { transaction: transactionId },
        'apple sandbox purchase verified (no chain grant)',
      );
      return { accepted: true, reason: 'sandbox_verified', days: 0, sandbox: true };
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'apple',
      eventKey: `sandbox:${originalTransactionId}`,
      externalRef: originalTransactionId,
      paymentCode: code,
      days,
    });
    this.log.info(
      { transaction: transactionId, days, result },
      'apple sandbox purchase verified (bounded probe grant)',
    );
    return { accepted: true, reason: `sandbox:${result}`, days, sandbox: true };
  }

  /**
   * Which code a verified transaction credits, given the code its token
   * names (`purchaser`, when known).
   *
   * Until a subscription is moved, the purchaser owns it, falling back to the
   * originalTransactionId binding — renewals of an offer-code purchase carry
   * no token. Once moved, the token still names the device it was moved AWAY
   * from, so everything follows the binding: renewals, restores, notification
   * retries. The one exception is a fresh purchase made after the move (a
   * resubscribe under the same original transaction), whose buyer owns it.
   */
  private ownerOf(
    txn: JWSTransactionDecodedPayload,
    purchaser: string | undefined,
  ): string | undefined {
    const known = txn.originalTransactionId
      ? this.subs.get('apple', txn.originalTransactionId)
      : undefined;
    if (known && known.transferred_at !== null) {
      const boughtSince =
        txn.transactionReason === 'PURCHASE' &&
        (txn.purchaseDate ?? 0) > known.transferred_at * 1000;
      if (!boughtSince || purchaser === undefined) {
        return known.payment_code;
      }
    }
    return purchaser ?? known?.payment_code;
  }

  /** Bind and grant the transaction's period — the verify path proper. */
  private settle(
    code: string,
    transactionId: string,
    originalTransactionId: string,
    expiresMs: number | undefined,
    sandbox: boolean,
    days: number,
  ): AppleVerifyOutcome {
    const plan: Plan = days === 360 ? 'annual' : 'monthly';
    this.subs.upsert('apple', originalTransactionId, code, plan);
    if (expiresMs !== undefined) {
      this.subs.noteAppleExpiry(originalTransactionId, expiresMs, sandbox);
    }
    if (sandbox && !this.cfg.sandboxGrants) {
      return this.sandboxGrant(transactionId, originalTransactionId, code);
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'apple',
      eventKey: transactionId,
      externalRef: originalTransactionId,
      paymentCode: code,
      days,
    });
    this.log.info({ transaction: transactionId, result }, 'apple purchase verified');
    return { accepted: true, reason: result, days, sandbox: false };
  }

  /**
   * Move the subscription to `code` and hand it the rest of the period (a
   * sandbox purchase gets the bounded probe instead, once per test
   * subscription under its own key).
   *
   * Synchronous on purpose: the caller's rate-limit check, the grant and the
   * rebind run with no await between them, so two racing transfers cannot
   * both pass the check. The grant is recorded BEFORE the rebind — a crash in
   * between leaves the subscription where it was, and the retry lands on the
   * same per-period key instead of losing the days.
   */
  private transferTo(
    code: string,
    originalTransactionId: string,
    plan: Plan,
    expiresMs: number,
    sandbox: boolean,
    actor: TransferActor,
  ): { days: number; grant: GrantResult | 'none'; previous: string | null } {
    const probe = sandbox && !this.cfg.sandboxGrants;
    const days = probe ? this.cfg.sandboxGrantDays : remainingDays(expiresMs, Date.now(), plan);
    const grant =
      days > 0
        ? recordGrant(this.payments, this.priceZats, {
            rail: 'apple',
            eventKey: probe
              ? `sandbox-transfer:${originalTransactionId}`
              : transferEventKey(originalTransactionId, expiresMs),
            externalRef: originalTransactionId,
            paymentCode: code,
            days,
          })
        : 'none';
    const previous = this.subs.rebind('apple', originalTransactionId, code, plan, actor, days);
    this.subs.noteAppleExpiry(originalTransactionId, expiresMs, sandbox);
    this.log.info(
      { original: originalTransactionId, actor, days, grant, sandbox },
      'apple subscription transferred',
    );
    return { days, grant, previous };
  }

  private daysForProduct(productId: string | undefined): number | null {
    if (productId === this.cfg.productMonthly) {
      return 30;
    }
    if (productId === this.cfg.productAnnual) {
      return 360;
    }
    return null;
  }

  private async decodeTransaction(
    jws: string,
  ): Promise<{ txn: JWSTransactionDecodedPayload | null; sandbox: boolean }> {
    try {
      return {
        txn: await this.verifier.verifyAndDecodeTransaction(jws),
        sandbox: this.cfg.environment === 'Sandbox',
      };
    } catch (primaryErr) {
      if (this.sandboxVerifier) {
        try {
          return { txn: await this.sandboxVerifier.verifyAndDecodeTransaction(jws), sandbox: true };
        } catch {
          // fall through to primary error handling
        }
      }
      this.log.warn({ err: primaryErr }, 'apple transaction verification failed');
      return { txn: null, sandbox: false };
    }
  }

  private async decodeNotification(
    signedPayload: string,
  ): Promise<{ payload: ResponseBodyV2DecodedPayload | null; sandbox: boolean }> {
    try {
      return {
        payload: await this.verifier.verifyAndDecodeNotification(signedPayload),
        sandbox: this.cfg.environment === 'Sandbox',
      };
    } catch (primaryErr) {
      if (this.sandboxVerifier) {
        try {
          return {
            payload: await this.sandboxVerifier.verifyAndDecodeNotification(signedPayload),
            sandbox: true,
          };
        } catch {
          // fall through
        }
      }
      this.log.warn({ err: primaryErr }, 'apple notification verification failed');
      return { payload: null, sandbox: false };
    }
  }
}

/** Load every vendored Apple root certificate (DER .cer) from a directory. */
function loadAppleRoots(dir: string): Buffer[] {
  const certs = readdirSync(dir)
    .filter((f) => f.endsWith('.cer'))
    .map((f) => readFileSync(join(dir, f)));
  if (certs.length === 0) {
    throw new Error(`apple: no root certificates (*.cer) found in ${dir}`);
  }
  return certs;
}
