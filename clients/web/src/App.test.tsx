import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@cumulusvpn/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { encodeRecoveryKey, generateKeypair } from '@cumulusvpn/core';
import type { DiscoveryState } from './hooks/useDiscovery';
import { LocaleProvider } from './hooks/useLocale';
import { ISSUED_CONFIG_STORAGE_KEY, KEYPAIR_STORAGE_KEY } from './config';
import { App } from './App';

// Offline: no directory fetch, no gateway status.
vi.mock('./hooks/useDiscovery', () => ({
  useDiscovery: (): DiscoveryState => ({
    loading: false,
    directory: null,
    source: null,
    verified: true,
    options: [],
    gateways: [],
    notice: null,
  }),
}));
const statusMock = vi.hoisted(() => vi.fn());
const checkMock = vi.hoisted(() => vi.fn());
vi.mock('@cumulusvpn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  status: statusMock,
  checkIssuedConfig: checkMock,
}));

beforeEach(() => {
  statusMock.mockReset();
  statusMock.mockRejectedValue(new Error('offline'));
  checkMock.mockReset();
  checkMock.mockResolvedValue('unknown');
  localStorage.clear();
  window.location.hash = '';
});

describe('<App /> identity restore', () => {
  it('switches this browser to the restored identity and keeps it across reloads', () => {
    const before = generateKeypair();
    const restored = generateKeypair();
    localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify(before));
    // A config issued to the OLD key: its staleness check must not survive the switch.
    localStorage.setItem(
      ISSUED_CONFIG_STORAGE_KEY,
      JSON.stringify({ ip: '203.0.113.7', serverPubKey: 's', cc: 'de', issuedAt: 'x' }),
    );

    render(
      <LocaleProvider initialLocale="en">
        <App />
      </LocaleProvider>,
    );
    expect(screen.getByText(before.publicKey)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore from recovery key' }));
    fireEvent.change(screen.getByLabelText('Recovery key'), {
      target: { value: encodeRecoveryKey(restored.privateKey) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace identity' }));

    expect(screen.getByText(restored.publicKey)).toBeTruthy();
    expect(screen.queryByText(before.publicKey)).toBeNull();
    expect(screen.getByText(/^Restored\./)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(KEYPAIR_STORAGE_KEY)!)).toEqual(restored);
    expect(localStorage.getItem(ISSUED_CONFIG_STORAGE_KEY)).toBeNull();
  });
});
