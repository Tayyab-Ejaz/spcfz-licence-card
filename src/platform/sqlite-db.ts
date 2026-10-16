// D1-shaped database over better-sqlite3 (docs/PORT-TO-NODE.md section 2). The application code in
// src/db was written against D1's prepare/bind/first/all/run, batch and exec; this adapter gives those
// the same results and the same edge cases (first() is null with no row, all().results, run().meta.changes,
// batch runs in one transaction and answers in order) on a local SQLite file in WAL mode.
//
// better-sqlite3 is synchronous, so every call completes before the next statement can start; the
// async signatures exist only to match D1. `?1`-style placeholders are bound as numbered keys (see bindArgs).
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3';
import type { D1Database, D1ExecResult, D1Meta, D1PreparedStatement, D1Result } from '../types.js';

const STATEMENT_CACHE_MAX = 256;

/**
 * better-sqlite3 treats `?NNN` placeholders as named parameters, so they must be bound with an object
 * keyed by number ({ 1: a, 2: b }); spreading positional values fails with "Too many parameter values".
 * D1, and therefore every statement in src/db, uses `?NNN`. Anonymous `?` statements still bind positionally.
 */
const NUMBERED_PARAM = /\?(\d+)/g;

function bindArgs(sql: string, params: readonly unknown[]): unknown[] {
  if (params.length === 0) return [];
  const used = new Set<number>();
  for (const m of sql.matchAll(NUMBERED_PARAM)) used.add(Number(m[1]));
  if (used.size === 0) return [...params];
  const named: Record<number, unknown> = {};
  for (const n of used) {
    if (n < 1 || n > params.length) throw new RangeError(`D1_ERROR: placeholder ?${n} has no bound value`);
    named[n] = params[n - 1];
  }
  return [named];
}

function coerceParam(value: unknown, index: number): unknown {
  if (value === undefined) throw new TypeError(`D1_TYPE_ERROR: parameter ${index + 1} is undefined (use null)`);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Date) return value.toISOString();
  return value;
}

function meta(start: number, changes: number, lastRowId: number | bigint, rowsRead: number): D1Meta {
  return {
    changes,
    last_row_id: Number(lastRowId),
    duration: performance.now() - start,
    rows_read: rowsRead,
    rows_written: changes,
  };
}

/** Number of top-level statements in a script, for exec()'s `count`. Good enough for migration files. */
function countStatements(sql: string): number {
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return stripped.split(';').filter((s) => s.trim().length > 0).length;
}

class SqlitePreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly db: SqliteDb,
    private readonly sql: string,
    private readonly params: readonly unknown[],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqlitePreparedStatement(this.db, this.sql, values.map(coerceParam));
  }

  /** Synchronous core shared by all/run and by batch(). SELECTs return rows; everything else returns meta only. */
  execute<T>(): D1Result<T> {
    const start = performance.now();
    const stmt = this.db.statement(this.sql);
    const args = bindArgs(this.sql, this.params);
    if (stmt.reader) {
      const results = stmt.all(...args) as T[];
      return { results, success: true, meta: meta(start, 0, 0, results.length) };
    }
    const info = stmt.run(...args);
    return { results: [], success: true, meta: meta(start, info.changes, info.lastInsertRowid, 0) };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T = unknown>(column: string): Promise<T | null>;
  async first(column?: string): Promise<unknown> {
    const stmt = this.db.statement(this.sql);
    const args = bindArgs(this.sql, this.params);
    if (!stmt.reader) {
      stmt.run(...args);
      return null;
    }
    const row = stmt.get(...args) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    if (column === undefined) return row;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: no column named ${column}`);
    return row[column] ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }
}

export class SqliteDb implements D1Database {
  private readonly cache = new Map<string, Statement>();

  constructor(readonly raw: BetterSqliteDatabase) {}

  /** Open (creating if needed) a database file in WAL mode with a busy timeout, or ':memory:'. */
  static open(file: string): SqliteDb {
    const raw = new Database(file);
    if (file !== ':memory:') raw.pragma('journal_mode = WAL');
    raw.pragma('synchronous = NORMAL');
    raw.pragma('busy_timeout = 5000');
    raw.pragma('foreign_keys = ON');
    return new SqliteDb(raw);
  }

  /** Prepared statements are cached per SQL text; SQLite re-prepares them itself after a schema change. */
  statement(sql: string): Statement {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      if (this.cache.size >= STATEMENT_CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqlitePreparedStatement(this, sql, []);
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const run = this.raw.transaction((): D1Result<T>[] =>
      statements.map((s) => {
        if (!(s instanceof SqlitePreparedStatement)) throw new TypeError('batch: statements must come from this database');
        return s.execute<T>();
      }),
    );
    return run();
  }

  async exec(sql: string): Promise<D1ExecResult> {
    const start = performance.now();
    this.raw.exec(sql);
    return { count: countStatements(sql), duration: performance.now() - start };
  }

  /** SQLite online backup to `destination` (overwritten). Safe while the service is running. */
  async backup(destination: string): Promise<void> {
    await this.raw.backup(destination);
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

export function openDatabase(file: string): SqliteDb {
  return SqliteDb.open(file);
}
