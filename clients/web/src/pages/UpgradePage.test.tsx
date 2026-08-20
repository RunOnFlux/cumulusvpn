import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@cumulusvpn/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Directory, Keypair } from '@cumulusvpn/core';
import { LocaleProvider } from '../hooks/useLocale';
import {
  PAY_CHECKOUT_STARTED_STORAGE_KEY,
  PAY_CODE_OVERRIDE_STORAGE_KEY,
  PAY_PORTAL_SESSIONS_STORAGE_KEY,
} from '../config';
import { UpgradePage } from './UpgradePage';

const checkoutMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
const redeemMock = vi.hoisted(() => vi.fn());
const portalMock = vi.hoisted(() => vi.fn());
vi.mock('@cumulusvpn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  createStripeCheckout: checkoutMock,
  paymentStatus: statusMock,
  redeemVoucher: redeemMock,
  openBillingPortal: portalMock,
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
  redeemMock.mockReset();
  portalMock.mockReset();
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

describe('UpgradePage voucher redemption', () => {
  it('redeems a grant code and switches to the activation panel', async () => {
    redeemMock.mockResolvedValue({ type: 'grant_days', days: 7, state: 'pending' });
    statusMock.mockResolvedValue({
      code: ZERO_CODE,
      payments: [
        {
          rail: 'voucher',
          months: 0,
          status: 'broadcast',
          txid: 'vtx',
          created_at: Math.floor(Date.now() / 1000),
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('CVPN-XXXXX-XXXXX'), {
      target: { value: 'CVPN-AAAAA-BBBBB' },
    });
    fireEvent.click(screen.getByText('Redeem'));
    await waitFor(() => expect(screen.getByText('Activating your premium…')).toBeTruthy());
    expect(redeemMock).toHaveBeenCalledWith(
      expect.anything(),
      { code: ZERO_CODE, voucher: 'CVPN-AAAAA-BBBBB' },
      expect.anything(),
    );
  });

  it('keeps a discount code and carries it into checkout', async () => {
    redeemMock.mockResolvedValue({ type: 'stripe_discount', percent_off: 50 });
    checkoutMock.mockResolvedValue({ url: 'https://checkout.stripe.com/c/z', session_id: 'cs_9' });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true });

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('CVPN-XXXXX-XXXXX'), {
      target: { value: 'HALFOFF99' },
    });
    fireEvent.click(screen.getByText('Redeem'));
    await waitFor(() =>
      expect(
        screen.getByText(
          '50% off applied — pay by card above and the discount is included at checkout.',
        ),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('Pay with card'));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalled());
    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({ voucher: 'HALFOFF99' });
    Object.defineProperty(window, 'location', { value: original, writable: true });
  });

  it('shows the taxonomy error for an already-redeemed code', async () => {
    const { ApiError } = await import('@cumulusvpn/core');
    redeemMock.mockRejectedValue(
      new ApiError({ code: '409', name: 'already_redeemed', message: 'x' }),
    );
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('CVPN-XXXXX-XXXXX'), {
      target: { value: 'USEDCODE9' },
    });
    fireEvent.click(screen.getByText('Redeem'));
    await waitFor(() =>
      expect(screen.getByText('This device has already redeemed this code.')).toBeTruthy(),
    );
  });

  it('prefills the box from a #/upgrade?voucher= deep link', () => {
    renderPage(new URLSearchParams('voucher=CVPN-AAAAA-CCCCC'));
    expect((screen.getByPlaceholderText('CVPN-XXXXX-XXXXX') as HTMLInputElement).value).toBe(
      'CVPN-AAAAA-CCCCC',
    );
  });
});

describe('UpgradePage subscription management', () => {
  it('explains where to go instead of offering a portal it cannot open', () => {
    // The card note promises a "Your subscription" section by name, so the
    // section always renders — it just has no button without a session.
    renderPage();
    expect(screen.getByText('Your subscription')).toBeTruthy();
    expect(screen.getByText(/No card subscription was bought in this browser/)).toBeTruthy();
    expect(screen.queryByText('Manage subscription')).toBeNull();
  });

  it('remembers the checkout session on return, then offers the portal', async () => {
    statusMock.mockResolvedValue({ code: ZERO_CODE, payments: [] });
    // The Stripe return is the only moment the session id is available.
    renderPage(new URLSearchParams('session=cs_live_mgmt'));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PAY_PORTAL_SESSIONS_STORAGE_KEY) ?? '{}')).toEqual({
        [ZERO_CODE]: 'cs_live_mgmt',
      }),
    );

    // A later plain visit finds it and shows the management card.
    portalMock.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true });
    renderPage();
    fireEvent.click(screen.getByText('Manage subscription'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/x'),
    );
    expect(portalMock).toHaveBeenCalledWith(
      expect.anything(),
      { code: ZERO_CODE, sessionId: 'cs_live_mgmt' },
      expect.anything(),
    );
    Object.defineProperty(window, 'location', { value: original, writable: true });
  });

  it('scopes the stored session to its payment code (desktop hand-off)', async () => {
    // A session bought for the DESKTOP code must not offer to manage the
    // browser's own (unpaid) code from the same profile.
    const override = '2bmMSbm88eN6MA6RuDiFKjNAZEuk';
    statusMock.mockResolvedValue({ code: override, payments: [] });
    renderPage(new URLSearchParams(`code=${override}&session=cs_live_desktop`));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PAY_PORTAL_SESSIONS_STORAGE_KEY) ?? '{}')).toEqual({
        [override]: 'cs_live_desktop',
      }),
    );
    renderPage();
    expect(screen.queryByText('Manage subscription')).toBeNull();
  });

  it('falls back to the receipt email when the portal cannot be opened', async () => {
    localStorage.setItem(
      PAY_PORTAL_SESSIONS_STORAGE_KEY,
      JSON.stringify({ [ZERO_CODE]: 'cs_live_gone' }),
    );
    const { ApiError } = await import('@cumulusvpn/core');
    portalMock.mockRejectedValue(
      new ApiError({ code: '404', name: 'no_subscription', message: 'x' }),
    );
    renderPage();
    fireEvent.click(screen.getByText('Manage subscription'));
    await waitFor(() => expect(screen.getByText(/link in your Stripe receipt email/)).toBeTruthy());
  });

  it('survives a corrupt storage entry', () => {
    localStorage.setItem(PAY_PORTAL_SESSIONS_STORAGE_KEY, 'not json');
    renderPage();
    expect(screen.queryByText('Manage subscription')).toBeNull();
  });

  it('ignores a junk ?session= instead of destroying a good stored id', async () => {
    // The stored id is unrecoverable — there is no account to restore it
    // from — so a crafted link must not be able to overwrite it.
    statusMock.mockResolvedValue({ code: ZERO_CODE, payments: [] });
    localStorage.setItem(
      PAY_PORTAL_SESSIONS_STORAGE_KEY,
      JSON.stringify({ [ZERO_CODE]: 'cs_live_real' }),
    );
    renderPage(new URLSearchParams('session=not-a-session'));
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(PAY_PORTAL_SESSIONS_STORAGE_KEY) ?? '{}')).toEqual({
      [ZERO_CODE]: 'cs_live_real',
    });
  });

  it('does not offer a portal for an empty ?session=', () => {
    // `?session=` parses to '' — non-null, so it used to render a button
    // whose request the bridge rejects on its minLength schema.
    statusMock.mockResolvedValue({ code: ZERO_CODE, payments: [] });
    renderPage(new URLSearchParams('session='));
    expect(screen.queryByText('Manage subscription')).toBeNull();
  });
});
