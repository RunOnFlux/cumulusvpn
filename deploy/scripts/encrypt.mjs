#!/usr/bin/env node
// encrypt.mjs — wrap a plaintext inner spec into the on-chain `enterprise` ciphertext.
//
//   node encrypt.mjs cumulusde
//
// FluxOS v8 enterprise apps carry {contacts, components} encrypted so only whitelisted, KYC'd
// ArcaneOS enterprise nodes can decrypt and run them. Encryption is a hybrid scheme (per-node
// RSA/PGP public keys wrapping an AES content key). The authoritative implementation lives in
// FluxOS (ZelBack/src/services/utils/enterpriseHelper.js + pgpService.js) and the RunOnFlux SDK.
//
// POC: this is a stub that documents the flow. Wire it to the official SDK
// (@runonflux/flux-sdk or the FluxOS enterprise endpoints) before real deployment:
//   1. Fetch the target enterprise nodes' public keys (or the enterprise-owner key set).
//   2. AES-256-GCM encrypt JSON.stringify({contacts, components}) with a random content key.
//   3. Wrap the content key to each target node's public key.
//   4. Base64 the envelope → write into onchain/<name>.json `enterprise`.
//
// Secrets (REGISTRY_TOKEN, payment address, directory pubkey) are injected from the environment
// here so they never live in git — the plaintext file keeps placeholders.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const name = process.argv[2];
if (!name) {
  console.error('usage: encrypt.mjs cumulus<cc>');
  process.exit(1);
}

const plain = JSON.parse(readFileSync(join(ROOT, 'specs', 'plain', `${name}.json`), 'utf8'));

// inject real secrets from env (fail loudly if missing)
const need = ['REGISTRY_AUTH', 'PAYMENT_ADDRESS', 'DIRECTORY_PUBKEY'];
for (const k of need)
  if (!process.env[k]) {
    console.error(`missing env ${k}`);
    process.exit(1);
  }
for (const comp of plain.components) {
  comp.repoauth = process.env.REGISTRY_AUTH;
  comp.environmentParameters = comp.environmentParameters.map((e) =>
    e
      .replace('t1REPLACE_PAYMENT_ADDRESS', process.env.PAYMENT_ADDRESS)
      .replace('REPLACE_ED25519_PUBKEY', process.env.DIRECTORY_PUBKEY),
  );
}

// TODO: replace with real FluxOS enterprise encryption (see header).
const enterpriseBlob = `ENTERPRISE_ENCRYPTED(${
  Buffer.from(
    JSON.stringify({
      contacts: plain.contacts,
      components: plain.components,
    }),
  ).length
} bytes)`;

const onchainPath = join(ROOT, 'specs', 'onchain', `${name}.json`);
const onchain = JSON.parse(readFileSync(onchainPath, 'utf8'));
onchain.enterprise = enterpriseBlob;
writeFileSync(onchainPath, JSON.stringify(onchain, null, 2));
console.log(
  `✓ wrapped ${name} → enterprise blob written to onchain/${name}.json (STUB — wire real encryption)`,
);
