import { describe, expect, it, vi } from 'vitest';
import {
  createStripeCheckout,
  paymentStatus,
  verifyApplePurchase,
  verifyGooglePurchase,
  DEFAULT_BRIDGE_URL,
} from './bridge.js';
import { ApiError } from './http.js';
import type { FetchImpl } from './types.js';

const CODE = '2RkUfDC55GMndKreXqK7Jruu8Snx';

function fetchReturning(body: unknown): FetchImpl & ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as never;
}

describe('createStripeCheckout', () => {
  it('POSTs the code and plan and unwraps the session', async () => {
    const f = fetchReturning({
      status: 'success',
      data: { url: 'https://checkout.stripe.com/c/x', session_id: 'cs_1' },
    });
    const out = await createStripeCheckout(f, { code: CODE, plan: 'annual' });
    expect(out.url).toBe('https://checkout.stripe.com/c/x');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_BRIDGE_URL}/v1/stripe/checkout`);
    expect(JSON.parse(init.body as string)).toEqual({ payment_code: CODE, plan: 'annual' });
  });

  it('honours a baseUrl override', async () => {
    const f = fetchReturning({ status: 'success', data: { url: 'u', session_id: 's' } });
    await createStripeCheckout(
      f,
      { code: CODE, plan: 'monthly' },
      { baseUrl: 'http://localhost:8080' },
    );
    expect((f.mock.calls[0] as [string])[0]).toBe('http://localhost:8080/v1/stripe/checkout');
  });

  it('surfaces the error envelope as ApiError', async () => {
    const f = fetchReturning({
      status: 'error',
      data: { code: '400', name: 'bad_code', message: 'invalid code' },
    });
    await expect(
      createStripeCheckout(f, { code: 'x'.repeat(25), plan: 'monthly' }),
    ).rejects.toThrow(ApiError);
  });
});

describe('verify endpoints', () => {
  it('sends the Apple JWS under signed_transaction', async () => {
    const f = fetchReturning({
      status: 'success',
      data: { accepted: true, months: 1, state: 'pending', sandbox: false },
    });
    const out = await verifyApplePurchase(f, { code: CODE, signedTransaction: 'ey.abc.def' });
    expect(out.accepted).toBe(true);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/apple/verify');
    expect(JSON.parse(init.body as string)).toEqual({
      payment_code: CODE,
      signed_transaction: 'ey.abc.def',
    });
  });

  it('sends the Play token under purchase_token', async () => {
    const f = fetchReturning({
      status: 'success',
      data: { accepted: true, months: 12, state: 'pending', test: false },
    });
    const out = await verifyGooglePurchase(f, { code: CODE, purchaseToken: 'tok123'.repeat(4) });
    expect(out.months).toBe(12);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/google/verify');
    expect(JSON.parse(init.body as string).purchase_token).toBe('tok123'.repeat(4));
  });
});

describe('paymentStatus', () => {
  it('GETs the per-code status feed', async () => {
    const f = fetchReturning({
      status: 'success',
      data: {
        code: CODE,
        payments: [{ rail: 'stripe', months: 1, status: 'broadcast', txid: 'abc', created_at: 1 }],
      },
    });
    const out = await paymentStatus(f, CODE);
    expect(out.payments[0]?.status).toBe('broadcast');
    expect((f.mock.calls[0] as [string])[0]).toBe(
      `${DEFAULT_BRIDGE_URL}/v1/payment/${CODE}/status`,
    );
  });
});
