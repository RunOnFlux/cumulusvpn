#!/usr/bin/env node
// generate.mjs — expand deploy/countries.yaml into per-country Flux v8 enterprise app specs.
//
//   node generate.mjs --stage beta            # generate all countries with stage <= beta
//   node generate.mjs --stage beta --check     # also query eligible datacenter-node counts
//
// Outputs, per country <cc>:
//   deploy/specs/plain/cumulus<cc>.json     SECRET  {contacts, components}  -> feeds encrypt.mjs
//   deploy/specs/onchain/cumulus<cc>.json   PUBLIC  v8 spec, enterprise field left as a placeholder
//                                                   until encrypt.mjs fills it.
//
// This script does NOT talk to any wallet or broadcast. register.sh does that.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml'; // yarn add yaml

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STAGES = { beta: 0, ga: 1, scale: 2 };
const STATS_API = process.env.FLUX_STATS_API || 'https://stats.runonflux.io';

const args = process.argv.slice(2);
const stage = args[stageIdx() + 1] ?? 'beta';
const doCheck = args.includes('--check');
// variant: 'open' (default, DEPLOYABLE) inlines the public image+env on-chain, no encryption,
// no datacenter flag. 'datacenter' keeps the enterprise/encrypted path (needs a real encrypt.mjs
// — the current one is a stub, so datacenter specs are NOT registerable yet).
const variant = flagValue('--variant') ?? 'open';
function stageIdx() {
  const i = args.indexOf('--stage');
  return i === -1 ? -1 : i;
}
function flagValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}
if (!['open', 'datacenter'].includes(variant)) {
  console.error(`--variant must be "open" or "datacenter" (got "${variant}")`);
  process.exit(1);
}

// The gateway's runtime env. Every value is PUBLIC (the payment address is on-chain; the directory
// pubkey is published in clients) — so the OPEN variant leaks nothing by inlining it on-chain.
//
// DPI-resistant transports (docs/15-transports.md) are additive and ride the FREE protocol sides
// of ports we already list, so they cost no extra Flux ports on the standard group:
//   - CVPN_OBFS_ENABLE=1 → AmneziaWG (awg) on 51821/udp   (free UDP side of the API port)
//   - CVPN_TLS_ENABLE=1  → WireGuard-over-TLS (wg-tls) on 51820/tcp (free TCP side of the WG port)
// The 443 STEALTH group additionally sets CVPN_TLS_PORT=443 (opts.tlsPort) for censors that allow
// only 443. A 0.1.0 gateway (or defaults.obfs/tls unset) advertises neither → behaves like today.
function gatewayEnv(defaults, opts = {}) {
  const env = [
    'CVPN_PRICE_FLUX=20',
    'CVPN_PAYMENT_ADDRESS=t3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ',
    'CVPN_DIRECTORY_PUBKEY=1e+42nEpmdjf/cAHs+yE2E2iwmAADpWiLy1VMepsKKw=',
    'CVPN_FREE_RATE_KBPS=100',
    'CVPN_PREMIUM_RATE_MBPS=50',
    `CVPN_MAX_PEERS_FREE=${defaults.maxPeersFree ?? 400}`,
    `CVPN_MAX_PEERS_TOTAL=${defaults.maxPeersTotal ?? 1000}`,
  ];
  if (defaults.obfs) env.push('CVPN_OBFS_ENABLE=1');
  // wg-tls is on whenever the fleet default enables it OR this is the 443 stealth group.
  if (defaults.tls || opts.tlsPort) {
    env.push('CVPN_TLS_ENABLE=1');
    if (defaults.tlsSni) env.push(`CVPN_TLS_SNI=${defaults.tlsSni}`);
    if (opts.tlsPort) env.push(`CVPN_TLS_PORT=${opts.tlsPort}`);
    // Reserve the SCARCE 443 stealth tier for paying users (docs/15). Only the
    // 443 group is gated: the standard group's wg-tls rides the free TCP side of
    // 51820, so gating it would take stealth away from free users for no saving.
    // The gateway enforces this by keeping free keys out of that listener's
    // peer set — clients just skip it and land on awg.
    if (opts.tlsPort && defaults.tlsPremium) env.push('CVPN_TLS_PREMIUM=1');
  }
  return env;
}

const manifest = parseYaml(readFileSync(join(ROOT, 'countries.yaml'), 'utf8'));
const { owner, defaults, countries } = manifest;
const wanted = countries.filter((c) => STAGES[c.stage ?? 'beta'] <= STAGES[stage]);

mkdirSync(join(ROOT, 'specs', 'plain'), { recursive: true });
mkdirSync(join(ROOT, 'specs', 'onchain'), { recursive: true });

let eligibleByCountry = null;
if (doCheck) eligibleByCountry = await fetchEligibleNodeCounts();

for (const c of wanted) {
  const instances = c.instances ?? defaults.instances;

  // Every country gets the standard `cumulusvpn<cc>` group, which advertises the
  // transports on the FREE protocol sides of its existing ports (no extra ports).
  // A country flagged `stealth: true` ALSO gets a separate `cumulusvpntls<cc>`
  // group that lists 443 and runs the TLS relay there — for censors that allow
  // only 443. Keeping 443 in its own spec bounds that scarce/expensive port to a
  // small strategic footprint instead of the whole fleet (docs/15 M4).
  const groups = [{ name: `cumulusvpn${c.cc}`, ports: defaults.ports, tlsPort: undefined }];
  if (c.stealth) {
    groups.push({
      name: `cumulusvpntls${c.cc}`,
      ports: c.stealthPorts ?? defaults.stealthPorts ?? [...defaults.ports, 443],
      tlsPort: 443,
    });
  }
  for (const g of groups) emitSpec(c, g, instances);

  let note = '';
  if (eligibleByCountry) {
    const cov = eligibleByCountry.get(c.cc.toUpperCase()) ?? {
      total: 0,
      static: 0,
      staticDatacenter: 0,
    };
    // What the spec can actually land on: static nodes when staticip is demanded, any
    // node otherwise (open variant); the datacenter variant additionally needs dataCenter.
    const staticip = c.staticip ?? defaults.staticip ?? true;
    const avail =
      variant === 'datacenter' ? cov.staticDatacenter : staticip ? cov.static : cov.total;
    const detail = `${cov.total} nodes, ${cov.static} static`;
    if (avail < instances)
      note = `  ⚠️  only ${avail} eligible (${detail}) < ${instances} instances — will under-fill`;
    else note = `  (${avail} eligible; ${detail})`;
  }
  const stealthNote = c.stealth ? '  (+tls stealth 443)' : '';
  console.log(`✓ cumulusvpn${c.cc}  ${c.geolocation}  instances=${instances}${stealthNote}${note}`);
}

// Build + write the on-chain (and, for the datacenter variant, plain) spec for one
// group of a country. `g` is { name, ports, tlsPort } — tlsPort set only for the
// 443 stealth group. Env is identical to the standard group plus CVPN_TLS_PORT.
function emitSpec(c, g, instances) {
  const name = g.name;
  const repotag = c.repotag ?? defaults.repotag;
  const cpu = c.cpu ?? defaults.cpu;
  const ram = c.ram ?? defaults.ram;
  const hdd = c.hdd ?? defaults.hdd;
  const ports = g.ports;
  const domains = ports.map(() => '');
  const expire = c.expire ?? defaults.expire ?? 264000;
  const staticip = c.staticip ?? defaults.staticip ?? true;
  const env = gatewayEnv(defaults, { tlsPort: g.tlsPort });

  if (variant === 'open') {
    // ---- OPEN v8 spec (DEPLOYABLE): public image + real env inline on-chain, no encryption.
    // enterprise:false is the required-in-v8 flag for a non-enterprise app; no datacenter flag.
    const onchain = {
      version: 8,
      name,
      description: 'CumulusVPN — decentralized VPN gateway',
      owner,
      compose: [
        {
          name: 'gateway',
          description: `CumulusVPN gateway (${c.cc.toUpperCase()})`,
          repotag,
          ports,
          containerPorts: ports,
          domains,
          environmentParameters: env,
          commands: [],
          containerData: '/data',
          cpu,
          ram,
          hdd,
        },
      ],
      instances,
      contacts: ['info@cumulusvpn.com'],
      geolocation: [c.geolocation],
      nodes: c.nodes ?? [],
      staticip,
      enterprise: false,
      expire,
    };
    writeFileSync(join(ROOT, 'specs', 'onchain', `${name}.json`), JSON.stringify(onchain, null, 2));
  } else {
    // ---- DATACENTER v8 spec: enterprise/encrypted path. plain inner spec (SECRET) feeds
    // encrypt.mjs; on-chain compose carries EMPTY env + an enterprise-blob placeholder.
    // NOTE: encrypt.mjs is currently a STUB — datacenter specs are not registerable until it
    // is wired to real FluxOS enterprise encryption.
    const plain = {
      contacts: ['info@cumulusvpn.com'],
      components: [
        {
          name: 'gateway',
          description: `CumulusVPN gateway (${c.cc.toUpperCase()})`,
          repotag,
          repoauth: '', // PUBLIC GHCR image — no auth needed (set only for a private registry)
          ports,
          containerPorts: ports,
          domains,
          environmentParameters: env,
          commands: [],
          containerData: '/data',
          cpu,
          ram,
          hdd,
          secrets: '',
        },
      ],
    };
    const onchain = {
      version: 8,
      name,
      description: 'CumulusVPN — decentralized VPN gateway',
      owner,
      instances,
      contacts: [],
      geolocation: [c.geolocation],
      expire,
      nodes: c.nodes ?? [],
      staticip,
      datacenter: c.datacenter ?? defaults.datacenter ?? true,
      enterprise: 'REPLACE_WITH_ENCRYPTED_BLOB', // encrypt.mjs overwrites this
      compose: [
        {
          name: 'gateway',
          description: 'gateway',
          repotag,
          ports,
          containerPorts: ports,
          domains,
          environmentParameters: [],
          commands: [],
          containerData: '/data',
          cpu,
          ram,
          hdd,
        },
      ],
    };
    writeFileSync(join(ROOT, 'specs', 'plain', `${name}.json`), JSON.stringify(plain, null, 2));
    writeFileSync(join(ROOT, 'specs', 'onchain', `${name}.json`), JSON.stringify(onchain, null, 2));
  }
}

console.log(`\nGenerated ${wanted.length} "${variant}" specs for stage "${stage}".`);
console.log(
  variant === 'open'
    ? 'Next: validate.mjs → register.sh (verify + sign + broadcast + pay). No encryption needed.'
    : 'Next: encrypt.mjs (wrap plaintext → enterprise blob) → register.sh (sign + broadcast + pay).',
);

// Eligibility per country from the Flux stats API, which carries per-node geolocation plus
// static-IP and datacenter flags (the daemon node list has NO geo fields at all). Still an
// upper bound for the datacenter variant — a precise count would also need the enterprise
// whitelist — but exact enough for the staticip gate the open variant cares about.
async function fetchEligibleNodeCounts() {
  // Network is best-effort: --check is an advisory pre-flight, never a hard gate. Any failure
  // (offline, rate-limited, shape drift) degrades to "no coverage data" instead of aborting.
  try {
    const res = await fetch(`${STATS_API}/fluxinfo?projection=geolocation`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const list = body?.data ?? [];
    const counts = new Map();
    for (const n of list) {
      const g = n?.geolocation;
      if (!g?.countryCode) continue;
      const c = counts.get(g.countryCode) ?? { total: 0, static: 0, staticDatacenter: 0 };
      c.total += 1;
      if (g.static) c.static += 1;
      if (g.static && g.dataCenter) c.staticDatacenter += 1;
      counts.set(g.countryCode, c);
    }
    return counts;
  } catch (err) {
    console.warn(
      `⚠️  --check: could not fetch node list (${err.message}); skipping coverage report.`,
    );
    return null;
  }
}
