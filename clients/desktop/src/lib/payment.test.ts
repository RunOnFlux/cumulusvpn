import { describe, expect, it } from 'vitest';
import type { GatewayInfo } from '@cumulusvpn/core';
import { fleetPriceFlux, formatExpiry, paymentIdentity, voucherErrorText } from './payment';
import { BUNDLED_DIRECTORY } from './directory';

const gw = (price?: unknown): GatewayInfo =>
  ({ ip: '1.1.1.1', price_flux: price }) as unknown as GatewayInfo;

describe('fleetPriceFlux', () => {
  it('takes the majority quote, ties to the higher price, ignores junk', () => {
    expect(fleetPriceFlux([gw(12), gw(12), gw(10)])).toBe(12);
    expect(fleetPriceFlux([gw(10), gw(12)])).toBe(12);
    expect(fleetPriceFlux([gw(undefined), gw('9'), gw(-1), gw(Number.NaN)])).toBeUndefined();
    expect(fleetPriceFlux([])).toBeUndefined();
  });
});

describe('paymentIdentity', () => {
  it('pays the signed directory address at the live price when known', () => {
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const live = paymentIdentity(key, 12);
    expect(live.address).toBe(BUNDLED_DIRECTORY.payment_address);
    expect(live.priceFlux).toBe(12);
    expect(live.code).toBeTruthy();
    expect(live.memo).toBeTruthy();
    expect(paymentIdentity(key).priceFlux).toBe(BUNDLED_DIRECTORY.price_flux);
  });
});

describe('formatExpiry', () => {
  it('counts whole days left and never goes negative', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(formatExpiry('2026-11-21T12:00:00Z', now)?.daysLeft).toBe(10);
    expect(formatExpiry('2026-11-01T12:00:00Z', now)?.daysLeft).toBe(0);
    expect(formatExpiry(null, now)).toBeNull();
    expect(formatExpiry('not a date', now)).toBeNull();
  });
});

describe('voucherErrorText', () => {
  it('explains each bridge outcome', () => {
    expect(voucherErrorText('expired')).toMatch(/expired/);
    expect(voucherErrorText('already_redeemed')).toMatch(/already redeemed/);
    expect(voucherErrorText('rate_limited')).toMatch(/briefly unavailable/);
    expect(voucherErrorText('whatever')).toMatch(/isn’t valid/);
  });
});
