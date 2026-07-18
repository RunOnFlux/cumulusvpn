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
import { UPGRADE_URL } from './lib/directory.js';

/** Which hop the country picker is currently editing, or closed. */
type PickerTarget = 'entry' | 'exit' | null;

/**
 * Open the upgrade/payment page. Desktop has no store constraints, so it may
 * link out (or embed) the pay-to-address flow freely.
 *
 * // POC: uses `window.open`; a shipped Tauri build opens it in the system
 * browser via `@tauri-apps/plugin-opener`, or hosts it in a dedicated embedded
 * WebviewWindow so the FLUX QR / wallet deep link render in-app.
 */
function openUpgrade(): void {
  try {
    window.open(UPGRADE_URL, '_blank', 'noopener');
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

      <ConnectOrb
        phase={conn.phase}
        onToggle={connected || busy ? conn.disconnect : conn.connect}
      />

      {connected && conn.connectedSince && <SessionTimer since={conn.connectedSince} />}

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

      <div className="spacer" />

      <TierBadge entitlement={conn.entitlement} onUpgrade={openUpgrade} />

      {connected || busy ? (
        <button className="btn-disc" onClick={conn.disconnect}>
          Disconnect
        </button>
      ) : (
        <button
          className="btn-primary"
          onClick={conn.connect}
          disabled={!selected || conn.phase === 'loading' || (conn.multihop && !conn.exit)}
        >
          {conn.phase === 'loading'
            ? 'Loading…'
            : conn.multihop
              ? 'Connect · multi-hop'
              : 'Connect'}
        </button>
      )}

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
          onAutoConnect={conn.setAutoConnect}
          onKillSwitch={conn.setKillSwitch}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
