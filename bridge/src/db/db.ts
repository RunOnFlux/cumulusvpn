/**
 * SQLite persistence — single-writer, WAL, lives on the /data volume so
 * idempotency guarantees survive restarts. better-sqlite3 is synchronous,
 * which is exactly right for a single-instance service: every webhook insert
 * is one transaction with no async interleaving.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Apply embedded migrations, versioned via PRAGMA user_version. */
function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
