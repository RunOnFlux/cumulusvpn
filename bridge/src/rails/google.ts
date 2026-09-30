/**
 * Google Play Billing rail. Trust model: nothing from the client or from an
 * RTDN push is believed until the Play Developer API confirms it —
 * `purchases.subscriptionsv2.get` is the authority for state, order id,
 * base plan, and the obfuscated account id that must equal the payment code
 * the purchase was made for. Grants are keyed by latestOrderId (GPA…-0,
 * -1, …), unique per renewal and stable across RTDN redeliveries.
 *
 * Claims (docs/18 "Claims and transfers") resolve ownership through the
 * persisted purchaseToken binding instead of that account id: a reinstall is
 * a new code, and a promo code redeemed in the Play Store has no account id
 * at all. The token is the subscription's identity throughout — stable
 * across renewals, and only the Play account holding the purchase can
 * present it.
 */
import { google, type androidpublisher_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyBaseLogger } from 'fastify';

import type { GoogleConfig } from '../config.js';
import { isValidPaymentCode } from '../codes.js';
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

/** RTDN subscription notification types that should trigger a re-verify + grant. */
const GRANT_NOTIFICATIONS = new Set([1 /* RECOVERED */, 2 /* RENEWED */, 4 /* PURCHASED */]);
const REVOKE_NOTIFICATION = 12;

export interface GoogleVerifyOutcome {
  readonly accepted: boolean;
  readonly reason: string;
  readonly days?: number;
  readonly test?: boolean;
}

/** What Play says the current period of a verified subscription is. */
interface PeriodFacts {
  readonly days: number;
  readonly plan: Plan;
  readonly orderId: string;
  readonly productId: string | undefined;
  /** End of the current period (ms); NaN when Play reported none. */
  readonly expiryMs: number;
  readonly test: boolean;
}

const nowS = (): number => Math.floor(Date.now() / 1000);

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
    const sub = await this.fetchSubscription(purchaseToken);
    const inactive = this.inactiveReason(sub);
    if (inactive !== null) {
      return { accepted: false, reason: inactive };
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
    const facts = this.periodFacts(sub);
    if (typeof facts === 'string') {
      return { accepted: false, reason: facts };
    }
    // Once moved, the account id still names the device the subscription was
    // moved AWAY from, and its app re-verifies on every launch. Letting that
    // rebind would undo the transfer past its 30-day limit, so a moved
    // subscription settles to its current owner, exactly as its RTDNs do.
    return this.settle(this.movedOwner(purchaseToken) ?? code, purchaseToken, sub, facts);
  }

  /**
   * Client-initiated claim: Restore Purchases after a reinstall, or a promo
   * code redeemed in the Play Store (no account id). Verified with Play
   * exactly like verifyPurchase; ownership comes from the persisted binding,
   * falling back to the account id:
   *
   * - owned by this code, or by nobody → settle exactly as verify would. An
   *   unbound purchase goes to its first claimant, which is safe because only
   *   the Play account holding it can present its token.
   * - owned by another code → `owned_by_other_device`; with `transfer`, a
   *   move (at most one per 30 days) that grants the rest of the period.
   */
  async claimPurchase(
    code: string,
    purchaseToken: string,
    transfer: boolean,
  ): Promise<ClaimOutcome> {
    if (!isValidPaymentCode(code)) {
      return { accepted: false, reason: 'invalid_code' };
    }
    const sub = await this.fetchSubscription(purchaseToken);
    const inactive = this.inactiveReason(sub);
    if (inactive !== null) {
      return { accepted: false, reason: inactive };
    }
    const facts = this.periodFacts(sub);
    if (typeof facts === 'string') {
      return { accepted: false, reason: facts };
    }
    const known = this.subs.get('google', purchaseToken);
    const owner =
      known?.payment_code ||
      sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ||
      undefined;
    if (owner === undefined || owner === code) {
      return { ...(await this.settle(code, purchaseToken, sub, facts)), transferred: false };
    }
    if (!transfer) {
      return { accepted: false, reason: 'owned_by_other_device' };
    }
    const availableAt = transferAvailableAt(known?.transferred_at ?? null, nowS());
    if (availableAt !== null) {
      return { accepted: false, reason: 'transfer_too_soon', availableAt };
    }
    const moved = this.transferTo(code, purchaseToken, facts, 'user');
    await this.acknowledgeIfNeeded(sub, purchaseToken, facts.productId);
    return {
      accepted: true,
      reason: `transfer:${moved.grant}`,
      days: moved.days,
      test: facts.test,
      transferred: true,
    };
  }

  /**
   * Support override: move a subscription with no 30-day limit, optionally
   * granting the rest of the current period — under the SAME per-period key
   * a user transfer uses, so support cannot double-grant a period either.
   */
  async adminRebind(
    purchaseToken: string,
    code: string,
    grantRemaining: boolean,
  ): Promise<RebindOutcome> {
    const known = this.subs.get('google', purchaseToken);
    if (!known) {
      return { ok: false, reason: 'not_found' };
    }
    if (!grantRemaining) {
      const previous = this.subs.rebind('google', purchaseToken, code, known.plan, 'admin', 0);
      return { ok: true, reason: 'rebound', previousCode: previous, days: 0, grant: 'none' };
    }
    const sub = await this.fetchSubscription(purchaseToken);
    const inactive = this.inactiveReason(sub);
    if (inactive !== null) {
      return { ok: false, reason: 'not_active' };
    }
    const facts = this.periodFacts(sub);
    if (typeof facts === 'string') {
      return { ok: false, reason: facts };
    }
    const moved = this.transferTo(code, purchaseToken, facts, 'admin');
    return {
      ok: true,
      reason: 'rebound',
      previousCode: moved.previous,
      days: moved.days,
      grant: moved.grant,
      test: facts.test,
    };
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
    // The persisted binding wins: after a transfer the account id still names
    // the code that originally bought, and renewals must credit the code the
    // subscription was moved to. (Renewals also carry no account id on some
    // resubscribe paths.) The account id is only the fallback for a purchase
    // whose client verify has not landed yet.
    const known = this.subs.get('google', token);
    const sub = await this.fetchSubscription(token);
    const code = known?.payment_code ?? sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
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

  /**
   * Settle a license-tester purchase for a token amount, at most once per
   * test subscription — the Play twin of AppleRail.sandboxGrant.
   *
   * Play's closed-testing track requires real testers to exercise the
   * purchase flow, and a tester whose Premium never activates files a bug
   * against a working build. Full grants are the wrong fix: test
   * subscriptions renew on an accelerated clock too.
   *
   * purchaseToken is the key because it is stable across renewals of the
   * same subscription (latestSuccessfulOrderId is not), so every RENEWED
   * notification lands on the idempotency key recordGrant already enforces.
   */
  private testGrant(purchaseToken: string, code: string, orderId: string): GoogleVerifyOutcome {
    const days = this.cfg.testGrantDays;
    if (days <= 0) {
      this.log.info({ order: orderId }, 'google test purchase verified (no chain grant)');
      return { accepted: true, reason: 'test_verified', days: 0, test: true };
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'google',
      eventKey: `test:${purchaseToken}`,
      externalRef: purchaseToken,
      paymentCode: code,
      days,
    });
    this.log.info(
      { order: orderId, days, result },
      'google test purchase verified (bounded probe grant)',
    );
    return { accepted: true, reason: `test:${result}`, days, test: true };
  }

  /**
   * Move the subscription to `code` and hand it the rest of the current
   * period (a test purchase gets the bounded probe instead, once per test
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
    purchaseToken: string,
    facts: PeriodFacts,
    actor: TransferActor,
  ): { days: number; grant: GrantResult | 'none'; previous: string | null } {
    const probe = facts.test && !this.cfg.testGrants;
    const days = probe
      ? this.cfg.testGrantDays
      : remainingDays(facts.expiryMs, Date.now(), facts.plan);
    const grant =
      days > 0
        ? recordGrant(this.payments, this.priceZats, {
            rail: 'google',
            eventKey: probe
              ? `test-transfer:${purchaseToken}`
              : transferEventKey(purchaseToken, facts.expiryMs),
            externalRef: purchaseToken,
            paymentCode: code,
            days,
          })
        : 'none';
    const previous = this.subs.rebind('google', purchaseToken, code, facts.plan, actor, days);
    this.log.info(
      { order: facts.orderId, actor, days, grant, test: facts.test },
      'google subscription transferred',
    );
    return { days, grant, previous };
  }

  /** The current owner of a subscription that has been moved; undefined if never moved. */
  private movedOwner(purchaseToken: string): string | undefined {
    const known = this.subs.get('google', purchaseToken);
    return known && known.transferred_at !== null ? known.payment_code : undefined;
  }

  /** Bind, acknowledge, and grant the current period — the verify path proper. */
  private async settle(
    code: string,
    purchaseToken: string,
    sub: androidpublisher_v3.Schema$SubscriptionPurchaseV2,
    facts: PeriodFacts,
  ): Promise<GoogleVerifyOutcome> {
    this.subs.upsert('google', purchaseToken, code, facts.plan);

    await this.acknowledgeIfNeeded(sub, purchaseToken, facts.productId);

    if (facts.test && !this.cfg.testGrants) {
      return this.testGrant(purchaseToken, code, facts.orderId);
    }
    const result = recordGrant(this.payments, this.priceZats, {
      rail: 'google',
      eventKey: facts.orderId,
      externalRef: purchaseToken,
      paymentCode: code,
      days: facts.days,
    });
    this.log.info({ order: facts.orderId, result }, 'google purchase verified');
    return { accepted: true, reason: result, days: facts.days, test: false };
  }

  private async fetchSubscription(
    purchaseToken: string,
  ): Promise<androidpublisher_v3.Schema$SubscriptionPurchaseV2> {
    const { data } = await this.publisher.purchases.subscriptionsv2.get({
      packageName: this.cfg.packageName,
      token: purchaseToken,
    });
    return data;
  }

  /** Why a subscription cannot be granted on, or null when it is active / in grace. */
  private inactiveReason(sub: androidpublisher_v3.Schema$SubscriptionPurchaseV2): string | null {
    if (
      sub.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE' &&
      sub.subscriptionState !== 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    ) {
      return `state:${sub.subscriptionState ?? 'unknown'}`;
    }
    return null;
  }

  /** Base plan, order id and period end of a verified subscription, or why they are unusable. */
  private periodFacts(
    sub: androidpublisher_v3.Schema$SubscriptionPurchaseV2,
  ): PeriodFacts | string {
    const line = sub.lineItems?.[0];
    const basePlan = line?.offerDetails?.basePlanId;
    const days = this.daysForBasePlan(basePlan);
    if (days === null) {
      return `unknown_base_plan:${basePlan ?? 'none'}`;
    }
    const orderId =
      line?.latestSuccessfulOrderId ??
      (sub as { latestOrderId?: string | null }).latestOrderId ??
      undefined;
    if (!orderId) {
      return 'no_order_id';
    }
    return {
      days,
      plan: days === 360 ? 'annual' : 'monthly',
      orderId,
      productId: line?.productId ?? undefined,
      expiryMs: line?.expiryTime ? Date.parse(line.expiryTime) : NaN,
      test: sub.testPurchase !== undefined && sub.testPurchase !== null,
    };
  }

  private daysForBasePlan(basePlanId: string | null | undefined): number | null {
    if (basePlanId === this.cfg.basePlanMonthly) {
      return 30;
    }
    if (basePlanId === this.cfg.basePlanAnnual) {
      return 360;
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
