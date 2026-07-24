// Package tlsrelay makes WireGuard traffic ride an ordinary-looking TLS session
// so it survives both the vanilla-WG DPI fingerprint and UDP/port blocking
// (docs/15-transports.md, transport "wg-tls").
//
// The gateway {@link Relay} terminates TLS on a TCP port and bridges each
// connection to the LOCAL WireGuard UDP listener; a client {@link ClientBridge}
// does the mirror. WireGuard datagrams are carried over the TLS byte stream with
// a 2-byte big-endian length prefix per datagram.
//
// SECURITY: the TLS layer is OBFUSCATION ONLY. The cert is self-signed and the
// client does NOT verify it — trust is anchored entirely in the inner WireGuard
// handshake (the client pins the server's WG key via the signed directory), so a
// TLS man-in-the-middle still cannot complete the inner WG handshake. This is the
// Shadowsocks/obfs model: outer layer hides, inner layer secures. A self-signed
// cert does not defeat an active-probing censor that validates the chain (that is
// REALITY/T3 territory) — it targets passive/static DPI, our actual markets.
package tlsrelay

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"time"
)

// maxDatagram bounds a single framed WireGuard datagram (well above any WG
// packet; the 2-byte length prefix caps it at 65535 anyway).
const maxDatagram = 65535

// writeFrame writes one length-prefixed datagram as a single Write (one TLS
// record — avoids a two-record-per-packet tell).
func writeFrame(w io.Writer, pkt []byte) error {
	if len(pkt) > maxDatagram {
		return fmt.Errorf("tlsrelay: datagram too large (%d)", len(pkt))
	}
	buf := make([]byte, 2+len(pkt))
	binary.BigEndian.PutUint16(buf, uint16(len(pkt)))
	copy(buf[2:], pkt)
	_, err := w.Write(buf)
	return err
}

// readFrame reads one length-prefixed datagram from the stream.
func readFrame(r io.Reader) ([]byte, error) {
	var hdr [2]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	pkt := make([]byte, binary.BigEndian.Uint16(hdr[:]))
	if _, err := io.ReadFull(r, pkt); err != nil {
		return nil, err
	}
	return pkt, nil
}

// SelfSignedCert generates an ephemeral self-signed TLS certificate. The TLS
// layer is camouflage only (see the package doc), so it never needs a CA or a
// real domain; cn is the certificate common name / a plausible SNI.
func SelfSignedCert(cn string) (tls.Certificate, error) {
	if cn == "" {
		cn = "localhost"
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: cn},
		DNSNames:     []string{cn},
		NotBefore:    time.Now().Add(-1 * time.Hour),
		NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, nil
}

// Relay is a TLS listener that bridges every accepted connection to the local
// WireGuard UDP listener on wgUDPPort.
type Relay struct {
	wgUDPPort int
	tlsCfg    *tls.Config
}

// NewRelay builds a relay serving cert and forwarding to 127.0.0.1:wgUDPPort/udp.
func NewRelay(wgUDPPort int, cert tls.Certificate) *Relay {
	return &Relay{
		wgUDPPort: wgUDPPort,
		tlsCfg: &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		},
	}
}

// ListenAndServe serves TLS on tcpAddr until ctx is cancelled.
func (r *Relay) ListenAndServe(ctx context.Context, tcpAddr string) error {
	ln, err := net.Listen("tcp", tcpAddr)
	if err != nil {
		return err
	}
	return r.Serve(ctx, ln)
}

// Serve wraps ln in TLS and serves until ctx is cancelled. Lets a caller bind
// the listener first (e.g. tests that need the resolved address up front).
func (r *Relay) Serve(ctx context.Context, ln net.Listener) error {
	tlsLn := tls.NewListener(ln, r.tlsCfg)
	go func() {
		<-ctx.Done()
		_ = tlsLn.Close()
	}()
	for {
		conn, err := tlsLn.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil // clean shutdown
			}
			return err
		}
		go r.handle(conn)
	}
}

// handle pumps one TLS connection <-> a fresh UDP socket to the WG device. Each
// TLS connection maps to a distinct local UDP source, which WireGuard treats as
// a roaming endpoint for the peer whose key is in the (opaque) inner handshake.
func (r *Relay) handle(tlsConn net.Conn) {
	defer tlsConn.Close()
	udp, err := net.Dial("udp", fmt.Sprintf("127.0.0.1:%d", r.wgUDPPort))
	if err != nil {
		return
	}
	defer udp.Close()

	// TLS -> UDP (WG device). Closing the conns on return unblocks this.
	go func() {
		for {
			pkt, err := readFrame(tlsConn)
			if err != nil {
				return
			}
			if _, err := udp.Write(pkt); err != nil {
				return
			}
		}
	}()

	// UDP (WG device) -> TLS.
	buf := make([]byte, maxDatagram)
	for {
		n, err := udp.Read(buf)
		if err != nil {
			return
		}
		if err := writeFrame(tlsConn, buf[:n]); err != nil {
			return
		}
	}
}

// ClientBridge lets a userspace WireGuard device speak to a wg-tls gateway. It
// exposes a local UDP endpoint the WG device dials as its peer endpoint, and
// tunnels those datagrams over one TLS connection to the gateway (replies come
// back as UDP). One WG device per bridge. The native mobile/desktop clients
// reimplement this shape in Swift/Kotlin/Rust; this Go version serves the Go
// e2e client + tests.
type ClientBridge struct {
	tlsConn  net.Conn
	localUDP *net.UDPConn
	wgSrcCh  chan *net.UDPAddr
}

// DialClientBridge opens the TLS connection to serverTLSAddr (cert NOT verified —
// obfuscation only) with the given sni, and a local UDP socket for the WG device.
func DialClientBridge(serverTLSAddr, sni string) (*ClientBridge, error) {
	tlsConn, err := tls.Dial("tcp", serverTLSAddr, &tls.Config{
		InsecureSkipVerify: true, // #nosec G402 — camouflage only; inner WG authenticates
		ServerName:         sni,
		MinVersion:         tls.VersionTLS12,
	})
	if err != nil {
		return nil, err
	}
	localUDP, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		_ = tlsConn.Close()
		return nil, err
	}
	b := &ClientBridge{tlsConn: tlsConn, localUDP: localUDP, wgSrcCh: make(chan *net.UDPAddr, 1)}
	go b.tlsToUDP()
	go b.udpToTLS()
	return b, nil
}

// LocalEndpoint is the "host:port" the WG device must use as its peer Endpoint.
func (b *ClientBridge) LocalEndpoint() string { return b.localUDP.LocalAddr().String() }

// Close tears down both sides.
func (b *ClientBridge) Close() error {
	_ = b.tlsConn.Close()
	return b.localUDP.Close()
}

// udpToTLS forwards datagrams from the WG device out over TLS, remembering the
// device's UDP source so replies can be delivered back to it.
func (b *ClientBridge) udpToTLS() {
	buf := make([]byte, maxDatagram)
	var lastSrc *net.UDPAddr
	for {
		n, src, err := b.localUDP.ReadFromUDP(buf)
		if err != nil {
			_ = b.tlsConn.Close()
			return
		}
		if lastSrc == nil || src.String() != lastSrc.String() {
			lastSrc = src
			select { // publish the current WG source (non-blocking, keep newest)
			case b.wgSrcCh <- src:
			default:
				select {
				case <-b.wgSrcCh:
				default:
				}
				b.wgSrcCh <- src
			}
		}
		if err := writeFrame(b.tlsConn, buf[:n]); err != nil {
			_ = b.localUDP.Close()
			return
		}
	}
}

// tlsToUDP forwards datagrams from the gateway back to the WG device.
func (b *ClientBridge) tlsToUDP() {
	var dst *net.UDPAddr
	for {
		pkt, err := readFrame(b.tlsConn)
		if err != nil {
			_ = b.localUDP.Close()
			return
		}
		select { // adopt the latest known WG source
		case dst = <-b.wgSrcCh:
		default:
		}
		if dst == nil {
			continue // no outbound datagram seen yet; nowhere to deliver
		}
		if _, err := b.localUDP.WriteToUDP(pkt, dst); err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
		}
	}
}
