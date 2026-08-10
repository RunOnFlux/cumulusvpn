/**
 * Google Play Billing rail. Trust model: nothing from the client or from an
 * RTDN push is believed until the Play Developer API confirms it —
 * `purchases.subscriptionsv2.get` is the authority for state, order id,
 * base plan, and the obfuscated account id that must equal the payment code
 * the purchase was made for. Grants are keyed by latestOrderId (GPA…-0,
 * -1, …), unique per renewal and stable across RTDN redeliveries.
 */
import { google, type androidpublisher_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyBaseLogger } from 'fastify';

import type { GoogleConfig } from '../config.js';
import { isValidPaymentCode } from '../codes.js';
import { recordGrant } from '../grants.js';
import type { PaymentsRepo } from '../db/payments.js';
import type { Plan, SubscriptionsRepo } from '../db/subscriptions.js';

/** RTDN subscription notification types that should trigger a re-verify + grant. */
const GRANT_NOTIFICATIONS = new Set([1 /* RECOVERED */, 2 /* RENEWED */, 4 /* PURCHASED */]);
const REVOKE_NOTIFICATION = 12;

export interface GoogleVerifyOutcome {
  readonly accepted: boolean;
  readonly reason: string;
  readonly months?: number;
  readonly test?: boolean;
}

export class GoogleRail {
  private readonly publisher: androidpublisher_v3.Androidpublisher;
  private readonly oidc = new OAuth2Client();

  constructor(
    private readonly cfg: GoogleConfig,
    private readonly priceZats: number,
    private readonly payments: PaymentsRepo,
    private readonly subs: SubscriptionsRepo,
    private readonly log: FastifyBaseLogger,
  ) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(cfg.serviceAccountJson) as Record<string, string>,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    this.publisher = google.androidpublisher({ version: 'v3', auth });
  }

  /** Client-initiated verification after purchase; also used on RTDN re-verify. */
  async verifyPurchase(
    code: string,
    purchaseToken: string,
    requireAccountMatch = true,
  ): Promise<GoogleVerifyOutcome> {
    // The route validates too, but the RTDN path can hand in an arbitrary
    // string from externalAccountIdentifiers — nothing unvalidated may reach
    // the subscriptions table or a grant.
    if (!isValidPaymentCode(code)) {
      return { accepted: false, reason: 'invalid_code' };
    }
    const { data: sub } = await this.publisher.purchases.subscriptionsv2.get({
      packageName: this.cfg.packageName,
      token: purchaseToken,
    });
    if (
      sub.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE' &&
      sub.subscriptionState !== 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    ) {
      return { accepted: false, reason: `state:${sub.subscriptionState ?? 'unknown'}` };
    }
    // The account id is the binding between this purchase and the payment
    // code — like Apple's appAccountToken, its absence must FAIL the strict
    // (client-initiated) path, or a leaked purchase token could be credited
    // to an arbitrary code. The RTDN path passes requireAccountMatch=false
    // because it resolved the code from the persisted binding already.
    const obfuscated = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (requireAccountMatch && obfuscated !== code) {
      return { accepted: false, reason: obfuscated ? 'account_id_mismatch' : 'account_id_missing' };
    }
    const line = sub.lineItems?.[0];
    const basePlan = line?.offerDetails?.basePlanId;
    const months = this.monthsForBasePlan(basePlan);
    if (months === null) {
      return { accepted: false, reason: `unknown_base_plan:${basePlan ?? 'none'}` };
    }
    const orderId =
      line?.latestSuccessfulOrderId ??
      (sub as { latestOrderId?: string | null }).latestOrderId ??
      undefined;
    if (!orderId) {
      return { accepted: false, reason: 'no_order_id' };
    }
    const plan: Plan = months === 12 ? 'annual' : 'monthly';
    this.subs.upsert('google', purchaseToken, code, plan);

    await this.acknowledgeIfNeeded(sub, purchaseToken, line?.productId ?? undefined);

    const isTest = sub.testPurchase !== undefined && sub.testPurchase !== null;
    if (isTest && !this.cfg.testGrants) {
      this.log.info({ order: orderId }, 'google test purchase verified (no chain grant)');
      return { accepted: true, reason: 'test_verified', months, test: true };
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'google',
      eventKey: orderId,
      externalRef: purchaseToken,
      paymentCode: code,
      months,
    });
    this.log.info({ order: orderId, result }, 'google purchase verified');
    return { accepted: true, reason: result, months, test: false };
  }

  /**
   * Real-time developer notification (Pub/Sub push). The caller has already
   * verified the OIDC token; this decodes and re-verifies via the Play API.
   */
  async handleRtdn(messageDataB64: string): Promise<string> {
    let decoded: {
      packageName?: string;
      subscriptionNotification?: { notificationType?: number; purchaseToken?: string };
      testNotification?: unknown;
    };
    try {
      decoded = JSON.parse(
        Buffer.from(messageDataB64, 'base64').toString('utf8'),
      ) as typeof decoded;
    } catch {
      // Malformed-but-authenticated push: ack it (return a slug -> 200) or
      // Pub/Sub redelivers the same poison message forever.
      return 'rtdn:malformed';
    }
    if (decoded.testNotification) {
      return 'rtdn:test-notification';
    }
    if (decoded.packageName !== this.cfg.packageName) {
      return 'rtdn:wrong-package';
    }
    const note = decoded.subscriptionNotification;
    const token = note?.purchaseToken;
    if (!note || !token) {
      return 'rtdn:not-subscription';
    }
    if (note.notificationType === REVOKE_NOTIFICATION) {
      this.subs.setStatus('google', token, 'refunded');
      return 'rtdn:revoked';
    }
    if (!GRANT_NOTIFICATIONS.has(note.notificationType ?? -1)) {
      return `rtdn:ignored:${note.notificationType}`;
    }
    // Renewals carry no account id on some resubscribe paths — fall back to
    // the binding persisted at first client verify.
    const known = this.subs.get('google', token);
    const { data: sub } = await this.publisher.purchases.subscriptionsv2.get({
      packageName: this.cfg.packageName,
      token,
    });
    const code = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? known?.payment_code;
    if (!code) {
      return 'rtdn:code-unknown';
    }
    const outcome = await this.verifyPurchase(code, token, false);
    return `rtdn:${outcome.reason}`;
  }

  /** Verify a Pub/Sub push OIDC bearer token. Returns true when authentic. */
  async verifyOidcToken(bearer: string): Promise<boolean> {
    try {
      const ticket = await this.oidc.verifyIdToken({
        idToken: bearer,
        audience: this.cfg.rtdnAudience,
      });
      const payload = ticket.getPayload();
      return payload?.email === this.cfg.rtdnEmail && payload.email_verified === true;
    } catch {
      return false;
    }
  }

  private monthsForBasePlan(basePlanId: string | null | undefined): number | null {
    if (basePlanId === this.cfg.basePlanMonthly) {
      return 1;
    }
    if (basePlanId === this.cfg.basePlanAnnual) {
      return 12;
    }
    return null;
  }

  private async acknowledgeIfNeeded(
    sub: androidpublisher_v3.Schema$SubscriptionPurchaseV2,
    token: string,
    productId: string | undefined,
  ): Promise<void> {
    if (sub.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING' || !productId) {
      return;
    }
    try {
      await this.publisher.purchases.subscriptions.acknowledge({
        packageName: this.cfg.packageName,
        subscriptionId: productId,
        token,
      });
    } catch (e) {
      // The client's finishTransaction also acknowledges; failing here is
      // recoverable until the 3-day window closes.
      this.log.warn({ err: e }, 'google acknowledge failed (client ack may still land)');
    }
  }
}
