import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DESKTOP_FLAGS, fetchDesktopFlags, resolveDesktopFlags } from './flags';

beforeEach(() => localStorage.clear());

describe('resolveDesktopFlags', () => {
  it('is ON unless desktop is explicitly false (kill switch)', () => {
    expect(
      resolveDesktopFlags({
        inAppUpgrade: { android: false, ios: false },
        webPayLink: { android: false, ios: false, desktop: true },
        voucherRedeem: { android: true, ios: true, desktop: false },
      }),
    ).toEqual({ fluxCheckout: true, cardCheckout: true, voucherRedeem: false });
  });
  it('treats an unknown shape as all ON', () => {
    expect(resolveDesktopFlags(null)).toEqual(DEFAULT_DESKTOP_FLAGS);
    expect(resolveDesktopFlags('nope')).toEqual(DEFAULT_DESKTOP_FLAGS);
  });
});

describe('fetchDesktopFlags', () => {
  const off = { inAppUpgrade: { android: false, ios: false, desktop: false } };
  const ok = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  const down: typeof fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;

  it('falls back to all ON with no previous answer', async () => {
    expect(await fetchDesktopFlags(down)).toEqual(DEFAULT_DESKTOP_FLAGS);
  });
  it('keeps an operator "off" through a later failed fetch', async () => {
    expect((await fetchDesktopFlags(ok(off))).fluxCheckout).toBe(false);
    expect((await fetchDesktopFlags(down)).fluxCheckout).toBe(false);
  });
});
