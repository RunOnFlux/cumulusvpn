//! Client side of the `wg-tls` transport: a local UDP <-> TLS bridge.
//!
//! WireGuard-over-TLS makes the tunnel ride an ordinary-looking TLS session so it
//! survives both the vanilla-WG DPI fingerprint AND UDP/port blocking — the one
//! thing the AmneziaWG (`awg`) transport can't do, since it's still UDP
//! (docs/15-transports.md, transport `wg-tls`).
//!
//! The wireguard-go sidecar dials a LOCAL UDP endpoint we own (its peer
//! `Endpoint`); we frame each datagram with a 2-byte big-endian length prefix
//! (matching `gateway/internal/tlsrelay`) and tunnel it over ONE TLS connection
//! to the gateway's TLS relay. Replies come back over the same TLS stream and are
//! delivered to the sidecar as UDP. This is the Rust mirror of the Go
//! `tlsrelay.ClientBridge`.
//!
//! SECURITY: the TLS layer is OBFUSCATION ONLY. The gateway's cert is self-signed
//! and we do NOT verify it — trust is anchored entirely in the inner WireGuard
//! handshake (the client pins the server's WG key via the signed directory), so a
//! TLS man-in-the-middle still can't complete the inner WG handshake. This is the
//! Shadowsocks/obfs model: outer layer hides, inner layer secures.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::TunnelError;

/// Upper bound on a single framed datagram (the 2-byte length prefix caps it at
/// 65535 anyway); matches the gateway relay's `maxDatagram`.
const MAX_DATAGRAM: usize = 65535;

/// Ceiling for the TCP connect and the TLS handshake to the relay. Short enough
/// that a blackholed port fails fast (so transport fallback can move on), long
/// enough for an intercontinental round trip.
const DIAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// A no-op TLS certificate verifier. The TLS layer is camouflage only (see the
/// module doc), so every certificate is accepted; the inner WireGuard handshake
/// is what actually authenticates the gateway.
#[derive(Debug)]
struct NoVerify(Arc<CryptoProvider>);

impl ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Build the client TLS config: an explicit ring provider (so we don't depend on
/// a process-global default being installed) + the camouflage-only verifier.
fn tls_client_config() -> Result<rustls::ClientConfig, TunnelError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let cfg = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|_| TunnelError::Sidecar("tls bridge: bad tls config"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerify(provider)))
        .with_no_client_auth();
    Ok(cfg)
}

/// A live UDP <-> TLS bridge. Dropping it (or calling [`ClientBridge::shutdown`])
/// tears down the owned Tokio runtime, which cancels the pump tasks and closes
/// the TLS connection + local UDP socket.
pub struct ClientBridge {
    local_addr: SocketAddr,
    // Owns the two pump tasks and both sockets; drop = shutdown.
    runtime: Option<tokio::runtime::Runtime>,
}

impl ClientBridge {
    /// Connect to the gateway's TLS relay at `server_addr` (`ip:tlsPort`) with
    /// the given `sni`, and bind a local UDP socket the WG sidecar will dial.
    /// Blocks until the TLS handshake completes (so a connect failure surfaces
    /// before the tunnel is configured) and then runs the pumps in the
    /// background.
    pub fn connect(server_addr: &str, sni: &str) -> Result<Self, TunnelError> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|_| TunnelError::Sidecar("tls bridge: runtime"))?;

        let server_addr = server_addr.to_string();
        let sni = sni.to_string();
        let local_addr = runtime.block_on(async move { establish(server_addr, sni).await })?;

        Ok(ClientBridge {
            local_addr,
            runtime: Some(runtime),
        })
    }

    /// The `127.0.0.1:<port>` endpoint the WG sidecar must dial as its peer.
    pub fn local_endpoint(&self) -> String {
        self.local_addr.to_string()
    }

    /// Tear the bridge down explicitly (idempotent). Drop does the same.
    pub fn shutdown(&mut self) {
        // Dropping the runtime cancels the pump tasks and closes the sockets.
        // shutdown_background avoids blocking if called from within an async
        // context (we never are, but it's the safe choice).
        if let Some(rt) = self.runtime.take() {
            rt.shutdown_background();
        }
    }
}

impl Drop for ClientBridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Bind the local UDP socket, open the TLS connection, and spawn the two pumps.
/// Returns the local UDP address for the WG `Endpoint`.
async fn establish(server_addr: String, sni: String) -> Result<SocketAddr, TunnelError> {
    let udp = tokio::net::UdpSocket::bind("127.0.0.1:0")
        .await
        .map_err(|_| TunnelError::Sidecar("tls bridge: udp bind"))?;
    let local_addr = udp
        .local_addr()
        .map_err(|_| TunnelError::Sidecar("tls bridge: udp addr"))?;

    // Bound the dial. A censor that BLACKHOLES the relay port (rather than
    // refusing it) is the expected hostile case, and an unbounded connect would
    // then block for the OS SYN timeout — ~75s on macOS, ~130s on Linux — inside
    // TunnelManager::connect while it holds the manager mutex, freezing status
    // polls and any transport fallback along with it. Fail fast instead so the
    // caller can try the next transport.
    let tcp = tokio::time::timeout(
        DIAL_TIMEOUT,
        tokio::net::TcpStream::connect(&server_addr),
    )
    .await
    .map_err(|_| TunnelError::Sidecar("tls bridge: tcp connect to relay timed out"))?
    .map_err(|_| TunnelError::Sidecar("tls bridge: tcp connect to relay failed"))?;
    let _ = tcp.set_nodelay(true);

    let connector = tokio_rustls::TlsConnector::from(Arc::new(tls_client_config()?));
    let domain =
        ServerName::try_from(sni).map_err(|_| TunnelError::Sidecar("tls bridge: bad sni"))?;
    // Same reasoning: a port that accepts TCP but never speaks TLS would hang here.
    let tls = tokio::time::timeout(DIAL_TIMEOUT, connector.connect(domain, tcp))
        .await
        .map_err(|_| TunnelError::Sidecar("tls bridge: tls handshake timed out"))?
        .map_err(|_| TunnelError::Sidecar("tls bridge: tls handshake failed"))?;

    let (mut rd, mut wr) = tokio::io::split(tls);
    let udp = Arc::new(udp);
    // The WG sidecar's UDP source, learned from its first datagram, so replies go
    // back to it. Buffered behind a Mutex; the lock is only ever held briefly and
    // never across an await.
    let src: Arc<Mutex<Option<SocketAddr>>> = Arc::new(Mutex::new(None));

    // UDP (WG device) -> TLS (gateway relay).
    {
        let udp = udp.clone();
        let src = src.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; MAX_DATAGRAM];
            loop {
                let (n, from) = match udp.recv_from(&mut buf).await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                if let Ok(mut g) = src.lock() {
                    *g = Some(from);
                }
                // One write per datagram = one TLS record (avoids a
                // two-records-per-packet tell).
                let mut frame = Vec::with_capacity(2 + n);
                frame.extend_from_slice(&(n as u16).to_be_bytes());
                frame.extend_from_slice(&buf[..n]);
                if wr.write_all(&frame).await.is_err() {
                    break;
                }
            }
        });
    }

    // TLS (gateway relay) -> UDP (WG device).
    {
        let udp = udp.clone();
        let src = src.clone();
        tokio::spawn(async move {
            let mut hdr = [0u8; 2];
            loop {
                if rd.read_exact(&mut hdr).await.is_err() {
                    break;
                }
                let len = u16::from_be_bytes(hdr) as usize;
                let mut pkt = vec![0u8; len];
                if rd.read_exact(&mut pkt).await.is_err() {
                    break;
                }
                let dst = src.lock().ok().and_then(|g| *g);
                if let Some(dst) = dst {
                    let _ = udp.send_to(&pkt, dst).await;
                }
            }
        });
    }

    Ok(local_addr)
}

#[cfg(test)]
mod tests {
    use super::ClientBridge;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// End-to-end: stand up a TLS echo server that speaks the same 2-byte-framed
    /// protocol as the gateway relay, connect the bridge to it, then act as the
    /// WG device — send a UDP datagram to the bridge's local endpoint and assert
    /// the identical bytes come back. Exercises the full UDP→TLS→TLS→UDP path,
    /// the framing, and the source-address learning.
    #[test]
    fn bridge_roundtrips_a_datagram_over_tls() {
        // Self-signed cert (camouflage; the client never verifies it).
        let ck = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let cert_der = ck.cert.der().clone();
        let key_der = rustls::pki_types::PrivateKeyDer::Pkcs8(ck.key_pair.serialize_der().into());

        let (addr_tx, addr_rx) = std::sync::mpsc::channel();
        // The TLS echo server runs on its own runtime + thread.
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                addr_tx.send(listener.local_addr().unwrap()).unwrap();

                let provider = Arc::new(rustls::crypto::ring::default_provider());
                let server_config = rustls::ServerConfig::builder_with_provider(provider)
                    .with_safe_default_protocol_versions()
                    .unwrap()
                    .with_no_client_auth()
                    .with_single_cert(vec![cert_der], key_der)
                    .unwrap();
                let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_config));

                let (tcp, _) = listener.accept().await.unwrap();
                let mut tls = acceptor.accept(tcp).await.unwrap();
                // Echo each 2-byte-length-framed datagram straight back.
                let mut hdr = [0u8; 2];
                loop {
                    if tls.read_exact(&mut hdr).await.is_err() {
                        break;
                    }
                    let len = u16::from_be_bytes(hdr) as usize;
                    let mut pkt = vec![0u8; len];
                    if tls.read_exact(&mut pkt).await.is_err() {
                        break;
                    }
                    let mut frame = Vec::with_capacity(2 + len);
                    frame.extend_from_slice(&hdr);
                    frame.extend_from_slice(&pkt);
                    if tls.write_all(&frame).await.is_err() {
                        break;
                    }
                }
            });
        });

        let server_addr = addr_rx.recv().unwrap().to_string();
        let bridge = ClientBridge::connect(&server_addr, "localhost").expect("bridge connect");

        // Act as the WG device: dial the bridge's local UDP endpoint.
        let sock = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let payload = b"hello-wg-over-tls";
        sock.send_to(payload, bridge.local_endpoint()).unwrap();

        let mut buf = [0u8; 128];
        let (n, _from) = sock.recv_from(&mut buf).expect("echo should return within timeout");
        assert_eq!(&buf[..n], payload, "datagram must survive the UDP<->TLS round trip");
    }
}
