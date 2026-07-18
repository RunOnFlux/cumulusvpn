import { describe, expect, it, vi } from 'vitest';
import { pingGateway } from './probe.js';

/** A monotonic virtual clock, advanced by the fake fetch to simulate RTT. */
function makeClock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

/**
 * A fetch that "takes" `step` ms per call by advancing `clock` (or rejects on
 * `'fail'`). Using a virtual clock instead of real `setTimeout` makes the RTT
 * each sample records exact — so the summary is deterministic and the test
 * can't flake on OS timer jitter.
 */
function fakeFetch(plan: Array<number | 'fail'>, clock: ReturnType<typeof makeClock>) {
  let i = 0;
  return vi.fn(async () => {
    const step = plan[i++ % plan.length];
    if (step === 'fail') {
      throw new Error('network');
    }
    clock.advance(step);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
  });
}

describe('pingGateway', () => {
  it('summarises RTT + jitter over samples', async () => {
    const clock = makeClock();
    const r = await pingGateway('http://x:51821', {
      samples: 3,
      fetchImpl: fakeFetch([10, 10, 10], clock),
      now: clock.now,
    });
    expect(r.rttMs).not.toBeNull();
    expect(r.loss).toBe(0);
    expect(r.jitterMs).toBe(0); // identical samples → no jitter
  });

  it('reports loss when samples fail', async () => {
    const clock = makeClock();
    const r = await pingGateway('http://x:51821', {
      samples: 4,
      fetchImpl: fakeFetch(['fail', 'fail', 'fail', 'fail'], clock),
      now: clock.now,
    });
    expect(r.rttMs).toBeNull();
    expect(r.jitterMs).toBeNull();
    expect(r.loss).toBe(1);
  });

  it('computes partial loss + a non-zero jitter for varied samples', async () => {
    const clock = makeClock();
    const r = await pingGateway('http://x:51821', {
      samples: 4,
      fetchImpl: fakeFetch([5, 25, 'fail', 15], clock),
      now: clock.now,
    });
    expect(r.loss).toBeCloseTo(0.25, 5);
    expect(r.rttMs).not.toBeNull();
    expect(r.jitterMs).toBeGreaterThan(0);
  });
});
