import type { Route } from '../hooks/useRoute';
import type { ThemeMode } from '../hooks/useTheme';

interface HeaderProps {
  readonly route: Route;
  readonly onNavigate: (route: Route) => void;
  readonly themeMode: ThemeMode;
  readonly onToggleTheme: () => void;
}

const THEME_ICON: Record<ThemeMode, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

/** Sticky top bar: brand mark, page nav, Flux badge, theme toggle. */
export function Header({ route, onNavigate, themeMode, onToggleTheme }: HeaderProps) {
  return (
    <header className="top">
      <div className="wrap">
        <a
          className="brand"
          href="#/connect"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('connect');
          }}
        >
          <svg className="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z"
              fill="currentColor"
              opacity=".18"
            />
            <path
              d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z"
              stroke="var(--cyan)"
              strokeWidth="1.7"
            />
            <path d="M14 15l-2.5 4h3l-1 4 4.5-6h-3l1.5-2.6z" fill="var(--cyan)" />
          </svg>
          CumulusVPN
        </a>

        <nav>
          <a
            href="#/connect"
            className={route === 'connect' ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('connect');
            }}
          >
            Connect
          </a>
          <a
            href="#/upgrade"
            className={route === 'upgrade' ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('upgrade');
            }}
          >
            Upgrade
          </a>
        </nav>

        <div className="top-right">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Theme: ${themeMode}`}
            title={`Theme: ${themeMode}`}
          >
            {THEME_ICON[themeMode]}
          </button>
          <span className="badge-flux">Powered by RunOnFlux</span>
        </div>
      </div>
    </header>
  );
}
