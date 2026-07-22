import type { Route } from '../hooks/useRoute';
import type { ThemeMode } from '../hooks/useTheme';
import { useI18n } from '../hooks/useLocale';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../i18n';
import type { Locale, MessageKey } from '../i18n';
import { PoweredByFlux } from './PoweredByFlux';

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

const THEME_MODE_KEY: Record<ThemeMode, MessageKey> = {
  system: 'header_theme_system',
  light: 'header_theme_light',
  dark: 'header_theme_dark',
};

/** Sticky top bar: brand mark, page nav, language picker, Flux badge, theme toggle. */
export function Header({ route, onNavigate, themeMode, onToggleTheme }: HeaderProps) {
  const { t, locale, setLocale } = useI18n();
  const themeTitle = t('header_theme_label', { mode: t(THEME_MODE_KEY[themeMode]) });
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
            {t('header_nav_connect')}
          </a>
          <a
            href="#/upgrade"
            className={route === 'upgrade' ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('upgrade');
            }}
          >
            {t('header_nav_upgrade')}
          </a>
        </nav>

        <div className="top-right">
          <select
            className="lang-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            aria-label={t('header_language_label')}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={themeTitle}
            title={themeTitle}
          >
            {THEME_ICON[themeMode]}
          </button>
          <PoweredByFlux height={16} />
        </div>
      </div>
    </header>
  );
}
