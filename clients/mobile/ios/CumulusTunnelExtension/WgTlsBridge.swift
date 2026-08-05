// WgTlsBridge.swift
//
// Client side of the `wg-tls` transport on iOS: a local UDP <-> TLS bridge.
//
// WireGuard-over-TLS makes the tunnel ride an ordinary-looking TLS session so it
// survives both the vanilla-WG DPI fingerprint AND UDP/port blocking — the one
// thing the AmneziaWG (`awg`) transport can't do, since it's still UDP
// (docs/15-transports.md).
//
// The wgnest WireGuard device dials a LOCAL UDP endpoint we own (its peer
// Endpoint); we frame each datagram with a 2-byte big-endian length prefix
// (matching gateway/internal/tlsrelay) and tunnel it over ONE TLS connection to
// the gateway's TLS relay. Replies come back over TLS and are delivered to the
// WG device as UDP. This is the iOS mirror of the Go `tlsrelay.ClientBridge` and
// the desktop Rust bridge (clients/desktop/src-tauri/src/tunnel/tlsbridge.rs).
//
// SECURITY: the TLS layer is OBFUSCATION ONLY. The gateway's cert is self-signed
// and we do NOT verify it (the verify block accepts everything) — trust is
// anchored entirely in the inner WireGuard handshake, so a TLS MITM still can't
// complete the inner WG handshake. Shadowsocks/obfs model: outer hides, inner
// secures.

import Foundation
import Network
import os

final class WgTlsBridge {
    private let log = Logger(subsystem: "com.cumulusvpn.tunnel", category: "WgTlsBridge")
    // Serial queue → all NWConnection/NWListener callbacks and the rx buffer are
    // accessed from one thread, so no extra locking is needed.
    private let queue = DispatchQueue(label: "com.cumulusvpn.tlsbridge")

    private var listener: NWListener?
    private var udp: NWConnection? // the WG device's inbound UDP flow
    private var tls: NWConnection?
    private var rx = [UInt8]() // accumulates the TLS byte stream for de-framing

    // Readiness tracking (both sides must be up before we hand back the port).
    private var tlsReady = false
    private var localPort: UInt16?
    private var didFinish = false

    private static let maxDatagram = 65535

    enum BridgeError: Error {
        case badPort
    }

    /// Bind the local UDP listener and open the TLS connection to the gateway
    /// relay at `relayHost:relayPort`. Calls `onReady(localPort)` once BOTH are
    /// up (the port the WG device must dial), or `onError` on failure. Exactly one
    /// of the two fires.
    func start(
        relayHost: String,
        relayPort: UInt16,
        sni: String,
        onReady: @escaping (UInt16) -> Void,
        onError: @escaping (Error) -> Void
    ) {
        let finishReady: (UInt16) -> Void = { [weak self] port in
            guard let self, !self.didFinish else { return }
            self.didFinish = true
            onReady(port)
        }
        let finishError: (Error) -> Void = { [weak self] err in
            guard let self, !self.didFinish else { return }
            self.didFinish = true
            onError(err)
        }

        // --- TLS connection to the gateway relay (camouflage: accept any cert) ---
        guard let port = NWEndpoint.Port(rawValue: relayPort) else {
            finishError(BridgeError.badPort)
            return
        }
        let tlsOpts = NWProtocolTLS.Options()
        sec_protocol_options_set_verify_block(
            tlsOpts.securityProtocolOptions,
            { _, _, complete in complete(true) },
            queue
        )
        if !sni.isEmpty {
            sni.withCString { sec_protocol_options_set_tls_server_name(tlsOpts.securityProtocolOptions, $0) }
        }
        let tlsConn = NWConnection(
            host: NWEndpoint.Host(relayHost),
            port: port,
            using: NWParameters(tls: tlsOpts)
        )
        tls = tlsConn
        tlsConn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.tlsReady = true
                self.readTLS()
                self.maybeReady(finishReady)
            case let .failed(err):
                self.log.error("wg-tls: relay connection failed: \(String(describing: err), privacy: .public)")
                finishError(err)
            default:
                break
            }
        }

        // --- Local UDP listener the WG device dials (loopback only) ---
        let udpParams = NWParameters.udp
        udpParams.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: "127.0.0.1",
            port: NWEndpoint.Port(rawValue: 0)! // any free port
        )
        let udpListener: NWListener
        do {
            udpListener = try NWListener(using: udpParams)
        } catch {
            finishError(error)
            return
        }
        listener = udpListener
        udpListener.newConnectionHandler = { [weak self] conn in
            guard let self else { return }
            // Exactly one WG source is expected; keep the first, drop any other.
            if self.udp == nil {
                self.udp = conn
                conn.start(queue: self.queue)
                self.readUDP(conn)
            } else {
                conn.cancel()
            }
        }
        udpListener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.localPort = udpListener.port?.rawValue
                self.maybeReady(finishReady)
            case let .failed(err):
                finishError(err)
            default:
                break
            }
        }

        udpListener.start(queue: queue)
        tlsConn.start(queue: queue)
    }

    /// Tear down both sides. Idempotent.
    func stop() {
        listener?.cancel()
        listener = nil
        udp?.cancel()
        udp = nil
        tls?.cancel()
        tls = nil
    }

    // MARK: - private

    private func maybeReady(_ onReady: (UInt16) -> Void) {
        guard tlsReady, let lp = localPort else { return }
        onReady(lp)
    }

    /// UDP (WG device) -> TLS (gateway relay): frame each datagram and forward.
    private func readUDP(_ conn: NWConnection) {
        conn.receiveMessage { [weak self] data, _, _, error in
            guard let self else { return }
            if let data, !data.isEmpty, data.count <= WgTlsBridge.maxDatagram, let tls = self.tls {
                var frame = Data(capacity: 2 + data.count)
                let len = UInt16(data.count).bigEndian
                withUnsafeBytes(of: len) { frame.append(contentsOf: $0) }
                frame.append(data)
                // One send per datagram = one logical write.
                tls.send(content: frame, completion: .contentProcessed { _ in })
            }
            if error == nil {
                self.readUDP(conn) // keep pumping
            }
        }
    }

    /// TLS (gateway relay) -> UDP (WG device): de-frame the stream, deliver each
    /// datagram back to the WG device.
    private func readTLS() {
        tls?.receive(minimumIncompleteLength: 1, maximumLength: WgTlsBridge.maxDatagram) {
            [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                self.rx.append(contentsOf: data)
                self.drainFrames()
            }
            if isComplete || error != nil {
                self.stop()
                return
            }
            self.readTLS()
        }
    }

    /// Pop every complete 2-byte-length-framed datagram out of `rx` and send it to
    /// the WG device.
    private func drainFrames() {
        var consumed = 0
        while rx.count - consumed >= 2 {
            let len = Int(rx[consumed]) << 8 | Int(rx[consumed + 1])
            if rx.count - consumed < 2 + len { break }
            let pkt = Data(rx[(consumed + 2) ..< (consumed + 2 + len)])
            udp?.send(content: pkt, completion: .contentProcessed { _ in })
            consumed += 2 + len
        }
        if consumed > 0 {
            rx.removeFirst(consumed)
        }
    }
}
