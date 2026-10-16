import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { loadDnsChoice } from '../lib/storage';
import { DnsSection } from './DnsSection';

beforeEach(() => {
  localStorage.clear();
});

describe('<DnsSection />', () => {
  it('lists the providers with what each blocks, the default marked and chosen', () => {
    render(<DnsSection />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(7);
    expect(screen.getByRole('radiogroup', { name: 'DNS provider' })).toBeTruthy();

    const cloudflare = screen.getByRole('radio', { name: /^Cloudflare\s*Default/ });
    expect(cloudflare).toBeChecked();
    expect(screen.getByRole('radio', { name: /Quad9.*Blocks known malicious sites/ })).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Mullvad DNS.*Privacy-focused, no filtering/ }),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Google Public DNS.*No filtering/ })).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /DNS4EU.*EU-based, blocks malware and phishing/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /AdGuard DNS.*Blocks ads and trackers/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', {
        name: /Cloudflare for Families.*Blocks malware and adult content/,
      }),
    ).not.toBeChecked();
    // Only the default carries the marker.
    expect(screen.getAllByText('Default')).toHaveLength(1);
  });

  it('says where lookups go and what the provider sees', () => {
    render(<DnsSection />);
    expect(
      screen.getByText(
        'Your DNS lookups go through the VPN to the provider you choose. It sees the VPN server’s address, never yours.',
      ),
    ).toBeTruthy();
  });

  it('saves a pick, and says it applies on the next connect', () => {
    render(<DnsSection />);
    expect(screen.queryByText('Changes apply the next time you connect.')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Quad9/ }));

    expect(screen.getByRole('radio', { name: /Quad9/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Cloudflare\s*Default/ })).not.toBeChecked();
    expect(loadDnsChoice()).toBe('quad9');
    expect(screen.getByText('Changes apply the next time you connect.')).toBeTruthy();
  });

  it('opens on the stored choice, and on the default when storage is corrupt', () => {
    localStorage.setItem('cvpn.dns.v1', 'family');
    const { unmount } = render(<DnsSection />);
    expect(screen.getByRole('radio', { name: /Cloudflare for Families/ })).toBeChecked();
    unmount();

    localStorage.setItem('cvpn.dns.v1', 'not-a-provider');
    render(<DnsSection />);
    expect(screen.getByRole('radio', { name: /^Cloudflare\s*Default/ })).toBeChecked();
  });
});
