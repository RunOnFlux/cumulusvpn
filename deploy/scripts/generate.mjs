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
const NODE_API = process.env.FLUX_API || 'https://api.runonflux.io';

const args = process.argv.slice(2);
const stage = args[stageIdx() + 1] ?? 'beta';
const doCheck = args.includes('--check');
function stageIdx() {
  const i = args.indexOf('--stage');
  return i === -1 ? -1 : i;
}

const manifest = parseYaml(readFileSync(join(ROOT, 'countries.yaml'), 'utf8'));
const { owner, defaults, countries } = manifest;
const wanted = countries.filter((c) => STAGES[c.stage ?? 'beta'] <= STAGES[stage]);

mkdirSync(join(ROOT, 'specs', 'plain'), { recursive: true });
mkdirSync(join(ROOT, 'specs', 'onchain'), { recursive: true });

let eligibleByCountry = null;
if (doCheck) eligibleByCountry = await fetchEligibleNodeCounts();

for (const c of wanted) {
  const name = `cumulus${c.cc}`;
  const instances = c.instances ?? defaults.instances;
  const repotag = c.repotag ?? defaults.repotag;

  // ---- plaintext inner spec (encrypted before broadcast) ----
  const plain = {
    contacts: ['info@cumulusvpn.com'],
    components: [
      {
        name: 'gateway',
        description: `CumulusVPN gateway (${c.cc.toUpperCase()})`,
        repotag,
        repoauth: '', // PUBLIC GHCR image — no auth needed (set only if you switch to a private registry)
        ports: defaults.ports,
        containerPorts: defaults.ports,
        domains: defaults.ports.map(() => ''),
        environmentParameters: [
          'CVPN_PRICE_FLUX=4.5',
          'CVPN_PAYMENT_ADDRESS=t1REPLACE_PAYMENT_ADDRESS',
          'CVPN_DIRECTORY_PUBKEY=REPLACE_ED25519_PUBKEY',
          'CVPN_FREE_RATE_KBPS=100',
          'CVPN_PREMIUM_RATE_MBPS=50',
          `CVPN_MAX_PEERS_FREE=${defaults.maxPeersFree ?? 400}`,
          `CVPN_MAX_PEERS_TOTAL=${defaults.maxPeersTotal ?? 1000}`,
        ],
        commands: [],
        containerData: '/data',
        cpu: c.cpu ?? defaults.cpu,
        ram: c.ram ?? defaults.ram,
        hdd: c.hdd ?? defaults.hdd,
        secrets: '',
      },
    ],
  };

  // ---- on-chain enterprise wrapper ----
  const onchain = {
    version: 8,
    name,
    description: 'CumulusVPN — decentralized VPN gateway',
    owner,
    instances,
    contacts: [],
    geolocation: [c.geolocation],
    expire: c.expire ?? defaults.expire ?? 264000,
    nodes: c.nodes ?? [],
    staticip: c.staticip ?? defaults.staticip ?? true,
    datacenter: c.datacenter ?? defaults.datacenter ?? true,
    enterprise: 'REPLACE_WITH_ENCRYPTED_BLOB', // encrypt.mjs overwrites this
    compose: [
      {
        name: 'gateway',
        description: 'gateway',
        repotag,
        ports: defaults.ports,
        containerPorts: defaults.ports,
        domains: defaults.ports.map(() => ''),
        environmentParameters: [],
        commands: [],
        containerData: '/data',
        cpu: c.cpu ?? defaults.cpu,
        ram: c.ram ?? defaults.ram,
        hdd: c.hdd ?? defaults.hdd,
      },
    ],
  };

  writeFileSync(join(ROOT, 'specs', 'plain', `${name}.json`), JSON.stringify(plain, null, 2));
  writeFileSync(join(ROOT, 'specs', 'onchain', `${name}.json`), JSON.stringify(onchain, null, 2));

  let note = '';
  if (eligibleByCountry) {
    const avail = eligibleByCountry.get(c.cc.toUpperCase()) ?? 0;
    if (avail < instances)
      note = `  ⚠️  only ${avail} eligible datacenter nodes < ${instances} instances — will under-fill`;
    else note = `  (${avail} eligible nodes)`;
  }
  console.log(`✓ ${name}  ${c.geolocation}  instances=${instances}${note}`);
}

console.log(`\nGenerated ${wanted.length} specs for stage "${stage}".`);
console.log(
  'Next: encrypt.mjs (wrap plaintext → enterprise blob) → register.sh (sign + broadcast + pay).',
);

// Rough eligibility: count deterministic nodes whose geo country matches. NOTE: this counts the
// whole fleet, not just enterprise/datacenter/staticip nodes — treat as an UPPER bound. A precise
// count needs the enterprise-node whitelist + staticip + tier data. POC: refine before GA.
async function fetchEligibleNodeCounts() {
  // Network is best-effort: --check is an advisory pre-flight, never a hard gate. Any failure
  // (offline, rate-limited, shape drift) degrades to "no coverage data" instead of aborting.
  try {
    const res = await fetch(`${NODE_API}/daemon/viewdeterministicfluxnodelist`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const list = body?.data ?? [];
    const counts = new Map();
    for (const n of list) {
      // geolocation strings look like "EU_DE_HES"; take the country segment.
      const cc = (n.geolocation || n.geo || '').split('_')[1];
      if (cc) counts.set(cc, (counts.get(cc) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    console.warn(
      `⚠️  --check: could not fetch node list (${err.message}); skipping coverage report.`,
    );
    return null;
  }
}
