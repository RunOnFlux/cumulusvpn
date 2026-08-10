/**
 * Stripe rail — hosted Checkout for card (and web Apple/Google Pay)
 * subscriptions. The payment code and plan ride as subscription metadata
 * (`cvpn_code`, `cvpn_plan`) so every renewal invoice carries them without a
 * client in the loop. Grants are keyed by INVOICE id: `invoice.paid` webhook
 * retries and event-id churn all collapse onto the same invoice.
 */
import Stripe from 'stripe';
import type { FastifyBaseLogger } from 'fastify';

import type { StripeConfig } from '../config.js';
import { PLAN_MONTHS } from '../config.js';
import { recordGrant, type GrantResult } from '../grants.js';
import type { PaymentsRepo } from '../db/payments.js';
import type { Plan, SubscriptionsRepo } from '../db/subscriptions.js';

export class StripeRail {
  private readonly stripe: Stripe;

  constructor(
    private readonly cfg: StripeConfig,
    private readonly priceZats: number,
    private readonly payments: PaymentsRepo,
    private readonly subs: SubscriptionsRepo,
    private readonly log: FastifyBaseLogger,
  ) {
    this.stripe = new Stripe(cfg.secretKey);
  }

  /** Create a hosted Checkout Session for a validated payment code. */
  async createCheckout(code: string, plan: Plan): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        { price: plan === 'annual' ? this.cfg.priceAnnual : this.cfg.priceMonthly, quantity: 1 },
      ],
      client_reference_id: code,
      metadata: { cvpn_code: code, cvpn_plan: plan },
      subscription_data: { metadata: { cvpn_code: code, cvpn_plan: plan } },
      success_url: this.cfg.successUrl,
      cancel_url: this.cfg.cancelUrl,
    });
    if (!session.url) {
      throw new Error('stripe: checkout session has no url');
    }
    return { url: session.url, sessionId: session.id };
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
    this.subs.upsert('stripe', subId, code, plan);
    return 'checkout-completed:bound';
  }

  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<string> {
    if (invoice.amount_paid === 0) {
      return 'invoice:zero-amount';
    }
    const bound = await this.resolveInvoiceBinding(invoice);
    if (!bound) {
      return 'invoice:no-subscription-binding';
    }
    const { subId, code, plan } = bound;
    this.subs.upsert('stripe', subId, code, plan);
    const result: GrantResult = recordGrant(this.payments, this.priceZats, {
      rail: 'stripe',
      eventKey: invoice.id ?? `invoice-missing-${subId}-${invoice.created}`,
      externalRef: subId,
      paymentCode: code,
      months: PLAN_MONTHS[plan],
    });
    this.log.info({ invoice: invoice.id, result }, 'stripe invoice.paid');
    return `invoice:${result}`;
  }

  /**
   * Find (subscription id, code, plan) for an invoice. Subscription metadata
   * is copied onto invoices by Stripe, but the exact field moved across API
   * versions — try the modern shape, then the legacy one, then fall back to
   * retrieving the subscription itself.
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
