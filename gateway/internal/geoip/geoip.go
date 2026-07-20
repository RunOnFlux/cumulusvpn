// Package geoip resolves a public IP to a coarse location (country/region/city)
// via a free, keyless geoIP service. The gateway uses it at startup to fill
// /v1/info when FluxOS hostinfo geo is empty (common on datacenter nodes), so
// clients can group gateways by real city/region and the dashboard can label
// them. Best-effort: a failure just leaves the locality blank.
package geoip

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Geo is a coarse location.
type Geo struct {
	Country string // ISO-3166 alpha-2, e.g. "DE"
	Region  string // state / province, e.g. "Hesse"
	City    string // e.g. "Frankfurt"
}

// lookupBase is the geoIP endpoint prefix (the IP is appended). ipwho.is is
// free, keyless and https. Overridable in tests.
var lookupBase = "https://ipwho.is/"

var httpClient = &http.Client{Timeout: 6 * time.Second}

// Lookup resolves ip to a Geo. Any error means "unknown" — the caller should
// leave the fields blank rather than fail startup.
func Lookup(ctx context.Context, ip string) (Geo, error) {
	ip = stripPort(strings.TrimSpace(ip))
	if ip == "" {
		return Geo{}, fmt.Errorf("geoip: empty ip")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, lookupBase+ip, nil)
	if err != nil {
		return Geo{}, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return Geo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Geo{}, fmt.Errorf("geoip: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Geo{}, err
	}
	return parseGeo(body)
}

// parseGeo decodes an ipwho.is response body into a Geo.
func parseGeo(body []byte) (Geo, error) {
	var r struct {
		Success     bool   `json:"success"`
		Message     string `json:"message"`
		CountryCode string `json:"country_code"`
		Region      string `json:"region"`
		City        string `json:"city"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return Geo{}, fmt.Errorf("geoip: decode: %w", err)
	}
	if !r.Success {
		msg := r.Message
		if msg == "" {
			msg = "unsuccessful"
		}
		return Geo{}, fmt.Errorf("geoip: %s", msg)
	}
	return Geo{Country: r.CountryCode, Region: r.Region, City: r.City}, nil
}

// stripPort removes a trailing :port from an IPv4 "1.2.3.4:16127" form; leaves
// bare IPs and IPv6 (multiple colons) untouched.
func stripPort(ip string) string {
	if strings.Count(ip, ":") == 1 {
		return ip[:strings.IndexByte(ip, ':')]
	}
	return ip
}
