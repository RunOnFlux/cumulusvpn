import type { Route } from '../hooks/useRoute';
import type { ThemeMode } from '../hooks/useTheme';
import { useI18n } from '../hooks/useLocale';
import { isLocale, LOCALE_NAMES, SUPPORTED_LOCALES } from '../i18n';
import type { MessageKey } from '../i18n';
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
          <svg className="mark" viewBox="259 240 560 560" aria-hidden="true">
            <defs>
              <linearGradient
                id="cvpn-hdr-cloud"
                x1="300"
                y1="360"
                x2="620"
                y2="700"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="#7DF3EB" />
                <stop offset=".5" stopColor="#34E4DA" />
                <stop offset="1" stopColor="#0FB9AE" />
              </linearGradient>
              <linearGradient
                id="cvpn-hdr-bolt"
                x1="470"
                y1="380"
                x2="560"
                y2="660"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="#FFFFFF" />
                <stop offset="1" stopColor="#E8FFFC" />
              </linearGradient>
            </defs>
            <g fill="url(#cvpn-hdr-cloud)">
              <circle cx="392" cy="556" r="104" />
              <circle cx="512" cy="486" r="146" />
              <circle cx="642" cy="532" r="118" />
              <circle cx="712" cy="588" r="78" />
              <rect x="326" y="556" width="452" height="132" rx="66" />
            </g>
            <path
              d="M566 372 L430 566 L512 566 L470 700 L620 512 L534 512 Z"
              fill="url(#cvpn-hdr-bolt)"
            />
          </svg>
          <span className="brand-name">CumulusVPN</span>
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
            onChange={(e) => {
              if (isLocale(e.target.value)) setLocale(e.target.value);
            }}
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
