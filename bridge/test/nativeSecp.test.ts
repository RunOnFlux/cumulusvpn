import { describe, expect, it } from 'vitest';

import { assertNativeSecp256k1 } from '../src/flux/nativeSecp.js';

describe('native secp256k1 guard', () => {
  it('passes when the compiled bindings load', () => {
    expect(() => assertNativeSecp256k1()).not.toThrow();
  });

  it('refuses to start when the bindings are missing', () => {
    const missing = (): never => {
      throw new Error("Cannot find module 'secp256k1/bindings'");
    };
    expect(() => assertNativeSecp256k1(missing)).toThrow(/refusing to start/);
    expect(() => assertNativeSecp256k1(missing)).toThrow(/Cannot find module/);
  });
});
