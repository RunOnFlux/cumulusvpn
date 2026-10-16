/**
 * DNS choice for `@cumulusvpn/core` (docs/03-gateway.md "DNS").
 *
 * The tunnel's `DNS =` address is the whole mechanism: lookups travel inside
 * the tunnel to that address, and gateway 0.4.2+ answers them itself and sends
 * them on encrypted (DNS over HTTPS) to the SAME provider. Older gateways
 * relay them as ordinary DNS from the gateway, so nearly every choice works
 * against every gateway and only the encryption past the gateway depends on
 * its version. The exception is Mullvad, which answers no ordinary DNS: it
 * resolves only through gateway 0.4.3+, so it may ship only once the fleet
 * runs 0.4.3.
 *
 * Every address below must stay in the gateway's provider table
 * (gateway/internal/dnsproxy/providers.go) — an address missing there would
 * silently go out unencrypted. A test pins the two lists together.
 *
 * The choice is a local setting: it never leaves the device.
 */

/** The DNS options the apps offer. */
export type DnsChoice =
  'cloudflare' | 'mullvad' | 'google' | 'quad9' | 'dns4eu' | 'adguard' | 'family';

export interface DnsOption {
  readonly id: DnsChoice;
  /** Provider name as shown in the apps. A brand, so never translated. */
  readonly provider: string;
  /** What the option blocks, in English (apps localize by `id`). */
  readonly blurb: string;
  /** IPv4 resolver addresses, primary first (Mullvad has only one). */
  readonly servers: readonly string[];
}

/** The default: Cloudflare, what every gateway advertises at enroll. */
export const DEFAULT_DNS: DnsChoice = 'cloudflare';

/**
 * All options in the order the apps list them: the default first, then the
 * other unfiltered resolvers, then the filtering ones.
 */
export const DNS_OPTIONS: readonly DnsOption[] = [
  {
    id: 'cloudflare',
    provider: 'Cloudflare',
    blurb: 'Fast, no filtering',
    servers: ['1.1.1.1', '1.0.0.1'],
  },
  {
    id: 'mullvad',
    provider: 'Mullvad DNS',
    blurb: 'Privacy-focused, no filtering',
    servers: ['194.242.2.2'],
  },
  {
    id: 'google',
    provider: 'Google Public DNS',
    blurb: 'No filtering',
    servers: ['8.8.8.8', '8.8.4.4'],
  },
  {
    id: 'quad9',
    provider: 'Quad9',
    blurb: 'Blocks known malicious sites',
    servers: ['9.9.9.9', '149.112.112.112'],
  },
  {
    id: 'dns4eu',
    provider: 'DNS4EU',
    blurb: 'EU-based, blocks malware and phishing',
    servers: ['86.54.11.1', '86.54.11.201'],
  },
  {
    id: 'adguard',
    provider: 'AdGuard DNS',
    blurb: 'Blocks ads and trackers',
    servers: ['94.140.14.14', '94.140.15.15'],
  },
  {
    id: 'family',
    provider: 'Cloudflare for Families',
    blurb: 'Blocks malware and adult content',
    servers: ['1.1.1.3', '1.0.0.3'],
  },
];

/** The option for `choice`. */
export function dnsOption(choice: DnsChoice): DnsOption {
  // DNS_OPTIONS covers every DnsChoice; the default is unreachable fallback.
  return DNS_OPTIONS.find((o) => o.id === choice) ?? (DNS_OPTIONS[0] as DnsOption);
}

/**
 * Reads a stored setting. Anything unknown (corrupt storage, or an option a
 * newer build added and this one doesn't know) falls back to the default
 * rather than failing, so a bad value can never block connecting.
 */
export function parseDnsChoice(value: unknown): DnsChoice {
  return DNS_OPTIONS.some((o) => o.id === value) ? (value as DnsChoice) : DEFAULT_DNS;
}

/**
 * The `DNS =` value for a tunnel config.
 *
 * The default keeps exactly what the gateway advertised (`dns` from enroll,
 * `1.1.1.1` across the fleet), so default configs are byte-identical to
 * before this feature. Any other choice lists that provider's addresses,
 * comma-separated as WireGuard configs expect.
 *
 * @param choice - The user's DNS choice.
 * @param gatewayDns - The `dns` the gateway returned at enroll.
 */
export function dnsServersFor(choice: DnsChoice, gatewayDns: string): string {
  if (choice === DEFAULT_DNS) return gatewayDns;
  return dnsOption(choice).servers.join(', ');
}
