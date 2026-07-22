import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Keypair } from '@cumulusvpn/core';
import type { DiscoveryState } from '../hooks/useDiscovery';
import { LocaleProvider } from '../hooks/useLocale';
import { MultihopSection } from './MultihopSection';

const keypair: Keypair = { publicKey: 'pub=', privateKey: 'priv=' };
const discovery: DiscoveryState = {
  loading: false,
  directory: null,
  source: null,
  verified: true,
  options: [],
  gateways: [],
  notice: null,
};

describe('<MultihopSection />', () => {
  it('renders the exact English chrome', () => {
    render(
      <LocaleProvider initialLocale="en">
        <MultihopSection keypair={keypair} discovery={discovery} />
      </LocaleProvider>,
    );
    expect(screen.getByText('Advanced: multi-hop (two configs)')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM · OPT-IN')).toBeInTheDocument();
    expect(screen.getByText('Entry country (sees your IP)')).toBeInTheDocument();
    expect(screen.getByText('Exit country (sees your destination)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate two configs' })).toBeInTheDocument();
    expect(screen.getByText(/no single server sees both/)).toBeInTheDocument();
  });
});
