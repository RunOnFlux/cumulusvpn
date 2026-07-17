// Shared test helpers. Each test builds an isolated sandbox INSIDE the deploy
// package (so the scripts' `import 'yaml'` and node:crypto resolve via the real
// node_modules by upward lookup) and runs the real CLI scripts against it.
// Everything is offline — no network, no --check.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG = join(HERE, '..'); // deploy/
const SANDBOX_ROOT = join(PKG, '.test-sandbox');

mkdirSync(SANDBOX_ROOT, { recursive: true });

/** Create a fresh sandbox dir under deploy/.test-sandbox and return its path. */
export function makeSandbox() {
  const dir = mkdtempSync(join(SANDBOX_ROOT, 'run-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'directory'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'onchain'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'plain'), { recursive: true });
  return dir;
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Copy a repo file (relative to deploy/) into the sandbox at destRel. */
export function copyIn(sandbox, srcRel, destRel) {
  copyFileSync(join(PKG, srcRel), join(sandbox, destRel));
}

/** Run `node <scriptAbs> ...args` and return { status, stdout, stderr }. */
export function runNode(scriptAbs, args = [], cwd = PKG) {
  const res = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}
