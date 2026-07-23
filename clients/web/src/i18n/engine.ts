import { createElement, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { Message, Params, RichHandlers } from './messages';

export const SUPPORTED_LOCALES = [
  'en',
  'es',
  'pt',
  'fr',
  'de',
  'it',
  'nl',
  'pl',
  'el',
  'uk',
  'ru',
  'tr',
  'sv',
  'da',
  'nb',
  'fi',
  'ar',
  'fa',
  'sw',
  'hi',
  'id',
  'th',
  'vi',
  'zh',
  'ja',
  'ko',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locales rendered right-to-left (`<html dir="rtl">`). */
export const RTL_LOCALES: readonly Locale[] = ['ar', 'fa'];

/** Endonyms for the header switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  el: 'Ελληνικά',
  uk: 'Українська',
  ru: 'Русский',
  tr: 'Türkçe',
  sv: 'Svenska',
  da: 'Dansk',
  nb: 'Norsk',
  fi: 'Suomi',
  ar: 'العربية',
  fa: 'فارسی',
  sw: 'Kiswahili',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
};

// Codes some engines still report: ISO 639-1 changed id/he/yi; Norwegian
// macrolanguage `no` (and Nynorsk) map to our Bokmål catalog.
const LEGACY_ALIASES: Record<string, Locale> = { no: 'nb', nn: 'nb', in: 'id' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

/** First supported match from BCP-47 tags: exact, then prefix, then alias. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    if (isLocale(lower)) {
      return lower;
    }
    const prefix = lower.split('-')[0]!;
    if (isLocale(prefix)) {
      return prefix;
    }
    const alias = LEGACY_ALIASES[prefix];
    if (alias) {
      return alias;
    }
  }
  return 'en';
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

function interpolate(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Resolve a message to a string: plural objects select on `params.n` via
 * Intl.PluralRules, then `{param}` placeholders interpolate. An unknown key
 * degrades to the key itself (never throws in render paths).
 */
export function formatMessage(
  catalog: Record<string, Message>,
  locale: Locale,
  key: string,
  params: Params = {},
): string {
  const msg = catalog[key];
  if (msg === undefined) {
    return key;
  }
  if (typeof msg === 'string') {
    return interpolate(msg, params);
  }
  const n = params.n;
  const category = typeof n === 'number' ? rulesFor(locale).select(n) : 'other';
  return interpolate(msg[category] ?? msg.other, params);
}

// One nesting level: content tags <x>…</x> and void tags <x/>.
const RICH_TAG = /<(\w+)\s*\/>|<(\w+)>(.*?)<\/\2>/gs;

/**
 * Resolve a rich message to ReactNodes: interpolates params first, then
 * substitutes `<tag>label</tag>` / `<tag/>` via handlers. Unhandled tags stay
 * literal. Handler nodes are keyed for React list rendering.
 */
export function formatRich(
  catalog: Record<string, Message>,
  locale: Locale,
  key: string,
  handlers: RichHandlers,
  params: Params = {},
): ReactNode[] {
  const text = formatMessage(catalog, locale, key, params);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  RICH_TAG.lastIndex = 0;
  for (let m = RICH_TAG.exec(text); m !== null; m = RICH_TAG.exec(text)) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    const tag = (m[1] ?? m[2])!;
    const handler = handlers[tag];
    if (handler) {
      const node = handler(m[3] ?? '');
      // Strings need no key; elements get one for React list rendering.
      out.push(typeof node === 'string' ? node : createElement(Fragment, { key: i++ }, node));
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}
