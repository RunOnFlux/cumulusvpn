import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox, cleanup, copyIn, runNode } from './helpers.mjs';

test('generate.mjs expands countries.yaml into 12 beta v8 enterprise specs', () => {
  const sb = makeSandbox();
  try {
    copyIn(sb, 'scripts/generate.mjs', 'scripts/generate.mjs');
    copyIn(sb, 'countries.yaml', 'countries.yaml');

    const { status, stderr } = runNode(join(sb, 'scripts', 'generate.mjs'), ['--stage', 'beta']);
    assert.equal(status, 0, `generate should exit 0; stderr: ${stderr}`);

    const onchainDir = join(sb, 'specs', 'onchain');
    const plainDir = join(sb, 'specs', 'plain');
    const onchain = readdirSync(onchainDir).filter((f) => f.startsWith('cumulus'));
    const plain = readdirSync(plainDir).filter((f) => f.startsWith('cumulus'));

    assert.equal(onchain.length, 12, 'exactly 12 beta on-chain specs');
    assert.equal(plain.length, 12, 'exactly 12 beta plain specs');

    for (const f of onchain) {
      const spec = JSON.parse(readFileSync(join(onchainDir, f), 'utf8'));
      // v8 enterprise shape
      assert.equal(spec.version, 8, `${f}: version 8`);
      assert.equal(spec.datacenter, true, `${f}: datacenter true`);
      assert.equal(typeof spec.enterprise, 'string', `${f}: enterprise is a string`);
      assert.ok(spec.enterprise.length > 0, `${f}: enterprise non-empty`);
      assert.equal(typeof spec.instances, 'number', `${f}: instances number`);
      assert.ok(spec.instances >= 1, `${f}: instances >= 1`);
      assert.equal(typeof spec.staticip, 'boolean', `${f}: staticip boolean`);
      assert.ok(
        Array.isArray(spec.geolocation) && spec.geolocation.length >= 1,
        `${f}: geolocation`,
      );
      assert.ok(Array.isArray(spec.compose) && spec.compose.length >= 1, `${f}: compose`);
      // public on-chain compose must not leak private image auth
      for (const comp of spec.compose) {
        assert.ok(!('repoauth' in comp), `${f}: on-chain compose must not carry repoauth`);
      }
    }

    // plain (secret) inner spec DOES carry repoauth for the private registry
    const us = JSON.parse(readFileSync(join(plainDir, 'cumulusus.json'), 'utf8'));
    assert.ok(Array.isArray(us.components) && us.components.length >= 1);
    assert.equal(typeof us.components[0].repoauth, 'string');
  } finally {
    cleanup(sb);
  }
});

test('generate.mjs honors per-country instance counts (us=6)', () => {
  const sb = makeSandbox();
  try {
    copyIn(sb, 'scripts/generate.mjs', 'scripts/generate.mjs');
    copyIn(sb, 'countries.yaml', 'countries.yaml');
    runNode(join(sb, 'scripts', 'generate.mjs'), ['--stage', 'beta']);
    const us = JSON.parse(readFileSync(join(sb, 'specs', 'onchain', 'cumulusus.json'), 'utf8'));
    assert.equal(us.instances, 6);
  } finally {
    cleanup(sb);
  }
});
