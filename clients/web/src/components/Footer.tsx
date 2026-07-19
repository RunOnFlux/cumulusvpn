import { PoweredByFlux } from './PoweredByFlux';

/** Page footer mirroring the mockup's quiet, monospaced credit line. */
export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <span>CumulusVPN — Decentralized VPN on Flux Cloud · vpn.cumulusvpn.com</span>
        <span className="footer-credit">
          <span className="mono">Beta rail · no account · no logs</span>
          <PoweredByFlux height={16} />
        </span>
      </div>
    </footer>
  );
}
