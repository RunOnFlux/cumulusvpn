import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Keypair } from '@cumulusvpn/core';
import type { DiscoveryState } from '../hooks/useDiscovery';
import { LocaleProvider } from '../hooks/useLocale';
import { ConnectPage } from './ConnectPage';

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

function renderPage(locale: 'en' | 'es' = 'en') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ConnectPage
        keypair={keypair}
        discovery={discovery}
        onRegenerate={() => {}}
        onNavigateUpgrade={() => {}}
      />
    </LocaleProvider>,
  );
}

describe('<ConnectPage />', () => {
  it('renders the exact English copy', () => {
    renderPage();
    expect(screen.getByText('Choose a location')).toBeInTheDocument();
    expect(screen.getByText('FREE · 100 KB/s')).toBeInTheDocument();
    expect(screen.getByText('Select a country to continue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate .conf' })).toBeInTheDocument();
    expect(screen.getByText('This device’s identity')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'One key, every gateway.',
    );
    expect(
      screen.getByText(/No live gateway reachable from the browser\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'upgrade with FLUX' })).toBeInTheDocument();
  });
});
