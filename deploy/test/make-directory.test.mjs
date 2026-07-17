import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox, cleanup, copyIn, runNode } from './helpers.mjs';

function setup(sb) {
  copyIn(sb, 'scripts/generate.mjs', 'scripts/generate.mjs');
  copyIn(sb, 'directory/make-directory.mjs', 'directory/make-directory.mjs');
  copyIn(sb, 'directory/directory.json', 'directory/directory.json');
  copyIn(sb, 'countries.yaml', 'countries.yaml');
  const md = join(sb, 'directory', 'make-directory.mjs');
  // fresh signing key (offline, node:crypto)
  const keygen = runNode(md, ['keygen', '--out', join(sb, 'directory', 'directory.key')]);
  assert.equal(keygen.status, 0, `keygen: ${keygen.stderr}`);
  // populate specs so the directory has a spec list
  runNode(join(sb, 'scripts', 'generate.mjs'), ['--stage', 'beta']);
  return md;
}

test('make-directory build → verify roundtrip passes', () => {
  const sb = makeSandbox();
  try {
    const md = setup(sb);
    const signed = join(sb, 'directory', 'directory.signed.json');

    const build = runNode(md, [
      'build',
      '--key',
      join(sb, 'directory', 'directory.key'),
      '--out',
      signed,
    ]);
    assert.equal(build.status, 0, `build: ${build.stderr}`);

    const dir = JSON.parse(readFileSync(signed, 'utf8'));
    assert.ok(dir.sig, 'signed artifact has sig');
    assert.ok(dir.sign_pubkey, 'signed artifact has sign_pubkey');
    assert.equal(dir.specs.length, 12, 'directory lists all 12 beta specs');

    const verify = runNode(md, ['verify', '--in', signed]);
    assert.equal(verify.status, 0, `verify should pass; stderr: ${verify.stderr}`);
    assert.match(verify.stdout, /signature valid/);
  } finally {
    cleanup(sb);
  }
});

test('make-directory verify FAILS after the signed payload is tampered', () => {
  const sb = makeSandbox();
  try {
    const md = setup(sb);
    const signed = join(sb, 'directory', 'directory.signed.json');
    runNode(md, ['build', '--key', join(sb, 'directory', 'directory.key'), '--out', signed]);

    // Tamper with a signed field (price) while leaving sig/sign_pubkey intact.
    const dir = JSON.parse(readFileSync(signed, 'utf8'));
    dir.price_flux = dir.price_flux + 100;
    writeFileSync(signed, JSON.stringify(dir, null, 2) + '\n');

    const verify = runNode(md, ['verify', '--in', signed]);
    assert.equal(verify.status, 1, 'tampered payload must fail verification');
    assert.match(verify.stderr, /INVALID/);
  } finally {
    cleanup(sb);
  }
});
