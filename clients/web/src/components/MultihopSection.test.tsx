import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@cumulusvpn/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DnsChoice, EnrollResponse, GatewayInfo, Keypair } from '@cumulusvpn/core';
import type { DiscoveryState } from '../hooks/useDiscovery';
import type { CountryOption } from '../lib/gateways';
import { LocaleProvider } from '../hooks/useLocale';
import { MultihopSection } from './MultihopSection';

// Both hops enroll over the network; stubbed so a pair can be generated offline.
const enrollMock = vi.hoisted(() => vi.fn());
vi.mock('@cumulusvpn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  enroll: enrollMock,
}));

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

// Two live countries, one gateway each, so a cross-jurisdiction route resolves.
function gateway(ip: string, country: string): GatewayInfo {
  return {
    ip,
    country,
    load: 0.1,
    sign_pubkey: `sign-${country}=`,
    server_pubkey: `srv-${country}=`,
  } as GatewayInfo;
}
function option(cc: string, name: string): CountryOption {
  return { id: cc, cc, name, flag: '', city: '', nodeCount: 1, status: 'live' } as CountryOption;
}
const twoCountries: DiscoveryState = {
  ...discovery,
  options: [option('DE', 'Germany'), option('NL', 'Netherlands')],
  gateways: [gateway('203.0.113.7', 'DE'), gateway('198.51.100.9', 'NL')],
};

function enrollFor(ip: string): EnrollResponse {
  return {
    assigned_ip: ip === '203.0.113.7' ? '10.8.0.2' : '10.9.0.2',
    dns: '1.1.1.1',
    server_pubkey: `srv-${ip}=`,
    endpoint: `${ip}:51820`,
    payment_address: 't3xyz',
    payment_memo: 'CVPN1:abc',
    price_flux: 12,
  };
}

/** The rendered `.conf` texts, [wg-entry, wg-exit], newlines intact. */
function confs(): string[] {
  return Array.from(document.querySelectorAll('pre.conf'), (pre) => pre.textContent ?? '');
}

function renderSection(dns: DnsChoice, state: DiscoveryState = discovery) {
  return render(
    <LocaleProvider initialLocale="en">
      <MultihopSection keypair={keypair} discovery={state} dns={dns} />
    </LocaleProvider>,
  );
}

describe('<MultihopSection />', () => {
  beforeEach(() => {
    enrollMock.mockReset();
    enrollMock.mockImplementation((ip: string) => Promise.resolve(enrollFor(ip)));
  });

  it('renders the exact English chrome', () => {
    renderSection('cloudflare');
    expect(screen.getByText('Advanced: multi-hop (two configs)')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM · OPT-IN')).toBeInTheDocument();
    expect(screen.getByText('Entry country (sees your IP)')).toBeInTheDocument();
    expect(screen.getByText('Exit country (sees your destination)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate two configs' })).toBeInTheDocument();
    expect(screen.getByText(/no single server sees both/)).toBeInTheDocument();
  });

  // The inner (exit) config is the one whose lookups leave the network, so it
  // carries the chosen resolver; a later change rewrites it without re-enrolling.
  it('puts the chosen DNS in wg-exit.conf, and follows a change without re-enrolling', async () => {
    const { rerender } = renderSection('adguard', twoCountries);
    fireEvent.click(screen.getByRole('button', { name: 'Generate two configs' }));

    await waitFor(() => expect(confs()).toHaveLength(2));
    const [outer, inner] = confs();
    expect(inner).toContain('\nDNS = 94.140.14.14, 94.140.15.15\n');
    expect(outer).not.toContain('DNS =');
    expect(enrollMock).toHaveBeenCalledTimes(2);

    rerender(
      <LocaleProvider initialLocale="en">
        <MultihopSection keypair={keypair} discovery={twoCountries} dns="cloudflare" />
      </LocaleProvider>,
    );
    expect(confs()[1]).toContain('\nDNS = 1.1.1.1\n');
    expect(confs()[1]).not.toContain('94.140.14.14');
    expect(enrollMock).toHaveBeenCalledTimes(2);
  });

  // The default keeps the exit gateway's own advertised DNS, byte for byte.
  it('keeps the exit gateway’s DNS by default', async () => {
    renderSection('cloudflare', twoCountries);
    fireEvent.click(screen.getByRole('button', { name: 'Generate two configs' }));
    await waitFor(() => expect(confs()).toHaveLength(2));
    expect(confs()[1]).toContain('\nDNS = 1.1.1.1\n');
  });
});
