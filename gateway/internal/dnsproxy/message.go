package dnsproxy

import (
	"encoding/binary"
	"errors"

	"golang.org/x/net/dns/dnsmessage"
)

const (
	headerLen = 12
	// minUDP is the classic DNS-over-UDP limit, for clients without EDNS.
	minUDP = 512
	// maxUDP caps what we send back over UDP even when the client advertises
	// more: 1232 bytes is the DNS Flag Day 2020 size, which fits a 1280-byte
	// IPv6 minimum MTU and so never needs IP fragmentation inside the tunnel.
	maxUDP = 1232
)

var (
	// ErrNotDNS reports a message that isn't a standard DNS query. On a
	// flow's first message the forwarder takes that to mean "not DNS at all"
	// (some apps tunnel other protocols over port 53) and relays the flow
	// to its real destination unchanged.
	ErrNotDNS = errors.New("dnsproxy: not a DNS query")

	errBadResponse = errors.New("dnsproxy: malformed DNS response")
)

// IsQuery reports whether m parses as a standard DNS query: a request
// (QR=0), opcode QUERY, with at least one question.
func IsQuery(m []byte) bool {
	var p dnsmessage.Parser
	h, err := p.Start(m)
	if err != nil || h.Response || h.OpCode != 0 {
		return false
	}
	_, err = p.Question()
	return err == nil
}

// checkResponse validates an upstream answer before it is handed to a client.
func checkResponse(m []byte) error {
	var p dnsmessage.Parser
	h, err := p.Start(m)
	if err != nil || !h.Response {
		return errBadResponse
	}
	return nil
}

func messageID(m []byte) uint16 { return binary.BigEndian.Uint16(m) }

func setMessageID(m []byte, id uint16) { binary.BigEndian.PutUint16(m, id) }

// truncatedBit is the TC flag in the second header word.
const truncatedBit = 1 << 9

func isTruncated(m []byte) bool {
	return len(m) >= headerLen && binary.BigEndian.Uint16(m[2:])&truncatedBit != 0
}

// FitUDP returns resp as it may go back over UDP to the client that sent
// query: unchanged when it fits the client's advertised EDNS buffer (512
// bytes without EDNS, never more than 1232), otherwise a truncated reply (TC
// set, question only). Upstream DoH answers have no UDP size limit, so this
// is what keeps a large answer from being dropped on the way back; a client
// seeing TC retries over TCP, which the gateway answers the same way.
func FitUDP(query, resp []byte) []byte {
	if len(resp) <= udpLimit(query) {
		return resp
	}
	return truncate(resp)
}

// udpLimit reads the client's EDNS UDP payload size from query's OPT record.
func udpLimit(query []byte) int {
	var p dnsmessage.Parser
	if _, err := p.Start(query); err != nil {
		return minUDP
	}
	if p.SkipAllQuestions() != nil || p.SkipAllAnswers() != nil || p.SkipAllAuthorities() != nil {
		return minUDP
	}
	for {
		h, err := p.AdditionalHeader()
		if err != nil {
			return minUDP
		}
		if h.Type == dnsmessage.TypeOPT {
			// For OPT, the class field carries the requestor's UDP size.
			return min(max(int(h.Class), minUDP), maxUDP)
		}
		if p.SkipAdditional() != nil {
			return minUDP
		}
	}
}

// truncate keeps resp's header (with TC set) and question, dropping records.
func truncate(resp []byte) []byte {
	var p dnsmessage.Parser
	h, err := p.Start(resp)
	if err == nil {
		var qs []dnsmessage.Question
		if qs, err = p.AllQuestions(); err == nil {
			h.Truncated = true
			b := dnsmessage.NewBuilder(make([]byte, 0, minUDP), h)
			b.EnableCompression()
			if err = b.StartQuestions(); err == nil {
				for _, q := range qs {
					if err = b.Question(q); err != nil {
						break
					}
				}
			}
			if err == nil {
				if out, ferr := b.Finish(); ferr == nil {
					return out
				}
			}
		}
	}
	// Unparseable: a bare header with TC set and no records still makes the
	// client retry over TCP.
	out := make([]byte, headerLen)
	copy(out, resp[:min(len(resp), 4)])
	binary.BigEndian.PutUint16(out[2:], binary.BigEndian.Uint16(out[2:])|truncatedBit)
	return out
}
