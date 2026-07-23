import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LOCALE_STORAGE_KEY } from '../config';
import {
  detectLocale,
  en,
  formatMessage,
  formatRich,
  isLocale,
  loadCatalog,
  RTL_LOCALES,
} from '../i18n';
import type { Catalog, Locale, MessageKey, Params, RichHandlers } from '../i18n';

export interface I18n {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: (key: MessageKey, params?: Params) => string;
  readonly rich: (key: MessageKey, handlers: RichHandlers, params?: Params) => ReactNode[];
}

const I18nContext = createContext<I18n | null>(null);

function initialLocaleFor(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures (private mode).
  }
  return detectLocale(
    (navigator.languages ?? [navigator.language]).filter((l): l is string => typeof l === 'string'),
  );
}

/**
 * Locale control mirroring useTheme: detected from the browser by default, an
 * explicit choice persisted in localStorage. `en` renders immediately; other
 * catalogs swap in when their lazy chunk lands (English until then — a failed
 * load degrades to English, never crashes).
 */
export function LocaleProvider({
  children,
  initialLocale,
}: {
  readonly children: ReactNode;
  readonly initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? initialLocaleFor());
  const [catalog, setCatalog] = useState<Catalog>(en);

  useEffect(() => {
    let cancelled = false;
    if (locale === 'en') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCatalog(en);
    } else {
      loadCatalog(locale)
        .then((c) => {
          if (!cancelled) {
            setCatalog(c);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCatalog(en);
          }
        });
    }
    document.documentElement.lang = locale;
    if (RTL_LOCALES.includes(locale)) {
      document.documentElement.dir = 'rtl';
    } else {
      document.documentElement.removeAttribute('dir');
    }
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    document.title = formatMessage(catalog, locale, 'app_title');
  }, [catalog, locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode).
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => formatMessage(catalog, locale, key, params),
      rich: (key, handlers, params) => formatRich(catalog, locale, key, handlers, params),
    }),
    [locale, catalog, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside <LocaleProvider>');
  }
  return ctx;
}
