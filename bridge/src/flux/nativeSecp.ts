/**
 * Refuse to sign treasury transactions without native libsecp256k1.
 *
 * utxo-lib signs through the `secp256k1` package, and that package silently
 * falls back to a pure-JS implementation built on `elliptic` when its native
 * addon failed to compile — its install script is `node-gyp rebuild || echo`,
 * so a broken toolchain never fails the build. elliptic has an unfixed bug
 * (CVE-2025-14505) whose faulty signatures can leak the private key, and the
 * key here is the treasury's. So boot fails instead of degrading.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function assertNativeSecp256k1(
  load: () => unknown = () => require('secp256k1/bindings'),
): void {
  try {
    load();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      'native secp256k1 bindings are not available, so signing would fall back to ' +
        'the vulnerable pure-JS elliptic implementation; refusing to start. Rebuild ' +
        `with python3, make and g++ present (node-gyp). Cause: ${reason}`,
    );
  }
}
