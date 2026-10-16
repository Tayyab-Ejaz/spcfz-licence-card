// Applies migrations/*.sql in name order, once each, tracked in a `_migrations` table
// (docs/PORT-TO-NODE.md section 3). Each file runs inside one transaction. Forward-only, like before.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteDb } from './sqlite-db.js';

/** The repository's migrations folder, resolved from this file so it works from src/ (tsx) and dist/ alike. */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export function listMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Returns the names of the migrations applied by this call. */
export function applyMigrations(db: SqliteDb, dir: string = MIGRATIONS_DIR): string[] {
  db.raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    (db.raw.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );
  const record = db.raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');
  const applied: string[] = [];
  for (const name of listMigrationFiles(dir)) {
    if (done.has(name)) continue;
    const sql = readFileSync(path.join(dir, name), 'utf8');
    db.raw.transaction(() => {
      db.raw.exec(sql);
      record.run(name, new Date().toISOString());
    })();
    applied.push(name);
  }
  return applied;
}

export function appliedMigrations(db: SqliteDb): string[] {
  const exists = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'").get();
  if (!exists) return [];
  return (db.raw.prepare('SELECT name FROM _migrations ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name);
}
