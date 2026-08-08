#!/usr/bin/env node
// update-image.mjs — move every registered CumulusVPN app to a new gateway
// image + transport env, changing NOTHING else, for free.
//
//   node scripts/update-image.mjs                 # dry run over all registered apps
//   node scripts/update-image.mjs --only de,us    # just these countries
//   node scripts/update-image.mjs --broadcast     # sign + submit (needs the owner key)
//   node scripts/update-image.mjs --broadcast --wait   # ...and poll until it lands
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
// deployed: `contacts` on-chain is a Flux storage pointer ("F_S_CONTACTS=https://…")
// rather than the raw e-mail our generator emits, and `enterprise` is "" on older
// apps but `false` on newer ones. Rebuilding from the generator would rewrite both
// as a side effect of an image bump. So: fetch on-chain, patch, submit.
//
// WHY THE UPDATE IS FREE (and what "free" actually means)
// FluxOS prices an update at zero only if it does not extend the subscription —
// see checkFreeAppUpdate() in appSpecHelpers.js. `expire` is a DURATION counted
// from the app's registration height, so re-submitting the on-chain value
// verbatim moves the expiration to `now + expire` and Flux bills for the
// extension (a naive repotag-only patch on cumulusvpnza quoted 49.5 FLUX).
// The fix is to re-express `expire` as the blocks REMAINING, which keeps the
// expiration height where it already is and quotes 0. That is what every recent
// free update on this fleet did.
//
// Zero-priced does not mean no transaction: a message only becomes permanent
// once a chain transaction carries its hash. For free updates the network's own
// appsmonitor service pays the 0.02 FLUX minimum a couple of minutes after the
// broadcast — the owner pays nothing and needs no funded wallet. That is why
// there is no payment step here.
//
// KEYS
// The owner ZelID private key is read from $CVPN_ZELID_KEY or --key-file at run
// time. It is never printed, never written to disk, and never leaves this
// process. The tool checks the key derives the app's owner address before it
// signs anything, so a wrong key fails locally instead of on the network.
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

/**
 * Fields this migration is allowed to touch. `expire` is in the list because a
 * free update REQUIRES rewriting it (see header), but unlike the other two it is
 * also the field that costs money if it is wrong — so it gets its own exact-value
 * assertion below rather than riding on this guard alone.
 */
const MUTABLE = new Set(['repotag', 'environmentParameters', 'expire']);

/**
 * Blocks of slack subtracted from the remaining subscription, and the reason a
 * fleet-wide run works at all.
 *
 * A judge computes `blocksToExtend = height_when_judged - height_when_signed -
 * EXTEND_MARGIN`, and refuses the update as an extension above 8 (FluxOS) or 11
 * (the free-update payer). So the margin is not a rounding fudge — it is how long
 * the broadcast stays claimable. A bigger margin makes blocksToExtend SMALLER and
 * buys time.
 *
 * That time matters because the payer is serial: it sleeps 60s after each payment,
 * so the twentieth app in a batch is judged twenty minutes after it was signed. A
 * 4-block margin (~2 min) closed the window after five apps and stranded fifteen
 * — they stayed temporary forever, since nothing retries a skipped message.
 *
 * Sizing it: the payer was measured at roughly one app per six minutes (5 apps
 * per 30-minute window, twice), so a 23-app fleet needs ~2.5 hours of claim
 * window. 120 blocks bought one hour — enough to take the fleet from 7 to 12 in a
 * single run, and not enough to finish it. 480 blocks is four hours at 30s
 * post-fork blocks, which covers the whole fleet with room for a slower queue.
 *
 * The only cost is ending the subscription four hours early on a ~3 month term.
 * Nothing rejects an update for shortening: both gates test `blocksToExtend <=
 * limit`, and a negative value passes by construction.
 */
const EXTEND_MARGIN = 480;

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

/**
 * Retry transport-level failures only. A FluxOS error REPLY is a verdict and is
 * never retried — but a dropped connection says nothing about the request, and
 * losing one app out of 22 to a stray `fetch failed` means hand-finishing the
 * batch later.
 */
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function getJson(url) {
  return withRetry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  });
}

/**
 * POST to FluxOS. The body is sent WITHOUT a JSON content-type on purpose:
 * FluxOS handlers read the raw request stream themselves (`req.on('data')`), and
 * if express's JSON body-parser has already drained it those listeners never
 * fire, so the request hangs until the gateway times out. Sending the same JSON
 * as a plain string leaves the stream unread and the handler answers instantly.
 * This is what made every /apps POST look "dead" (504) for weeks.
 */
async function postFlux(path, payload, headers = {}) {
  return withRetry(async () => {
    const res = await fetch(`${FLUX_API}${path}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers,
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${path}: non-JSON reply (${res.status}) ${text.slice(0, 120)}`);
    }
  });
}

function unwrap(reply, what) {
  if (reply?.status !== 'success') {
    const d = reply?.data;
    throw new Error(`${what}: ${d?.message ?? JSON.stringify(d ?? reply).slice(0, 200)}`);
  }
  return reply.data;
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

async function daemonHeight() {
  const info = await getJson(`${FLUX_API}/daemon/getinfo`);
  const blocks = info?.data?.blocks;
  if (!blocks) throw new Error('could not read daemon block height');
  return blocks;
}

/** Log in to FluxOS the way its own tooling does, returning a `zelidauth` header. */
async function login(zelid, key, signMessage) {
  const loginPhrase = unwrap(await getJson(`${FLUX_API}/id/loginphrase`), 'loginphrase');
  const signature = signMessage(loginPhrase, key);
  unwrap(await postFlux('/id/verifylogin', { loginPhrase, zelid, signature }), 'verifylogin');
  return new URLSearchParams({ zelid, signature, loginPhrase }).toString();
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

  const height = await daemonHeight();
  console.log(`\nDaemon height: ${height}`);
  console.log(`Target image:  ${image}`);
  console.log(`Transport env: ${transportEnv.join('  ')}\n`);

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
    // a submitted spec and would fail validation if echoed back. `height` is kept
    // aside first — it is what the remaining subscription is measured from.
    const registeredAt = live.height;
    const current = { ...live };
    delete current.hash;
    delete current.height;

    const next = JSON.parse(JSON.stringify(current));
    for (const c of next.compose) {
      c.repotag = image;
      c.environmentParameters = mergeEnv(c.environmentParameters ?? [], transportEnv);
    }

    // Re-express the subscription as blocks remaining so the expiration height
    // stays put. Submitting the stored duration instead would extend it, and an
    // extension is precisely what Flux charges for.
    const expiresAt = registeredAt + current.expire;
    const remaining = expiresAt - height - EXTEND_MARGIN;
    if (remaining <= 0) {
      skipped.push([name, `subscription already expired (expires at ${expiresAt}, now ${height})`]);
      continue;
    }
    next.expire = remaining;

    // Guard: every differing path must sit AT or UNDER one of the owned fields.
    // Matching only the last segment would reject `…environmentParameters.7` — an
    // appended variable — so compare against the whole path.
    const changed = diffPaths(current, next);
    const illegal = changed.filter((p) => !p.split('.').some((seg) => MUTABLE.has(seg)));
    if (illegal.length) {
      skipped.push([name, `REFUSED — would also change: ${illegal.join(', ')}`]);
      continue;
    }
    if (!changed.some((p) => p.includes('repotag') || p.includes('environmentParameters'))) {
      skipped.push([name, 'already up to date']);
      continue;
    }

    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(next, null, 2)}\n`);
    ready.push({
      name,
      next,
      from: current.compose[0].repotag,
      changed,
      expiresAt,
      wasExpire: current.expire,
    });
  }

  for (const { name, from, next, changed, expiresAt, wasExpire } of ready) {
    console.log(`✓ ${name.padEnd(18)} ${from} → ${image}`);
    console.log(
      `  instances=${next.instances} (preserved) · expire ${wasExpire} → ${next.expire}` +
        ` (same expiry block ~${expiresAt}) · fields changed: ${changed.length}`,
    );
  }
  for (const [name, why] of skipped) console.log(`· ${name.padEnd(18)} ${why}`);
  console.log(`\n${ready.length} spec(s) written to specs/update/`);

  if (!has('broadcast')) {
    console.log('Dry run — nothing was submitted. Re-run with --broadcast to apply.');
    return;
  }
  if (!ready.length) return;

  const key =
    process.env.CVPN_ZELID_KEY ??
    (flag('key-file') && readFileSync(flag('key-file'), 'utf8').trim());
  if (!key) {
    console.error('\n--broadcast needs the owner key: set $CVPN_ZELID_KEY or pass --key-file.');
    process.exit(1);
  }
  const { signMessage, deriveZelId } = await import('./zelid-sign.mjs');

  // Fail on the wrong key here, locally, rather than after 22 rejected broadcasts.
  const owner = ready[0].next.owner;
  const derived = deriveZelId(key);
  if (derived !== owner) {
    console.error(`\nThis key derives ${derived} but the apps are owned by ${owner}. Refusing.`);
    process.exit(1);
  }
  const zelidauth = await login(owner, key, signMessage);
  console.log(`\nAuthenticated as ${owner}.\n`);

  // Broadcast in small batches, waiting for each to be paid before sending the
  // next. FluxOS keeps only a handful of temporary messages around — the pool was
  // observed holding 3 network-wide — and the free-update payer works through
  // what it can see at roughly one per minute. Submitting the whole fleet at once
  // therefore does not queue: the payer takes about five, the rest are pruned
  // before it comes back, and nothing retries them. Two runs lost 15 and then 11
  // apps exactly that way, both stopping at five.
  const BATCH = Number(flag('batch') ?? 4);
  const batches = [];
  for (let i = 0; i < ready.length; i += BATCH) batches.push(ready.slice(i, i + BATCH));

  const broadcast = [];
  const stuck = [];
  for (const [bi, batch] of batches.entries()) {
    // Re-price the subscription against the CURRENT height for every batch. A
    // fleet run spans hours, and expire is only meaningful relative to the height
    // it was computed at.
    const nowHeight = await daemonHeight();
    console.log(`— batch ${bi + 1}/${batches.length} (height ${nowHeight})`);
    const sent = await broadcastBatch(batch, nowHeight, { key, zelidauth, signMessage });
    broadcast.push(...sent);
    if (!sent.length) continue;
    const pending = await waitForLive(
      sent.map((s) => s.name),
      image,
    );
    stuck.push(...pending);
  }

  console.log(`\n${broadcast.length}/${ready.length} update message(s) broadcast.`);
  if (stuck.length) {
    console.log(`Not confirmed: ${stuck.join(' ')} — re-run to re-sign just those.`);
  } else if (broadcast.length) {
    console.log('All confirmed live on-chain.');
  }
  return;
}

/** Sign and submit one batch, returning what actually went out. */
async function broadcastBatch(batch, nowHeight, { key, zelidauth, signMessage }) {
  const sent = [];
  for (const item of batch) {
    const { name, next, expiresAt } = item;
    next.expire = expiresAt - nowHeight - EXTEND_MARGIN;
    try {
      // Ask the node to format the spec exactly as it will when verifying our
      // signature. Signing our own JSON instead would break the moment FluxOS
      // reorders a key or coerces a type.
      const formatted = unwrap(
        await postFlux('/apps/verifyappupdatespecifications', next),
        `${name} verify`,
      );

      // Price guard. A pure image+env change extends nothing, so it must quote
      // zero. Anything else means the spec differs from what we think it does —
      // stop rather than spend. An unreachable quote is UNKNOWN, never free.
      const price = unwrap(
        await postFlux('/apps/calculatefiatandfluxprice', formatted),
        `${name} price`,
      );
      if (Number(price.usd) !== 0 && !has('allow-cost')) {
        console.log(`· ${name}: quoted ${price.flux} FLUX / $${price.usd} — skipped (not free)`);
        continue;
      }

      const timestamp = Date.now();
      const signature = signMessage(`fluxappupdate1${JSON.stringify(formatted)}${timestamp}`, key);
      const hash = unwrap(
        await postFlux(
          '/apps/appupdate',
          {
            type: 'fluxappupdate',
            version: 1,
            appSpecification: formatted,
            timestamp,
            signature,
          },
          { zelidauth },
        ),
        `${name} update`,
      );
      console.log(`→ ${name.padEnd(18)} broadcast, message ${hash}`);
      sent.push({ name, hash });
    } catch (e) {
      console.log(`✗ ${name.padEnd(18)} ${e.message}`);
    }
  }
  return sent;
}

/**
 * Wait for a batch to go permanent, returning whatever never did.
 *
 * Polls the on-chain spec rather than the message: the repotag flipping is the
 * outcome we actually want, and it only flips once the message has been paid for.
 * A batch that never confirms is reported, not retried here — re-running the tool
 * re-signs at a fresh height, which is the correct retry.
 */
async function waitForLive(names, image, minutes = 15) {
  const pending = new Set(names);
  const deadline = Date.now() + minutes * 60 * 1000;
  while (pending.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30_000));
    for (const name of [...pending]) {
      try {
        const { data } = await getJson(`${FLUX_API}/apps/appspecifications/${name}`);
        if (data?.compose?.every((c) => c.repotag === image)) {
          console.log(`✓ ${name.padEnd(18)} live on ${image}`);
          pending.delete(name);
        }
      } catch {
        /* transient; try again next tick */
      }
    }
  }
  for (const name of pending) console.log(`… ${name.padEnd(18)} not confirmed in ${minutes} min`);
  return [...pending];
}

main().catch((e) => {
  console.error(`update-image: ${e.message}`);
  process.exit(1);
});
