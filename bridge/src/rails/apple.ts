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
import { recordGrant } from '../grants.js';
import type { PaymentsRepo } from '../db/payments.js';
import type { Plan, SubscriptionsRepo } from '../db/subscriptions.js';

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
    const plan: Plan = days === 360 ? 'annual' : 'monthly';
    this.subs.upsert('apple', txn.originalTransactionId, code, plan);
    this.subs.mapAppleToken(expected, code);
    if (sandbox && !this.cfg.sandboxGrants) {
      this.log.info(
        { transaction: txn.transactionId },
        'apple sandbox purchase verified (no chain grant)',
      );
      return { accepted: true, reason: 'sandbox_verified', days, sandbox: true };
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'apple',
      eventKey: txn.transactionId,
      externalRef: txn.originalTransactionId,
      paymentCode: code,
      days,
    });
    this.log.info({ transaction: txn.transactionId, result }, 'apple purchase verified');
    return { accepted: true, reason: result, days, sandbox: false };
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

    const code = this.codeForTransaction(txn);
    if (!code) {
      // First-purchase notification can outrun the client's /verify call;
      // the client-side verify records the grant when it lands.
      return 'notification:code-unknown';
    }
    const days = this.daysForProduct(txn.productId);
    if (days === null || !txn.transactionId) {
      return 'notification:bad-product';
    }
    if (sandbox && !this.cfg.sandboxGrants) {
      return 'notification:sandbox-skipped';
    }
    this.subs.upsert('apple', txn.originalTransactionId, code, days === 360 ? 'annual' : 'monthly');
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

  private codeForTransaction(txn: JWSTransactionDecodedPayload): string | undefined {
    if (txn.appAccountToken) {
      const mapped = this.subs.codeForAppleToken(txn.appAccountToken);
      if (mapped) {
        return mapped;
      }
    }
    return txn.originalTransactionId
      ? this.subs.get('apple', txn.originalTransactionId)?.payment_code
      : undefined;
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
