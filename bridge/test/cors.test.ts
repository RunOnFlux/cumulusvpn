import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { VouchersRepo } from '../src/db/vouchers.js';
import { buildServer } from '../src/server.js';
import type { ChainClient } from '../src/chain.js';

const WEB = 'https://vpn.cumulusvpn.com';

const BASE_ENV: NodeJS.ProcessEnv = {
  PAYMENT_ADDRESS: 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ',
  TREASURY_WIF: 'not-a-real-wif',
  ADMIN_TOKEN: 'admin-token',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_MONTHLY: 'price_m',
  STRIPE_PRICE_ANNUAL: 'price_a',
  STRIPE_SUCCESS_URL: `${WEB}/#/upgrade?session={CHECKOUT_SESSION_ID}`,
  STRIPE_CANCEL_URL: `${WEB}/#/upgrade?canceled=1`,
};

const chain = {
  balanceZats: async () => 0,
} as unknown as ChainClient;

async function serverWith(env: NodeJS.ProcessEnv) {
  const cfg = loadConfig(env);
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const { app } = await buildServer({
    cfg,
    payments,
    subs: new SubscriptionsRepo(db),
    vouchers: new VouchersRepo(db, payments, cfg.priceZats),
    chain,
    treasuryAddress: cfg.paymentAddress,
  });
  return app;
}

/**
 * The bug these pin: the web app lives on a different origin to the bridge, so
 * a JSON POST from the browser is preflighted. With no CORS the OPTIONS request
 * 404s, the browser reports net::ERR_FAILED, and the real request is never
 * sent — card checkout simply does not work on the web.
 *
 * It survived every other test because the failure exists only in a browser:
 * curl, the native apps and `app.inject` all ignore CORS. Only an explicit
 * OPTIONS with an Origin header reproduces it.
 */
describe('cors: the browser preflight that broke card checkout', () => {
  it('answers the preflight for every endpoint the web app calls', async () => {
    const app = await serverWith(BASE_ENV);
    for (const url of ['/v1/stripe/checkout', '/v1/stripe/portal', '/v1/voucher/redeem']) {
      const res = await app.inject({
        method: 'OPTIONS',
        url,
        headers: {
          origin: WEB,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(res.statusCode, `${url} preflight`).toBeLessThan(300);
      expect(res.headers['access-control-allow-origin'], `${url} ACAO`).toBe(WEB);
    }
    await app.close();
  });

  it('puts the header on the real response too, or the browser discards it', async () => {
    const app = await serverWith(BASE_ENV);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      headers: { origin: WEB, 'content-type': 'application/json' },
      payload: {},
    });
    // 400 is fine — an empty body IS invalid. What matters is that a browser
    // would be allowed to read the answer instead of throwing it away.
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    await app.close();
  });

  it('covers the GET status route the upgrade page polls', async () => {
    const app = await serverWith(BASE_ENV);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/payment/abc/status',
      headers: { origin: WEB },
    });
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    await app.close();
  });

  it('defaults to the STRIPE_SUCCESS_URL origin, so it cannot drift from the site', async () => {
    const app = await serverWith(BASE_ENV);
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/stripe/checkout',
      headers: { origin: WEB, 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    await app.close();
  });

  it('refuses an origin that is not allowlisted', async () => {
    const app = await serverWith(BASE_ENV);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: {},
    });
    // No ACAO for a stranger: these endpoints are unauthenticated by design, so
    // an arbitrary page must not be able to drive them on a visitor's behalf.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('honours an explicit CORS_ORIGINS list', async () => {
    const app = await serverWith({
      ...BASE_ENV,
      CORS_ORIGINS: 'https://a.example, https://b.example',
    });
    for (const origin of ['https://a.example', 'https://b.example']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/stripe/checkout',
        headers: { origin, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      headers: { origin: WEB, 'content-type': 'application/json' },
      payload: {},
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('registers nothing when CORS_ORIGINS is explicitly empty', async () => {
    const app = await serverWith({ ...BASE_ENV, CORS_ORIGINS: '' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      headers: { origin: WEB, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
