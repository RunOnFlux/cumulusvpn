/**
 * Stripe rail — hosted Checkout for card (and web Apple/Google Pay)
 * subscriptions. The payment code and plan ride as subscription metadata
 * (`cvpn_code`, `cvpn_plan`) so every renewal invoice carries them without a
 * client in the loop. Grants are keyed by INVOICE id: `invoice.paid` webhook
 * retries and event-id churn all collapse onto the same invoice.
 *
 * Once a subscription is moved to another code (a buyer's transfer, or a
 * support rebind — docs/18 "Claims and transfers"), the bridge's own
 * `subscriptions` binding is authoritative. The metadata is rewritten too,
 * but invoices already drafted, and webhook retries, still carry the old
 * copy.
 */
import Stripe from 'stripe';
import type { FastifyBaseLogger } from 'fastify';

import type { StripeConfig } from '../config.js';
import { PLAN_DAYS } from '../config.js';
import { recordGrant, type GrantResult } from '../grants.js';
import type { PaymentsRepo } from '../db/payments.js';
import type { Plan, SubscriptionsRepo, TransferActor } from '../db/subscriptions.js';
import type { VouchersRepo } from '../db/vouchers.js';
import {
  remainingDays,
  transferAvailableAt,
  transferEventKey,
  type ClaimOutcome,
  type RebindOutcome,
} from '../transfers.js';

/** Narrow Stripe's `string | Customer | DeletedCustomer | null` to an id. */
function customerId(ref: string | { id: string } | null | undefined): string | null {
  if (typeof ref === 'string') {
    return ref;
  }
  return ref?.id ?? null;
}

/**
 * Whether an invoice line is a proration.
 *
 * The flag moved into `parent.{subscription_item,invoice_item}_details` in the
 * basil API, while older payloads still carry it at the top level — read both,
 * exactly as `resolveInvoiceBinding` does for the subscription id.
 */
function isProration(line: Stripe.InvoiceLineItem): boolean {
  const l = line as unknown as {
    proration?: boolean;
    parent?: {
      subscription_item_details?: { proration?: boolean };
      invoice_item_details?: { proration?: boolean };
    };
  };
  return (
    l.proration === true ||
    l.parent?.subscription_item_details?.proration === true ||
    l.parent?.invoice_item_details?.proration === true
  );
}

/**
 * Price id an invoice line was billed at, across the basil
 * (`pricing.price_details.price`) and legacy (`price`) payload shapes.
 */
function priceIdOf(line: Stripe.InvoiceLineItem): string | null {
  const l = line as unknown as {
    pricing?: { price_details?: { price?: string | { id: string } } };
    price?: string | { id: string } | null;
  };
  const ref = l.pricing?.price_details?.price ?? l.price ?? null;
  if (typeof ref === 'string') {
    return ref;
  }
  return ref?.id ?? null;
}

/**
 * End of a subscription's current period (unix seconds), across the basil
 * (per-item `current_period_end`) and legacy (top-level) payload shapes.
 */
function periodEndOf(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = sub as unknown as { current_period_end?: number };
  return item?.current_period_end ?? legacy.current_period_end ?? null;
}

export class StripeRail {
  private readonly stripe: Stripe;
  /** Plan list prices in cents, keyed `plan:currency`, lazily read from Stripe. */
  private readonly listCents = new Map<string, number>();

  constructor(
    private readonly cfg: StripeConfig,
    private readonly priceZats: number,
    private readonly payments: PaymentsRepo,
    private readonly subs: SubscriptionsRepo,
    private readonly vouchers: VouchersRepo,
    private readonly log: FastifyBaseLogger,
  ) {
    this.stripe = new Stripe(cfg.secretKey);
  }

  /**
   * Create a hosted Checkout Session for a validated payment code.
   * `promoId` (a Stripe promotion-code id resolved from one of OUR discount
   * vouchers) applies the discount explicitly — deliberately NOT
   * `allow_promotion_codes` (mutually exclusive with `discounts`, and only
   * our own redeem box can also route grant codes with sane errors).
   */
  async createCheckout(
    code: string,
    plan: Plan,
    promoId?: string,
  ): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        { price: plan === 'annual' ? this.cfg.priceAnnual : this.cfg.priceMonthly, quantity: 1 },
      ],
      client_reference_id: code,
      metadata: { cvpn_code: code, cvpn_plan: plan },
      subscription_data: { metadata: { cvpn_code: code, cvpn_plan: plan } },
      ...(promoId ? { discounts: [{ promotion_code: promoId }] } : {}),
      success_url: this.cfg.successUrl,
      cancel_url: this.cfg.cancelUrl,
    });
    if (!session.url) {
      throw new Error('stripe: checkout session has no url');
    }
    return { url: session.url, sessionId: session.id };
  }

  /**
   * Provision the Stripe side of a discount-voucher batch: ONE coupon
   * (percent off, first invoice only) + one promotion code per voucher so
   * every code redeems exactly the campaign's discount and reports back via
   * invoice metadata.
   */
  async provisionDiscount(
    percentOff: number,
    campaign: string,
    codes: readonly string[],
    maxRedemptions: number,
    expiresAt: number | null,
  ): Promise<{ couponId: string; promoIds: string[] }> {
    const coupon = await this.stripe.coupons.create({
      percent_off: percentOff,
      duration: 'once',
      name: campaign !== '' ? campaign : (codes[0] ?? 'cvpn-discount'),
      metadata: { cvpn_campaign: campaign },
    });
    const promoIds: string[] = [];
    for (const code of codes) {
      const promo = await this.stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        code,
        max_redemptions: maxRedemptions,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
        metadata: { cvpn_code: code },
      });
      promoIds.push(promo.id);
    }
    return { couponId: coupon.id, promoIds };
  }

  /**
   * Open a Stripe billing portal (cancel, change card, switch plan) for a
   * completed Checkout Session.
   *
   * **Why the session id and not just the payment code:** the payment code is
   * `base58(sha256(device pubkey))`, and every gateway a device enrolls with
   * receives that pubkey — so gateway operators can derive their users' codes
   * at will. Authorizing a portal on the code alone would hand any operator
   * their users' billing email, card last-4, invoice history, and a cancel
   * button. The Checkout Session id is high-entropy and only ever reaches the
   * buyer's own browser, so it is the capability; the code is checked on top
   * of it purely to bind the two (a session may not be redeemed for a
   * different device's portal).
   *
   * @returns The portal URL, or null when the session is unknown, unbound, or
   *   bound to a different code — all of which the caller reports as 404 so a
   *   probe cannot distinguish them.
   */
  async createPortalSession(sessionId: string, code: string): Promise<string | null> {
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (e) {
      this.log.info({ err: e, session: sessionId }, 'portal: session lookup failed');
      return null;
    }
    if (session.metadata?.cvpn_code !== code) {
      return null;
    }
    const customer = customerId(session.customer);
    if (!customer) {
      return null;
    }
    const portal = await this.stripe.billingPortal.sessions.create({
      customer,
      return_url: this.cfg.portalReturnUrl,
    });
    return portal.url;
  }

  /**
   * Move a card subscription to another device's payment code, handing it the
   * rest of the current period.
   *
   * Authorized exactly like createPortalSession — by the Checkout Session id,
   * never by a payment code (see there for why) — except that the code here is
   * the NEW device's, so it cannot be checked against the session. The buyer
   * who holds the session may move the subscription again later, at most
   * once per 30 days.
   *
   * Refusals: `no_subscription` (unknown session, no subscription, or not
   * active / refunded), `already_bound`, `transfer_too_soon`.
   */
  async transferSubscription(sessionId: string, code: string): Promise<ClaimOutcome> {
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (e) {
      this.log.info({ err: e, session: sessionId }, 'transfer: session lookup failed');
      return { accepted: false, reason: 'no_subscription' };
    }
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) {
      return { accepted: false, reason: 'no_subscription' };
    }
    let sub: Stripe.Subscription;
    try {
      sub = await this.stripe.subscriptions.retrieve(subId);
    } catch (e) {
      this.log.info({ err: e, subscription: subId }, 'transfer: subscription lookup failed');
      return { accepted: false, reason: 'no_subscription' };
    }
    const known = this.subs.get('stripe', subId);
    if (sub.status !== 'active' || known?.status === 'refunded') {
      return { accepted: false, reason: 'no_subscription' };
    }
    const owner = known?.payment_code ?? sub.metadata.cvpn_code;
    if (owner === code) {
      return { accepted: false, reason: 'already_bound' };
    }
    const availableAt = transferAvailableAt(
      known?.transferred_at ?? null,
      Math.floor(Date.now() / 1000),
    );
    if (availableAt !== null) {
      return { accepted: false, reason: 'transfer_too_soon', availableAt };
    }
    const moved = this.transferTo(code, sub, known?.plan, 'user', true);
    await this.rewriteMetadata(subId, code);
    return {
      accepted: true,
      reason: `transfer:${moved.grant}`,
      days: moved.days,
      test: !sub.livemode,
      transferred: true,
    };
  }

  /**
   * Support override: move a subscription with no 30-day limit, optionally
   * granting the rest of the current period under the SAME per-period key a
   * buyer's transfer uses, so support cannot double-grant a period either.
   */
  async adminRebind(subId: string, code: string, grantRemaining: boolean): Promise<RebindOutcome> {
    const known = this.subs.get('stripe', subId);
    if (!known) {
      return { ok: false, reason: 'not_found' };
    }
    const sub = await this.stripe.subscriptions.retrieve(subId);
    if (grantRemaining && (sub.status !== 'active' || known.status === 'refunded')) {
      return { ok: false, reason: 'not_active' };
    }
    const moved = this.transferTo(code, sub, known.plan, 'admin', grantRemaining);
    await this.rewriteMetadata(subId, code);
    return {
      ok: true,
      reason: 'rebound',
      previousCode: moved.previous,
      days: moved.days,
      grant: moved.grant,
      test: !sub.livemode,
    };
  }

  /**
   * Rebind (and, when `grant`, hand over the rest of the period). Synchronous
   * on purpose: the caller's rate-limit check, the grant and the rebind run
   * with no await between them, so two racing transfers cannot both pass the
   * check. The grant is recorded BEFORE the rebind — a crash in between leaves
   * the subscription where it was, and the retry lands on the same
   * per-period key instead of losing the days.
   *
   * Test-mode subscriptions move but never settle unless STRIPE_TEST_GRANTS,
   * exactly like their invoices.
   */
  private transferTo(
    code: string,
    sub: Stripe.Subscription,
    knownPlan: Plan | undefined,
    actor: TransferActor,
    grant: boolean,
  ): { days: number; grant: GrantResult | 'none'; previous: string | null } {
    const item = sub.items?.data?.[0];
    const plan = (item ? this.planForPrice(item.price?.id) : null) ?? knownPlan ?? 'monthly';
    const periodEnd = periodEndOf(sub);
    const settles = grant && (sub.livemode || this.cfg.testGrants) && periodEnd !== null;
    const days = settles ? remainingDays(periodEnd * 1000, Date.now(), plan) : 0;
    const result =
      days > 0 && periodEnd !== null
        ? recordGrant(this.payments, this.priceZats, {
            rail: 'stripe',
            eventKey: transferEventKey(sub.id, periodEnd * 1000),
            externalRef: sub.id,
            paymentCode: code,
            days,
          })
        : 'none';
    const previous = this.subs.rebind('stripe', sub.id, code, plan, actor, days);
    this.log.info(
      { subscription: sub.id, actor, days, grant: result, livemode: sub.livemode },
      'stripe subscription transferred',
    );
    return { days, grant: result, previous };
  }

  /**
   * Point the subscription metadata at the new code, so the Stripe dashboard
   * and future invoices agree with the bridge. Best effort: the bridge's own
   * binding already won in resolveInvoiceBinding, so a failure here must not
   * fail a move that has been recorded.
   */
  private async rewriteMetadata(subId: string, code: string): Promise<void> {
    try {
      await this.stripe.subscriptions.update(subId, { metadata: { cvpn_code: code } });
    } catch (e) {
      this.log.warn({ err: e, subscription: subId }, 'stripe metadata rewrite failed');
    }
  }

  /** Deactivate the Stripe promotion code behind a revoked discount voucher. */
  async deactivatePromo(promoId: string): Promise<void> {
    await this.stripe.promotionCodes.update(promoId, { active: false });
  }

  /** Verify + dispatch a webhook delivery. Returns a short outcome slug for logging. */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<string> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.cfg.webhookSecret);
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event.data.object);
      case 'invoice.paid':
        return this.onInvoicePaid(event.data.object);
      case 'charge.refunded':
        return this.onChargeRefunded(event.data.object);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event.data.object);
      default:
        return `ignored:${event.type}`;
    }
  }

  private onCheckoutCompleted(session: Stripe.Checkout.Session): string {
    const code = session.metadata?.cvpn_code;
    const plan = session.metadata?.cvpn_plan === 'annual' ? 'annual' : 'monthly';
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!code || !subId) {
      return 'checkout-completed:missing-binding';
    }
    // A redelivery of this event after a transfer must not move it back.
    const bound = this.subs.get('stripe', subId)?.payment_code ?? code;
    this.subs.upsert('stripe', subId, bound, plan, customerId(session.customer));
    return 'checkout-completed:bound';
  }

  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<string> {
    const hasDiscount = (invoice.total_discount_amounts ?? []).some((d) => d.amount > 0);
    // A 100%-off promotion legitimately produces a $0 invoice that must
    // still grant; only discount-less $0 anomalies (trials we never
    // configure) stay skipped.
    //
    // Invoices settled from a CREDIT BALANCE are deliberately in that skipped
    // set. The only way our customers acquire credit is a downgrade, whose
    // unused value we already handed out in full as irrevocable chain days —
    // spending that credit on fresh grants would pay for the same time twice.
    if (invoice.amount_paid === 0 && !hasDiscount) {
      return 'invoice:zero-amount';
    }
    const bound = await this.resolveInvoiceBinding(invoice);
    if (!bound) {
      return 'invoice:no-subscription-binding';
    }
    const { subId, code } = bound;
    const lines = await this.invoiceLines(invoice);
    const plan = this.planForLines(lines) ?? bound.plan;
    this.subs.upsert('stripe', subId, code, plan, customerId(invoice.customer));
    // Test-mode invoices bind like any other but must not spend the treasury,
    // mirroring APPLE_SANDBOX_GRANTS / GOOGLE_TEST_GRANTS. Without this a
    // single 4242 checkout against sk_test_ broadcasts a real 20-FLUX tx, and
    // a testing session drains the wallet quietly.
    if (!invoice.livemode && !this.cfg.testGrants) {
      this.log.info({ invoice: invoice.id }, 'stripe test-mode invoice verified (no chain grant)');
      return 'invoice:test-mode';
    }
    const days = await this.daysForInvoice(invoice, lines, plan);
    if (days < 1) {
      // A downgrade's credit exceeds the new charge: the old plan's days are
      // already on chain and still running. Nothing to buy.
      this.log.info({ invoice: invoice.id, plan }, 'stripe invoice grants no days (net credit)');
      return 'invoice:no-days';
    }
    const result: GrantResult = recordGrant(this.payments, this.priceZats, {
      rail: 'stripe',
      eventKey: invoice.id ?? `invoice-missing-${subId}-${invoice.created}`,
      externalRef: subId,
      paymentCode: code,
      days,
    });
    if (hasDiscount && result === 'queued') {
      await this.trackDiscountRedemption(invoice, code);
    }
    this.log.info({ invoice: invoice.id, result }, 'stripe invoice.paid');
    return `invoice:${result}`;
  }

  /**
   * Every line on the invoice.
   *
   * Webhook payloads carry only the first page plus `has_more`. Reading a
   * partial list would let an invoice whose proration lines fall past the
   * first page take the "ordinary renewal" branch and silently grant a full
   * plan, so fetch the rest rather than guess.
   */
  private async invoiceLines(invoice: Stripe.Invoice): Promise<Stripe.InvoiceLineItem[]> {
    const page = invoice.lines;
    if (page?.has_more !== true || !invoice.id) {
      return page?.data ?? [];
    }
    const all = await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 });
    return all.data;
  }

  /**
   * The plan this invoice actually bills, read from its lines' price ids.
   *
   * Deliberately **not** from `cvpn_plan` metadata. That is written once at
   * Checkout and Stripe never rewrites it when a subscription's price
   * changes, so after a portal plan switch the metadata still names the plan
   * the customer LEFT. Sizing grants from it would give an upgraded
   * subscriber 30 days for a year's payment, and a downgraded one a fresh
   * 360 days every single month — a treasury drain. The price id on the line
   * is what was actually charged.
   *
   * A plan-change invoice carries both halves — a credit at the old price and
   * a charge at the new one — so the largest POSITIVE line is the plan being
   * bought. Returns null when no line matches a configured price, leaving the
   * caller on the metadata fallback.
   */
  private planForLines(lines: readonly Stripe.InvoiceLineItem[]): Plan | null {
    let best: { plan: Plan; amount: number } | null = null;
    for (const line of lines) {
      const plan = this.planForPrice(priceIdOf(line));
      if (plan === null || line.amount <= 0) {
        continue;
      }
      if (best === null || line.amount > best.amount) {
        best = { plan, amount: line.amount };
      }
    }
    return best?.plan ?? null;
  }

  /** The plan a configured price id bills, or null for any other price. */
  private planForPrice(id: string | null | undefined): Plan | null {
    return id === this.cfg.priceAnnual ? 'annual' : id === this.cfg.priceMonthly ? 'monthly' : null;
  }

  /**
   * How many days this invoice actually bought.
   *
   * The ordinary path is deliberately untouched: an invoice with no proration
   * lines grants the whole plan, discounted or not — a promo code buys a
   * cheaper month, never a shorter one.
   *
   * A **plan change** is the case that needs arithmetic. Stripe puts both
   * halves on one invoice — a credit for the unused remainder of the old plan
   * and a charge for the new one — but the days the old plan bought are
   * already settled on chain and cannot be clawed back. Granting a fresh full
   * plan on top would make the treasury pay for that overlap twice. So a
   * prorated invoice grants in proportion to what it actually charged:
   * `subtotal / list price` of the plan.
   *
   * `total_excluding_tax` is the numerator: the money actually owed for this
   * period, net of proration credits AND of any discount, without VAT
   * inflating it. `subtotal` would be wrong — Stripe defines it as the line
   * total BEFORE invoice-level discounts (which is what `total_discount_amounts`
   * reports separately), so a discounted switch would scale off money that was
   * never charged. A monthly→annual switch lands around 340 days (a year minus
   * the monthly days already granted); annual→monthly goes negative and grants
   * nothing, which is correct because the annual days are still running.
   *
   * Sub-30-day results settle below one price unit and therefore depend on
   * the fleet's pro-rata day rule (docs/04, the same dependency vouchers
   * carry). Realistic plan switches land far above that, so this is a note,
   * not a gate.
   */
  private async daysForInvoice(
    invoice: Stripe.Invoice,
    lines: readonly Stripe.InvoiceLineItem[],
    plan: Plan,
  ): Promise<number> {
    if (!lines.some(isProration)) {
      return PLAN_DAYS[plan];
    }
    const listCents = await this.planListCents(plan, invoice.currency);
    const net = invoice.total_excluding_tax ?? invoice.subtotal ?? 0;
    const days = Math.round((PLAN_DAYS[plan] * net) / listCents);
    // Never more than the plan itself: a surprise positive line (a one-off
    // invoice item swept in) must not mint extra entitlement.
    return Math.max(0, Math.min(days, PLAN_DAYS[plan]));
  }

  /**
   * List price of a plan, from Stripe itself rather than a constant here (a
   * Price's `unit_amount` is immutable, so this is cached for the process
   * lifetime and only fetched when a prorated invoice actually needs it).
   *
   * Cached per currency and checked against the invoice's: dividing a
   * presentment-currency total by a base-currency list price would silently
   * mis-size every prorated grant the day anyone adds a second currency.
   */
  private async planListCents(plan: Plan, currency: string): Promise<number> {
    const key = `${plan}:${currency}`;
    const cached = this.listCents.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const id = plan === 'annual' ? this.cfg.priceAnnual : this.cfg.priceMonthly;
    const price = await this.stripe.prices.retrieve(id);
    const amount = price.unit_amount;
    if (amount === null || amount <= 0) {
      // Throwing fails the webhook so Stripe retries, which beats guessing a
      // grant size from a price we could not read.
      throw new Error(`stripe: price ${id} has no positive unit_amount`);
    }
    if (price.currency !== currency) {
      throw new Error(`stripe: price ${id} is ${price.currency} but invoice is ${currency}`);
    }
    this.listCents.set(key, amount);
    return amount;
  }

  /**
   * Attribute a discounted invoice back to our voucher (dashboard stats).
   * Best effort: unknown coupons (console-created) are silently skipped, and
   * the UNIQUE(voucher, code) INSERT absorbs webhook retries.
   */
  private async trackDiscountRedemption(invoice: Stripe.Invoice, code: string): Promise<string> {
    try {
      const promoIds = new Set<string>();
      const couponIds = new Set<string>();
      const collect = (d: unknown): void => {
        if (!d || typeof d !== 'object') {
          return;
        }
        const disc = d as {
          promotion_code?: string | { id: string };
          coupon?: string | { id: string };
        };
        const promo =
          typeof disc.promotion_code === 'string' ? disc.promotion_code : disc.promotion_code?.id;
        const coupon = typeof disc.coupon === 'string' ? disc.coupon : disc.coupon?.id;
        if (promo) {
          promoIds.add(promo);
        }
        if (coupon) {
          couponIds.add(coupon);
        }
      };
      for (const d of invoice.discounts ?? []) {
        collect(d);
      }
      if (promoIds.size === 0 && couponIds.size === 0 && invoice.id) {
        const expanded = await this.stripe.invoices.retrieve(invoice.id, {
          expand: ['discounts', 'discounts.promotion_code'],
        });
        for (const d of expanded.discounts ?? []) {
          collect(d);
        }
      }
      let voucher;
      for (const p of promoIds) {
        voucher = this.vouchers.byStripePromoId(p);
        if (voucher) {
          break;
        }
      }
      if (!voucher) {
        for (const c of couponIds) {
          voucher = this.vouchers.byStripeCouponId(c);
          if (voucher) {
            break;
          }
        }
      }
      if (!voucher) {
        return 'discount:unknown-coupon';
      }
      this.vouchers.recordDiscountRedemption(voucher.id, code, null);
      return 'discount:tracked';
    } catch (e) {
      this.log.warn({ err: e, invoice: invoice.id }, 'discount attribution failed');
      return 'discount:error';
    }
  }

  /**
   * Find (subscription id, code, plan) for an invoice. Subscription metadata
   * is copied onto invoices by Stripe, but the exact field moved across API
   * versions — try the modern shape, then the legacy one, then fall back to
   * retrieving the subscription itself.
   *
   * The code the bridge has persisted for the subscription wins over all of
   * them: after a transfer the metadata on an already-drafted invoice (and on
   * any webhook retry) still names the device it was moved away from. Before
   * any transfer the two are the same code, so this changes nothing.
   */
  private async resolveInvoiceBinding(
    invoice: Stripe.Invoice,
  ): Promise<{ subId: string; code: string; plan: Plan } | null> {
    // Modern (basil): invoice.parent.subscription_details
    const parent = (
      invoice as unknown as {
        parent?: {
          subscription_details?: {
            subscription?: string | { id: string };
            metadata?: Record<string, string>;
          };
        };
      }
    ).parent;
    const legacy = invoice as unknown as {
      subscription?: string | { id: string };
      subscription_details?: { metadata?: Record<string, string> };
    };
    const subRef = parent?.subscription_details?.subscription ?? legacy.subscription;
    const subId = typeof subRef === 'string' ? subRef : subRef?.id;
    if (!subId) {
      return null;
    }
    const meta = parent?.subscription_details?.metadata ?? legacy.subscription_details?.metadata;
    let code = meta?.cvpn_code;
    let planRaw = meta?.cvpn_plan;
    if (!code) {
      const sub = await this.stripe.subscriptions.retrieve(subId);
      code = sub.metadata.cvpn_code;
      planRaw = sub.metadata.cvpn_plan;
    }
    code = this.subs.get('stripe', subId)?.payment_code ?? code;
    if (!code) {
      return null;
    }
    return { subId, code, plan: planRaw === 'annual' ? 'annual' : 'monthly' };
  }

  private async onChargeRefunded(charge: Stripe.Charge): Promise<string> {
    // Chain grants are irrevocable; the response to a refund is to stop the
    // bleeding — mark the subscription and cancel it at Stripe.
    const invoiceRef = (charge as unknown as { invoice?: string | { id: string } }).invoice;
    const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id;
    if (!invoiceId) {
      return 'refund:no-invoice';
    }
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      const bound = await this.resolveInvoiceBinding(invoice);
      if (!bound) {
        return 'refund:no-subscription';
      }
      this.subs.setStatus('stripe', bound.subId, 'refunded');
      await this.stripe.subscriptions.cancel(bound.subId).catch(() => undefined);
      this.log.warn({ subscription: bound.subId }, 'stripe charge refunded; subscription canceled');
      return 'refund:handled';
    } catch (e) {
      this.log.error({ err: e, invoice: invoiceId }, 'refund handling failed');
      return 'refund:error';
    }
  }

  private onSubscriptionDeleted(sub: Stripe.Subscription): string {
    if (this.subs.get('stripe', sub.id)?.status === 'active') {
      this.subs.setStatus('stripe', sub.id, 'canceled');
    }
    return 'subscription:canceled';
  }
}
