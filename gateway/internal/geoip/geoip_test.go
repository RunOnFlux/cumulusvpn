package geoip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseGeo(t *testing.T) {
	body := []byte(`{"ip":"1.2.3.4","success":true,"country_code":"DE","region":"Hesse","city":"Frankfurt"}`)
	g, err := parseGeo(body)
	if err != nil {
		t.Fatalf("parseGeo error: %v", err)
	}
	if g.Country != "DE" || g.Region != "Hesse" || g.City != "Frankfurt" {
		t.Fatalf("parseGeo = %+v, want DE/Hesse/Frankfurt", g)
	}
}

func TestParseGeoUnsuccessful(t *testing.T) {
	if _, err := parseGeo([]byte(`{"success":false,"message":"Invalid IP address"}`)); err == nil {
		t.Fatal("expected an error when success=false")
	}
}

func TestStripPort(t *testing.T) {
	cases := map[string]string{
		"1.2.3.4:16127": "1.2.3.4",
		"1.2.3.4":       "1.2.3.4",
		"::1":           "::1", // IPv6 (multiple colons) untouched
	}
	for in, want := range cases {
		if got := stripPort(in); got != want {
			t.Errorf("stripPort(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLookup(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/5.6.7.8" { // port must be stripped before the request
			t.Errorf("request path = %q, want /5.6.7.8", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"success":true,"country_code":"US","region":"California","city":"Fremont"}`))
	}))
	defer srv.Close()

	old := lookupBase
	lookupBase = srv.URL + "/"
	defer func() { lookupBase = old }()

	g, err := Lookup(context.Background(), "5.6.7.8:51820")
	if err != nil {
		t.Fatalf("Lookup error: %v", err)
	}
	if g.Country != "US" || g.Region != "California" || g.City != "Fremont" {
		t.Fatalf("Lookup = %+v, want US/California/Fremont", g)
	}
}
