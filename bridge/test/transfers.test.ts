import { describe, expect, it } from 'vitest';

import {
  remainingDays,
  tooSoonMessage,
  transferAvailableAt,
  transferEventKey,
  TRANSFER_INTERVAL_S,
} from '../src/transfers.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

describe('transfers: remaining days of a period', () => {
  it('rounds a part day UP, so a move never shortchanges the new device', () => {
    expect(remainingDays(NOW + 10 * DAY, NOW, 'monthly')).toBe(10);
    expect(remainingDays(NOW + 10 * DAY + 1, NOW, 'monthly')).toBe(11);
  });

  it('grants at least one day while the period is still running', () => {
    expect(remainingDays(NOW + 60_000, NOW, 'monthly')).toBe(1);
  });

  it('never grants more than the plan, whatever the store reports', () => {
    expect(remainingDays(NOW + 45 * DAY, NOW, 'monthly')).toBe(30);
    expect(remainingDays(NOW + 400 * DAY, NOW, 'annual')).toBe(360);
    expect(remainingDays(NOW + 200 * DAY, NOW, 'annual')).toBe(200);
  });

  it('grants nothing once the period has ended, or when there is no period end', () => {
    expect(remainingDays(NOW, NOW, 'monthly')).toBe(0);
    expect(remainingDays(NOW - DAY, NOW, 'annual')).toBe(0);
    expect(remainingDays(NaN, NOW, 'monthly')).toBe(0);
  });
});

describe('transfers: one grant per billing period', () => {
  it('keys a transfer grant by subscription AND period end', () => {
    const key = transferEventKey('tok-1', NOW + 10 * DAY);
    expect(key).toBe(`transfer:tok-1:${NOW + 10 * DAY}`);
    // Same period → same key (so A→B→A cannot mint a second grant) ...
    expect(transferEventKey('tok-1', NOW + 10 * DAY)).toBe(key);
    // ... the next period, or another subscription, is a different one.
    expect(transferEventKey('tok-1', NOW + 40 * DAY)).not.toBe(key);
    expect(transferEventKey('tok-2', NOW + 10 * DAY)).not.toBe(key);
  });
});

describe('transfers: 30-day rate limit', () => {
  const nowS = NOW / 1000;

  it('allows a subscription that never moved', () => {
    expect(transferAvailableAt(null, nowS)).toBeNull();
  });

  it('blocks for 30 days after a move, then allows again', () => {
    expect(transferAvailableAt(nowS, nowS)).toBe(nowS + TRANSFER_INTERVAL_S);
    expect(transferAvailableAt(nowS - TRANSFER_INTERVAL_S + 1, nowS)).toBe(nowS + 1);
    expect(transferAvailableAt(nowS - TRANSFER_INTERVAL_S, nowS)).toBeNull();
  });

  it('ends the refusal message with the ISO date it becomes possible', () => {
    const at = nowS + TRANSFER_INTERVAL_S;
    expect(tooSoonMessage(at)).toMatch(/after 2026-10-30T12:00:00\.000Z$/);
  });
});
