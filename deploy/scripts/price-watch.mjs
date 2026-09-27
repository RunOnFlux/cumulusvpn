#!/usr/bin/env node
// price-watch.mjs — is paying in FLUX still under $0.99 a month, everywhere?
//
//   node scripts/price-watch.mjs                      # human report
//   node scripts/price-watch.mjs --report out.md      # also write the report as markdown
//
// Exit: 0 all checked and fine · 1 alert · 3 inconclusive (a data source was down
// or the script failed, and nothing it COULD check was wrong). The workflow only
// opens an issue on 1 and only closes one on 0 — an API outage must neither page
// anyone nor mark a live alert as resolved.
//
// Run hourly by .github/workflows/price-watch.yml, which opens (or refreshes) a
// `price-alert` issue while this exits 1 and closes it once it passes again.
//
// It checks what a payer actually meets, not what the repo intends:
//   1. band      — the fleet's CURRENT quote × median FLUX/USD must sit inside
//                  countries.yaml price.[floorUsd, ceilingUsd]. Above the ceiling
//                  is the broken promise; below the floor is revenue left behind.
//   2. fleet     — every registered app spec must carry the same schedule. A
//                  reprice that only reached some specs charges two prices.
//   3. directory — the served vpn.cumulusvpn.com/directory.json (what the web
//                  Upgrade page quotes) must show the fleet's current price.
//   4. bridge    — pay.cumulusvpn.com/v1/health must report the fleet's schedule,
//                  or card/voucher settlements are sized at the wrong price.
// Checks 2 and 3 allow SETTLE_BLOCKS after the newest schedule entry for a
// reprice to roll out (batched spec updates, then a git push), so a normal
// reprice never pages anyone.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  BLOCK_SECONDS,
  fetchFluxUsd,
  formatSchedule,
  priceAt,
  readPriceConfig,
  scheduleFromEnv,
  suggestPrice,
} from './price.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLUX_API = process.env.FLUX_API ?? 'https://api.runonflux.io';
const DIRECTORY_URL = process.env.DIRECTORY_URL ?? 'https://vpn.cumulusvpn.com/directory.json';
const BRIDGE_HEALTH_URL = process.env.BRIDGE_HEALTH_URL ?? 'https://pay.cumulusvpn.com/v1/health';

/** 6 h: time a reprice gets to reach every spec and the served directory. */
export const SETTLE_BLOCKS = (6 * 3600) / BLOCK_SECONDS;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

async function getJson(url) {
  let last;
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last.message}`);
}

/**
 * Pure evaluation, separated for tests. `fleet` maps app name -> schedule
 * entries (null when unreadable). `bridgeSchedule` is the bridge's reported
 * schedule string, null when it predates reporting one, undefined when
 * unreachable. Returns { alerts, notes, conclusive } — conclusive is false
 * when a check that could have alerted was skipped for lack of data.
 */
export function evaluate({ tip, band, rate, fleet, directoryPrice, bridgeSchedule = null }) {
  const alerts = [];
  const notes = [];
  let conclusive = true;

  // The schedule most apps carry is "the fleet's"; the rest are drift.
  const bySchedule = new Map();
  for (const [name, entries] of Object.entries(fleet)) {
    if (!entries) continue;
    const key = formatSchedule(entries);
    bySchedule.set(key, [...(bySchedule.get(key) ?? []), name]);
  }
  if (!bySchedule.size) {
    notes.push('⚠️ could not read the price from any registered app spec');
    return { alerts, notes, conclusive: false };
  }
  const ranked = [...bySchedule.entries()].sort((a, b) => b[1].length - a[1].length);
  const [majorityKey] = ranked[0];
  const entries = Object.values(fleet).find((e) => e && formatSchedule(e) === majorityKey);
  const quote = priceAt(entries, tip);
  const newest = Math.max(
    ...Object.values(fleet)
      .filter(Boolean)
      .map((e) => e[e.length - 1].from),
  );
  const settled = tip - newest > SETTLE_BLOCKS;
  notes.push(`fleet schedule \`${majorityKey}\` → quoting **${quote} FLUX** at block ${tip}`);

  if (ranked.length > 1) {
    const drift = ranked
      .slice(1)
      .map(([k, names]) => `\`${k}\` on ${names.join(', ')}`)
      .join('; ');
    (settled ? alerts : notes).push(
      `specs disagree on the price — majority \`${majorityKey}\`, but ${drift}` +
        (settled ? '' : ' (reprice still rolling out)'),
    );
  }

  if (rate) {
    const usd = quote * rate.usd;
    notes.push(
      `FLUX/USD $${rate.usd.toFixed(5)} (${rate.quotes.map((q) => `${q.source} ${q.usd}`).join(', ')})` +
        ` → a month costs **$${usd.toFixed(2)}**`,
    );
    const fix = suggestPrice(rate.usd, band.targetUsd, band.ceilingUsd);
    const how =
      `reprice to ${fix} FLUX (≈ $${(fix * rate.usd).toFixed(2)}): ` +
      `\`cd deploy && node scripts/reprice.mjs --flux ${fix} --apply --broadcast\``;
    if (usd > band.ceilingUsd) {
      alerts.push(
        `${quote} FLUX = $${usd.toFixed(2)}, above the $${band.ceilingUsd} ceiling — ${how}`,
      );
    } else if (usd < band.floorUsd) {
      alerts.push(`${quote} FLUX = $${usd.toFixed(2)}, below the $${band.floorUsd} floor — ${how}`);
    }
  } else {
    notes.push('⚠️ FLUX/USD unavailable — band not checked this run');
    conclusive = false;
  }

  if (directoryPrice === undefined) {
    notes.push('⚠️ served directory unreadable — not checked this run');
    conclusive = false;
  } else if (directoryPrice !== quote) {
    const msg = `served directory quotes ${directoryPrice} FLUX, the fleet charges ${quote}`;
    (settled ? alerts : notes).push(
      settled
        ? `${msg} — re-sign and push it (reprice.mjs --apply does)`
        : `${msg} (not pushed yet)`,
    );
  }

  if (bridgeSchedule === undefined) {
    notes.push('⚠️ bridge health unreachable — not checked this run');
    conclusive = false;
  } else if (bridgeSchedule === null) {
    notes.push('bridge does not report its price schedule (a pre-schedule build)');
  } else if (bridgeSchedule !== majorityKey) {
    const msg = `bridge settles at \`${bridgeSchedule}\`, the fleet charges \`${majorityKey}\``;
    (settled ? alerts : notes).push(
      settled
        ? `${msg} — set PRICE_SCHEDULE=${majorityKey} on the bridge`
        : `${msg} (bridge not updated yet)`,
    );
  }
  return { alerts, notes, conclusive };
}

async function main() {
  const manifest = parseYaml(readFileSync(join(ROOT, 'countries.yaml'), 'utf8'));
  const band = readPriceConfig(manifest);
  const tip = (await getJson(`${FLUX_API}/daemon/getblockcount`))?.data;
  if (!Number.isSafeInteger(tip)) throw new Error('could not read the chain height');

  const names = (manifest.countries ?? []).flatMap((c) => [
    `cumulusvpn${c.cc}`,
    ...(c.stealth ? [`cumulusvpntls${c.cc}`] : []),
  ]);
  const fleet = {};
  for (let i = 0; i < names.length; i += 6) {
    await Promise.all(
      names.slice(i, i + 6).map(async (name) => {
        try {
          const { data } = await getJson(`${FLUX_API}/apps/appspecifications/${name}`);
          const env = data?.compose?.[0]?.environmentParameters;
          // Unregistered and encrypted (enterprise) specs carry no readable price.
          if (env?.length) fleet[name] = scheduleFromEnv(env);
        } catch {
          /* not registered */
        }
      }),
    );
  }

  let rate;
  try {
    rate = await fetchFluxUsd();
  } catch (e) {
    console.warn(`FLUX/USD: ${e.message}`);
  }
  let directoryPrice;
  try {
    directoryPrice = Number((await getJson(DIRECTORY_URL)).price_flux);
  } catch (e) {
    console.warn(`directory: ${e.message}`);
  }

  let bridgeSchedule;
  try {
    bridgeSchedule = (await getJson(BRIDGE_HEALTH_URL))?.data?.price_schedule ?? null;
  } catch (e) {
    console.warn(`bridge: ${e.message}`);
  }

  const { alerts, notes, conclusive } = evaluate({
    tip,
    band,
    rate,
    fleet,
    directoryPrice,
    bridgeSchedule,
  });
  const status = alerts.length ? 1 : conclusive ? 0 : 3;
  const report = [
    [
      '## ✅ FLUX price is in band',
      '## ❌ FLUX price needs attention',
      '',
      '## ⚠️ FLUX price check inconclusive',
    ][status],
    '',
    `Band $${band.floorUsd}–$${band.ceilingUsd} per 30 days (target $${band.targetUsd}); ` +
      `repo schedule \`${formatSchedule(band.entries)}\`; ${Object.keys(fleet).length} app specs read.`,
    '',
    ...alerts.map((a) => `- **ALERT:** ${a}`),
    ...notes.map((n) => `- ${n}`),
    '',
    `_${new Date().toISOString()} · deploy/scripts/price-watch.mjs_`,
    '',
  ].join('\n');
  console.log(report);
  if (flag('report')) writeFileSync(flag('report'), report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.exit(status);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`price-watch: ${e.message}`);
    process.exit(3); // inconclusive: a crash is not evidence the price is wrong
  });
}
