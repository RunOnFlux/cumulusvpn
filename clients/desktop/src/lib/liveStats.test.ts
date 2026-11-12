import { describe, expect, it } from 'vitest';
import { speedBetween, ZERO_SPEED } from './liveStats';

describe('speedBetween', () => {
  it('is zero without a previous sample', () => {
    expect(speedBetween(null, { rx: 100, tx: 100, at: 1000 })).toEqual(ZERO_SPEED);
  });
  it('divides the byte delta by elapsed seconds', () => {
    expect(speedBetween({ rx: 0, tx: 0, at: 0 }, { rx: 3_000, tx: 1_500, at: 1_500 })).toEqual({
      down: 2_000,
      up: 1_000,
    });
  });
  it('reads a counter reset (tunnel rebuilt) or a zero interval as zero', () => {
    expect(speedBetween({ rx: 500, tx: 0, at: 0 }, { rx: 100, tx: 10, at: 1_000 })).toEqual(
      ZERO_SPEED,
    );
    expect(speedBetween({ rx: 0, tx: 0, at: 5 }, { rx: 10, tx: 10, at: 5 })).toEqual(ZERO_SPEED);
  });
});
