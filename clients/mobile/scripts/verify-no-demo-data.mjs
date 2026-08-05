#!/usr/bin/env node
/**
 * Assert that a normal (non-screenshot) bundle contains NO screenshot-mode demo
 * data — no fabricated latency table, no demo gateway IP, no demo session.
 *
 * This exists because the obvious gate is not sufficient. Guarding call sites
 * with the `__SCREENSHOT_MODE__` build constant makes the branches dead, but the
 * module is still an import edge, so its top-level constants are bundled anyway
 * — they were greppable in a `--dev false` bundle before metro.config.js began
 * swapping the module for src/lib/screenshot.stub.ts at resolve time.
 *
 * Run before shipping any store build:  yarn verify:no-demo-data
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Literal VALUES that exist only in the real src/lib/screenshot.ts. Names like
// `demoLatency` are deliberately NOT listed: the stub exports the same names, so
// they appear in a clean bundle too and would fail this check for no reason.
// If you add demo data to screenshot.ts, add one of its literals here.
const FORBIDDEN = [
  '185.201.148.62', // demo session gateway IP
  '94208', // demo downstream bytes/sec
  '11776', // demo upstream bytes/sec
  '181000', // demo session age (3m 01s)
];

// Strings that MUST appear. `pingGateway` proves we inspected a real bundle
// rather than passing vacuously on an empty file; the stub's throw message
// proves the resolver substitution actually happened, so a future refactor that
// silently stops swapping the module fails here instead of shipping.
const REQUIRED = ['pingGateway', 'screenshot mode is not enabled in this build'];

const dir = mkdtempSync(join(tmpdir(), 'cvpn-bundle-'));
const out = join(dir, 'check.jsbundle');

try {
  console.log('Bundling without CVPN_SCREENSHOT…');
  const env = { ...process.env };
  delete env.CVPN_SCREENSHOT;
  execFileSync(
    'npx',
    [
      'react-native',
      'bundle',
      '--platform',
      'ios',
      '--dev',
      'false',
      '--entry-file',
      'index.js',
      '--bundle-output',
      out,
      '--reset-cache',
    ],
    { stdio: 'inherit', env },
  );

  const bundle = readFileSync(out, 'utf8');

  const missing = REQUIRED.filter((m) => !bundle.includes(m));
  if (missing.length > 0) {
    console.error('\nFAIL: expected markers missing — the bundle looks wrong, not clean:');
    for (const m of missing) {
      console.error(`  - ${m}`);
    }
    process.exit(1);
  }

  const leaked = FORBIDDEN.filter((m) => bundle.includes(m));
  if (leaked.length > 0) {
    console.error('\nFAIL: screenshot demo data present in a normal bundle:');
    for (const m of leaked) {
      console.error(`  - ${m}`);
    }
    console.error('\nThe metro resolveRequest swap in metro.config.js is not working.');
    process.exit(1);
  }

  console.log(`\nOK: no demo data in the bundle (${FORBIDDEN.length} markers checked).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
