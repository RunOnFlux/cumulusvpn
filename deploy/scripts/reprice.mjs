#!/usr/bin/env node
// reprice.mjs — change the premium FLUX price, prospectively, everywhere it lives.
//
//   node scripts/reprice.mjs --usd 0.85             # plan: price from live FLUX/USD (dry run)
//   node scripts/reprice.mjs --flux 12              # plan: an explicit price (dry run)
//   node scripts/reprice.mjs --flux 12 --apply      # write the repo side, dry-run the fleet
//   node scripts/reprice.mjs --flux 12 --apply --broadcast [--key-file f]
//                                                   # ...and push it to every gateway spec
//
//   --lead <blocks>        blocks from now until the new price applies (default 240, ~2 h:
//                          time for the batched spec updates to land, so every gateway
//                          hot-applies the entry BEFORE it starts — no rescans, one switch)
//   --force                allow a price outside the USD band in countries.yaml
//   --force-redate         re-date an unsent entry whose earlier broadcast may still land
//   --price-only           fleet step touches only the price env (default: full desired
//                          state from countries.yaml — image, transports and price — which
//                          is what rolls a schedule-capable image in the same update)
//   --directory-key <f>    directory signing key (default directory/directory.key)
//
// WHAT A REPRICE IS
// One entry appended to countries.yaml `price.schedule`: "<flux>@<height>", with the
// height a few blocks in the future. Every gateway judges a payment by the price in
// force at the height it was MINED at (gateway/internal/price), so nothing already paid
// changes — and for 72 h after the change the lower of the old and new price is honoured,
// so nobody quoted the old price mid-flight is short-changed.
//
// WHERE THE PRICE LIVES — --apply updates all of it:
//   deploy/countries.yaml               price.schedule (canonical, append-only)
//   gateway app specs, on-chain         CVPN_PRICE_SCHEDULE + CVPN_PRICE_FLUX, via
//                                       update-image.mjs (--broadcast to send)
//   clients/web/public/directory.json   price_flux, re-signed — plus the 3 bundled copies
//   deploy/directory/directory.json     price_flux in the unsigned template
//   clients/landing/public/**           rebuilt (the price is a build token)
//   bridge (operator infra)             PRICE_SCHEDULE / PRICE_FLUX — printed; set by hand
//
// RE-DATING
// An entry no registered app carries yet is not live anywhere, so a new reprice REPLACES
// it instead of appending behind it — the fix for a planned change that was never sent.
// Two things make that safe: every registered app must be readable (an unreadable one
// might carry it), and an entry whose broadcast may still be landing is left alone —
// update-image's messages stay claimable for ~EXTEND_MARGIN blocks after signing.
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import {
  BLOCK_SECONDS,
  fetchFluxUsd,
  formatFlux,
  formatSchedule,
  parseSchedule,
  priceAt,
  readPriceConfig,
  scheduleFromEnv,
  suggestPrice,
} from './price.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..'); // deploy/
const REPO = join(ROOT, '..');
const FLUX_API = process.env.FLUX_API ?? 'https://api.runonflux.io';

/** The served directory, then its bundled copies — all four must stay byte-identical. */
export const DIRECTORY_COPIES = [
  'clients/web/public/directory.json',
  'clients/web/src/directory.bundled.json',
  'clients/mobile/src/data/directory.json',
  'clients/desktop/src/data/directory.json',
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

/**
 * Rewrite the `schedule:` line of the `price:` block in countries.yaml text,
 * leaving every comment and all other formatting exactly as it was.
 */
export function rewriteScheduleLine(yamlText, schedule) {
  const re = /^(price:\n(?:[ \t]*#.*\n|[ \t]+\S.*\n)*?[ \t]+schedule:[ \t]*)(\S.*)$/m;
  if (!re.test(yamlText)) throw new Error('countries.yaml: no `schedule:` line under `price:`');
  return yamlText.replace(re, (_, head) => `${head}'${schedule}'`);
}

/**
 * The schedule with `entry` added: an unpublished tail (entries no app carries)
 * is replaced, everything published is kept. Throws on a reprice that would be
 * a no-op or would land before a published entry.
 */
export function plannedSchedule(entries, published, entry, { tip = 0, forceRedate = false } = {}) {
  const key = (e) => `${formatFlux(e.flux)}@${e.from}`;
  let keep = entries.length;
  while (keep > 1 && !published.has(key(entries[keep - 1]))) keep -= 1;
  const inFlight = entries.slice(keep).find((e) => tip <= e.from + REDATE_SETTLE_BLOCKS);
  if (inFlight && !forceRedate) {
    throw new Error(
      `unsent entry ${key(inFlight)} may still land (its update messages stay claimable ` +
        `until ~block ${inFlight.from + REDATE_SETTLE_BLOCKS}); wait, or pass --force-redate`,
    );
  }
  const kept = entries.slice(0, keep);
  const last = kept[kept.length - 1];
  if (entry.from <= last.from) {
    throw new Error(`a published entry (${key(last)}) starts at/after block ${entry.from}`);
  }
  if (entry.flux === last.flux) throw new Error(`the fleet already charges ${entry.flux} FLUX`);
  return { schedule: [...kept, entry], replaced: entries.slice(keep) };
}

/**
 * How long after an entry's start an unsent copy of it may still land: the
 * start is at most the broadcast height + lead, and update-image signs with
 * EXTEND_MARGIN (480) blocks of claim window. Conservative on purpose.
 */
export const REDATE_SETTLE_BLOCKS = 480;

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
 * Every schedule entry some registered app's on-chain spec already carries.
 * Fails closed: an app that cannot be read might carry an entry, and treating
 * it as empty would let a reprice re-date a live entry.
 */
async function publishedEntries(manifest) {
  const names = (manifest.countries ?? []).flatMap((c) => [
    `cumulusvpn${c.cc}`,
    ...(c.stealth ? [`cumulusvpntls${c.cc}`] : []),
  ]);
  const seen = new Set();
  let apps = 0;
  for (let i = 0; i < names.length; i += 6) {
    await Promise.all(
      names.slice(i, i + 6).map(async (name) => {
        const reply = await getJson(`${FLUX_API}/apps/appspecifications/${name}`);
        // FluxOS answers an unknown app with status "error"; an enterprise spec
        // has an encrypted (empty) public compose. Neither carries a price.
        const env =
          reply?.status === 'success' ? reply.data?.compose?.[0]?.environmentParameters : null;
        if (!env?.length) return;
        for (const e of scheduleFromEnv(env)) seen.add(`${formatFlux(e.flux)}@${e.from}`);
        apps += 1;
      }),
    );
  }
  if (!apps) throw new Error('could not read the price from any registered app spec');
  return seen;
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${[cmd, ...argv].join(' ')} exited ${r.status}`);
}

/** Re-sign the served directory at the new price and fan it out to every copy. */
function resignDirectory(flux, keyPath) {
  const served = join(REPO, DIRECTORY_COPIES[0]);
  const dir = JSON.parse(readFileSync(served, 'utf8'));
  delete dir.sig;
  delete dir.sign_pubkey;
  dir.price_flux = flux;
  dir.updated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const tmp = mkdtempSync(join(tmpdir(), 'cvpn-dir-'));
  try {
    const unsigned = join(tmp, 'unsigned.json');
    const signed = join(tmp, 'signed.json');
    writeFileSync(unsigned, `${JSON.stringify(dir, null, 2)}\n`);
    const mk = join(ROOT, 'directory', 'make-directory.mjs');
    run(process.execPath, [mk, 'sign', '--in', unsigned, '--out', signed, '--key', keyPath]);
    run(process.execPath, [mk, 'verify', '--in', signed]);
    for (const rel of DIRECTORY_COPIES) copyFileSync(signed, join(REPO, rel));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // The unsigned template `build` starts from: keep its price in step too.
  const tplPath = join(ROOT, 'directory', 'directory.json');
  const tpl = readFileSync(tplPath, 'utf8');
  writeFileSync(tplPath, tpl.replace(/("price_flux":\s*)[\d.]+/, `$1${flux}`));
}

async function main() {
  const manifestText = readFileSync(join(ROOT, 'countries.yaml'), 'utf8');
  const manifest = parseYaml(manifestText);
  const cfg = readPriceConfig(manifest);

  const tip = (await getJson(`${FLUX_API}/daemon/getblockcount`))?.data;
  if (!Number.isSafeInteger(tip)) throw new Error('could not read the chain height');
  const current = priceAt(cfg.entries, tip);

  let rate;
  try {
    rate = await fetchFluxUsd();
  } catch (e) {
    if (flag('flux') === undefined) throw e;
    console.warn(`⚠️  FLUX/USD unavailable (${e.message}); continuing without a USD check`);
  }
  const usd = rate?.usd;
  const suggestion = usd ? suggestPrice(usd, cfg.targetUsd, cfg.ceilingUsd) : undefined;

  console.log(`\nChain height:  ${tip}`);
  if (rate) {
    const venues = rate.quotes.map((q) => `${q.source} ${q.usd}`).join(', ');
    console.log(`FLUX/USD:      $${usd.toFixed(5)}  (median of ${venues})`);
  }
  console.log(
    `Now charging:  ${current} FLUX${usd ? ` ≈ $${(current * usd).toFixed(2)}` : ''} / 30 days`,
  );
  console.log(
    `USD band:      $${cfg.floorUsd}–$${cfg.ceilingUsd} (target $${cfg.targetUsd})` +
      (suggestion ? ` → suggested ${suggestion} FLUX ≈ $${(suggestion * usd).toFixed(2)}` : ''),
  );

  let flux;
  if (flag('flux') !== undefined) flux = Number(flag('flux'));
  else if (flag('usd') !== undefined) {
    if (!usd) throw new Error('--usd needs a live FLUX/USD rate');
    flux = suggestPrice(usd, Number(flag('usd')), cfg.ceilingUsd);
  } else {
    console.log('\nPass --flux <amount> or --usd <target> to plan a reprice.');
    process.exit(2);
  }
  // Round-trips through the shared parser: ≤ 8 decimals, no exponent forms.
  try {
    parseSchedule(String(flux));
  } catch {
    throw new Error(`invalid price ${flux}`);
  }
  if (usd && (flux * usd > cfg.ceilingUsd || flux * usd < cfg.floorUsd) && !has('force')) {
    throw new Error(
      `${flux} FLUX ≈ $${(flux * usd).toFixed(2)} is outside $${cfg.floorUsd}–$${cfg.ceilingUsd} ` +
        '(--force to override)',
    );
  }

  const lead = Number(flag('lead') ?? 240);
  if (!Number.isSafeInteger(lead) || lead < 1) throw new Error('--lead must be a positive integer');
  const published = await publishedEntries(manifest);
  const { schedule, replaced } = plannedSchedule(
    cfg.entries,
    published,
    { from: tip + lead, flux },
    { tip, forceRedate: has('force-redate') },
  );
  const wire = formatSchedule(schedule);
  const eta = new Date(Date.now() + lead * BLOCK_SECONDS * 1000);

  console.log(
    `\nNew price:     ${flux} FLUX${usd ? ` ≈ $${(flux * usd).toFixed(2)}` : ''} / 30 days, ` +
      `from block ${tip + lead} (~${eta.toISOString().slice(11, 16)} UTC)`,
  );
  if (replaced.length) console.log(`Re-dating:     unsent ${formatSchedule(replaced)} is replaced`);
  console.log(`Schedule:      ${wire}`);
  console.log(`Bridge env:    PRICE_SCHEDULE=${wire}  PRICE_FLUX=${flux}`);

  if (!has('apply')) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  // Preflight everything --apply touches before writing any of it.
  const keyPath = resolve(flag('directory-key') ?? join(ROOT, 'directory', 'directory.key'));
  if (!existsSync(keyPath)) throw new Error(`no directory signing key at ${keyPath}`);
  const shipped = JSON.parse(readFileSync(join(REPO, DIRECTORY_COPIES[0]), 'utf8')).sign_pubkey;
  const keyPub = JSON.parse(readFileSync(keyPath, 'utf8')).pub;
  if (shipped !== keyPub) {
    // Clients pin the pubkey: signing with another key would brick every one of them.
    throw new Error(`key ${keyPath} is not the directory key clients ship (${shipped})`);
  }
  const nextYaml = rewriteScheduleLine(manifestText, wire);
  if (formatSchedule(readPriceConfig(parseYaml(nextYaml)).entries) !== wire) {
    throw new Error('countries.yaml rewrite did not round-trip');
  }

  writeFileSync(join(ROOT, 'countries.yaml'), nextYaml);
  console.log('\n✓ countries.yaml price.schedule');
  resignDirectory(flux, keyPath);
  console.log(`✓ directory re-signed at ${flux} FLUX → ${DIRECTORY_COPIES.join(', ')}`);
  run(process.execPath, [join(REPO, 'clients', 'landing', 'build.mjs')]);
  console.log('✓ landing rebuilt');

  const fleetArgs = [join(HERE, 'update-image.mjs')];
  if (has('price-only')) fleetArgs.push('--price-only');
  if (has('broadcast')) fleetArgs.push('--broadcast');
  if (flag('key-file')) fleetArgs.push('--key-file', flag('key-file'));
  console.log(`\nFleet specs (${['update-image.mjs', ...fleetArgs.slice(1)].join(' ')}):`);
  const fleet = spawnSync(process.execPath, fleetArgs, { stdio: 'inherit' });
  const fleetOk = fleet.status === 0;
  const when = `block ${tip + lead} (~${eta.toISOString().slice(11, 16)} UTC)`;

  if (!has('broadcast')) {
    console.log(`
Next:
  1. Send the fleet update: node scripts/update-image.mjs${has('price-only') ? ' --price-only' : ''} --broadcast --key-file <owner key>
     ${fleetOk ? '' : '⚠️  the dry run above REFUSED some apps — resolve that first. '}Send it well before ${when}.
  2. After ${when}: set the bridge's PRICE_SCHEDULE=${wire} PRICE_FLUX=${flux} (new image), then
     commit + push this repo (web, landing and the bundled directories go live on push).
  3. Check convergence: node scripts/price-watch.mjs`);
    return;
  }
  if (!fleetOk) {
    throw new Error(
      'the fleet update is INCOMPLETE (refused, failed or unconfirmed apps above). Re-run ' +
        'update-image.mjs --broadcast for the rest; do not set the bridge or push until every ' +
        'app carries the new schedule.',
    );
  }
  console.log(`
Next:
  1. After ${when}: set the bridge's PRICE_SCHEDULE=${wire} PRICE_FLUX=${flux} (new image), then
     commit + push this repo (web, landing and the bundled directories go live on push).
  2. Check convergence: node scripts/price-watch.mjs`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`reprice: ${e.message}`);
    process.exit(1);
  });
}
