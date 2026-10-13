#!/usr/bin/env node
// Build the privileged helper and stage it where the bundlers expect it.
//
// Runs as part of `beforeBuildCommand` on every desktop OS (tauri.macos.conf.json,
// tauri.linux.conf.json, tauri.windows.conf.json), so `tauri build` — locally or
// in .github/workflows/desktop-release.yml — always bundles a helper built from
// the same tree as the app. Node rather than bash because Tauri runs the command
// through cmd.exe on Windows, where `bash` may not be Git Bash.
//
// The bundlers copy a fixed path, but cargo's output directory depends on
// whether --target was passed (CI passes one, a plain `tauri build` does not).
// Rather than teach every config about both, the result is always staged at
// src-tauri/helper/build/cumulusvpn-helper[.exe]:
//   - macOS:   bundle.macOS.files → Contents/MacOS/cumulusvpn-helper
//   - Linux:   bundle.linux.{deb,rpm}.files → /usr/bin/cumulusvpn-helper
//   - Windows: windows/hooks.nsh (NSIS) and windows/helper-service.wxs (MSI)
//
// Tauri exports TAURI_ENV_TARGET_TRIPLE to beforeBuildCommand; a triple given as
// the first argument overrides it.
//
// Windows: the helper links the C runtime statically (+crt-static). The app gets
// the same from tauri-build; the helper is a plain binary, and a service must not
// depend on a VC++ redistributable being installed. Different RUSTFLAGS would
// make cargo rebuild the shared dependencies back and forth with the app, so
// that build uses its own target directory.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcTauri = join(desktop, 'src-tauri');
const triple = process.argv[2] || process.env.TAURI_ENV_TARGET_TRIPLE || '';
const windows = triple ? triple.includes('-windows-') : process.platform === 'win32';
const exe = windows ? 'cumulusvpn-helper.exe' : 'cumulusvpn-helper';

const baseTargetDir = process.env.CARGO_TARGET_DIR
  ? resolve(process.env.CARGO_TARGET_DIR)
  : join(srcTauri, 'target');
const targetDir = windows ? join(baseTargetDir, 'helper-crt-static') : baseTargetDir;

const args = [
  'build',
  '--release',
  '--manifest-path',
  join(srcTauri, 'Cargo.toml'),
  '-p',
  'cumulusvpn-helper',
  '--target-dir',
  targetDir,
];
if (triple) {
  args.push('--target', triple);
}

const env = { ...process.env };
if (windows) {
  env.RUSTFLAGS = [env.RUSTFLAGS, '-C target-feature=+crt-static'].filter(Boolean).join(' ');
}

console.log(`building helper: cargo ${args.join(' ')}`);
const built = spawnSync('cargo', args, { stdio: 'inherit', env });
if (built.error || built.status !== 0) {
  console.error(`cargo build of the helper failed${built.error ? `: ${built.error.message}` : ''}`);
  process.exit(built.status || 1);
}

const output = join(targetDir, ...(triple ? [triple] : []), 'release', exe);
if (!existsSync(output)) {
  console.error(`helper binary not found at ${output}`);
  process.exit(1);
}
const stageDir = join(srcTauri, 'helper', 'build');
mkdirSync(stageDir, { recursive: true });
const staged = join(stageDir, exe);
copyFileSync(output, staged);
if (!windows) {
  // The deb/rpm bundlers carry the file mode over into the package.
  chmodSync(staged, 0o755);
}
console.log(`staged helper: ${staged} (from ${output})`);
