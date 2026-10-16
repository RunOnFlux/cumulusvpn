import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DnsChoice } from '@cumulusvpn/core';
import { LocaleProvider } from '../hooks/useLocale';
import { DnsSection } from './DnsSection';

function renderSection(
  value: DnsChoice,
  onChange: (choice: DnsChoice) => void = () => {},
  locale: 'en' | 'es' = 'en',
) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <DnsSection value={value} onChange={onChange} />
    </LocaleProvider>,
  );
}

describe('<DnsSection />', () => {
  it('renders the exact English copy, default marked', () => {
    renderSection('cloudflare');
    expect(screen.getByRole('radiogroup', { name: 'DNS provider' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByText('Fast, no filtering')).toBeInTheDocument();
    expect(screen.getByText('No filtering')).toBeInTheDocument();
    expect(screen.getByText('Blocks known malicious sites')).toBeInTheDocument();
    expect(screen.getByText('EU-based, blocks malware and phishing')).toBeInTheDocument();
    expect(screen.getByText('Blocks ads and trackers')).toBeInTheDocument();
    expect(screen.getByText('Blocks malware and adult content')).toBeInTheDocument();
    // Exactly one option carries the default tag: Cloudflare's.
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Fast, no filtering/ })).toHaveAccessibleName(
      /^Cloudflare\s*Default/,
    );
    expect(
      screen.getByText(
        'Your DNS lookups go through the VPN to the provider you choose. It sees the VPN server’s address, never yours.',
      ),
    ).toBeInTheDocument();
  });

  it('checks the current choice and names it in the summary', () => {
    renderSection('quad9');
    expect(screen.getByRole('radio', { name: /Quad9/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Fast, no filtering/ })).not.toBeChecked();
    expect(screen.getByText('Quad9', { selector: '.dns-pill' })).toBeInTheDocument();
  });

  it('reports a pick by id', () => {
    const onChange = vi.fn();
    renderSection('cloudflare', onChange);
    fireEvent.click(screen.getByRole('radio', { name: /AdGuard DNS/ }));
    expect(onChange).toHaveBeenCalledWith('adguard');
  });

  // Blurbs are translated; provider names are brands and stay as they are.
  it('localizes the blurbs but not the provider names', async () => {
    renderSection('cloudflare', () => {}, 'es');
    const { es } = await import('../i18n/locales/es');
    expect(await screen.findByText(es.dns_blurb_quad9 as string)).toBeInTheDocument();
    expect(screen.queryByText('Blocks known malicious sites')).not.toBeInTheDocument();
    expect(screen.getByText('Cloudflare for Families')).toBeInTheDocument();
    expect(screen.getByText('AdGuard DNS')).toBeInTheDocument();
  });
});
