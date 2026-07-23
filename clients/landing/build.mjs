#!/usr/bin/env node
// Zero-dependency generator for the localized landing site.
// Usage:  node build.mjs            regenerate public/ from src/
//         node build.mjs --check    verify committed output (extended in later tasks)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)); // clients/landing
const SRC = join(ROOT, 'src');
const PUB = join(ROOT, 'public');
const ORIGIN = 'https://cumulusvpn.com';

// Canonical registry — array order is switcher order. `og` is og:locale.
export const LOCALES = [
  { code: 'en', endonym: 'English', og: 'en_US' },
  { code: 'es', endonym: 'Español', og: 'es_ES' },
  { code: 'pt', endonym: 'Português', og: 'pt_BR' },
  { code: 'fr', endonym: 'Français', og: 'fr_FR' },
  { code: 'de', endonym: 'Deutsch', og: 'de_DE' },
  { code: 'it', endonym: 'Italiano', og: 'it_IT' },
  { code: 'nl', endonym: 'Nederlands', og: 'nl_NL' },
  { code: 'pl', endonym: 'Polski', og: 'pl_PL' },
  { code: 'el', endonym: 'Ελληνικά', og: 'el_GR' },
  { code: 'uk', endonym: 'Українська', og: 'uk_UA' },
  { code: 'ru', endonym: 'Русский', og: 'ru_RU' },
  { code: 'tr', endonym: 'Türkçe', og: 'tr_TR' },
  { code: 'sv', endonym: 'Svenska', og: 'sv_SE' },
  { code: 'da', endonym: 'Dansk', og: 'da_DK' },
  { code: 'nb', endonym: 'Norsk', og: 'nb_NO' },
  { code: 'fi', endonym: 'Suomi', og: 'fi_FI' },
  { code: 'ar', endonym: 'العربية', og: 'ar_AR', rtl: true },
  { code: 'fa', endonym: 'فارسی', og: 'fa_IR', rtl: true },
  { code: 'sw', endonym: 'Kiswahili', og: 'sw_KE' },
  { code: 'hi', endonym: 'हिन्दी', og: 'hi_IN' },
  { code: 'id', endonym: 'Bahasa Indonesia', og: 'id_ID' },
  { code: 'th', endonym: 'ไทย', og: 'th_TH' },
  { code: 'vi', endonym: 'Tiếng Việt', og: 'vi_VN' },
  { code: 'zh', endonym: '中文', og: 'zh_CN' },
  { code: 'ja', endonym: '日本語', og: 'ja_JP' },
  { code: 'ko', endonym: '한국어', og: 'ko_KR' },
];

export const PAGES = [
  { slug: '', template: 'index.html', out: 'index.html' },
  { slug: 'support', template: 'support.html', out: 'support.html' },
  { slug: 'privacy', template: 'privacy.html', out: 'privacy.html' },
];

export const localeBase = (code) => (code === 'en' ? '/' : `/${code}/`);
export const pagePath = (code, slug) => localeBase(code) + slug;
export const pageUrl = (code, slug) => ORIGIN + pagePath(code, slug);

export function flatten(catalog) {
  const out = new Map();
  for (const [group, entries] of Object.entries(catalog)) {
    for (const [key, value] of Object.entries(entries)) out.set(`${group}.${key}`, value);
  }
  return out;
}

function loadCatalogs() {
  const map = new Map();
  for (const l of LOCALES) {
    const file = join(SRC, 'locales', `${l.code}.json`);
    if (existsSync(file)) map.set(l.code, flatten(JSON.parse(readFileSync(file, 'utf8'))));
  }
  return map;
}

export function render(templateText, locale, page, catalog, activeLocales) {
  let html = templateText.replace(/\{\{([a-z0-9_.]+)\}\}/g, (_, path) => {
    const val = catalog.get(path);
    if (typeof val !== 'string') throw new Error(`${locale.code}/${page.template}: missing catalog key ${path}`);
    return val;
  });
  const tokens = {
    '%HOME%': localeBase(locale.code),
    '%SUPPORT%': localeBase(locale.code) + 'support',
    '%PRIVACY%': localeBase(locale.code) + 'privacy',
  };
  html = html.replace(/%[A-Z_]{2,}%/g, (m) => {
    if (m in tokens) return tokens[m];
    throw new Error(`${locale.code}/${page.template}: unknown token ${m}`);
  });
  return html;
}

export function buildAll() {
  const catalogs = loadCatalogs();
  const active = LOCALES.filter((l) => catalogs.has(l.code));
  const out = new Map(); // relPath under public/ -> content
  for (const page of PAGES) {
    if (!existsSync(join(SRC, 'templates', page.template))) continue;
    const templateText = readFileSync(join(SRC, 'templates', page.template), 'utf8');
    for (const locale of active) {
      const rel = locale.code === 'en' ? page.out : `${locale.code}/${page.out}`;
      out.set(rel, render(templateText, locale, page, catalogs.get(locale.code), active));
    }
  }
  return { out, active, catalogs };
}

function write() {
  const { out, active } = buildAll();
  for (const [rel, content] of out) {
    const file = join(PUB, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  console.log(`landing i18n: wrote ${out.size} pages for ${active.length} locale(s)`);
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  console.error('landing i18n: --check arrives in a later task');
  process.exit(1);
} else {
  write();
}
