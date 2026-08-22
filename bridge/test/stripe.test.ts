import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { VouchersRepo } from '../src/db/vouchers.js';
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
  portalReturnUrl: 'https://vpn.cumulusvpn.com/#/upgrade',
  testGrants: false,
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

function setup(): {
  rail: StripeRail;
  payments: PaymentsRepo;
  subs: SubscriptionsRepo;
  vouchers: VouchersRepo;
} {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  const vouchers = new VouchersRepo(db, payments, 20e8);
  return {
    rail: new StripeRail(cfg, 20e8, payments, subs, vouchers, nullLog),
    payments,
    subs,
    vouchers,
  };
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
        livemode: true,
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
      days: 30,
      flux_zats: 20e8,
      status: 'pending',
    });
  });

  it('grants 360 days for an annual invoice as a single 240-FLUX payment', async () => {
    const { rail, payments } = setup();
    const { raw, sig } = signedEvent(invoicePaidEvent('in_B', 'sub_2', 'annual', 1499));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 360, flux_zats: 240e8 });
  });

  it('treats a new invoice on the same subscription as a fresh renewal grant', async () => {
    const { rail, payments } = setup();
    const a = signedEvent(invoicePaidEvent('in_C1', 'sub_3', 'monthly'));
    const b = signedEvent(invoicePaidEvent('in_C2', 'sub_3', 'monthly'));
    await rail.handleWebhook(a.raw, a.sig);
    await rail.handleWebhook(b.raw, b.sig);
    expect(payments.byCode(CODE)).toHaveLength(2);
  });

  it('grants a 100%-discounted invoice (zero amount WITH a discount)', async () => {
    const { rail, payments, vouchers } = setup();
    const [v] = vouchers.createBatch(
      { type: 'stripe_discount', value: 100, maxRedemptions: 10 },
      ['FREEMONTH23'],
      { couponId: 'coup_free', promoIds: ['promo_free'] },
    );
    const ev = invoicePaidEvent('in_free', 'sub_free', 'monthly', 0) as {
      data: { object: Record<string, unknown> };
    };
    ev.data.object.total_discount_amounts = [{ amount: 199, discount: 'di_1' }];
    ev.data.object.discounts = [{ promotion_code: 'promo_free', coupon: 'coup_free' }];
    const { raw, sig } = signedEvent(ev);
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 30, flux_zats: 20e8 });
    // ...and the redemption was attributed to our voucher for stats.
    expect(vouchers.byId(v!.id)!.redemption_count).toBe(1);
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

  it('remembers the Stripe customer, and a renewal without one never wipes it', async () => {
    const { rail, subs } = setup();
    const checkout = signedEvent({
      id: 'evt_cs2',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_2',
          object: 'checkout.session',
          subscription: 'sub_7',
          customer: 'cus_7',
          metadata: { cvpn_code: CODE, cvpn_plan: 'monthly' },
        },
      },
    });
    await rail.handleWebhook(checkout.raw, checkout.sig);
    expect(subs.get('stripe', 'sub_7')?.stripe_customer_id).toBe('cus_7');

    // A renewal invoice that carries no customer field must COALESCE, not null it.
    const renewal = signedEvent(invoicePaidEvent('in_R', 'sub_7', 'monthly'));
    await rail.handleWebhook(renewal.raw, renewal.sig);
    expect(subs.get('stripe', 'sub_7')?.stripe_customer_id).toBe('cus_7');
    expect(subs.listForCode(CODE).map((r) => r.external_id)).toContain('sub_7');
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

/**
 * Stub the two Stripe network calls the portal path makes. `retrieve` is given
 * the session object to return (or an Error to throw, standing in for an
 * unknown id).
 */
function stubPortal(
  rail: StripeRail,
  session: object | Error,
): { portalCalls: { customer: string; return_url: string }[] } {
  const portalCalls: { customer: string; return_url: string }[] = [];
  (rail as unknown as { stripe: unknown }).stripe = {
    checkout: {
      sessions: {
        retrieve: () =>
          session instanceof Error ? Promise.reject(session) : Promise.resolve(session),
      },
    },
    billingPortal: {
      sessions: {
        create: (args: { customer: string; return_url: string }) => {
          portalCalls.push(args);
          return Promise.resolve({ url: 'https://billing.stripe.com/p/session/live_xyz' });
        },
      },
    },
  };
  return { portalCalls };
}

/**
 * A plan-change invoice: Stripe credits the unused old plan and charges the
 * new one on the same invoice, both lines flagged as prorations. The charge
 * line carries the NEW plan's price id — which is how the rail must learn the
 * plan, since `cvpn_plan` metadata still names the plan being left.
 */
function planChangeEvent(
  invoiceId: string,
  subId: string,
  toPlan: 'monthly' | 'annual',
  net: number,
  over: {
    legacyProrationFlag?: boolean;
    /** What stale Checkout metadata claims — defaults to the plan left behind. */
    metadataPlan?: 'monthly' | 'annual';
    creditAmount?: number;
    currency?: string;
  } = {},
): object {
  const prorationFlag = over.legacyProrationFlag
    ? { proration: true }
    : { parent: { subscription_item_details: { proration: true } } };
  const toPrice = toPlan === 'annual' ? 'price_annual' : 'price_monthly';
  const fromPrice = toPlan === 'annual' ? 'price_monthly' : 'price_annual';
  const charge = toPlan === 'annual' ? 1499 : 199;
  return {
    id: `evt_${invoiceId}`,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        livemode: true,
        amount_paid: Math.max(0, net),
        subtotal: net,
        total_excluding_tax: net,
        currency: over.currency ?? 'usd',
        created: 1_700_000_000,
        lines: {
          has_more: false,
          data: [
            {
              id: 'il_credit',
              amount: over.creditAmount ?? -66,
              pricing: { price_details: { price: fromPrice } },
              ...prorationFlag,
            },
            {
              id: 'il_charge',
              amount: charge,
              pricing: { price_details: { price: toPrice } },
              ...prorationFlag,
            },
          ],
        },
        parent: {
          subscription_details: {
            subscription: subId,
            // Stripe never rewrites this on a price change, so it still names
            // the plan the customer LEFT — the trap this suite guards.
            metadata: {
              cvpn_code: CODE,
              cvpn_plan: over.metadataPlan ?? (toPlan === 'annual' ? 'monthly' : 'annual'),
            },
          },
        },
      },
    },
  };
}

describe('stripe plan changes (proration)', () => {
  /** Stub the Price lookup the prorated path needs. */
  function stubPrices(
    rail: StripeRail,
    unitAmount: number | null,
    currency = 'usd',
  ): { calls: string[] } {
    const calls: string[] = [];
    (rail as unknown as { stripe: { prices: unknown } }).stripe.prices = {
      retrieve: (id: string) => {
        calls.push(id);
        return Promise.resolve({ id, unit_amount: unitAmount, currency });
      },
    };
    return { calls };
  }

  it('grants the whole plan on an ordinary renewal, without asking Stripe for prices', async () => {
    // The common path must not regress — no proration lines, no extra API
    // call, exactly 30 days as before.
    const { rail, payments } = setup();
    const { calls } = stubPrices(rail, 199);
    const { raw, sig } = signedEvent(invoicePaidEvent('in_plain', 'sub_p1', 'monthly'));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 30 });
    expect(calls).toEqual([]);
  });

  it('scales the grant to the money charged when switching monthly → annual', async () => {
    // 1499 - 66 credit = 1433 charged against a 1499 list price.
    // round(360 * 1433 / 1499) = 344 days — the ~16 days the monthly plan
    // already put on chain are not paid for a second time.
    const { rail, payments } = setup();
    const { calls } = stubPrices(rail, 1499);
    const { raw, sig } = signedEvent(planChangeEvent('in_up', 'sub_p2', 'annual', 1433));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 344 });
    expect(calls).toEqual(['price_annual']);
  });

  it('reads the legacy top-level proration flag too', async () => {
    const { rail, payments } = setup();
    stubPrices(rail, 1499);
    const { raw, sig } = signedEvent(
      planChangeEvent('in_legacy', 'sub_p3', 'annual', 1433, { legacyProrationFlag: true }),
    );
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 344 });
  });

  it('grants nothing when a downgrade credit exceeds the new charge', async () => {
    // Annual → monthly mid-term: the annual days are already on chain and
    // still running, and the invoice is a net credit that goes INTO the
    // customer balance, so nothing is collected. The zero-amount guard
    // catches it before the day maths; what matters is that no second grant
    // is minted for time already paid.
    const { rail, payments } = setup();
    stubPrices(rail, 199);
    const { raw, sig } = signedEvent(
      planChangeEvent('in_down', 'sub_p4', 'monthly', -1050, { creditAmount: -1249 }),
    );
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:zero-amount');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('does NOT grant a renewal settled from a downgrade credit balance', async () => {
    // The credit only exists because a downgrade left unused annual value
    // behind — and we already handed those annual days out as irrevocable
    // chain time. Granting again here would pay for the same period twice,
    // month after month, until the balance ran out.
    const { rail, payments } = setup();
    stubPrices(rail, 199);
    const ev = invoicePaidEvent('in_credit', 'sub_p6', 'monthly', 0) as {
      data: { object: Record<string, unknown> };
    };
    ev.data.object.starting_balance = -1050;
    ev.data.object.ending_balance = -851;
    const { raw, sig } = signedEvent(ev);
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:zero-amount');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('sizes an upgrade from the LINE price, not the stale cvpn_plan metadata', async () => {
    // Stripe never rewrites subscription metadata when the price changes, so
    // after a portal switch it still says "monthly". Trusting it would size
    // 344 annual days against the $1.99 list price and clamp the result to 30
    // days for a $14.33 charge.
    const { rail, payments } = setup();
    const { calls } = stubPrices(rail, 1499);
    const { raw, sig } = signedEvent(
      planChangeEvent('in_stale_up', 'sub_s1', 'annual', 1433, { metadataPlan: 'monthly' }),
    );
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 344 });
    expect(calls).toEqual(['price_annual']);
  });

  it('grants a post-downgrade monthly renewal 30 days, not the stale annual 360', async () => {
    // The treasury-drain half of the same trap: metadata still says "annual",
    // the invoice is an ordinary $1.99 monthly renewal with no proration, and
    // a metadata-sized grant would mint 360 days every month.
    const { rail, payments, subs } = setup();
    stubPrices(rail, 199);
    const ev = invoicePaidEvent('in_stale_down', 'sub_s2', 'annual') as {
      data: { object: Record<string, unknown> };
    };
    ev.data.object.currency = 'usd';
    ev.data.object.lines = {
      has_more: false,
      data: [{ id: 'il', amount: 199, pricing: { price_details: { price: 'price_monthly' } } }],
    };
    const { raw, sig } = signedEvent(ev);
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 30 });
    // ...and the stored plan is corrected too, so support sees the truth.
    expect(subs.get('stripe', 'sub_s2')?.plan).toBe('monthly');
  });

  it('refuses to size a grant when the price currency differs from the invoice', async () => {
    const { rail, payments } = setup();
    stubPrices(rail, 1499, 'eur');
    const { raw, sig } = signedEvent(planChangeEvent('in_cur', 'sub_s3', 'annual', 1433));
    await expect(rail.handleWebhook(raw, sig)).rejects.toThrow(/eur but invoice is usd/);
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('fetches the rest of a paginated line list instead of assuming no proration', async () => {
    // Webhooks carry only the first page. A proration line beyond it would
    // otherwise take the "ordinary renewal" branch and grant a full plan.
    const { rail, payments } = setup();
    stubPrices(rail, 1499);
    const listed: string[] = [];
    (rail as unknown as { stripe: { invoices: Record<string, unknown> } }).stripe.invoices = {
      listLineItems: (id: string) => {
        listed.push(id);
        return Promise.resolve({
          data: [
            {
              id: 'il_credit',
              amount: -66,
              pricing: { price_details: { price: 'price_monthly' } },
              parent: { subscription_item_details: { proration: true } },
            },
            {
              id: 'il_charge',
              amount: 1499,
              pricing: { price_details: { price: 'price_annual' } },
              parent: { subscription_item_details: { proration: true } },
            },
          ],
        });
      },
    };
    const ev = planChangeEvent('in_paged', 'sub_s4', 'annual', 1433) as {
      data: { object: Record<string, unknown> };
    };
    // First page hides the proration entirely.
    ev.data.object.lines = {
      has_more: true,
      data: [{ id: 'il_other', amount: 0 }],
    };
    const { raw, sig } = signedEvent(ev);
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(listed).toEqual(['in_paged']);
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 344 });
  });

  it('grants nothing when a collected invoice still nets out to no days', async () => {
    // Something was collected (so the zero-amount guard lets it through) but
    // the subscription lines are a net credit — the day maths must stop it.
    const { rail, payments } = setup();
    stubPrices(rail, 199);
    const ev = planChangeEvent('in_net0', 'sub_p9', 'monthly', -1050) as {
      data: { object: Record<string, unknown> };
    };
    ev.data.object.amount_paid = 5; // e.g. tax collected on a credited switch
    const { raw, sig } = signedEvent(ev);
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:no-days');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('never grants more than the plan even if a stray line inflates the subtotal', async () => {
    const { rail, payments } = setup();
    stubPrices(rail, 1499);
    const { raw, sig } = signedEvent(planChangeEvent('in_big', 'sub_p5', 'annual', 9999));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 360 });
  });

  it('still skips a discount-less zero invoice (trial)', async () => {
    const { rail, payments } = setup();
    stubPrices(rail, 199);
    const { raw, sig } = signedEvent(invoicePaidEvent('in_trial', 'sub_p7', 'monthly', 0));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:zero-amount');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('fails the webhook (so Stripe retries) when the list price cannot be read', async () => {
    const { rail, payments } = setup();
    stubPrices(rail, null);
    const { raw, sig } = signedEvent(planChangeEvent('in_noprice', 'sub_p8', 'annual', 1433));
    await expect(rail.handleWebhook(raw, sig)).rejects.toThrow(/unit_amount/);
    expect(payments.byCode(CODE)).toHaveLength(0);
  });
});

describe('stripe billing portal', () => {
  const session = (over: object = {}): object => ({
    id: 'cs_live_abc',
    object: 'checkout.session',
    customer: 'cus_9',
    metadata: { cvpn_code: CODE, cvpn_plan: 'monthly' },
    ...over,
  });

  it('opens a portal for the customer behind a matching checkout session', async () => {
    const { rail } = setup();
    const { portalCalls } = stubPortal(rail, session());
    await expect(rail.createPortalSession('cs_live_abc', CODE)).resolves.toContain(
      'billing.stripe.com',
    );
    expect(portalCalls).toEqual([{ customer: 'cus_9', return_url: cfg.portalReturnUrl }]);
  });

  it('refuses a session bound to a different payment code', async () => {
    // The security property: knowing someone's payment code (every gateway
    // operator does — it is derived from the pubkey clients enroll with) must
    // not open their billing portal. Only the session id they never see does.
    const { rail } = setup();
    const other = base58.encode(new Uint8Array(20).fill(9));
    const { portalCalls } = stubPortal(rail, session({ metadata: { cvpn_code: other } }));
    await expect(rail.createPortalSession('cs_live_abc', CODE)).resolves.toBeNull();
    expect(portalCalls).toHaveLength(0);
  });

  it('returns null for an unknown session id and for one with no customer', async () => {
    const { rail } = setup();
    stubPortal(rail, new Error('No such checkout.session'));
    await expect(rail.createPortalSession('cs_bogus', CODE)).resolves.toBeNull();

    const { rail: rail2 } = setup();
    const { portalCalls } = stubPortal(rail2, session({ customer: null }));
    await expect(rail2.createPortalSession('cs_live_abc', CODE)).resolves.toBeNull();
    expect(portalCalls).toHaveLength(0);
  });
});

describe('stripe test-mode grants', () => {
  /** Same rail, but configured to settle test invoices on chain. */
  function setupTestGrants(): { rail: StripeRail; payments: PaymentsRepo } {
    const db = openDb(':memory:');
    const payments = new PaymentsRepo(db);
    const subs = new SubscriptionsRepo(db);
    const vouchers = new VouchersRepo(db, payments, 20e8);
    const rail = new StripeRail(
      { ...cfg, testGrants: true },
      20e8,
      payments,
      subs,
      vouchers,
      nullLog,
    );
    return { rail, payments };
  }

  function testModeInvoice(id: string, sub: string): object {
    const ev = invoicePaidEvent(id, sub, 'monthly') as {
      data: { object: Record<string, unknown> };
    };
    ev.data.object.livemode = false;
    return ev;
  }

  it('binds the subscription but spends no treasury on a test-mode invoice', async () => {
    // The trap: sk_test_ + one 4242 checkout would otherwise broadcast a real
    // 20-FLUX tx, and a testing session drains the wallet unnoticed.
    const { rail, payments, subs } = setup();
    const { raw, sig } = signedEvent(testModeInvoice('in_test1', 'sub_t1'));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:test-mode');
    expect(payments.byCode(CODE)).toHaveLength(0);
    // ...but the binding is still recorded, exactly as the Apple rail does.
    expect(subs.get('stripe', 'sub_t1')).toMatchObject({ payment_code: CODE });
  });

  it('does settle test invoices when STRIPE_TEST_GRANTS is on', async () => {
    const { rail, payments } = setupTestGrants();
    const { raw, sig } = signedEvent(testModeInvoice('in_test2', 'sub_t2'));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 30 });
  });

  it('never affects live invoices', async () => {
    const { rail, payments } = setup();
    const { raw, sig } = signedEvent(invoicePaidEvent('in_live', 'sub_l1', 'monthly'));
    expect(await rail.handleWebhook(raw, sig)).toBe('invoice:queued');
    expect(payments.byCode(CODE)[0]).toMatchObject({ days: 30 });
  });
});
