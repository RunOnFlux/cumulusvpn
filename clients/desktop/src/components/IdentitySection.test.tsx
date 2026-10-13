import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeRecoveryKey, generateKeypair, paymentCode } from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';
import { loadOrCreateKeypair } from '../lib/storage';
import { recoveryKeySaved } from '../lib/identity';
import { IdentitySection } from './IdentitySection';

const short = (kp: Keypair): string => {
  const code = paymentCode(kp.publicKey);
  return `${code.slice(0, 4)}…${code.slice(-4)}`;
};

let current: Keypair;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  current = loadOrCreateKeypair();
});

function enterKey(value: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Restore from recovery key' }));
  fireEvent.change(screen.getByLabelText('Recovery key to restore'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('<IdentitySection />', () => {
  it('frames Premium as the key’s, best on one device at a time', () => {
    render(<IdentitySection />);
    expect(
      screen.getByText(/Your Premium belongs to your key, not to this computer\./),
    ).toBeTruthy();
    expect(screen.getByText(/one device at a time/)).toBeTruthy();
  });

  it('reveals this computer’s recovery key and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<IdentitySection />);
    const key = encodeRecoveryKey(current.privateKey);
    expect(screen.queryByText(key)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show recovery key' }));
    expect(screen.getByText(key)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(key);
    expect(recoveryKeySaved(paymentCode(current.publicKey))).toBe(true);
  });

  it('opens with the key showing when asked to (from the nudge)', () => {
    render(<IdentitySection revealKey />);
    expect(screen.getByText(encodeRecoveryKey(current.privateKey))).toBeTruthy();
  });

  it('asks before restoring and names both identities', async () => {
    const other = generateKeypair();
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    render(<IdentitySection onSwitch={onSwitch} />);
    enterKey(encodeRecoveryKey(other.privateKey));

    const text = screen.getByText(/This computer switches to identity/).textContent ?? '';
    expect(text).toContain(short(other));
    expect(text).toContain(short(current));
    expect(text).toContain('the VPN disconnects');
    expect(onSwitch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(other));
  });

  it('shows why a switch failed and leaves the identity alone', async () => {
    const other = generateKeypair();
    const onSwitch = vi.fn().mockRejectedValue(new Error('Couldn’t disconnect the VPN'));
    render(<IdentitySection onSwitch={onSwitch} />);
    enterKey(encodeRecoveryKey(other.privateKey));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Couldn’t disconnect the VPN')).toBeTruthy();
    expect(loadOrCreateKeypair()).toEqual(current);
  });

  it('refuses this computer’s own key and junk', () => {
    const onSwitch = vi.fn();
    render(<IdentitySection onSwitch={onSwitch} />);
    enterKey(encodeRecoveryKey(current.privateKey));
    expect(screen.getByText('That is already this computer’s identity.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Recovery key to restore'), {
      target: { value: 'not a key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('That doesn’t look like a CumulusVPN recovery key.')).toBeTruthy();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
