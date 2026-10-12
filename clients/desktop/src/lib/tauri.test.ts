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
  // Connect is gated on this. Linux/Windows answer `notNeeded` (the tunnel runs
  // in-process), so treating only `enabled` as ready would disable Connect on
  // every non-macOS desktop.
  it('treats notNeeded and enabled as ready, every macOS setup step as not', () => {
    const cases: [HelperRegistration, boolean][] = [
      ['notNeeded', true],
      ['enabled', true],
      ['requiresApproval', false],
      ['notRegistered', false],
      ['notFound', false],
    ];
    for (const [state, ready] of cases) {
      expect(helperReady(state)).toBe(ready);
    }
  });

  it('passes the native answer through (Linux/Windows report notNeeded)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('notNeeded');
    await expect(helperRegistration()).resolves.toBe('notNeeded');
    expect(invoke).toHaveBeenCalledWith('helper_registration');
  });

  it('reads a failing registration query as not set up, not as ready', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('SMAppService unavailable'));
    const state = await helperRegistration();
    expect(state).toBe('notRegistered');
    expect(helperReady(state)).toBe(false);
  });
});
