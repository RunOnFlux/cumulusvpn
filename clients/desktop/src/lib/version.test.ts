import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  it('compares numerically, field by field', () => {
    expect(isNewerVersion('1.4.9', '1.4.8')).toBe(true);
    expect(isNewerVersion('1.4.10', '1.4.9')).toBe(true);
    expect(isNewerVersion('1.5.0', '1.4.99')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('is false for the same or an older version', () => {
    expect(isNewerVersion('1.4.8', '1.4.8')).toBe(false);
    expect(isNewerVersion('1.4.7', '1.4.8')).toBe(false);
  });

  it('never treats a malformed version as newer', () => {
    expect(isNewerVersion('', '1.4.8')).toBe(false);
    expect(isNewerVersion('1.4', '1.4.8')).toBe(false);
    expect(isNewerVersion('1.4.9-beta', '1.4.8')).toBe(false);
  });
});
