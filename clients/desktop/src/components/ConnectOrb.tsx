import type { JSX } from 'react';
import type { Phase } from '../hooks/useConnection.js';

interface Props {
  readonly phase: Phase;
  readonly onToggle: () => void;
}

const LABEL: Record<Phase, string> = {
  loading: 'Loading',
  idle: 'Not connected',
  connecting: 'Connecting',
  connected: 'Protected',
  error: 'Error',
};

/** The big central connect state — cyan glow + pulse ring when protected. */
export function ConnectOrb({ phase, onToggle }: Props): JSX.Element {
  const mode = phase === 'connected' ? 'on' : phase === 'connecting' ? 'connecting' : 'off';
  const glyph = phase === 'connected' ? '🛡️' : phase === 'connecting' ? '⋯' : '⏻';
  return (
    <div className="orb-wrap">
      <button
        className={`orb ${mode}`}
        onClick={onToggle}
        disabled={phase === 'loading' || phase === 'connecting'}
        aria-label={LABEL[phase]}
      >
        <span className="ring" />
        <span className="core">
          <span className="glyph">{glyph}</span>
          <span className="state">{LABEL[phase]}</span>
        </span>
      </button>
    </div>
  );
}
