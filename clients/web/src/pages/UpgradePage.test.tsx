import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@cumulusvpn/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Directory, Keypair } from '@cumulusvpn/core';
import { LocaleProvider } from '../hooks/useLocale';
import { PAY_CHECKOUT_STARTED_STORAGE_KEY, PAY_CODE_OVERRIDE_STORAGE_KEY } from '../config';
import { UpgradePage } from './UpgradePage';

const checkoutMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
vi.mock('@cumulusvpn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  createStripeCheckout: checkoutMock,
  paymentStatus: statusMock,
}));

const keypair: Keypair = {
  // 32 bytes of 0x00 -> the known ZERO_CODE payment code.
  publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  privateKey: 'priv+test/key=',
};
const ZERO_CODE = '2RkUfDC55GMndKreXqK7Jruu8Snx';

const directory: Directory = {
  version: 1,
  updated: '2026-01-01T00:00:00Z',
  payment_address: 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ',
  price_flux: 20,
  specs: [],
  seed_gateways: [],
  sig: 'sig',
};

function renderPage(params = new URLSearchParams()) {
  return render(
    <LocaleProvider initialLocale="en">
      <UpgradePage
        keypair={keypair}
        directory={directory}
        params={params}
        onNavigateConnect={() => {}}
      />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  checkoutMock.mockReset();
  statusMock.mockReset();
  localStorage.clear();
});

describe('UpgradePage card checkout', () => {
  it('renders both rails: FLUX first, card second', () => {
    renderPage();
    expect(screen.getByText('20 FLUX')).toBeTruthy();
    expect(screen.getByText('Pay with card')).toBeTruthy();
    expect(screen.getByText('$1.99 / month')).toBeTruthy();
    expect(screen.getByText('$14.99 / year')).toBeTruthy();
  });

  it('creates a checkout session for the browser code and redirects', async () => {
    checkoutMock.mockResolvedValue({ url: 'https://checkout.stripe.com/c/x', session_id: 'cs_1' });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...original, assign },
      writable: true,
    });

    renderPage();
    fireEvent.click(screen.getByText('$14.99 / year'));
    fireEvent.click(screen.getByText('Pay with card'));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/x'));
    expect(checkoutMock).toHaveBeenCalledWith(
      expect.anything(),
      { code: ZERO_CODE, plan: 'annual' },
      expect.anything(),
    );
    Object.defineProperty(window, 'location', { value: original, writable: true });
  });

  it('uses and persists a ?code= override (desktop hand-off)', async () => {
    checkoutMock.mockResolvedValue({ url: 'https://checkout.stripe.com/c/y', session_id: 'cs_2' });
    const override = '2bmMSbm88eN6MA6RuDiFKjNAZEuk';
    renderPage(new URLSearchParams(`code=${override}`));
    // The FLUX memo now carries the override, not the browser code.
    expect(screen.getByText(`CVPN1:${override}`)).toBeTruthy();
    expect(localStorage.getItem(PAY_CODE_OVERRIDE_STORAGE_KEY)).toBe(override);
  });

  it('keeps the override across a CANCELED checkout (Stripe cancel_url round-trip)', () => {
    // Backing out of Stripe must not silently swap the payment target to the
    // browser's own keypair — a retry would pay the wrong key.
    const override = '2bmMSbm88eN6MA6RuDiFKjNAZEuk';
    localStorage.setItem(PAY_CODE_OVERRIDE_STORAGE_KEY, override);
    renderPage(new URLSearchParams('canceled=1'));
    expect(screen.getByText(`CVPN1:${override}`)).toBeTruthy();
    expect(localStorage.getItem(PAY_CODE_OVERRIDE_STORAGE_KEY)).toBe(override);
  });

  it('clears a stale override on a plain visit', () => {
    localStorage.setItem(PAY_CODE_OVERRIDE_STORAGE_KEY, 'stale-code');
    renderPage();
    expect(localStorage.getItem(PAY_CODE_OVERRIDE_STORAGE_KEY)).toBeNull();
    expect(screen.getByText(`CVPN1:${ZERO_CODE}`)).toBeTruthy();
  });

  it('shows the activating panel and polls status after the Stripe return', async () => {
    statusMock.mockResolvedValue({
      code: ZERO_CODE,
      payments: [{ rail: 'stripe', months: 1, status: 'broadcast', txid: 'abc', created_at: 1 }],
    });
    renderPage(new URLSearchParams('session=cs_123'));
    expect(screen.getByText('Activating your premium…')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByText('Activation sent to the Flux network — waiting for confirmation.'),
      ).toBeTruthy(),
    );
    expect(statusMock).toHaveBeenCalledWith(expect.anything(), ZERO_CODE, expect.anything());
  });

  it('ignores payments older than the checkout-start stamp (renewal false-confirm guard)', async () => {
    // Previous month's confirmed payment sits at the head of the feed; the
    // fresh checkout's row hasn't landed yet. The panel must keep waiting,
    // not flash an instant "Confirmed!".
    localStorage.setItem(PAY_CHECKOUT_STARTED_STORAGE_KEY, String(Math.floor(Date.now() / 1000)));
    statusMock.mockResolvedValue({
      code: ZERO_CODE,
      payments: [
        { rail: 'stripe', months: 1, status: 'confirmed', txid: 'old', created_at: 1_000_000 },
      ],
    });
    renderPage(new URLSearchParams('session=cs_777'));
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    // Still on the waiting copy — the stale confirmed row was filtered out.
    expect(
      screen.getByText('Payment received — preparing your activation on the Flux network.'),
    ).toBeTruthy();
    expect(
      screen.queryByText('Confirmed! Full speed unlocks on all servers within a minute.'),
    ).toBeNull();
  });

  it('keeps the persisted override across the Stripe round-trip', () => {
    statusMock.mockResolvedValue({ code: 'x', payments: [] });
    const override = '2bmMSbm88eN6MA6RuDiFKjNAZEuk';
    localStorage.setItem(PAY_CODE_OVERRIDE_STORAGE_KEY, override);
    renderPage(new URLSearchParams('session=cs_999'));
    // Poll targets the override code, not the browser keypair's.
    expect(statusMock).toHaveBeenCalledWith(expect.anything(), override, expect.anything());
  });
});
