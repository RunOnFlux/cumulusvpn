import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@cumulusvpn/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Keypair } from '@cumulusvpn/core';
import type { DiscoveryState } from '../hooks/useDiscovery';
import type { CountryOption } from '../lib/gateways';
import { LocaleProvider } from '../hooks/useLocale';
import { ConnectPage } from './ConnectPage';

// The page's network calls — enroll(), status() for the tier pill and the
// issued-config check — are stubbed so every state is reachable offline.
const enrollMock = vi.hoisted(() => vi.fn());
const checkMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
vi.mock('@cumulusvpn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  enroll: enrollMock,
  checkIssuedConfig: checkMock,
  status: statusMock,
}));

const keypair: Keypair = {
  publicKey: 'pub+test/key=',
  privateKey: 'priv+test/key=',
};

const discovery: DiscoveryState = {
  loading: false,
  directory: null,
  source: null,
  verified: true,
  options: [],
  gateways: [],
  notice: 'no-live-gateway',
};

function renderPage(locale: 'en' | 'es' = 'en', state: DiscoveryState = discovery) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ConnectPage
        keypair={keypair}
        discovery={state}
        identityRestored={false}
        onRegenerate={() => {}}
        onRestore={() => {}}
        onNavigateUpgrade={() => {}}
      />
    </LocaleProvider>,
  );
}

// A discovery state with one live, enrollable country.
const liveOption: CountryOption = {
  id: 'de',
  cc: 'de',
  spec: 'cumulusvpnde',
  name: 'Germany',
  flag: '🇩🇪',
  city: 'Frankfurt',
  nodeCount: 1,
  status: 'live',
  bestGateway: {
    ip: '203.0.113.7',
    country: 'DE',
    region: 'HE',
    city: 'Frankfurt',
    load: 0.1,
    capacity: 100,
    version: '0.2.0',
    server_pubkey: 'srv+pub/key=',
    sign_pubkey: 'sign+pub/key=',
    min_client_version: '0.1.0',
  } as CountryOption['bestGateway'],
};

const liveDiscovery: DiscoveryState = { ...discovery, options: [liveOption], notice: null };

// The record the page writes when it issues a config, so a later visit can tell
// the user their config died.
const ISSUED_KEY = 'cvpn.issued.v1';

function rememberIssued() {
  localStorage.setItem(
    ISSUED_KEY,
    JSON.stringify({
      ip: '203.0.113.7',
      serverPubKey: 'srv+pub/key=',
      cc: 'de',
      issuedAt: '2026-07-01T00:00:00Z',
    }),
  );
}

describe('<ConnectPage />', () => {
  beforeEach(() => {
    localStorage.clear();
    checkMock.mockReset();
    checkMock.mockResolvedValue('unknown');
    enrollMock.mockReset();
    statusMock.mockReset();
    statusMock.mockRejectedValue(new Error('offline'));
  });

  // A migration re-places the gateway on a node with its own key, so the issued
  // config can never handshake again — and WireGuard reports that as a connected
  // tunnel passing nothing. This banner is the only way the user finds out.
  it('warns definitively when the issuing gateway was replaced', async () => {
    rememberIssued();
    checkMock.mockResolvedValue('replaced');
    renderPage('en', liveDiscovery);

    expect(
      await screen.findByText(/server that issued your last config for DE has been replaced/),
    ).toBeInTheDocument();
  });

  // Unreachable is NOT proof of breakage — the user may simply be offline — so
  // it must hedge rather than assert. Getting this wrong would train users to
  // ignore the banner that actually matters.
  it('hedges when the gateway merely did not answer', async () => {
    rememberIssued();
    checkMock.mockResolvedValue('unreachable');
    renderPage('en', liveDiscovery);

    expect(await screen.findByText(/Couldn’t reach the server/)).toBeInTheDocument();
    expect(screen.queryByText(/has been replaced/)).not.toBeInTheDocument();
  });

  it('says nothing when no config was ever issued', async () => {
    renderPage('en', liveDiscovery);
    await waitFor(() => expect(checkMock).not.toHaveBeenCalled());
    expect(screen.queryByText(/has been replaced/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t reach the server/)).not.toBeInTheDocument();
  });

  it('renders the exact English copy', () => {
    renderPage();
    expect(screen.getByText('Choose a location')).toBeInTheDocument();
    expect(screen.getByText('Select a country to continue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate .conf' })).toBeInTheDocument();
    expect(screen.getByText('This device’s identity')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One key, every gateway.');
    expect(screen.getByText(/Couldn’t reach any gateway just now\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'upgrade with FLUX' })).toBeInTheDocument();
  });

  // The pill used to be a hard-coded FREE, which told paying users their payment
  // had not landed. It now shows the key's real tier, and nothing until known.
  it('shows the real tier: nothing while unknown, then premium with its end date', async () => {
    statusMock.mockResolvedValue({
      tier: 'premium',
      paid_until: '2026-11-09T16:11:00Z',
      bytes_used: 0,
    });
    renderPage('en', liveDiscovery);
    expect(screen.queryByText('FREE · 100 KB/s')).not.toBeInTheDocument();
    expect(await screen.findByText(/^PREMIUM · until .*Nov.*2026$/)).toBeInTheDocument();
    expect(statusMock).toHaveBeenCalledWith('203.0.113.7', keypair.publicKey, expect.anything());
  });

  it('shows FREE only once a gateway says the key is free', async () => {
    statusMock.mockResolvedValue({ tier: 'free', paid_until: '', bytes_used: 0 });
    renderPage('en', liveDiscovery);
    expect(await screen.findByText('FREE · 100 KB/s')).toBeInTheDocument();
  });

  it('shows no tier pill when no gateway answers', async () => {
    renderPage('en', liveDiscovery);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(screen.queryByText('FREE · 100 KB/s')).not.toBeInTheDocument();
    expect(screen.queryByText(/^PREMIUM · until /)).not.toBeInTheDocument();
  });

  // Discovery starts out unverified, so keying the warning on `verified` alone
  // showed every visitor a forged-directory warning for the whole load.
  it('warns about the directory signature only once the check has finished', () => {
    const { rerender } = renderPage('en', { ...discovery, loading: true, verified: false });
    expect(screen.queryByText(/could not be verified/)).not.toBeInTheDocument();

    rerender(
      <LocaleProvider initialLocale="en">
        <ConnectPage
          keypair={keypair}
          discovery={{ ...discovery, verified: false }}
          identityRestored={false}
          onRegenerate={() => {}}
          onRestore={() => {}}
          onNavigateUpgrade={() => {}}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/could not be verified/)).toBeInTheDocument();
  });

  // A .conf pins one node's endpoint, server key and peer registration, and any
  // of those can change under the user — WireGuard then reports "connected"
  // while nothing handshakes. The apps re-enroll automatically; the stock client
  // reading a static file cannot, so the page has to both warn and offer the fix.
  it('warns that a generated .conf can go stale, and offers to reissue it', async () => {
    enrollMock.mockClear();
    enrollMock.mockResolvedValue({
      assigned_ip: '10.8.0.2',
      dns: '1.1.1.1',
      server_pubkey: 'srv+pub/key=',
      endpoint: '203.0.113.7:51820',
      payment_address: 't3xyz',
      payment_memo: 'CVPN1:abc',
      price_flux: 20,
    });

    renderPage('en', liveDiscovery);
    fireEvent.click(screen.getByRole('button', { name: 'Generate .conf' }));

    await waitFor(() => {
      expect(screen.getByText(/Tied to this server/)).toBeInTheDocument();
    });
    // The warning must name the deceptive symptom, not just say "may expire" —
    // a user whose tunnel reads "connected" will not otherwise suspect the conf.
    expect(
      screen.getByText(/show the tunnel as connected while nothing gets through/),
    ).toBeInTheDocument();

    // And the remedy is one click away, on the SAME keypair (a new keypair would
    // change the payment code and orphan any premium the user paid for).
    fireEvent.click(screen.getByRole('button', { name: 'Generate a new .conf' }));
    await waitFor(() => expect(enrollMock).toHaveBeenCalledTimes(2));
    for (const call of enrollMock.mock.calls) {
      expect(call[1]).toBe(keypair.publicKey);
    }
  });

  it('renders Spanish after the es catalog loads', async () => {
    renderPage('es');
    // The catalog chunk loads async; findBy* waits for the swap.
    expect(await screen.findByRole('button', { name: /\.conf/ })).toBeInTheDocument();
    const { es } = await import('../i18n/locales/es');
    expect(await screen.findByText(es.connect_choose_location as string)).toBeInTheDocument();
    expect(screen.queryByText('Choose a location')).not.toBeInTheDocument();
  });
});
