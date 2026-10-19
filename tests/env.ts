// A fresh Env for one test file (docs/PORT-TO-NODE.md section 6): SQLite in a temp folder with the
// migrations applied. The temp folder is removed when the file's tests finish.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { MIGRATIONS_DIR, applyMigrations } from '../src/platform/migrate.js';
import { SqliteDb } from '../src/platform/sqlite-db.js';
import type { Env } from '../src/types.js';

/** The same values the Workers test environment used to provide. */
export const TEST_VARS = {
  BASE_URL: 'https://licensed.test',
  ERP_IP_ALLOWLIST: '203.0.113.10,198.51.100.0/24',
  FIELD_MAP: '{}',
  GTM_CONTAINER: '',
  WEBHOOK_SECRET_CURRENT: 'test-production-secret-current',
  WEBHOOK_SECRET_PREVIOUS: 'test-production-secret-previous',
  TEST_SECRET_CURRENT: 'test-test-secret-current',
  TEST_SECRET_PREVIOUS: '',
  ADMIN_LOGIN_KEY: 'test-login-key-0123456789abcdef',
} as const;

export interface TestEnv extends Env {
  readonly dir: string;
  readonly db: SqliteDb;
  close(): void;
}

export function tempDir(prefix = 'spcfz-licence-card-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function createTestEnv(overrides: Partial<Env> = {}): TestEnv {
  const dir = tempDir();
  const db = SqliteDb.open(path.join(dir, 'licence-card.sqlite'));
  applyMigrations(db, MIGRATIONS_DIR);
  const env: TestEnv = {
    DB: db,
    DATA_DIR: dir,
    PORT: 0,
    TRUST_PROXY: 'off',
    ...TEST_VARS,
    ...overrides,
    dir,
    db,
    close() {
      try {
        db.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
  afterAll(() => env.close());
  return env;
}
