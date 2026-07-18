import { describe, expect, it } from 'vitest';
import { gatewayQuality } from './quality.js';

describe('gatewayQuality', () => {
  it('rates a fast, empty node Excellent', () => {
    const q = gatewayQuality(40, 0.1);
    expect(q.tone).toBe('excellent');
    expect(q.loadPct).toBe(10);
    expect(q.score).toBeGreaterThanOrEqual(78);
  });

  it('rates a near-full node Busy regardless of latency', () => {
    expect(gatewayQuality(30, 0.9).tone).toBe('busy');
    expect(gatewayQuality(500, 0.95).tone).toBe('busy');
  });

  it('clamps load to a 0..100 percentage', () => {
    expect(gatewayQuality(100, 1.5).loadPct).toBe(100);
    expect(gatewayQuality(100, -0.2).loadPct).toBe(0);
  });

  it('scores an unmeasured latency neutrally rather than failing', () => {
    const q = gatewayQuality(null, 0.3);
    expect(q.score).toBeGreaterThan(0);
    expect(['excellent', 'good', 'fair']).toContain(q.tone);
  });

  it('ranks a lighter node above a heavier one at equal latency', () => {
    expect(gatewayQuality(120, 0.2).score).toBeGreaterThan(gatewayQuality(120, 0.7).score);
  });

  it('degrades toward Fair as latency climbs', () => {
    expect(gatewayQuality(600, 0.3).tone).toBe('fair');
  });
});
