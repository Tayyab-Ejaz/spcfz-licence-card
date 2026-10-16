import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, appliedMigrations, applyMigrations, listMigrationFiles } from '../../src/platform/migrate.js';
import { SqliteDb } from '../../src/platform/sqlite-db.js';
import { tempDir } from '../env.js';

const dir = tempDir('spcfz-migrate-');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('applyMigrations', () => {
  it('applies files in name order, once each, and records them in _migrations', () => {
    const mdir = path.join(dir, 'm');
    mkdirSync(mdir);
    writeFileSync(path.join(mdir, '0002_second.sql'), 'INSERT INTO a (v) VALUES (2);');
    writeFileSync(path.join(mdir, '0001_first.sql'), 'CREATE TABLE a (v INTEGER);\nINSERT INTO a (v) VALUES (1);');
    writeFileSync(path.join(mdir, 'README.md'), 'not a migration');
    expect(listMigrationFiles(mdir)).toEqual(['0001_first.sql', '0002_second.sql']);

    const db = SqliteDb.open(':memory:');
    expect(appliedMigrations(db)).toEqual([]);
    expect(applyMigrations(db, mdir)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(appliedMigrations(db)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(db.raw.prepare('SELECT v FROM a ORDER BY v').all()).toEqual([{ v: 1 }, { v: 2 }]);

    // Second run: nothing to do.
    expect(applyMigrations(db, mdir)).toEqual([]);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM a').get()).toEqual({ n: 2 });

    // A new file is picked up on its own.
    writeFileSync(path.join(mdir, '0003_third.sql'), 'INSERT INTO a (v) VALUES (3);');
    expect(applyMigrations(db, mdir)).toEqual(['0003_third.sql']);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM a').get()).toEqual({ n: 3 });
    db.close();
  });

  it('rolls a failing migration back and leaves it unrecorded', () => {
    const mdir = path.join(dir, 'bad');
    mkdirSync(mdir);
    writeFileSync(path.join(mdir, '0001_ok.sql'), 'CREATE TABLE b (v INTEGER NOT NULL);');
    writeFileSync(path.join(mdir, '0002_bad.sql'), 'INSERT INTO b (v) VALUES (1);\nINSERT INTO b (v) VALUES (NULL);');
    const db = SqliteDb.open(':memory:');
    expect(() => applyMigrations(db, mdir)).toThrow();
    expect(appliedMigrations(db)).toEqual(['0001_ok.sql']);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM b').get()).toEqual({ n: 0 });
    db.close();
  });

  it("applies the repository's migrations to an empty database", () => {
    const db = SqliteDb.open(':memory:');
    const applied = applyMigrations(db, MIGRATIONS_DIR);
    expect(applied).toEqual(listMigrationFiles(MIGRATIONS_DIR));
    expect(applied).toContain('0001_init.sql');
    expect(applied).toContain('0002_jobs.sql');
    const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ['_migrations', 'cards', 'events', 'jobs', 'metrics', 'settings']) expect(tables).toContain(t);
    expect(db.raw.prepare("SELECT value FROM settings WHERE key = 'retention_days'").get()).toEqual({ value: '730' });
    db.close();
  });
});
