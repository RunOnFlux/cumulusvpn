import { useState } from 'react';
import type { JSX } from 'react';
import { useConnection } from './hooks/useConnection.js';
import { ConnectOrb } from './components/ConnectOrb.js';
import { CountryPicker } from './components/CountryPicker.js';
import { MultihopPanel } from './components/MultihopPanel.js';
import { TierBadge } from './components/TierBadge.js';
import { StatBar } from './components/StatBar.js';
import { SessionTimer } from './components/SessionTimer.js';
import { Settings } from './components/Settings.js';
import { helperReady, openHelperSettings } from './lib/tauri.js';
import { desktopOs, setupBanner } from './lib/setup.js';
import { upgradeUrl } from './lib/directory.js';
import { loadOrCreateKeypair } from './lib/storage.js';
import { paymentCode } from '@cumulusvpn/core';

/** Which hop the country picker is currently editing, or closed. */
type PickerTarget = 'entry' | 'exit' | null;

/**
 * Open the upgrade/payment page with THIS app's payment code (`?code=`), so
 * a payment made in the browser — FLUX or card — credits the desktop key
 * rather than the browser's own keypair.
 *
 * // POC: uses `window.open`; a shipped Tauri build opens it in the system
 * browser via `@tauri-apps/plugin-opener`, or hosts it in a dedicated embedded
 * WebviewWindow so the FLUX QR / wallet deep link render in-app.
 */
function openUpgrade(): void {
  let code = '';
  try {
    code = paymentCode(loadOrCreateKeypair().publicKey);
  } catch {
    /* fall back to the un-prefilled page */
  }
  try {
    window.open(upgradeUrl(code), '_blank', 'noopener');
  } catch {
    /* no-op in headless contexts */
  }
}

function pingClass(load: number): string {
  if (load < 0.4) {
    return 'ping';
  }
  if (load < 0.75) {
    return 'ping mid';
  }
  return 'ping far';
}

export function App(): JSX.Element {
  const conn = useConnection();
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [showSettings, setShowSettings] = useState(false);

  const connected = conn.phase === 'connected';
  const busy = conn.phase === 'connecting';
  const locked = connected || busy;
  const ready = helperReady(conn.helperState);
  const banner = setupBanner(conn.helperState, desktopOs(navigator.userAgent));
  const { selected } = conn;

  return (
    <div className="shell">
      <div className="titlebar">
        <div className="brand">
          <span className="dot" />
          CumulusVPN
        </div>
        <button className="gear" onClick={() => setShowSettings(true)} aria-label="Settings">
          ⚙
        </button>
      </div>

      {/* The app holds no privileges: the tunnel belongs to the helper daemon
          (LaunchDaemon / systemd service / Windows service). Until it is there
          and serves this app Connect cannot work, so say that up front with
          the fix attached, rather than letting the user press Connect and meet
          a transport error. An elevated app running the tunnel itself gets a
          non-blocking note instead (lib/setup.ts). */}
      {banner && (
        <div className={banner.blocking ? 'setup' : 'setup info'} role="status">
          <div className="setup-text">{banner.text}</div>
          {banner.openSettings && (
            <button className="setup-btn" onClick={() => void openHelperSettings()}>
              Open Settings
            </button>
          )}
        </div>
      )}

      <div className="shell-body scroll-y">
        <ConnectOrb
          phase={conn.phase}
          onToggle={connected || busy ? conn.disconnect : conn.connect}
        />

        {connected && conn.connectedSince && <SessionTimer since={conn.connectedSince} />}
        {/* docs/17 §8: with split rules active, the user must never be unsure
            whether they are fully protected — say so persistently. */}
        {connected && conn.splitActive && <div className="split-on">Split tunneling on</div>}
        {/* The tunnel is up but the system resolver is not the tunnel's: never
            let that read as fully protected. */}
        {conn.dnsWarning && (
          <div className="dns-warn" role="alert">
            {conn.dnsWarning}
          </div>
        )}

        <button
          className="loc-btn"
          onClick={() => setPicker('entry')}
          disabled={conn.countries.length === 0}
        >
          {conn.multihop && <span className="hop-tag entry">ENTRY</span>}
          <span className="flag">{selected?.flag ?? '🌐'}</span>
          <span className="meta">
            <span className="n">{selected?.name ?? 'No locations'}</span>
            <span className="s">
              {selected
                ? `${selected.city || selected.code} · ${selected.gatewayIp}`
                : 'discovering fleet…'}
            </span>
          </span>
          {selected && <span className={pingClass(selected.load)} />}
          <span className="chev">›</span>
        </button>

        <MultihopPanel
          multihop={conn.multihop}
          onToggle={conn.setMultihop}
          routeStyle={conn.routeStyle}
          onRouteStyle={conn.setRouteStyle}
          exit={conn.exit}
          onOpenExit={() => setPicker('exit')}
          locked={locked}
        />

        <button
          type="button"
          className="ks-row"
          role="switch"
          aria-checked={conn.killSwitch}
          onClick={() => !locked && conn.setKillSwitch(!conn.killSwitch)}
          disabled={locked}
        >
          <span className="ks-icon">🛡️</span>
          <span className="ks-meta">
            <span className="ks-title">Kill switch</span>
            <span className="ks-sub">
              {conn.killSwitch
                ? 'Blocks all traffic if the VPN drops'
                : 'Off — traffic can leak if the VPN drops'}
            </span>
          </span>
          <span className={`ks-track ${conn.killSwitch ? 'on' : ''}`}>
            <span className="ks-thumb" />
          </span>
        </button>

        {connected && <StatBar tunnel={conn.tunnel} />}

        {conn.error && <div className="err">{conn.error}</div>}
      </div>

      <div className="shell-foot">
        <TierBadge entitlement={conn.entitlement} onUpgrade={openUpgrade} />

        {connected || busy ? (
          <button className="btn-disc" onClick={conn.disconnect}>
            Disconnect
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={conn.connect}
            disabled={
              !selected ||
              !ready ||
              conn.phase === 'loading' ||
              (conn.multihop && conn.routeStyle === 'multihop-cross-jurisdiction' && !conn.exit)
            }
          >
            {conn.phase === 'loading'
              ? 'Loading…'
              : conn.multihop
                ? 'Connect · multi-hop'
                : 'Connect'}
          </button>
        )}
      </div>

      {picker !== null && (
        <CountryPicker
          countries={conn.countries}
          selectedCode={picker === 'exit' ? (conn.exit?.code ?? null) : (selected?.code ?? null)}
          onPick={picker === 'exit' ? conn.selectExit : conn.select}
          onClose={() => setPicker(null)}
          onRefresh={conn.refresh}
          favorites={conn.favorites}
          onToggleFavorite={conn.toggleFavorite}
        />
      )}

      {showSettings && (
        <Settings
          autoConnect={conn.autoConnect}
          killSwitch={conn.killSwitch}
          stealth={conn.transportMode === 'stealth'}
          tier={conn.entitlement?.tier ?? 'free'}
          onAutoConnect={conn.setAutoConnect}
          onKillSwitch={conn.setKillSwitch}
          onStealth={(v) => conn.setTransportMode(v ? 'stealth' : 'auto')}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
