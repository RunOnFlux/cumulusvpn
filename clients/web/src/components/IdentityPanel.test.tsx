import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeRecoveryKey, generateKeypair, paymentCode } from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';
import { LocaleProvider } from '../hooks/useLocale';
import { RECOVERY_KEY_SAVED_STORAGE_KEY } from '../config';
import { IdentityPanel } from './IdentityPanel';

const current = generateKeypair();
const other = generateKeypair();
const short = (kp: Keypair): string => {
  const code = paymentCode(kp.publicKey);
  return `${code.slice(0, 4)}…${code.slice(-4)}`;
};

function renderPanel(
  props: Partial<{
    restored: boolean;
    onRegenerate: () => void;
    onRestore: (kp: Keypair) => void;
  }> = {},
) {
  return render(
    <LocaleProvider initialLocale="en">
      <IdentityPanel
        keypair={current}
        restored={props.restored ?? false}
        onRegenerate={props.onRegenerate ?? (() => {})}
        onRestore={props.onRestore ?? (() => {})}
      />
    </LocaleProvider>,
  );
}

function openRestore(input: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Restore from recovery key' }));
  fireEvent.change(screen.getByLabelText('Recovery key'), { target: { value: input } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('<IdentityPanel />', () => {
  it('says Premium belongs to the key, and is best used on one device at a time', () => {
    renderPanel();
    expect(screen.getByText(/Your Premium belongs to your key, not to one device\./)).toBeTruthy();
    expect(screen.getByText(/one device at a time/)).toBeTruthy();
    // Never the old per-device framing.
    expect(screen.queryByText(/per device/)).toBeNull();
  });

  it('reveals and hides this identity’s recovery key', () => {
    renderPanel();
    const key = encodeRecoveryKey(current.privateKey);
    expect(screen.queryByText(key)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show recovery key' }));
    expect(screen.getByText(key)).toBeTruthy();
    expect(screen.getByText(/Anyone with this key gets this identity/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide recovery key' }));
    expect(screen.queryByText(key)).toBeNull();
  });

  // Copying is the one signal we get that the key was saved; it quiets the nudge.
  it('remembers that the key was copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show recovery key' }));
    const copyButtons = screen.getAllByRole('button', { name: 'Copy' });
    fireEvent.click(copyButtons[copyButtons.length - 1]!);

    await waitFor(() =>
      expect(localStorage.getItem(RECOVERY_KEY_SAVED_STORAGE_KEY)).toBe(
        paymentCode(current.publicKey),
      ),
    );
    expect(writeText).toHaveBeenCalledWith(encodeRecoveryKey(current.privateKey));
  });

  it('asks before restoring, names both identities, and restores only on confirm', () => {
    const onRestore = vi.fn();
    renderPanel({ onRestore });
    openRestore(encodeRecoveryKey(other.privateKey));

    const confirm = screen.getByText(/Replace this browser’s identity with/);
    expect(confirm.textContent).toContain(short(other));
    expect(confirm.textContent).toContain(short(current));
    expect(confirm.textContent).toContain('stays with that key');
    expect(onRestore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Replace identity' }));
    expect(onRestore).toHaveBeenCalledWith(other);
  });

  it('does nothing when the restore is cancelled at the confirmation', () => {
    const onRestore = vi.fn();
    renderPanel({ onRestore });
    openRestore(encodeRecoveryKey(other.privateKey));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.queryByText(/Replace this browser’s identity/)).toBeNull();
  });

  it('explains why a key cannot be restored', () => {
    const onRestore = vi.fn();
    renderPanel({ onRestore });

    openRestore('hello');
    expect(screen.getByText('That doesn’t look like a CumulusVPN recovery key.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Recovery key'), {
      target: { value: encodeRecoveryKey(current.privateKey) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('That is already this browser’s identity.')).toBeTruthy();
    expect(onRestore).not.toHaveBeenCalled();
  });

  // A new key orphans the Premium on the old one unless its recovery key was
  // saved — so it asks first, like a restore does.
  it('asks before making a new key', () => {
    const onRegenerate = vi.fn();
    renderPanel({ onRegenerate });

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate key' }));
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/Make a new key\?/).textContent).toContain(short(current));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRegenerate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a new key' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('confirms a restore once it has landed', () => {
    renderPanel({ restored: true });
    expect(screen.getByText(/^Restored\./)).toBeTruthy();
  });

  it('renders in another locale with the same structure', async () => {
    render(
      <LocaleProvider initialLocale="de">
        <IdentityPanel
          keypair={current}
          restored={false}
          onRegenerate={() => {}}
          onRestore={() => {}}
        />
      </LocaleProvider>,
    );
    expect(
      await screen.findByRole('button', { name: 'Wiederherstellungsschlüssel anzeigen' }),
    ).toBeTruthy();
  });
});
