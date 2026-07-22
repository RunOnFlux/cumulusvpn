import type { Catalog } from '../index';
import { en } from './en';

// UNTRANSLATED STUB — English copy. Replaced by its translation task
// (Tasks 7–9); the sentinel test in catalogs.test.ts fails on any leftover.
export const id: Catalog = {
  ...en,
  // id has no 'one' plural category; keep the stub sweep-valid.
  countries_nodes: { other: en.countries_nodes.other },
  connect_live_nodes: { other: en.connect_live_nodes.other },
};
