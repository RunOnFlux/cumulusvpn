package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/netstack"
	"golang.org/x/net/dns/dnsmessage"
)

// dnsProbe is one lookup through the tunnel. Each DNS choice is checked with a
// name its provider answers distinctively, so a pass proves that provider —
// not the default — answered: AdGuard returns 0.0.0.0 for an ad domain that
// Cloudflare resolves, and Quad9 refuses its own blocking-test domain. The
// same refusal at 194.242.2.2 (Mullvad's retired DNS) proves Quad9 took it
// over (gateway 0.4.4+).
type dnsProbe struct {
	label  string
	server string // the address the client sends to (the DNS choice)
	name   string
	tcp    bool
	want   string // "ip" = a real address, "0.0.0.0" = blocked, "nxdomain"
}

var dnsProbes = []dnsProbe{
	{"cloudflare, unfiltered", "1.1.1.1", "doubleclick.net.", false, "ip"},
	{"cloudflare over TCP", "1.1.1.1", "example.com.", true, "ip"},
	{"adguard blocks ads", "94.140.14.14", "doubleclick.net.", false, "0.0.0.0"},
	{"quad9 blocks its test domain", "9.9.9.9", "isitblocked.org.", false, "nxdomain"},
	{"quad9 resolves normally", "9.9.9.9", "example.com.", false, "ip"},
	{"cloudflare for families", "1.1.1.3", "example.com.", false, "ip"},
	{"google", "8.8.8.8", "example.com.", false, "ip"},
	{"194.242.2.2 (mullvad, retired) is quad9", "194.242.2.2", "isitblocked.org.", false, "nxdomain"},
	{"dns4eu protective", "86.54.11.1", "example.com.", false, "ip"},
}

// dnsCounters is /v1/info `dns` (gateway 0.4.2+).
type dnsCounters struct {
	Mode      string `json:"mode"`
	Encrypted uint64 `json:"encrypted"`
	Fallbacks uint64 `json:"fallbacks"`
	Failed    uint64 `json:"failed"`
}

func fetchDNSCounters(control string) (*dnsCounters, error) {
	c := &http.Client{Timeout: 10 * time.Second}
	r, err := c.Get(control + "/v1/info")
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	var env struct {
		Data struct {
			Version string       `json:"version"`
			DNS     *dnsCounters `json:"dns"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
		return nil, err
	}
	if env.Data.DNS == nil {
		return nil, fmt.Errorf("gateway %s reports no dns block (pre-0.4.2: DNS relayed in plain text)", env.Data.Version)
	}
	return env.Data.DNS, nil
}

// runDNSCheck resolves every probe through the tunnel and compares the
// gateway's DoH counters before and after. It returns false on any failure.
func runDNSCheck(tnet *netstack.Net, control string) bool {
	before, berr := fetchDNSCounters(control)
	if berr != nil {
		fmt.Println("DNS: counters unavailable:", berr)
	}
	ok := true
	for _, p := range dnsProbes {
		got, err := lookupThroughTunnel(tnet, p)
		switch {
		case err != nil:
			fmt.Printf("DNS FAIL  %-30s @%-13s %s: %v\n", p.label, p.server, p.name, err)
			ok = false
		case got != p.want:
			fmt.Printf("DNS FAIL  %-30s @%-13s %s: got %s, want %s\n", p.label, p.server, p.name, got, p.want)
			ok = false
		default:
			fmt.Printf("DNS ok    %-30s @%-13s %s → %s\n", p.label, p.server, p.name, got)
		}
	}
	after, aerr := fetchDNSCounters(control)
	if berr == nil && aerr == nil {
		enc := after.Encrypted - before.Encrypted
		fb := after.Fallbacks - before.Fallbacks
		fmt.Printf("DNS gateway mode=%s  encrypted +%d  fallbacks +%d  (others' lookups may add to both)\n",
			after.Mode, enc, fb)
		if after.Mode != "doh" || enc < uint64(len(dnsProbes)) {
			fmt.Println("DNS FAIL  the gateway did not answer these lookups over DoH")
			ok = false
		}
	} else {
		ok = false
	}
	return ok
}

// lookupThroughTunnel sends one A query to p.server:53 inside the tunnel and
// classifies the answer as "ip", "0.0.0.0", "nxdomain" or an rcode name.
func lookupThroughTunnel(tnet *netstack.Net, p dnsProbe) (string, error) {
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: 0x2b1d, RecursionDesired: true})
	if err := b.StartQuestions(); err != nil {
		return "", err
	}
	if err := b.Question(dnsmessage.Question{
		Name: dnsmessage.MustNewName(p.name), Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET,
	}); err != nil {
		return "", err
	}
	query, err := b.Finish()
	if err != nil {
		return "", err
	}

	network := "udp"
	if p.tcp {
		network = "tcp"
	}
	var resp []byte
	// Retry over UDP: a datagram can be lost; one answer is all we need.
	for attempt := 0; attempt < 3 && resp == nil; attempt++ {
		resp, err = exchange(tnet, network, p.server, query)
		if p.tcp {
			break
		}
	}
	if resp == nil {
		return "", err
	}

	var parser dnsmessage.Parser
	h, err := parser.Start(resp)
	if err != nil {
		return "", err
	}
	if h.RCode == dnsmessage.RCodeNameError {
		return "nxdomain", nil
	}
	if h.RCode != dnsmessage.RCodeSuccess {
		return h.RCode.String(), nil
	}
	if err := parser.SkipAllQuestions(); err != nil {
		return "", err
	}
	sawZero := false
	for {
		ah, err := parser.AnswerHeader()
		if err != nil {
			break
		}
		if ah.Type != dnsmessage.TypeA {
			_ = parser.SkipAnswer()
			continue
		}
		a, err := parser.AResource()
		if err != nil {
			return "", err
		}
		if a.A == [4]byte{} {
			sawZero = true
			continue
		}
		return "ip", nil
	}
	if sawZero {
		return "0.0.0.0", nil
	}
	return "no A record", nil
}

func exchange(tnet *netstack.Net, network, server string, query []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	c, err := tnet.DialContext(ctx, network, net.JoinHostPort(server, "53"))
	if err != nil {
		return nil, err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(5 * time.Second))
	if network == "tcp" {
		msg := make([]byte, 2+len(query))
		binary.BigEndian.PutUint16(msg, uint16(len(query)))
		copy(msg[2:], query)
		if _, err := c.Write(msg); err != nil {
			return nil, err
		}
		var l [2]byte
		if _, err := io.ReadFull(c, l[:]); err != nil {
			return nil, err
		}
		resp := make([]byte, binary.BigEndian.Uint16(l[:]))
		_, err = io.ReadFull(c, resp)
		return resp, err
	}
	if _, err := c.Write(query); err != nil {
		return nil, err
	}
	buf := make([]byte, 4096)
	n, err := c.Read(buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}
