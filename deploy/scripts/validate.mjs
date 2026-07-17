#!/usr/bin/env node
// validate.mjs — check generated on-chain specs against the Flux v8 enterprise shape.
//
//   node scripts/validate.mjs                 # validate every specs/onchain/cumulus*.json
//   node scripts/validate.mjs cumulusde       # validate one
//
// This is a shape check, not a FluxOS registration check (register.sh does the authoritative
// POST /apps/verifyappregistrationspecifications). It catches generator regressions before we
// ever hit the network: version 8, datacenter:true, an `enterprise` field, and the compose shape.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ONCHAIN = join(ROOT, 'specs', 'onchain');

const TOP_STRING = ['name', 'description', 'owner'];
const TOP_ARRAY = ['contacts', 'geolocation', 'nodes', 'compose'];
const COMPOSE_STRING = ['name', 'repotag', 'containerData'];
const COMPOSE_ARRAY = ['ports', 'containerPorts', 'domains', 'environmentParameters', 'commands'];
const COMPOSE_NUMBER = ['cpu', 'ram', 'hdd'];

function validateSpec(name, spec) {
  const errs = [];
  const fail = (m) => errs.push(m);

  // Variant is inferred from the `enterprise` field: `false` => OPEN (public inline compose),
  // a non-empty string => DATACENTER (encrypted enterprise blob + datacenter:true).
  const isOpen = spec.enterprise === false;

  if (spec.version !== 8) fail(`version must be 8 (got ${JSON.stringify(spec.version)})`);
  if (isOpen) {
    if ('datacenter' in spec && spec.datacenter !== false)
      fail(`open spec must not set datacenter:true`);
  } else if (spec.datacenter !== true) {
    fail(`datacenter must be true (enterprise/datacenter placement)`);
  }
  if (typeof spec.instances !== 'number' || spec.instances < 1)
    fail(`instances must be a positive number`);
  if (typeof spec.staticip !== 'boolean') fail(`staticip must be a boolean`);
  if (typeof spec.expire !== 'number' || spec.expire < 1) fail(`expire must be a positive number`);

  for (const k of TOP_STRING)
    if (typeof spec[k] !== 'string' || !spec[k]) fail(`${k} must be a non-empty string`);
  for (const k of TOP_ARRAY) if (!Array.isArray(spec[k])) fail(`${k} must be an array`);
  if (Array.isArray(spec.geolocation) && spec.geolocation.length < 1)
    fail(`geolocation must list at least one region`);

  // enterprise: OPEN => literal false; DATACENTER => non-empty string (placeholder or ciphertext).
  if (isOpen) {
    if (spec.enterprise !== false) fail(`open spec: enterprise must be false`);
  } else if (typeof spec.enterprise !== 'string' || !spec.enterprise) {
    fail(`enterprise field missing — must be a placeholder or encrypted blob`);
  }

  if (Array.isArray(spec.compose)) {
    if (spec.compose.length < 1) fail(`compose must have at least one component`);
    spec.compose.forEach((comp, i) => {
      const at = `compose[${i}]`;
      for (const k of COMPOSE_STRING)
        if (typeof comp[k] !== 'string' || !comp[k]) fail(`${at}.${k} must be a non-empty string`);
      for (const k of COMPOSE_ARRAY)
        if (!Array.isArray(comp[k])) fail(`${at}.${k} must be an array`);
      for (const k of COMPOSE_NUMBER)
        if (typeof comp[k] !== 'number' || comp[k] <= 0)
          fail(`${at}.${k} must be a positive number`);
      if (
        Array.isArray(comp.ports) &&
        Array.isArray(comp.containerPorts) &&
        comp.ports.length !== comp.containerPorts.length
      ) {
        fail(`${at}: ports/containerPorts length mismatch`);
      }
      if (
        Array.isArray(comp.ports) &&
        Array.isArray(comp.domains) &&
        comp.ports.length !== comp.domains.length
      ) {
        fail(`${at}: domains length must match ports`);
      }
      // On-chain compose must NOT leak private image auth — that belongs in the encrypted inner spec.
      if ('repoauth' in comp) fail(`${at}: repoauth must not appear in the public on-chain spec`);
      // v7-only fields FluxOS v8 rejects ("Unsupported parameter for v8", appValidator.js).
      for (const k of ['secrets', 'tiered'])
        if (k in comp) fail(`${at}.${k} is not allowed in a v8 spec`);
      // OPEN spec's public compose must actually carry the runtime env (nothing is encrypted).
      if (
        isOpen &&
        Array.isArray(comp.environmentParameters) &&
        comp.environmentParameters.length === 0
      )
        fail(`${at}: open spec must inline environmentParameters (none found)`);
    });
  }

  return errs;
}

const only = process.argv[2];
let files;
try {
  files = readdirSync(ONCHAIN).filter((f) => f.startsWith('cumulus') && f.endsWith('.json'));
} catch {
  console.error(`no specs/onchain/ dir — run: node scripts/generate.mjs --stage beta`);
  process.exit(1);
}
if (only) files = files.filter((f) => f === `${only}.json`);
if (files.length === 0) {
  console.error(`no matching specs to validate`);
  process.exit(1);
}

let bad = 0;
for (const f of files.sort()) {
  const name = f.replace(/\.json$/, '');
  let spec;
  try {
    spec = JSON.parse(readFileSync(join(ONCHAIN, f), 'utf8'));
  } catch (e) {
    console.log(`✗ ${name}  invalid JSON: ${e.message}`);
    bad++;
    continue;
  }
  const errs = validateSpec(name, spec);
  if (errs.length) {
    bad++;
    console.log(`✗ ${name}`);
    for (const e of errs) console.log(`    - ${e}`);
  } else {
    console.log(
      `✓ ${name}  v${spec.version} datacenter=${spec.datacenter} instances=${spec.instances} compose=${spec.compose.length}`,
    );
  }
}

console.log(`\n${files.length - bad}/${files.length} specs valid.`);
process.exit(bad ? 1 : 0);
