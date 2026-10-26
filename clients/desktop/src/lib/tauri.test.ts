import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { helperReady, helperRegistration } from './tauri';
import type { HelperRegistration } from './tauri';

// The production (in-Tauri) path, with `invoke` standing in for the native
// `helper_registration` command.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

describe('helper setup state', () => {
  // Connect is gated on this. The three ready states are the helper serving us
  // and the two in-process modes (macOS as root, Linux as root); treating only
  // `enabled` as ready would disable Connect for a root app that runs the
  // tunnel itself.
  it('treats enabled and the in-process states as ready, every setup step as not', () => {
    const cases: [HelperRegistration, boolean][] = [
      ['enabled', true],
      ['notNeeded', true],
      ['elevated', true],
      ['requiresApproval', false],
      ['notRegistered', false],
      ['notFound', false],
      ['serviceNotInstalled', false],
      ['serviceNotRunning', false],
      ['serviceDenied', false],
    ];
    for (const [state, ready] of cases) {
      expect(helperReady(state)).toBe(ready);
    }
  });

  it('passes the native answer through', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('serviceDenied');
    await expect(helperRegistration()).resolves.toBe('serviceDenied');
    expect(invoke).toHaveBeenCalledWith('helper_registration');
  });

  it('reads a failing registration query as not set up, not as ready', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('SMAppService unavailable'));
    const state = await helperRegistration();
    expect(state).toBe('notRegistered');
    expect(helperReady(state)).toBe(false);
  });
});
