// D1-shape fidelity of the SQLite adapter: the exact behaviours src/db relies on.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDb } from '../../src/platform/sqlite-db.js';

const db = SqliteDb.open(':memory:');

beforeEach(async () => {
  await db.exec('DROP TABLE IF EXISTS t; CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, n INTEGER);');
});
afterAll(() => db.close());

describe('SqliteDb (D1 shape)', () => {
  it('first() is null with no row, the row otherwise, and a column by name', async () => {
    expect(await db.prepare('SELECT * FROM t WHERE id = ?1').bind(1).first()).toBeNull();
    await db.prepare('INSERT INTO t (id, name, n) VALUES (?1, ?2, ?3)').bind(1, 'one', 10).run();
    expect(await db.prepare('SELECT * FROM t WHERE id = ?1').bind(1).first<{ id: number; name: string; n: number }>()).toEqual({ id: 1, name: 'one', n: 10 });
    expect(await db.prepare('SELECT name FROM t WHERE id = ?1').bind(1).first<string>('name')).toBe('one');
    expect(await db.prepare('SELECT COUNT(*) AS c FROM t').first<number>('c')).toBe(1);
    await expect(db.prepare('SELECT name FROM t WHERE id = ?1').bind(1).first('missing')).rejects.toThrow(/missing/);
    // first() on a statement that returns no rows at all runs it and answers null.
    expect(await db.prepare('UPDATE t SET n = 11 WHERE id = ?1').bind(1).first()).toBeNull();
    expect(await db.prepare('SELECT n FROM t WHERE id = 1').first<number>('n')).toBe(11);
  });

  it('all() answers { results } and run() answers meta.changes', async () => {
    const empty = await db.prepare('SELECT * FROM t').all();
    expect(empty.results).toEqual([]);
    expect(empty.success).toBe(true);
    const ins = await db.prepare("INSERT INTO t (name) VALUES ('a'), ('b'), ('c')").run();
    expect(ins.meta.changes).toBe(3);
    expect(ins.meta.last_row_id).toBe(3);
    expect(ins.results).toEqual([]);
    const all = await db.prepare('SELECT name FROM t ORDER BY id').all<{ name: string }>();
    expect(all.results).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    const upd = await db.prepare("UPDATE t SET n = 1 WHERE name IN ('a', 'b')").run();
    expect(upd.meta.changes).toBe(2);
    const none = await db.prepare("DELETE FROM t WHERE name = 'zzz'").run();
    expect(none.meta.changes).toBe(0);
    // run() on a SELECT returns the rows, as D1 does.
    const viaRun = await db.prepare('SELECT COUNT(*) AS c FROM t').run<{ c: number }>();
    expect(viaRun.results).toEqual([{ c: 3 }]);
  });

  it('binds ?NNN positional parameters, including one used twice', async () => {
    await db.prepare('INSERT INTO t (id, name, n) VALUES (?1, ?2, ?1)').bind(7, 'seven').run();
    expect(await db.prepare('SELECT * FROM t WHERE id = 7').first()).toEqual({ id: 7, name: 'seven', n: 7 });
    await db.prepare('INSERT INTO t (id, name, n) VALUES (?3, ?1, ?2)').bind('one-two-three', 123, 9).run();
    expect(await db.prepare('SELECT * FROM t WHERE id = 9').first()).toEqual({ id: 9, name: 'one-two-three', n: 123 });
  });

  it('converts booleans to integers and rejects undefined', async () => {
    await db.prepare('INSERT INTO t (id, name, n) VALUES (?1, ?2, ?3)').bind(1, 'bool', true).run();
    expect(await db.prepare('SELECT n FROM t WHERE id = 1').first<number>('n')).toBe(1);
    expect(() => db.prepare('INSERT INTO t (id, name) VALUES (?1, ?2)').bind(2, undefined)).toThrow(/undefined/);
    await db.prepare('INSERT INTO t (id, name, n) VALUES (?1, ?2, ?3)').bind(3, 'null', null).run();
    expect(await db.prepare('SELECT n FROM t WHERE id = 3').first<number | null>('n')).toBeNull();
  });

  it('batch() runs in order inside one transaction, answers in order, and rolls back on failure', async () => {
    const [a, b, c] = await db.batch<{ c: number }>([
      db.prepare("INSERT INTO t (name) VALUES ('x')"),
      db.prepare("INSERT INTO t (name) VALUES ('y')"),
      db.prepare('SELECT COUNT(*) AS c FROM t'),
    ]);
    expect(a?.meta.changes).toBe(1);
    expect(b?.meta.changes).toBe(1);
    expect(c?.results).toEqual([{ c: 2 }]);

    await expect(
      db.batch([
        db.prepare("INSERT INTO t (name) VALUES ('z')"),
        db.prepare('INSERT INTO t (name) VALUES (?1)').bind(null), // NOT NULL violation
      ]),
    ).rejects.toThrow();
    // The first insert of the failed batch was rolled back.
    expect(await db.prepare('SELECT COUNT(*) AS c FROM t').first<number>('c')).toBe(2);
  });

  it('exec() runs several statements at once and counts them', async () => {
    const r = await db.exec(`
      -- a comment
      INSERT INTO t (name) VALUES ('p');
      INSERT INTO t (name) VALUES ('q');
      UPDATE t SET n = 5;
    `);
    expect(r.count).toBe(3);
    expect(await db.prepare('SELECT COUNT(*) AS c FROM t WHERE n = 5').first<number>('c')).toBe(2);
  });

  it('bind() returns a new statement; the original stays unbound', async () => {
    const base = db.prepare('SELECT ?1 AS v');
    const one = base.bind(1);
    const two = base.bind(2);
    expect(await one.first<number>('v')).toBe(1);
    expect(await two.first<number>('v')).toBe(2);
  });

  it('opens a file in WAL mode', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'spcfz-sqlite-'));
    const file = SqliteDb.open(path.join(dir, 'x.sqlite'));
    try {
      expect(file.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      file.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
