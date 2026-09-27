import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { GRACE_BLOCKS, PriceSchedule } from '../src/price.js';

/**
 * The gateway's price package owns the vectors; running them here is what
 * keeps the bridge's settlement sizing in lock-step with how every gateway
 * will judge those settlements.
 */
interface Vectors {
  grace_blocks: number;
  valid: {
    in: string;
    canonical: string;
    latest: number;
    points: { h: number; at: number; effective: number }[];
  }[];
  invalid: string[];
}
const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../gateway/internal/price/testdata/vectors.json', import.meta.url)),
    'utf8',
  ),
) as Vectors;

describe('price schedule: shared vectors with the gateway', () => {
  it('uses the same grace window', () => {
    expect(GRACE_BLOCKS).toBe(vectors.grace_blocks);
  });

  for (const v of vectors.valid) {
    it(`evaluates ${JSON.stringify(v.in)}`, () => {
      const s = PriceSchedule.parse(v.in);
      expect(s.toString()).toBe(v.canonical);
      expect(s.latest()).toBe(v.latest);
      for (const p of v.points) {
        expect([p.h, s.at(p.h), s.effective(p.h)]).toEqual([p.h, p.at, p.effective]);
      }
    });
  }

  it('rejects exactly what the gateway rejects', () => {
    for (const bad of vectors.invalid) {
      expect(() => PriceSchedule.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('price schedule: payout window', () => {
  const rise = PriceSchedule.parse('12@0,16@1000');

  it('is the effective price when nothing changes inside the window', () => {
    expect(rise.maxEffective(2000, 2040)).toBe(12); // inside the rise's grace
    expect(rise.maxEffective(20000, 20040)).toBe(16);
  });

  it('picks up a grace window that closes inside it', () => {
    const end = 1000 + GRACE_BLOCKS;
    expect(rise.maxEffective(end - 40, end - 1)).toBe(12);
    expect(rise.maxEffective(end - 40, end)).toBe(16);
  });

  it('never lets a drop inside the window lower the payout below the current price', () => {
    const drop = PriceSchedule.parse('20@0,12@1000');
    expect(drop.maxEffective(980, 1020)).toBe(20);
  });
});

describe('config: price schedule', () => {
  const BASE: NodeJS.ProcessEnv = {
    PAYMENT_ADDRESS: 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ',
    TREASURY_WIF: 'not-a-real-wif',
    ADMIN_TOKEN: 'admin-token',
    APPLE_BUNDLE_ID: 'com.cumulusvpn.app',
    APPLE_APP_ID: '6792741863',
  };

  it('defaults to a flat 20 FLUX', () => {
    const cfg = loadConfig(BASE);
    expect(cfg.priceSchedule.toString()).toBe('20@0');
    expect(cfg.priceZats).toBe(20e8);
  });

  it('prefers PRICE_SCHEDULE and reports its latest price', () => {
    const cfg = loadConfig({ ...BASE, PRICE_SCHEDULE: '20@0,12@2215000', PRICE_FLUX: '12' });
    expect(cfg.priceSchedule.toString()).toBe('20@0,12@2215000');
    expect(cfg.priceFlux).toBe(12);
    expect(cfg.priceZats).toBe(12e8);
  });

  it('refuses a PRICE_FLUX that disagrees with the schedule', () => {
    expect(() => loadConfig({ ...BASE, PRICE_SCHEDULE: '20@0,12@9', PRICE_FLUX: '20' })).toThrow(
      /disagrees/,
    );
  });

  it('refuses a malformed schedule', () => {
    expect(() => loadConfig({ ...BASE, PRICE_SCHEDULE: '20,12' })).toThrow(/PRICE_SCHEDULE/);
  });
});
