package dnsproxy

import "net/netip"

// Provider is a public resolver whose lookups the gateway sends on encrypted.
type Provider struct {
	// Name is a stable slug, used in docs and the apps' DNS choice.
	Name string
	// Host is the DoH hostname. The resolver's TLS certificate is verified
	// against it, and the request goes to https://<Host>/dns-query.
	Host string
	// Addrs are the resolver's addresses: what clients send port-53 lookups
	// to, and also what the gateway dials for DoH, so no bootstrap lookup of
	// Host is ever needed (the node's own resolver is never consulted).
	Addrs []netip.Addr
}

// Providers are the resolvers the gateway encrypts lookups to. A client picks
// one simply by its address (the tunnel's DNS = setting): a lookup sent to
// 9.9.9.9 is answered by Quad9 over DoH, one sent to 1.1.1.1 by Cloudflare.
// Each entry was checked to serve DoH over HTTP/2 on every one of its Addrs
// with Host as the TLS name (2026-10-13).
var Providers = []Provider{
	// The default: the fleet advertises 1.1.1.1 in every enroll response.
	{Name: "cloudflare", Host: "cloudflare-dns.com", Addrs: addrs("1.1.1.1", "1.0.0.1")},
	// Cloudflare for Families: malware blocking, then malware + adult content.
	{Name: "cloudflare-security", Host: "security.cloudflare-dns.com", Addrs: addrs("1.1.1.2", "1.0.0.2")},
	{Name: "cloudflare-family", Host: "family.cloudflare-dns.com", Addrs: addrs("1.1.1.3", "1.0.0.3")},
	// Quad9: Swiss non-profit, blocks known-malicious domains.
	{Name: "quad9", Host: "dns.quad9.net", Addrs: addrs("9.9.9.9", "149.112.112.112")},
	// AdGuard DNS: blocks ads and trackers.
	{Name: "adguard", Host: "dns.adguard-dns.com", Addrs: addrs("94.140.14.14", "94.140.15.15")},
	// Not offered as a choice, but apps that hard-code Google's resolver get
	// the same encryption.
	{Name: "google", Host: "dns.google", Addrs: addrs("8.8.8.8", "8.8.4.4")},
}

func addrs(s ...string) []netip.Addr {
	out := make([]netip.Addr, len(s))
	for i, a := range s {
		out[i] = netip.MustParseAddr(a)
	}
	return out
}
