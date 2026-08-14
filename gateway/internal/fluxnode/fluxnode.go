// Package fluxnode talks to FluxOS-provided services:
//
//   - the in-container node-info service at http://fluxnode.service:16101
//     (geo, public IP, benchmark — used for /v1/info self-description), and
//   - the host node's FluxOS API at http://$FLUX_NODE_HOST_IP:16127 for
//     blockchain queries (daemon RPC pass-through + insight-style explorer
//     endpoints), with https://explorer.runonflux.io/api as fallback.
//
// The blockchain client feeds the entitlement scanner (internal/entitle).
package fluxnode

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

const (
	hostInfoURL     = "http://fluxnode.service:16101/hostinfo"
	explorerBaseURL = "https://explorer.runonflux.io/api"
)

// HostInfo is the response of fluxnode.service:16101/hostinfo.
type HostInfo struct {
	AppName string `json:"appName"`
	ID      string `json:"id"` // node collateral id
	IP      string `json:"ip"` // node public IP (may include :apiport suffix)
	Geo     struct {
		Continent string `json:"continent"`
		Country   string `json:"country"`
		Region    string `json:"region"`
	} `json:"geo"`
	Benchmark struct {
		Cores float64 `json:"cores"`
		RAM   float64 `json:"ram"`
		Disk  float64 `json:"disk"`
	} `json:"benchmark"`
}

// GetHostInfo queries the FluxOS in-container node info service.
func GetHostInfo(ctx context.Context) (*HostInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, hostInfoURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("fluxnode: hostinfo: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fluxnode: hostinfo: HTTP %d", resp.StatusCode)
	}
	var hi HostInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&hi); err != nil {
		return nil, fmt.Errorf("fluxnode: hostinfo decode: %w", err)
	}
	// POC: verify exact field names against a live node — some FluxOS
	// versions nest geo/benchmark differently or return {status,data:{...}}.
	return &hi, nil
}

// Client queries the host node's FluxOS API (port 16127) for blockchain data,
// falling back to the public explorer when the node API is unavailable
// (e.g. local development outside a Flux container).
type Client struct {
	nodeBase string // http://<host-ip>:16127, "" if unknown
	explorer string
	http     *http.Client

	// mu guards addrSrc, which caches whether the host node can serve address
	// history (see addrTxPage). Probed once, re-probed if a working node
	// starts failing.
	mu      sync.Mutex
	addrSrc int
}

// NewClient builds a chain client. hostIP may be empty (explorer-only mode).
func NewClient(hostIP string) *Client {
	c := &Client{
		explorer: explorerBaseURL,
		http:     &http.Client{Timeout: 15 * time.Second},
	}
	if hostIP != "" {
		c.nodeBase = "http://" + hostIP + ":16127"
	}
	return c
}

// fluxAPIResponse is the standard FluxOS API envelope.
type fluxAPIResponse struct {
	Status string          `json:"status"`
	Data   json.RawMessage `json:"data"`
}

func (c *Client) nodeGet(ctx context.Context, path string, out any) error {
	if c.nodeBase == "" {
		return fmt.Errorf("fluxnode: no host node configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.nodeBase+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fluxnode: GET %s: HTTP %d", path, resp.StatusCode)
	}
	var env fluxAPIResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&env); err != nil {
		return err
	}
	if env.Status != "success" {
		return fmt.Errorf("fluxnode: GET %s: status %q", path, env.Status)
	}
	return json.Unmarshal(env.Data, out)
}

func (c *Client) explorerGet(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.explorer+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fluxnode: explorer GET %s: HTTP %d", path, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

// BlockCount returns the current chain height, preferring the host node's
// daemon API and falling back to the explorer.
func (c *Client) BlockCount(ctx context.Context) (int64, error) {
	var height int64
	if err := c.nodeGet(ctx, "/daemon/getblockcount", &height); err == nil {
		return height, nil
	}
	// Insight fallback: /status?q=getInfo → {"info":{"blocks":N,...}}.
	var st struct {
		Info struct {
			Blocks int64 `json:"blocks"`
		} `json:"info"`
	}
	if err := c.explorerGet(ctx, "/status?q=getInfo", &st); err != nil {
		return 0, fmt.Errorf("fluxnode: blockcount: %w", err)
	}
	return st.Info.Blocks, nil
}

// insightTx is the subset of an insight-style transaction we care about.
type insightTx struct {
	TxID          string `json:"txid"`
	Blockheight   int64  `json:"blockheight"`
	Confirmations int64  `json:"confirmations"`
	Time          int64  `json:"time"`
	Vout          []struct {
		Value        json.Number `json:"value"` // insight returns strings, daemon numbers
		ScriptPubKey struct {
			Hex       string   `json:"hex"`
			Addresses []string `json:"addresses"`
		} `json:"scriptPubKey"`
	} `json:"vout"`
}

// AddressTx is a normalized transaction touching the payment address.
type AddressTx struct {
	TxID   string
	Height int64
	Time   time.Time
	// AmountTo is the total FLUX paid to the queried address in this tx.
	AmountTo float64
	// Memos are the decoded UTF-8 payloads of every OP_RETURN output.
	Memos []string
}

// insightPage is one page of insight address history (newest-first).
type insightPage struct {
	TotalItems int         `json:"totalItems"`
	Items      []insightTx `json:"items"`
}

// Address-history source, resolved once per client and then reused.
const (
	addrSrcUnknown = iota
	addrSrcNode
	addrSrcExplorer
)

// AddressTxs pages through the transaction history of addr, oldest first,
// returning only txs at height > afterHeight. Used by the entitlement scanner
// both for the boot backfill and incremental polls.
func (c *Client) AddressTxs(ctx context.Context, addr string, afterHeight int64) ([]AddressTx, error) {
	const pageSize = 50
	var out []AddressTx
	from := 0
	for {
		page, err := c.addrTxPage(ctx, addr, from, from+pageSize)
		if err != nil {
			return nil, fmt.Errorf("fluxnode: address txs: %w", err)
		}
		for _, tx := range page.Items {
			if tx.Blockheight <= afterHeight {
				// Items are newest-first; once we cross the cursor we
				// can stop paging entirely.
				return reverse(out), nil
			}
			out = append(out, normalizeTx(tx, addr))
		}
		from += pageSize
		if from >= page.TotalItems || len(page.Items) == 0 {
			return reverse(out), nil
		}
	}
}

// addrTxPage fetches one page of address history, preferring the host node.
//
// Insight paging: GET /addrs/{addr}/txs?from=A&to=B →
// {"totalItems":N,"from":A,"to":B,"items":[...]}, newest first. FluxOS mirrors
// the same shape under /explorer on port 16127, so the node can serve this
// without the public explorer — which matters because a fleet redeploy has
// every gateway backfilling at once, and explorer.runonflux.io is both flaky
// and a single point of failure for entitlement.
//
// The node route is version-dependent, so the source is probed once and then
// remembered: without stickiness a node that lacks it would cost a failed
// request on every page of every poll. The probe demands a page that actually
// looks like address history — a route that 404s, returns a different shape,
// or reports nothing at all is treated as absent and the explorer takes over.
// Guessing wrong here would mean silently seeing zero payments, so "looks
// empty" is deliberately not trusted.
func (c *Client) addrTxPage(ctx context.Context, addr string, from, to int) (*insightPage, error) {
	path := fmt.Sprintf("/addrs/%s/txs?from=%d&to=%d", url.PathEscape(addr), from, to)

	c.mu.Lock()
	src := c.addrSrc
	c.mu.Unlock()

	if src == addrSrcUnknown && c.nodeBase != "" {
		var page insightPage
		err := c.nodeGet(ctx, "/explorer"+path, &page)
		usable := err == nil && (page.TotalItems > 0 || len(page.Items) > 0)
		c.mu.Lock()
		if usable {
			c.addrSrc = addrSrcNode
		} else {
			c.addrSrc = addrSrcExplorer
		}
		c.mu.Unlock()
		if usable {
			return &page, nil
		}
		// An address with genuinely no history reads the same as a missing
		// route; the explorer answers identically, so at worst this costs one
		// extra request at boot.
	} else if src == addrSrcNode {
		var page insightPage
		if err := c.nodeGet(ctx, "/explorer"+path, &page); err == nil {
			return &page, nil
		}
		// The node was working and stopped. Fall back for this page, and let
		// the next call re-probe rather than pinning to the explorer forever.
		c.mu.Lock()
		c.addrSrc = addrSrcUnknown
		c.mu.Unlock()
	}

	var page insightPage
	if err := c.explorerGet(ctx, path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

// RawTransaction fetches one transaction via the daemon API (verbose form).
// Used for the optional 0-conf fast path and for spot re-verification.
func (c *Client) RawTransaction(ctx context.Context, txid string) (*AddressTx, error) {
	var tx insightTx
	if err := c.nodeGet(ctx, "/daemon/getrawtransaction?txid="+url.QueryEscape(txid)+"&verbose=1", &tx); err != nil {
		if err2 := c.explorerGet(ctx, "/tx/"+url.PathEscape(txid), &tx); err2 != nil {
			return nil, fmt.Errorf("fluxnode: rawtx: node: %v, explorer: %w", err, err2)
		}
	}
	n := normalizeTx(tx, "") // caller filters by address via memos+amount
	return &n, nil
}

func normalizeTx(tx insightTx, addr string) AddressTx {
	out := AddressTx{
		TxID:   tx.TxID,
		Height: tx.Blockheight,
		Time:   time.Unix(tx.Time, 0).UTC(),
	}
	for _, vout := range tx.Vout {
		if memo, ok := decodeOpReturn(vout.ScriptPubKey.Hex); ok {
			out.Memos = append(out.Memos, memo)
			continue
		}
		if addr == "" {
			continue
		}
		for _, a := range vout.ScriptPubKey.Addresses {
			if a == addr {
				if v, err := vout.Value.Float64(); err == nil {
					out.AmountTo += v
				}
			}
		}
	}
	return out
}

// decodeOpReturn extracts the pushdata payload from an OP_RETURN script.
// Script forms handled: 6a <len> <data> and 6a 4c <len> <data> (PUSHDATA1).
func decodeOpReturn(scriptHex string) (string, bool) {
	raw, err := hex.DecodeString(scriptHex)
	if err != nil || len(raw) < 2 || raw[0] != 0x6a {
		return "", false
	}
	data := raw[1:]
	switch {
	case data[0] <= 0x4b: // direct push
		n := int(data[0])
		data = data[1:]
		if len(data) < n {
			return "", false
		}
		return string(data[:n]), true
	case data[0] == 0x4c && len(data) >= 2: // OP_PUSHDATA1
		n := int(data[1])
		data = data[2:]
		if len(data) < n {
			return "", false
		}
		return string(data[:n]), true
	}
	return "", false
}

func reverse(txs []AddressTx) []AddressTx {
	for i, j := 0, len(txs)-1; i < j; i, j = i+1, j-1 {
		txs[i], txs[j] = txs[j], txs[i]
	}
	return txs
}
