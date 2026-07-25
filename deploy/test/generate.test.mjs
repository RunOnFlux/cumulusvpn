import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox, cleanup, copyIn, runNode } from './helpers.mjs';

// The DEPLOYABLE default is the OPEN variant: public image + real env inlined on-chain,
// enterprise:false, no datacenter flag, no encryption step (encrypt.mjs is a stub).
test('generate.mjs (open, default) expands countries.yaml into 12 beta v8 OPEN specs', () => {
  const sb = makeSandbox();
  try {
    copyIn(sb, 'scripts/generate.mjs', 'scripts/generate.mjs');
    copyIn(sb, 'countries.yaml', 'countries.yaml');

    const { status, stderr } = runNode(join(sb, 'scripts', 'generate.mjs'), ['--stage', 'beta']);
    assert.equal(status, 0, `generate should exit 0; stderr: ${stderr}`);

    const onchainDir = join(sb, 'specs', 'onchain');
    const onchain = readdirSync(onchainDir).filter((f) => f.startsWith('cumulus'));
    const standard = onchain.filter((f) => !f.startsWith('cumulusvpntls'));
    const stealth = onchain.filter((f) => f.startsWith('cumulusvpntls'));
    assert.equal(standard.length, 12, 'exactly 12 standard beta on-chain specs');
    assert.equal(stealth.length, 1, 'the DE 443-stealth group (cumulusvpntlsde)');

    for (const f of onchain) {
      const spec = JSON.parse(readFileSync(join(onchainDir, f), 'utf8'));
      assert.equal(spec.version, 8, `${f}: version 8`);
      assert.equal(spec.enterprise, false, `${f}: open spec enterprise:false`);
      assert.ok(!('datacenter' in spec), `${f}: open spec has no datacenter flag`);
      assert.equal(typeof spec.instances, 'number', `${f}: instances number`);
      assert.ok(spec.instances >= 1, `${f}: instances >= 1`);
      assert.equal(spec.staticip, true, `${f}: staticip true`);
      assert.ok(
        Array.isArray(spec.geolocation) && spec.geolocation.length >= 1,
        `${f}: geolocation`,
      );
      assert.ok(Array.isArray(spec.compose) && spec.compose.length >= 1, `${f}: compose`);
      for (const comp of spec.compose) {
        // public on-chain compose must not leak private image auth or v7-only fields
        assert.ok(!('repoauth' in comp), `${f}: on-chain compose must not carry repoauth`);
        assert.ok(!('secrets' in comp), `${f}: v8 compose must not carry secrets`);
        assert.ok(!('tiered' in comp), `${f}: v8 compose must not carry tiered`);
        // open compose carries the real runtime env inline (nothing is encrypted)
        assert.ok(
          Array.isArray(comp.environmentParameters) && comp.environmentParameters.length > 0,
          `${f}: open compose inlines environmentParameters`,
        );
      }
    }

    // Standard specs advertise awg + wg-tls on the FREE protocol sides (no 443,
    // no explicit TLS port → the relay rides 51820/tcp).
    const de = JSON.parse(readFileSync(join(onchainDir, 'cumulusvpnde.json'), 'utf8'));
    const deEnv = de.compose[0].environmentParameters;
    assert.ok(deEnv.includes('CVPN_OBFS_ENABLE=1'), 'standard advertises awg');
    assert.ok(deEnv.includes('CVPN_TLS_ENABLE=1'), 'standard advertises wg-tls');
    assert.ok(
      !deEnv.some((e) => e.startsWith('CVPN_TLS_PORT=')),
      'standard uses the default TLS port (51820/tcp) — no 443',
    );
    assert.deepEqual(de.compose[0].ports, [51820, 51821], 'standard keeps 2 ports (no 443)');

    // The 443 STEALTH group lists 443 and runs the TLS relay there.
    const tlsDe = JSON.parse(readFileSync(join(onchainDir, 'cumulusvpntlsde.json'), 'utf8'));
    assert.deepEqual(tlsDe.compose[0].ports, [51820, 51821, 443], 'stealth group lists 443');
    const tlsEnv = tlsDe.compose[0].environmentParameters;
    assert.ok(
      tlsEnv.includes('CVPN_TLS_ENABLE=1') && tlsEnv.includes('CVPN_TLS_PORT=443'),
      'stealth group runs the TLS relay on 443',
    );
    assert.equal(tlsDe.geolocation[0], 'acEU_DE', 'stealth group stays in its country');

    // The scarce 443 tier is premium-gated; the standard group's free-side
    // wg-tls is NOT (gating it would cost free users stealth for no saving).
    assert.ok(tlsEnv.includes('CVPN_TLS_PREMIUM=1'), '443 stealth tier is premium-gated');
    assert.ok(!deEnv.includes('CVPN_TLS_PREMIUM=1'), 'standard wg-tls stays open to everyone');

    // The gateway's premium WG device is container-internal: publishing 51822
    // would let clients bypass the TLS relay and defeat the gate.
    for (const f of onchain) {
      const spec = JSON.parse(readFileSync(join(onchainDir, f), 'utf8'));
      for (const comp of spec.compose) {
        assert.ok(!comp.ports.includes(51822), `${f}: 51822 must never be published`);
        assert.ok(!comp.containerPorts.includes(51822), `${f}: 51822 must never be published`);
      }
    }
  } finally {
    cleanup(sb);
  }
});

// The DATACENTER variant keeps the enterprise/encrypted path (plain inner spec + enterprise blob).
test('generate.mjs --variant datacenter emits 12 on-chain + 12 plain enterprise specs', () => {
  const sb = makeSandbox();
  try {
    copyIn(sb, 'scripts/generate.mjs', 'scripts/generate.mjs');
    copyIn(sb, 'countries.yaml', 'countries.yaml');

    const { status, stderr } = runNode(join(sb, 'scripts', 'generate.mjs'), [
      '--stage',
      'beta',
      '--variant',
      'datacenter',
    ]);
    assert.equal(status, 0, `generate should exit 0; stderr: ${stderr}`);

    const onchainDir = join(sb, 'specs', 'onchain');
    const plainDir = join(sb, 'specs', 'plain');
    const onchain = readdirSync(onchainDir).filter((f) => f.startsWith('cumulus'));
    const plain = readdirSync(plainDir).filter((f) => f.startsWith('cumulus'));
    // 12 standard + 1 DE 443-stealth group = 13, in both onchain and plain.
    assert.equal(onchain.length, 13, '12 standard + 1 stealth on-chain specs');
    assert.equal(plain.length, 13, '12 standard + 1 stealth plain specs');

    for (const f of onchain) {
      const spec = JSON.parse(readFileSync(join(onchainDir, f), 'utf8'));
      assert.equal(spec.version, 8, `${f}: version 8`);
      assert.equal(spec.datacenter, true, `${f}: datacenter true`);
      assert.equal(typeof spec.enterprise, 'string', `${f}: enterprise is a string`);
      assert.ok(spec.enterprise.length > 0, `${f}: enterprise non-empty`);
      for (const comp of spec.compose) {
        assert.ok(!('repoauth' in comp), `${f}: on-chain compose must not carry repoauth`);
      }
    }

    // plain (secret) inner spec DOES carry repoauth for the private registry
    const us = JSON.parse(readFileSync(join(plainDir, 'cumulusvpnus.json'), 'utf8'));
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
    const us = JSON.parse(readFileSync(join(sb, 'specs', 'onchain', 'cumulusvpnus.json'), 'utf8'));
    assert.equal(us.instances, 6);
  } finally {
    cleanup(sb);
  }
});
