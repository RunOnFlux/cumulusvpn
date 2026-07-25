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

/// A live UDP <-> TLS bridge.
///
/// The bridge owns a Tokio runtime, but that runtime lives on a **dedicated
/// thread of its own** rather than being driven from the caller. That is not a
/// style choice: `TunnelManager::connect` is invoked from an `async` Tauri
/// command, so it already runs *inside* Tokio's worker context, and calling
/// `Runtime::block_on` there panics with "Cannot start a runtime from within a
/// runtime" (likewise `Runtime::drop`). In a release build (`panic = "abort"`)
/// that killed the app with the kill switch already engaged — no tunnel, no UI,
/// and no way to clear the firewall. Owning the runtime on a plain thread makes
/// the bridge safe to construct from sync *or* async context.
pub struct ClientBridge {
    local_addr: SocketAddr,
    /// Dropping this signals the bridge thread to finish, which drops the
    /// runtime there — cancelling the pumps and closing both sockets.
    shutdown: Option<std::sync::mpsc::Sender<()>>,
}

impl ClientBridge {
    /// Connect to the gateway's TLS relay at `server_addr` (`ip:tlsPort`) with
    /// the given `sni`, and bind a local UDP socket the WG sidecar will dial.
    /// Blocks until the TLS handshake completes (so a connect failure surfaces
    /// before the tunnel is configured) and then runs the pumps in the
    /// background. Safe to call from within an async runtime.
    pub fn connect(server_addr: &str, sni: &str) -> Result<Self, TunnelError> {
        let server_addr = server_addr.to_string();
        let sni = sni.to_string();
        // `ready` carries the handshake result back; `shutdown` keeps the bridge
        // thread parked until this handle is dropped.
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<SocketAddr, TunnelError>>();
        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();

        std::thread::Builder::new()
            .name("cvpn-tls-bridge".into())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(_) => {
                        let _ = ready_tx.send(Err(TunnelError::Sidecar("tls bridge: runtime")));
                        return;
                    }
                };
                rt.block_on(async move {
                    match establish(server_addr, sni).await {
                        Ok(addr) => {
                            if ready_tx.send(Ok(addr)).is_err() {
                                return; // caller vanished; tear down
                            }
                            // Park until shutdown (or the handle is dropped) so
                            // the pump tasks keep running on this runtime.
                            let _ = tokio::task::spawn_blocking(move || {
                                let _ = shutdown_rx.recv();
                            })
                            .await;
                        }
                        Err(e) => {
                            let _ = ready_tx.send(Err(e));
                        }
                    }
                });
            })
            .map_err(|_| TunnelError::Sidecar("tls bridge: thread"))?;

        // Bounded by establish()'s own DIAL_TIMEOUT; the extra margin only
        // covers thread start-up, so a wedged bridge can't hang the connect.
        let local_addr = ready_rx
            .recv_timeout(DIAL_TIMEOUT * 2 + std::time::Duration::from_secs(2))
            .map_err(|_| TunnelError::Sidecar("tls bridge: timed out starting"))??;

        Ok(ClientBridge {
            local_addr,
            shutdown: Some(shutdown_tx),
        })
    }

    /// The `127.0.0.1:<port>` endpoint the WG sidecar must dial as its peer.
    pub fn local_endpoint(&self) -> String {
        self.local_addr.to_string()
    }

    /// Tear the bridge down explicitly (idempotent). Drop does the same.
    pub fn shutdown(&mut self) {
        // Dropping the sender wakes the bridge thread, which then drops its
        // runtime — cancelling the pumps and closing the sockets. Never touches
        // a runtime from the caller's thread, so this is safe in async context.
        self.shutdown.take();
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
    let tcp = tokio::time::timeout(DIAL_TIMEOUT, tokio::net::TcpStream::connect(&server_addr))
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

    /// Stand up a TLS echo server speaking the same 2-byte-framed protocol as the
    /// gateway relay. Returns its address.
    fn spawn_echo_relay() -> (String, ()) {
        let ck = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let cert_der = ck.cert.der().clone();
        let key_der = rustls::pki_types::PrivateKeyDer::Pkcs8(ck.key_pair.serialize_der().into());
        let (addr_tx, addr_rx) = std::sync::mpsc::channel();
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
        (addr_rx.recv().unwrap().to_string(), ())
    }

    /// Drives the connect from inside a multi-thread Tokio runtime from inside a multi-thread Tokio runtime — the
    /// shape the real app uses, because `TunnelManager::connect` is reached from
    /// an `async` Tauri command running on a Tokio worker. A bridge that creates
    /// and blocks on a nested runtime panics with "Cannot start a runtime from
    /// within a runtime" here, while passing the plain `#[test]` below. That gap
    /// is exactly how the defect shipped, so this test is the regression guard.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bridge_connects_from_inside_a_tokio_runtime() {
        let (addr, _keep) = spawn_echo_relay();
        let bridge = tokio::task::spawn_blocking(move || ClientBridge::connect(&addr, "localhost"))
            .await
            .expect("join")
            .expect("bridge must connect from within a runtime, not panic");
        assert!(bridge.local_endpoint().starts_with("127.0.0.1:"));
    }

    /// End-to-end: connect the bridge, then act as the WG device — send a UDP
    /// datagram to the bridge's local endpoint and assert the identical bytes come
    /// back. Exercises the full UDP→TLS→TLS→UDP path, the framing, and the
    /// source-address learning.
    #[test]
    fn bridge_roundtrips_a_datagram_over_tls() {
        let (server_addr, _keep) = spawn_echo_relay();
        let bridge = ClientBridge::connect(&server_addr, "localhost").expect("bridge connect");

        let sock = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let payload = b"hello-wg-over-tls";
        sock.send_to(payload, bridge.local_endpoint()).unwrap();

        let mut buf = [0u8; 128];
        let (n, _from) = sock
            .recv_from(&mut buf)
            .expect("echo should return within timeout");
        assert_eq!(
            &buf[..n],
            payload,
            "datagram must survive the UDP<->TLS round trip"
        );
    }
}
