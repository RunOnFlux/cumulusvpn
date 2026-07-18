import { describe, expect, it, vi } from 'vitest';
import { pingGateway } from './probe.js';

/** A fetch that resolves after `delay` ms with a 200 (or a rejection). */
function fakeFetch(plan: Array<number | 'fail'>) {
  let i = 0;
  return vi.fn(async () => {
    const step = plan[i++ % plan.length];
    if (step === 'fail') {
      throw new Error('network');
    }
    await new Promise((r) => setTimeout(r, step));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
  });
}

describe('pingGateway', () => {
  it('summarises RTT + jitter over samples', async () => {
    const r = await pingGateway('http://x:51821', {
      samples: 3,
      fetchImpl: fakeFetch([10, 10, 10]),
    });
    expect(r.rttMs).not.toBeNull();
    expect(r.loss).toBe(0);
    expect(r.jitterMs).toBe(0); // identical samples → no jitter
  });

  it('reports loss when samples fail', async () => {
    const r = await pingGateway('http://x:51821', {
      samples: 4,
      fetchImpl: fakeFetch(['fail', 'fail', 'fail', 'fail']),
    });
    expect(r.rttMs).toBeNull();
    expect(r.jitterMs).toBeNull();
    expect(r.loss).toBe(1);
  });

  it('computes partial loss + a non-zero jitter for varied samples', async () => {
    const r = await pingGateway('http://x:51821', {
      samples: 4,
      fetchImpl: fakeFetch([5, 25, 'fail', 15]),
    });
    expect(r.loss).toBeCloseTo(0.25, 5);
    expect(r.rttMs).not.toBeNull();
    expect(r.jitterMs).toBeGreaterThan(0);
  });
});
