#!/usr/bin/env node
// update-image.mjs — move every registered CumulusVPN app to a new gateway
// image + transport env, changing NOTHING else.
//
//   node scripts/update-image.mjs                      # dry run, all registered apps
//   node scripts/update-image.mjs --only de,us         # just these countries
//   node scripts/update-image.mjs --broadcast          # sign + submit (needs a key)
//
// WHY THIS EXISTS
// Hand-editing 20+ specs is how the fleet drifted: countries.yaml said US had 6
// instances while 20 were live, and an update built from that file would have
// quietly cut 14 nodes — a change no price quote would flag, because a SMALLER
// app is not more expensive. This script never authors a spec; it takes the one
// already on-chain and patches two fields.
//
// WHY IT DOES NOT USE specs/onchain/*.json
// Those are regenerated from countries.yaml and differ from what is actually
// deployed in ways that matter:
//   • contacts   on-chain is a Flux storage pointer ("F_S_CONTACTS=https://…"),
//                not the raw e-mail our generator emits.
//   • expire     on-chain is the REMAINING subscription, not the 264000 we
//                register with. Submitting the bigger number asks Flux to
//                extend the subscription — which is exactly what costs FLUX.
//   • enterprise on-chain is "" on older apps, `false` on newer ones.
// Rebuilding from the generator would rewrite all three as a side effect of an
// image bump. So: fetch on-chain, patch, submit.
//
// KEYS
// The owner ZelID private key is read from $CVPN_ZELID_KEY or --key-file at run
// time. It is never printed, never written to disk, and never leaves this
// process. Broadcasting also needs the FLUX fee paid from a separate funded
// wallet — that step stays manual on purpose (see PAYMENT below).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLUX_API = process.env.FLUX_API ?? 'https://api.runonflux.io';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? '');
};
const has = (name) => args.includes(`--${name}`);

/** Fields we are willing to change. Anything else differing aborts that app. */
const MUTABLE = new Set(['repotag', 'environmentParameters']);

/** The env vars this migration owns; everything else on-chain is preserved. */
function desiredTransportEnv() {
  const cfg = parseYaml(readFileSync(join(ROOT, 'countries.yaml'), 'utf8'));
  const d = cfg.defaults ?? {};
  const out = [];
  if (d.obfs) out.push('CVPN_OBFS_ENABLE=1');
  if (d.tls) out.push('CVPN_TLS_ENABLE=1');
  if (d.tlsSni) out.push(`CVPN_TLS_SNI=${d.tlsSni}`);
  return { env: out, image: d.repotag };
}

/** Merge: drop any existing copy of the keys we own, then append ours, so the
 *  on-chain ordering of every unrelated variable survives untouched. */
function mergeEnv(current, desired) {
  const owned = new Set(desired.map((e) => e.split('=')[0]));
  const kept = current.filter((e) => !owned.has(e.split('=')[0]));
  return [...kept, ...desired];
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Deep diff → dotted paths that differ, descending into arrays as well as
 * objects so a change lands on `compose.0.repotag` rather than the whole
 * `compose` array. Without that the guard cannot tell an image bump from a
 * wholesale component rewrite, and refuses everything.
 */
function diffPaths(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const walkable = (v) => v && typeof v === 'object';
  if (!walkable(a) || !walkable(b) || Array.isArray(a) !== Array.isArray(b)) {
    return [path || '(root)'];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPaths(a[k], b[k], path ? `${path}.${k}` : k));
}

async function main() {
  const { env: transportEnv, image: defaultImage } = desiredTransportEnv();
  const image = flag('image') ?? defaultImage;
  if (!image)
    throw new Error('no target image (set defaults.repotag in countries.yaml or --image)');

  const only = flag('only')
    ?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // The apps to touch = every spec we generate, minus the ones not registered.
  const cfg = parseYaml(readFileSync(join(ROOT, 'countries.yaml'), 'utf8'));
  let names = (cfg.countries ?? []).flatMap((c) => [
    `cumulusvpn${c.cc}`,
    ...(c.stealth ? [`cumulusvpntls${c.cc}`] : []),
  ]);
  if (only) names = names.filter((n) => only.some((cc) => n.endsWith(cc)));

  const outDir = join(ROOT, 'specs', 'update');
  mkdirSync(outDir, { recursive: true });

  const ready = [];
  const skipped = [];
  for (const name of names) {
    let live;
    try {
      const { status, data } = await getJson(`${FLUX_API}/apps/appspecifications/${name}`);
      if (status !== 'success' || !data?.compose?.length) throw new Error('no compose in response');
      live = data;
    } catch (e) {
      skipped.push([name, `not registered / unreadable (${e.message})`]);
      continue;
    }

    // `hash` and `height` are chain metadata the node adds; they are not part of
    // a submitted spec and would fail validation if echoed back.
    const current = { ...live };
    delete current.hash;
    delete current.height;
    const next = JSON.parse(JSON.stringify(current));
    for (const c of next.compose) {
      c.repotag = image;
      c.environmentParameters = mergeEnv(c.environmentParameters ?? [], transportEnv);
    }

    // Guard: every differing path must sit AT or UNDER one of the owned
    // fields. Matching only the last segment would reject `…
    // environmentParameters.7` — an appended variable — while accepting
    // nothing useful, so compare against the whole path.
    const changed = diffPaths(current, next);
    const illegal = changed.filter((p) => !p.split('.').some((seg) => MUTABLE.has(seg)));
    if (illegal.length) {
      skipped.push([name, `REFUSED — would also change: ${illegal.join(', ')}`]);
      continue;
    }
    if (!changed.length) {
      skipped.push([name, 'already up to date']);
      continue;
    }

    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(next, null, 2)}\n`);
    ready.push({ name, next, from: current.compose[0].repotag, changed });
  }

  console.log(`\nTarget image: ${image}`);
  console.log(`Transport env: ${transportEnv.join('  ')}\n`);
  for (const { name, from, next, changed } of ready) {
    console.log(`✓ ${name.padEnd(18)} ${from} → ${image}`);
    console.log(
      `  instances=${next.instances} expire=${next.expire} (both preserved) · fields changed: ${changed.length}`,
    );
  }
  for (const [name, why] of skipped) console.log(`· ${name.padEnd(18)} ${why}`);
  console.log(`\n${ready.length} spec(s) written to specs/update/`);

  if (!has('broadcast')) {
    console.log(
      'Dry run. Review the JSON above, then either paste each file into the Flux UI\n' +
        '(Apps → Update, owner ZelID signs in Zelcore), or re-run with --broadcast.',
    );
    return;
  }

  const key =
    process.env.CVPN_ZELID_KEY ??
    (flag('key-file') && readFileSync(flag('key-file'), 'utf8').trim());
  if (!key) {
    console.error('\n--broadcast needs the owner key: set $CVPN_ZELID_KEY or pass --key-file.');
    process.exit(1);
  }
  const { signMessage } = await import('./zelid-sign.mjs');

  for (const { name, next } of ready) {
    // PRICE GUARD. An image+env change alters no resource and does not extend
    // `expire`, so it must not cost FLUX. If the quote says otherwise, that
    // means the spec differs from what we think it does — stop rather than
    // spend. (The public POST endpoints have been 504-ing; an unreachable
    // quote is treated as unknown, not as free.)
    let price;
    try {
      const res = await fetch(`${FLUX_API}/apps/calculateprice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(25_000),
      });
      price = res.ok ? (await res.json())?.data : null;
    } catch {
      price = null; // unreachable quote is UNKNOWN, never assumed free
    }
    if (!has('allow-cost')) {
      if (price == null) {
        // The quote endpoint is unreachable (504s for weeks). "Unknown" must
        // not fall through as "free" — that is how an update that silently
        // extends a subscription would get broadcast.
        console.log(`· ${name}: price unknown (quote endpoint unreachable) — skipped`);
        continue;
      }
      if (Number(price) > 0) {
        console.log(`· ${name}: quoted ${price} FLUX — skipped`);
        continue;
      }
    }

    const timestamp = Date.now();
    const message = `fluxappupdate${JSON.stringify(next)}${timestamp}`;
    const signature = signMessage(message, key);
    const res = await fetch(`${FLUX_API}/apps/appupdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'fluxappupdate',
        version: 1,
        appSpecifications: next,
        timestamp,
        signature,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    console.log(`→ ${name}: ${res.status} ${body.slice(0, 200)}`);
  }

  // PAYMENT is deliberately not automated: it moves money from a different,
  // funded wallet than the ZelID that signs here. A free update needs none —
  // if a broadcast comes back asking for one, that is the signal to stop and
  // look at what the spec actually changed.
  console.log('\nIf a broadcast returned a message hash AND a price, pay it per docs/16 Stage C.');
}

main().catch((e) => {
  console.error(`update-image: ${e.message}`);
  process.exit(1);
});
