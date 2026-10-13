import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Entitlement } from '../hooks/useConnection';
import { codeOf, markRecoveryKeySaved } from '../lib/identity';
import { loadOrCreateKeypair } from '../lib/storage';
import { RecoveryNudge } from './RecoveryNudge';

const premium: Entitlement = { tier: 'premium', paidUntil: '2026-12-01T00:00:00Z', bytesUsed: 0 };
const free: Entitlement = { tier: 'free', paidUntil: '', bytesUsed: 0 };
const NUDGE = /Save your recovery key so you don’t lose Premium/;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('<RecoveryNudge />', () => {
  it('stays quiet until there is Premium to lose', () => {
    const { container } = render(<RecoveryNudge entitlement={free} onShowKey={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('nudges a premium user and opens the key on request', () => {
    const onShowKey = vi.fn();
    render(<RecoveryNudge entitlement={premium} onShowKey={onShowKey} />);
    expect(screen.getByText(NUDGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show recovery key' }));
    expect(onShowKey).toHaveBeenCalled();
  });

  it('stays dismissed for the session', () => {
    const { unmount } = render(<RecoveryNudge entitlement={premium} onShowKey={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(NUDGE)).toBeNull();
    unmount();
    render(<RecoveryNudge entitlement={premium} onShowKey={() => {}} />);
    expect(screen.queryByText(NUDGE)).toBeNull();
  });

  it('retires once this identity’s key has been copied', () => {
    markRecoveryKeySaved(codeOf(loadOrCreateKeypair()));
    render(<RecoveryNudge entitlement={premium} onShowKey={() => {}} />);
    expect(screen.queryByText(NUDGE)).toBeNull();
  });

  it('confirms a restore after the reload that completed it', () => {
    sessionStorage.setItem('cvpn.identity.restored.v1', '1');
    render(<RecoveryNudge entitlement={null} onShowKey={() => {}} />);
    expect(screen.getByText(/^Restored\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/^Restored\./)).toBeNull();
    expect(sessionStorage.getItem('cvpn.identity.restored.v1')).toBeNull();
  });
});
