import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  GRACE_BLOCKS,
  effectivePrice,
  formatSchedule,
  latestPrice,
  parseSchedule,
  priceAt,
  priceEnv,
  readPriceConfig,
  scheduleFromEnv,
  suggestPrice,
} from '../scripts/price.mjs';
import { mergeEnv, priceRefusal, STALE_ENTRY_BLOCKS } from '../scripts/update-image.mjs';
import { plannedSchedule, rewriteScheduleLine } from '../scripts/reprice.mjs';
import { evaluate, SETTLE_BLOCKS } from '../scripts/price-watch.mjs';

// The gateway owns the vectors; this is what keeps a schedule written by the
// tooling identical to the one every gateway evaluates.
const vectors = JSON.parse(
  readFileSync(
    new URL('../../gateway/internal/price/testdata/vectors.json', import.meta.url),
    'utf8',
  ),
);
const manifestText = readFileSync(new URL('../countries.yaml', import.meta.url), 'utf8');

test('price.mjs agrees with the gateway on every shared vector', () => {
  assert.equal(GRACE_BLOCKS, vectors.grace_blocks);
  for (const v of vectors.valid) {
    const s = parseSchedule(v.in);
    assert.equal(formatSchedule(s), v.canonical, v.in);
    assert.equal(latestPrice(s), v.latest, v.in);
    for (const p of v.points) {
      assert.deepEqual(
        [priceAt(s, p.h), effectivePrice(s, p.h)],
        [p.at, p.effective],
        `${v.in} @${p.h}`,
      );
    }
  }
  for (const bad of vectors.invalid) assert.throws(() => parseSchedule(bad), undefined, bad);
});

test('countries.yaml carries a valid price block and the env emits both variables', () => {
  const cfg = readPriceConfig(parseYaml(manifestText));
  assert.ok(cfg.floorUsd < cfg.targetUsd && cfg.targetUsd < cfg.ceilingUsd);
  assert.ok(cfg.ceilingUsd < 0.99, 'the ceiling is the promise: always under $0.99');
  const env = priceEnv(parseSchedule('20@0,12@100'));
  assert.deepEqual(env, ['CVPN_PRICE_FLUX=12', 'CVPN_PRICE_SCHEDULE=20@0,12@100']);
  assert.equal(formatSchedule(scheduleFromEnv(env)), '20@0,12@100');
  assert.equal(formatSchedule(scheduleFromEnv(['CVPN_PRICE_FLUX=20'])), '20@0', 'legacy spec');
});

test('suggestPrice lands near the target and never above the ceiling', () => {
  assert.equal(suggestPrice(0.0726, 0.85, 0.95), 12); // 11.7 → 12 ≈ $0.87
  assert.equal(suggestPrice(0.0495, 0.85, 0.95), 17);
  assert.equal(suggestPrice(0.3, 0.85, 0.95), 2.8); // tenths below 10 FLUX
  // Round-to-nearest would breach a tight ceiling; it must floor instead.
  assert.equal(suggestPrice(0.0726, 0.85, 0.86), 11);
});

test('rewriteScheduleLine edits only the schedule, comments and all', () => {
  const next = rewriteScheduleLine(manifestText, '20@0,12@2985988');
  assert.equal(readPriceConfig(parseYaml(next)).entries.length, 2);
  const changed = next.split('\n').filter((l, i) => l !== manifestText.split('\n')[i]);
  assert.deepEqual(changed, ["  schedule: '20@0,12@2985988'"]);
  assert.throws(() => rewriteScheduleLine('owner: x\n', '20'), /no `schedule:`/);
});

test('plannedSchedule appends after published entries and re-dates unsent ones', () => {
  const entries = parseSchedule('20@0,12@1000');
  // 12@1000 is live somewhere: append behind it.
  const live = plannedSchedule(entries, new Set(['20@0', '12@1000']), { from: 5000, flux: 10 });
  assert.equal(formatSchedule(live.schedule), '20@0,12@1000,10@5000');
  assert.deepEqual(live.replaced, []);
  // 12@1000 never reached any spec: replace it rather than stack behind it.
  const unsent = plannedSchedule(
    entries,
    new Set(['20@0']),
    { from: 5000, flux: 12 },
    { tip: 2000 },
  );
  assert.equal(formatSchedule(unsent.schedule), '20@0,12@5000');
  assert.equal(formatSchedule(unsent.replaced), '12@1000');
  // ...but not while an earlier broadcast of it may still be landing.
  assert.throws(
    () => plannedSchedule(entries, new Set(['20@0']), { from: 5000, flux: 12 }, { tip: 1100 }),
    /may still land/,
  );
  const forced = plannedSchedule(
    entries,
    new Set(['20@0']),
    { from: 5000, flux: 12 },
    { tip: 1100, forceRedate: true },
  );
  assert.equal(formatSchedule(forced.schedule), '20@0,12@5000');
  assert.throws(
    () => plannedSchedule(entries, new Set(['20@0', '12@1000']), { from: 5000, flux: 12 }),
    /already charges/,
  );
  assert.throws(
    () => plannedSchedule(entries, new Set(['20@0', '12@1000']), { from: 900, flux: 10 }),
    /published entry/,
  );
});

test('update-image refuses to rewrite price history or push a stale entry', () => {
  const desired = parseSchedule('20@0,12@1000');
  assert.equal(priceRefusal(['CVPN_PRICE_FLUX=20'], desired, 1010), null, 'legacy flat → append');
  assert.equal(
    priceRefusal(['CVPN_PRICE_SCHEDULE=20@0,12@1000'], desired, 99999),
    null,
    'already carried: nothing new to date-check',
  );
  assert.match(priceRefusal(['CVPN_PRICE_FLUX=15'], desired, 1010), /not a prefix/);
  assert.match(
    priceRefusal(['CVPN_PRICE_SCHEDULE=20@0,12@1000,9@2000'], desired, 2010),
    /not a prefix/,
  );
  // A stale DROP only favours payers: it goes through.
  assert.equal(priceRefusal(['CVPN_PRICE_FLUX=20'], desired, 1000 + STALE_ENTRY_BLOCKS + 1), null);
  const rise = parseSchedule('12@0,16@1000');
  assert.match(
    priceRefusal(['CVPN_PRICE_FLUX=12'], rise, 1000 + STALE_ENTRY_BLOCKS + 1),
    /allow-stale/,
  );
  assert.equal(
    priceRefusal(['CVPN_PRICE_FLUX=12'], rise, 1000 + STALE_ENTRY_BLOCKS + 1, { allowStale: true }),
    null,
  );
});

test('mergeEnv rewrites owned keys in place', () => {
  const merged = mergeEnv(
    ['CVPN_PRICE_FLUX=20', 'CVPN_PAYMENT_ADDRESS=t3x', 'CVPN_PRICE_FLUX=99'],
    ['CVPN_PRICE_FLUX=12', 'CVPN_PRICE_SCHEDULE=20@0,12@9'],
  );
  assert.deepEqual(merged, [
    'CVPN_PRICE_FLUX=12',
    'CVPN_PAYMENT_ADDRESS=t3x',
    'CVPN_PRICE_SCHEDULE=20@0,12@9',
  ]);
});

test('price-watch alerts on the band, and on drift only once a reprice has settled', () => {
  const band = { floorUsd: 0.7, targetUsd: 0.85, ceilingUsd: 0.95 };
  const rate = { usd: 0.0726, quotes: [{ source: 'x', usd: 0.0726 }] };
  const flat = parseSchedule('20');

  const over = evaluate({ tip: 5000, band, rate, fleet: { a: flat }, directoryPrice: 20 });
  assert.equal(over.alerts.length, 1);
  assert.match(over.alerts[0], /above the \$0\.95 ceiling.*--flux 12/);

  const next = parseSchedule('20@0,12@5000');
  const rolling = { a: next, b: next, c: flat };
  const early = evaluate({ tip: 5010, band, rate, fleet: rolling, directoryPrice: 20 });
  assert.deepEqual(early.alerts, [], 'mid-rollout drift and an unpushed directory are notes');

  const late = evaluate({
    tip: 5000 + SETTLE_BLOCKS + 1,
    band,
    rate,
    fleet: rolling,
    directoryPrice: 20,
  });
  assert.equal(late.alerts.length, 2, 'settled drift + stale directory both alert');

  const healthy = evaluate({ tip: 5010, band, rate, fleet: { a: next }, directoryPrice: 12 });
  assert.deepEqual(healthy.alerts, []);
  assert.equal(healthy.conclusive, true);
});

test('price-watch is inconclusive — never "resolved" — when it could not check', () => {
  const band = { floorUsd: 0.7, targetUsd: 0.85, ceilingUsd: 0.95 };
  const fleet = { a: parseSchedule('20') };
  const noRate = evaluate({ tip: 5000, band, rate: undefined, fleet, directoryPrice: 20 });
  assert.deepEqual(noRate.alerts, []);
  assert.equal(noRate.conclusive, false, 'a closed alert on a rate outage would flap');
  const noDir = evaluate({
    tip: 5000,
    band,
    rate: { usd: 0.045, quotes: [] },
    fleet,
    directoryPrice: undefined,
  });
  assert.equal(noDir.conclusive, false);
});

test('price-watch compares the bridge schedule once a reprice has settled', () => {
  const band = { floorUsd: 0.7, targetUsd: 0.85, ceilingUsd: 0.95 };
  const rate = { usd: 0.0726, quotes: [] };
  const next = parseSchedule('20@0,12@5000');
  const args = { band, rate, fleet: { a: next }, directoryPrice: 12 };
  const early = evaluate({ ...args, tip: 5010, bridgeSchedule: '20@0' });
  assert.deepEqual(early.alerts, []);
  const late = evaluate({ ...args, tip: 5000 + SETTLE_BLOCKS + 1, bridgeSchedule: '20@0' });
  assert.match(late.alerts[0], /bridge settles at/);
  const legacy = evaluate({ ...args, tip: 5010, bridgeSchedule: null });
  assert.equal(legacy.conclusive, true, 'an old bridge build is a note, not missing data');
});

test('update-image refuses a schedule on an image that cannot read it', async () => {
  const { imageSupportsSchedule } = await import('../scripts/update-image.mjs');
  assert.equal(imageSupportsSchedule('ghcr.io/runonflux/cumulusvpn-gateway:0.3.0'), false);
  assert.equal(imageSupportsSchedule('ghcr.io/runonflux/cumulusvpn-gateway:0.4.0'), true);
  assert.equal(imageSupportsSchedule('ghcr.io/runonflux/cumulusvpn-gateway:1.0.0'), true);
  assert.equal(imageSupportsSchedule('ghcr.io/runonflux/cumulusvpn-gateway:latest'), false);
});
