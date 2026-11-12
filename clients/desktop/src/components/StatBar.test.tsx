import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatBar } from './StatBar';
import type { TunnelStatus } from '../lib/tauri';

function status(overrides: Partial<TunnelStatus>): TunnelStatus {
  return {
    state: 'up',
    endpoint: '198.51.100.2:51820',
    assignedIp: '10.8.0.2',
    country: 'DE',
    rxBytes: 0,
    txBytes: 0,
    lastHandshake: null,
    dnsWarning: null,
    error: null,
    ...overrides,
  };
}

describe('<StatBar />', () => {
  it('renders the three stat labels', () => {
    render(<StatBar tunnel={status({})} speed={{ down: 0, up: 0 }} pingMs={null} />);
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Ping')).toBeInTheDocument();
  });

  it('shows live speed, session totals and ping', () => {
    render(
      <StatBar
        tunnel={status({ rxBytes: 5 * 1024 * 1024, txBytes: 512 })}
        speed={{ down: 2.5 * 1024 * 1024, up: 300 }}
        pingMs={42}
      />,
    );
    expect(screen.getByText('2.5 MB/s')).toBeInTheDocument();
    expect(screen.getByText('300 B/s')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB total')).toBeInTheDocument();
    expect(screen.getByText('512 B total')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
  });

  it('shows a dash until the first ping lands', () => {
    render(<StatBar tunnel={status({})} speed={{ down: 0, up: 0 }} pingMs={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
