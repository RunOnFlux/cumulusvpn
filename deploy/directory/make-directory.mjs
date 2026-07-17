#!/usr/bin/env node
// make-directory.mjs — assemble, sign, and verify the client directory.json (docs/10).
//
//   node directory/make-directory.mjs keygen [--out directory/directory.key]
//       Generate an Ed25519 directory signing key. Writes {priv,pub} as std-base64 raw keys.
//       SECRET — the .key file is gitignored; ship only the pubkey to clients (CVPN_DIRECTORY_PUBKEY).
//
//   node directory/make-directory.mjs build --key directory/directory.key \
//        [--payment-address t1...] [--price 20] [--in directory.json] [--out directory.signed.json]
//       Read specs/onchain/cumulus*.json for the spec list, fold in the payment address / price /
//       seed gateways from the unsigned sample directory.json (or flags), then SIGN. Writes the
//       signed artifact to directory.signed.json (gitignored) with `sig` + `sign_pubkey`.
//
//   node directory/make-directory.mjs sign --key directory/directory.key [--in directory.json] [--out directory.signed.json]
//       Sign an already-assembled unsigned directory.json (no spec re-scan).
//
//   node directory/make-directory.mjs verify [--in directory/directory.signed.json]
//       Recompute the canonical bytes and verify `sig` against the embedded `sign_pubkey`.
//
// Signature: Ed25519 over the canonical (sorted-key, no-whitespace) JSON of every field EXCEPT
// `sig` and `sign_pubkey`. Clients ship the pubkey and verify before trusting any endpoint.
// docs/10 §"directory.json". Uses node:crypto (no external deps).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ONCHAIN = join(ROOT, 'specs', 'onchain');
const SAMPLE_DIR = join(HERE, 'directory.json'); // unsigned sample / template (committed)
const SIGNED_DIR = join(HERE, 'directory.signed.json'); // built + signed artifact (gitignored)
const DEFAULT_KEY = join(HERE, 'directory.key');

// ---- arg parsing ----
const [cmd, ...rest] = process.argv.slice(2);
function flag(name, dflt) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? dflt : rest[i + 1];
}

// ---- canonical JSON (stable key order, no whitespace) ----
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function signingBytes(dir) {
  // Sign over everything except the signature fields and `//`-prefixed JSON comment keys.
  const payload = {};
  for (const [k, v] of Object.entries(dir)) {
    if (k === 'sig' || k === 'sign_pubkey' || k.startsWith('//')) continue;
    payload[k] = v;
  }
  return Buffer.from(canonical(payload), 'utf8');
}

// ---- raw <-> KeyObject (std base64 of the 32-byte raw keys, per docs/10) ----
const b64 = (buf) => Buffer.from(buf).toString('base64');
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64 = (s) => Buffer.from(s, 'base64');

function privFromRaw(rawB64, pubB64) {
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: b64url(fromB64(rawB64)), x: b64url(fromB64(pubB64)) },
    format: 'jwk',
  });
}
function pubFromRaw(rawB64) {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: b64url(fromB64(rawB64)) },
    format: 'jwk',
  });
}
function loadKey(path) {
  const p = resolve(path);
  if (!existsSync(p)) {
    console.error(`no key at ${p} — run: make-directory.mjs keygen`);
    process.exit(1);
  }
  const k = JSON.parse(readFileSync(p, 'utf8'));
  if (!k.priv || !k.pub) {
    console.error(`malformed key file ${p}`);
    process.exit(1);
  }
  return k;
}

// ---- commands ----
function cmdKeygen() {
  const out = resolve(flag('out', DEFAULT_KEY));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  const key = {
    alg: 'Ed25519',
    pub: b64(Buffer.from(pubJwk.x, 'base64url')),
    priv: b64(Buffer.from(privJwk.d, 'base64url')),
  };
  writeFileSync(out, JSON.stringify(key, null, 2) + '\n');
  console.log(`✓ directory signing key → ${out}`);
  console.log(`  pubkey (CVPN_DIRECTORY_PUBKEY): ${key.pub}`);
  console.log(`  keep the .key file SECRET (gitignored); ship only the pubkey to clients.`);
}

function assembleFromSpecs(base) {
  let specs = [];
  try {
    specs = readdirSync(ONCHAIN)
      .filter((f) => f.startsWith('cumulus') && f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    console.warn(`⚠️  no specs/onchain/ — spec list will be empty (run generate.mjs first)`);
  }
  return {
    version: base.version ?? 1,
    updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    payment_address: flag('payment-address', base.payment_address ?? 't1REPLACE_PAYMENT_ADDRESS'),
    price_flux: flag('price') !== undefined ? Number(flag('price')) : (base.price_flux ?? 20),
    specs,
    seed_gateways: base.seed_gateways ?? [],
  };
}

function signInto(dir, keyPath) {
  const key = loadKey(keyPath);
  const priv = privFromRaw(key.priv, key.pub);
  const sig = edSign(null, signingBytes(dir), priv);
  dir.sign_pubkey = key.pub;
  dir.sig = b64(sig);
  return dir;
}

function cmdBuild() {
  const inPath = resolve(flag('in', SAMPLE_DIR));
  const outPath = resolve(flag('out', SIGNED_DIR));
  const base = existsSync(inPath) ? JSON.parse(readFileSync(inPath, 'utf8')) : {};
  const dir = signInto(assembleFromSpecs(base), flag('key', DEFAULT_KEY));
  writeFileSync(outPath, JSON.stringify(dir, null, 2) + '\n');
  console.log(`✓ built + signed directory → ${outPath}`);
  console.log(
    `  version=${dir.version} specs=${dir.specs.length} seeds=${dir.seed_gateways.length}`,
  );
  console.log(`  sign_pubkey=${dir.sign_pubkey}`);
}

function cmdSign() {
  const inPath = resolve(flag('in', SAMPLE_DIR));
  const outPath = resolve(flag('out', SIGNED_DIR));
  const dir = signInto(JSON.parse(readFileSync(inPath, 'utf8')), flag('key', DEFAULT_KEY));
  writeFileSync(outPath, JSON.stringify(dir, null, 2) + '\n');
  console.log(`✓ signed ${inPath} → ${outPath}  (sign_pubkey=${dir.sign_pubkey})`);
}

function cmdVerify() {
  const inPath = resolve(flag('in', SIGNED_DIR));
  const dir = JSON.parse(readFileSync(inPath, 'utf8'));
  if (!dir.sig || !dir.sign_pubkey) {
    console.error(`✗ not signed (missing sig/sign_pubkey)`);
    process.exit(1);
  }
  const ok = edVerify(null, signingBytes(dir), pubFromRaw(dir.sign_pubkey), fromB64(dir.sig));
  if (ok) {
    console.log(
      `✓ signature valid  (sign_pubkey=${dir.sign_pubkey}, specs=${dir.specs?.length ?? 0})`,
    );
    process.exit(0);
  }
  console.error(`✗ signature INVALID for ${inPath}`);
  process.exit(1);
}

switch (cmd) {
  case 'keygen':
    cmdKeygen();
    break;
  case 'build':
    cmdBuild();
    break;
  case 'sign':
    cmdSign();
    break;
  case 'verify':
    cmdVerify();
    break;
  default:
    console.error('usage: make-directory.mjs <keygen|build|sign|verify> [flags]');
    process.exit(1);
}
