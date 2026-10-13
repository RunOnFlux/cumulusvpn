#!/usr/bin/env node
// expiry-watch.mjs — is every registered gateway app paid up and actually running?
//
//   node scripts/expiry-watch.mjs                     # human report
//   node scripts/expiry-watch.mjs --report out.md     # also write the report as markdown
//   WARN_DAYS=5 node scripts/expiry-watch.mjs         # warn earlier (default 3)
//
// Exit: 0 all checked and fine · 1 alert · 3 inconclusive (a data source was down
// or the script failed, and nothing it COULD check was wrong). Same contract as
// price-watch.mjs: the workflow opens an issue only on 1 and closes it only on 0.
//
// Run daily by .github/workflows/expiry-watch.yml, which opens (or refreshes) a
// `fleet-alert` issue while this exits 1 and closes it once it passes again.
//
// Why it exists: a Flux app's subscription simply ends at `height + expire`, and
// the country vanishes from the fleet with no error anywhere. Renewal is NOT in
// this repo (renew.sh -> register.sh's pay step is TODO): FluxCloud auto-renews,
// paid from its own wallet t1gjUUxBpBeVC1sWwAFrtSsVCbSaFdZx8UY, for a month at a
// time ~4-5 days before expiry (on-chain history of cumulusvpnat). So the
// threshold sits BELOW that window: an alert means auto-renew did not happen.
// It checks:
//   1. expiry   — every registered app must have more than WARN_DAYS left.
//   2. running  — a registered app with ZERO live instances is a country gone
//                 dark (the paid spec places nowhere). Fewer than requested is
//                 only a note: several countries have fewer usable public IPs
//                 than instances (one gateway per IP, fixed ports).
// Apps listed in specs/onchain/ but not registered (se/ch/kr today) are noted,
// never alerted on.
import { readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_SECONDS } from './price.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLUX_API = process.env.FLUX_API ?? 'https://api.runonflux.io';
const WARN_DAYS = Number(process.env.WARN_DAYS ?? 3);

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

export const daysLeft = (expiresAt, tip) => ((expiresAt - tip) * BLOCK_SECONDS) / 86_400;

/**
 * Pure evaluation, separated for tests. `apps` maps app name -> one of
 *   { registered: false }                                   not on-chain
 *   { registered: true, expiresAt, instances, running }     running may be null (unreadable)
 *   null                                                    spec unreadable
 * Returns { alerts, notes, conclusive }.
 */
export function assess(apps, tip, warnDays = WARN_DAYS) {
  const alerts = [];
  const notes = [];
  let conclusive = true;
  const rows = Object.entries(apps).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, app] of rows) {
    if (app === null) {
      conclusive = false;
      notes.push(`${name}: spec unreadable this run`);
      continue;
    }
    if (!app.registered) {
      notes.push(`${name}: not registered`);
      continue;
    }
    const days = daysLeft(app.expiresAt, tip);
    if (days <= 0) {
      alerts.push(`${name}: subscription EXPIRED ${(-days).toFixed(1)} days ago`);
    } else if (days < warnDays) {
      alerts.push(
        `${name}: expires in ${days.toFixed(1)} days — FluxCloud auto-renew has not run; renew it`,
      );
    }
    if (app.running === null) {
      conclusive = false;
      notes.push(`${name}: live instance count unreadable this run`);
    } else if (app.running === 0) {
      alerts.push(`${name}: 0 of ${app.instances} instances running — this country is dark`);
    } else if (app.running < app.instances) {
      notes.push(`${name}: ${app.running} of ${app.instances} instances running`);
    }
  }
  return { alerts, notes, conclusive };
}

async function main() {
  const names = readdirSync(join(ROOT, 'specs', 'onchain'))
    .filter((f) => f.startsWith('cumulusvpn') && f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
  const tip = (await getJson(`${FLUX_API}/daemon/getblockcount`))?.data;
  if (!Number.isInteger(tip)) throw new Error('no block height from the Flux API');

  const apps = {};
  for (const name of names) {
    let spec;
    try {
      spec = await getJson(`${FLUX_API}/apps/appspecifications/${name}`);
    } catch {
      apps[name] = null;
      continue;
    }
    const d = spec?.data;
    if (spec?.status !== 'success' || !d || typeof d !== 'object' || !Number.isInteger(d.height)) {
      apps[name] = { registered: false };
      continue;
    }
    let running = null;
    try {
      const loc = await getJson(`${FLUX_API}/apps/location/${name}`);
      if (Array.isArray(loc?.data)) running = loc.data.length;
    } catch {
      // stays null → inconclusive, never a false "dark" alert
    }
    apps[name] = {
      registered: true,
      expiresAt: d.height + (d.expire ?? 22_000),
      instances: d.instances,
      running,
    };
  }

  const { alerts, notes, conclusive } = assess(apps, tip);
  const status = alerts.length ? 1 : conclusive ? 0 : 3;
  const soonest = Object.entries(apps)
    .filter(([, a]) => a?.registered)
    .map(([n, a]) => [n, daysLeft(a.expiresAt, tip)])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(([n, d]) => `${n} ${d.toFixed(1)}d`)
    .join(', ');
  const report = [
    [
      '## ✅ Gateway fleet is paid up and running',
      '## ❌ Gateway fleet needs attention',
      '',
      '## ⚠️ Gateway fleet check inconclusive',
    ][status],
    '',
    `Block ${tip}; ${names.length} specs checked; alert below ${WARN_DAYS} days. Soonest expiry: ${soonest}.`,
    '',
    ...alerts.map((a) => `- **ALERT:** ${a}`),
    ...notes.map((n) => `- ${n}`),
    '',
    'Renew: Flux Cloud (owner ZelID 196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH) → the app → check auto-renew, or extend it by hand. ' +
      'Image-only changes stay free via `scripts/update-image.mjs`, which keeps the expiry where it is.',
    '',
    `_${new Date().toISOString()} · deploy/scripts/expiry-watch.mjs_`,
    '',
  ].join('\n');
  console.log(report);
  if (flag('report')) writeFileSync(flag('report'), report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.exit(status);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`expiry-watch: ${e.message}`);
    process.exit(3); // inconclusive: a crash is not evidence the fleet is unpaid
  });
}
