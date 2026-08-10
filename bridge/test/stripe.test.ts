import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { StripeRail } from '../src/rails/stripe.js';
import type { StripeConfig } from '../src/config.js';

const CODE = base58.encode(new Uint8Array(20).fill(3));
const SECRET = 'whsec_test_secret';

const cfg: StripeConfig = {
  secretKey: 'sk_test_x',
  webhookSecret: SECRET,
  priceMonthly: 'price_monthly',
  priceAnnual: 'price_annual',
  successUrl: 'https://vpn.cumulusvpn.com/#/upgrade?session={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://vpn.cumulusvpn.com/#/upgrade',
};

const nullLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  silent: () => undefined,
  level: 'silent',
  child: function () {
    return this;
  },
} as unknown as FastifyBaseLogger;

function setup(): { rail: StripeRail; payments: PaymentsRepo; subs: SubscriptionsRepo } {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  return { rail: new StripeRail(cfg, 20e8, payments, subs, nullLog), payments, subs };
}

/** Sign an event payload exactly like Stripe's webhook delivery does. */
function signedEvent(payload: object): { raw: Buffer; sig: string } {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = Stripe.webhooks.generateTestHeaderString({
    payload: raw.toString('utf8'),
    secret: SECRET,
  });
  return { raw, sig };
}

function invoicePaidEvent(
  invoiceId: string,
  subId: string,
  plan: 'monthly' | 'annual',
  amountPaid = 199,
): object {
  return {
    id: `evt_${invoiceId}`,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        amount_paid: amountPaid,
        created: 1_700_000_000,
        parent: {
          subscription_details: {
            subscription: subId,
            metadata: { cvpn_code: CODE, cvpn_plan: plan },
          },
        },
      },
    },
  };
}

describe('stripe rail', () => {
  it('rejects a forged signature', async () => {
    const { rail } = setup();
    const raw = Buffer.from(JSON.stringify({ type: 'invoice.paid' }), 'utf8');
    await expect(rail.handleWebhook(raw, 't=1,v1=deadbeef')).rejects.toThrow();
  });

  it('grants one month per paid monthly invoice, idempotently across retries', async () => {
    const { rail, payments } = setup();
    const { raw, sig } = signedEvent(invoicePaidEvent('in_A', 'sub_1', 'monthly'));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    // Stripe redelivers the same invoice (retry or the twin event type).
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:duplicate');
    const rows = payments.byCode(CODE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rail: 'stripe',
      months: 1,
      flux_zats: 20e8,
      status: 'pending',
    });
  });

  it('grants 12 months for an annual invoice as a single 240-FLUX payment', async () => {
    const { rail, payments } = setup();
    const { raw, sig } = signedEvent(invoicePaidEvent('in_B', 'sub_2', 'annual', 1499));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ months: 12, flux_zats: 240e8 });
  });

  it('treats a new invoice on the same subscription as a fresh renewal grant', async () => {
    const { rail, payments } = setup();
    const a = signedEvent(invoicePaidEvent('in_C1', 'sub_3', 'monthly'));
    const b = signedEvent(invoicePaidEvent('in_C2', 'sub_3', 'monthly'));
    await rail.handleWebhook(a.raw, a.sig);
    await rail.handleWebhook(b.raw, b.sig);
    expect(payments.byCode(CODE)).toHaveLength(2);
  });

  it('ignores zero-amount invoices', async () => {
    const { rail, payments } = setup();
    const { raw, sig } = signedEvent(invoicePaidEvent('in_D', 'sub_4', 'monthly', 0));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:zero-amount');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('binds the subscription at checkout completion', async () => {
    const { rail, subs } = setup();
    const { raw, sig } = signedEvent({
      id: 'evt_cs',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          object: 'checkout.session',
          subscription: 'sub_5',
          metadata: { cvpn_code: CODE, cvpn_plan: 'annual' },
        },
      },
    });
    expect(await rail.handleWebhook(raw, sig)).toBe('checkout-completed:bound');
    expect(subs.get('stripe', 'sub_5')).toMatchObject({
      payment_code: CODE,
      plan: 'annual',
      status: 'active',
    });
  });

  it('marks a deleted subscription canceled', async () => {
    const { rail, subs } = setup();
    subs.upsert('stripe', 'sub_6', CODE, 'monthly');
    const { raw, sig } = signedEvent({
      id: 'evt_del',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_6', object: 'subscription' } },
    });
    expect(await rail.handleWebhook(raw, sig)).toBe('subscription:canceled');
    expect(subs.get('stripe', 'sub_6')?.status).toBe('canceled');
  });
});
