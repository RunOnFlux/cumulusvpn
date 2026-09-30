import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base58 } from '@scure/base';

import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { VouchersRepo } from '../src/db/vouchers.js';
import { AppleRail } from '../src/rails/apple.js';
import { buildServer } from '../src/server.js';
import { uuidForCode } from '../src/codes.js';
import type { ChainClient } from '../src/flux/chain.js';

const CODE = base58.encode(new Uint8Array(20).fill(21));
const NEW_CODE = base58.encode(new Uint8Array(20).fill(22));
const ORIG = '2000000987654321';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const ADMIN = { authorization: 'Bearer admin-token' };
/** Long enough for the route schema; the verifier itself is stubbed. */
const JWS = 'e'.repeat(120);

const ENV: NodeJS.ProcessEnv = {
  PAYMENT_ADDRESS: 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ',
  TREASURY_WIF: 'not-a-real-wif',
  ADMIN_TOKEN: 'admin-token',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_MONTHLY: 'price_m',
  STRIPE_PRICE_ANNUAL: 'price_a',
  STRIPE_SUCCESS_URL: 'https://vpn.cumulusvpn.com/#/upgrade?session={CHECKOUT_SESSION_ID}',
  STRIPE_CANCEL_URL: 'https://vpn.cumulusvpn.com/#/upgrade?canceled=1',
  APPLE_BUNDLE_ID: 'com.cumulusvpn.app',
  APPLE_ENVIRONMENT: 'Sandbox',
  APPLE_SANDBOX_GRANTS: 'true',
};

const chain = { balanceZats: async () => 0 } as unknown as ChainClient;

async function server() {
  const cfg = loadConfig(ENV);
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  const { app } = await buildServer({
    cfg,
    payments,
    subs,
    vouchers: new VouchersRepo(db, payments, cfg.priceZats),
    chain,
    treasuryAddress: cfg.paymentAddress,
  });
  return { app, payments, subs };
}

/** Stand in for Apple's JWS verification — we cannot mint Apple-signed payloads. */
function presentTransaction(over: Record<string, unknown> = {}): void {
  const proto = AppleRail.prototype as unknown as { decodeTransaction: () => unknown };
  vi.spyOn(proto, 'decodeTransaction').mockResolvedValue({
    txn: {
      transactionId: '2000000000000001',
      originalTransactionId: ORIG,
      productId: 'cvpn.premium.monthly',
      appAccountToken: uuidForCode(CODE),
      expiresDate: NOW + 10 * DAY,
      purchaseDate: NOW - 20 * DAY,
      transactionReason: 'PURCHASE',
      ...over,
    },
    sandbox: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /v1/apple/claim', () => {
  it('asks before moving, moves on confirmation, then rate-limits', async () => {
    const { app, subs } = await server();
    presentTransaction();
    const verify = await app.inject({
      method: 'POST',
      url: '/v1/apple/verify',
      payload: { payment_code: CODE, signed_transaction: JWS },
    });
    expect(verify.statusCode).toBe(200);

    const ask = await app.inject({
      method: 'POST',
      url: '/v1/apple/claim',
      payload: { payment_code: NEW_CODE, signed_transaction: JWS },
    });
    expect(ask.statusCode).toBe(409);
    expect(ask.json()).toMatchObject({
      status: 'error',
      data: { code: '409', name: 'owned_by_other_device' },
    });

    const move = await app.inject({
      method: 'POST',
      url: '/v1/apple/claim',
      payload: { payment_code: NEW_CODE, signed_transaction: JWS, transfer: true },
    });
    expect(move.statusCode).toBe(200);
    expect(move.json()).toEqual({
      status: 'success',
      data: {
        accepted: true,
        days: 10,
        months: 0,
        state: 'pending',
        transferred: true,
        test: true,
        sandbox: true,
      },
    });
    expect(subs.get('apple', ORIG)?.payment_code).toBe(NEW_CODE);

    const again = await app.inject({
      method: 'POST',
      url: '/v1/apple/claim',
      payload: { payment_code: CODE, signed_transaction: JWS, transfer: true },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ data: { name: 'transfer_too_soon' } });
    expect(again.json().data.message).toMatch(/after 2026-10-30T12:00:00\.000Z$/);
    await app.close();
  });

  it('reports verification failures exactly like verify', async () => {
    const { app } = await server();
    presentTransaction({ expiresDate: NOW - 1 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/apple/claim',
      payload: { payment_code: CODE, signed_transaction: JWS },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ data: { name: 'verify_failed', message: 'expired' } });
    await app.close();
  });
});

describe('POST /v1/stripe/transfer', () => {
  it('rejects a malformed payment code before touching Stripe', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/transfer',
      payload: { payment_code: 'x'.repeat(25), session_id: 'cs_live_abcdef' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ data: { name: 'bad_code' } });
    await app.close();
  });
});

describe('POST /internal/subscriptions/rebind', () => {
  const rebind = (payload: object, headers: Record<string, string> = ADMIN) => ({
    method: 'POST' as const,
    url: '/internal/subscriptions/rebind',
    headers,
    payload,
  });

  it('is admin-only', async () => {
    const { app } = await server();
    const res = await app.inject(
      rebind({ rail: 'apple', external_id: ORIG, payment_code: NEW_CODE }, {}),
    );
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('validates the rail, the handle and the code', async () => {
    const { app } = await server();
    const bad = [
      { rail: 'paypal', external_id: ORIG, payment_code: NEW_CODE },
      { rail: 'apple', external_id: '', payment_code: NEW_CODE },
      { rail: 'apple', external_id: ORIG, payment_code: 'nope' },
      { rail: 'apple', external_id: ORIG, payment_code: NEW_CODE, grant_remaining: 'yes' },
    ];
    for (const payload of bad) {
      expect((await app.inject(rebind(payload))).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const missing = await app.inject(
      rebind({ rail: 'apple', external_id: 'unknown', payment_code: NEW_CODE }),
    );
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('moves with no 30-day limit, and never grants one period twice', async () => {
    const { app, payments, subs } = await server();
    presentTransaction();
    await app.inject({
      method: 'POST',
      url: '/v1/apple/verify',
      payload: { payment_code: CODE, signed_transaction: JWS },
    });

    const first = await app.inject(
      rebind({ rail: 'apple', external_id: ORIG, payment_code: NEW_CODE, grant_remaining: true }),
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({
      rail: 'apple',
      external_id: ORIG,
      payment_code: NEW_CODE,
      previous_code: CODE,
      // A sandbox subscription, granted in full only because this bridge runs
      // with APPLE_SANDBOX_GRANTS=true (otherwise: the bounded probe).
      days: 10,
      grant: 'queued',
      test: true,
    });
    // Straight back again: support is not rate-limited, but the period is
    // already handed over.
    const back = await app.inject(
      rebind({ rail: 'apple', external_id: ORIG, payment_code: CODE, grant_remaining: true }),
    );
    expect(back.json().data).toMatchObject({ previous_code: NEW_CODE, grant: 'duplicate' });
    expect(subs.get('apple', ORIG)?.payment_code).toBe(CODE);
    expect(payments.byCode(CODE).map((p) => p.event_key)).toEqual(['2000000000000001']);

    const noop = await app.inject(rebind({ rail: 'apple', external_id: ORIG, payment_code: CODE }));
    expect(noop.statusCode).toBe(409);
    expect(noop.json()).toMatchObject({ data: { name: 'already_bound' } });
    await app.close();
  });

  it('shows the move in the support lookup of the OLD code', async () => {
    const { app, subs } = await server();
    subs.upsert('apple', ORIG, CODE, 'monthly');
    await app.inject(rebind({ rail: 'apple', external_id: ORIG, payment_code: NEW_CODE }));
    const res = await app.inject({
      method: 'GET',
      url: `/internal/subscriptions?code=${CODE}`,
      headers: ADMIN,
    });
    const data = res.json().data as { subscriptions: unknown[]; transfers: unknown[] };
    expect(data.subscriptions).toEqual([]);
    expect(data.transfers).toEqual([
      {
        rail: 'apple',
        external_id: ORIG,
        from_code: CODE,
        to_code: NEW_CODE,
        actor: 'admin',
        days: 0,
        created_at: NOW / 1000,
      },
    ]);
    await app.close();
  });
});
