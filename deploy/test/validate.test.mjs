import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox, cleanup, copyIn, runNode } from './helpers.mjs';

function seed(sb) {
  copyIn(sb, 'scripts/generate.mjs', 'scripts/generate.mjs');
  copyIn(sb, 'scripts/validate.mjs', 'scripts/validate.mjs');
  copyIn(sb, 'countries.yaml', 'countries.yaml');
  runNode(join(sb, 'scripts', 'generate.mjs'), ['--stage', 'beta']);
}

test('validate.mjs accepts freshly generated good specs', () => {
  const sb = makeSandbox();
  try {
    seed(sb);
    const { status, stderr } = runNode(join(sb, 'scripts', 'validate.mjs'));
    assert.equal(status, 0, `all generated specs should validate; stderr: ${stderr}`);
  } finally {
    cleanup(sb);
  }
});

test('validate.mjs rejects a malformed spec (wrong version, bad types, leaked repoauth)', () => {
  const sb = makeSandbox();
  try {
    copyIn(sb, 'scripts/validate.mjs', 'scripts/validate.mjs');
    const onchain = join(sb, 'specs', 'onchain');
    mkdirSync(onchain, { recursive: true });
    const bad = {
      version: 7,
      name: 'cumulusbad',
      description: 'bad',
      owner: 'ZELID',
      instances: 0,
      staticip: 'yes',
      expire: 0,
      contacts: [],
      geolocation: [],
      nodes: [],
      compose: [
        {
          name: 'gateway',
          repotag: 'x',
          containerData: '/data',
          ports: [1],
          containerPorts: [1, 2],
          domains: [],
          environmentParameters: [],
          commands: [],
          cpu: 0,
          ram: 1,
          hdd: 1,
          repoauth: 'leak',
        },
      ],
    };
    writeFileSync(join(onchain, 'cumulusbad.json'), JSON.stringify(bad, null, 2));
    const { status, stdout } = runNode(join(sb, 'scripts', 'validate.mjs'));
    assert.equal(status, 1, 'malformed spec must fail validation');
    assert.match(stdout, /cumulusbad/);
    assert.match(stdout, /version must be 8/);
    assert.match(stdout, /repoauth must not appear/);
  } finally {
    cleanup(sb);
  }
});

test('validate.mjs rejects invalid JSON', () => {
  const sb = makeSandbox();
  try {
    copyIn(sb, 'scripts/validate.mjs', 'scripts/validate.mjs');
    rmSync(join(sb, 'specs', 'onchain'), { recursive: true, force: true });
    mkdirSync(join(sb, 'specs', 'onchain'), { recursive: true });
    writeFileSync(join(sb, 'specs', 'onchain', 'cumulusbroken.json'), '{ not json');
    const { status, stdout } = runNode(join(sb, 'scripts', 'validate.mjs'));
    assert.equal(status, 1);
    assert.match(stdout, /invalid JSON/);
  } finally {
    cleanup(sb);
  }
});
