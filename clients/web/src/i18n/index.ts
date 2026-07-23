import { en } from './locales/en';
import type { Locale } from './engine';
import type { Message } from './messages';

export {
  SUPPORTED_LOCALES,
  RTL_LOCALES,
  LOCALE_NAMES,
  detectLocale,
  isLocale,
  formatMessage,
  formatRich,
} from './engine';
export type { Locale } from './engine';
export type { Message, Params, PluralMessage, RichHandlers } from './messages';
export { en };

/** Every locale file must provide exactly the keys of `en`. */
export type Catalog = Record<keyof typeof en, Message>;
export type MessageKey = keyof typeof en;

// `en` is the statically-bundled fallback; every other catalog is its own
// Vite chunk, fetched on demand.
const loaders: Record<Locale, () => Promise<Catalog>> = {
  en: () => Promise.resolve(en),
  es: () => import('./locales/es').then((m) => m.es),
  pt: () => import('./locales/pt').then((m) => m.pt),
  fr: () => import('./locales/fr').then((m) => m.fr),
  de: () => import('./locales/de').then((m) => m.de),
  it: () => import('./locales/it').then((m) => m.it),
  nl: () => import('./locales/nl').then((m) => m.nl),
  pl: () => import('./locales/pl').then((m) => m.pl),
  el: () => import('./locales/el').then((m) => m.el),
  uk: () => import('./locales/uk').then((m) => m.uk),
  ru: () => import('./locales/ru').then((m) => m.ru),
  tr: () => import('./locales/tr').then((m) => m.tr),
  sv: () => import('./locales/sv').then((m) => m.sv),
  da: () => import('./locales/da').then((m) => m.da),
  nb: () => import('./locales/nb').then((m) => m.nb),
  fi: () => import('./locales/fi').then((m) => m.fi),
  ar: () => import('./locales/ar').then((m) => m.ar),
  fa: () => import('./locales/fa').then((m) => m.fa),
  sw: () => import('./locales/sw').then((m) => m.sw),
  hi: () => import('./locales/hi').then((m) => m.hi),
  id: () => import('./locales/id').then((m) => m.id),
  th: () => import('./locales/th').then((m) => m.th),
  vi: () => import('./locales/vi').then((m) => m.vi),
  zh: () => import('./locales/zh').then((m) => m.zh),
  ja: () => import('./locales/ja').then((m) => m.ja),
  ko: () => import('./locales/ko').then((m) => m.ko),
};

export function loadCatalog(locale: Locale): Promise<Catalog> {
  return loaders[locale]();
}
