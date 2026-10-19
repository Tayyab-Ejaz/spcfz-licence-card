import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { setSettingRaw } from '../../src/db/cards.js';
import { BACKUP_DIR_NAME, BACKUP_KEEP, backupDatabase, backupFileName } from '../../src/platform/backup.js';
import { SqliteDb } from '../../src/platform/sqlite-db.js';
import { createTestEnv } from '../env.js';

const env = createTestEnv();

describe('backupDatabase', () => {
  it('writes a consistent copy named after the Dubai date and keeps only the newest seven', async () => {
    await setSettingRaw(env.DB, 'marker', 'present');
    const dir = path.join(env.dir, BACKUP_DIR_NAME);

    // Eight older files, oldest first, plus a stranger that must be left alone.
    const olderDays = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    for (const d of olderDays) writeFileSync(path.join(dir, backupFileName(d)), 'old');
    writeFileSync(path.join(dir, 'notes.txt'), 'keep me');

    // 15 Oct 01:15 UTC is 05:15 in Dubai, still 15 Oct.
    const result = await backupDatabase(env.db, env.dir, { now: new Date('2026-10-15T01:15:00Z') });
    expect(result.file).toBe(path.join(dir, backupFileName('2026-10-15')));
    expect(result.removed.sort()).toEqual([backupFileName('2026-10-01'), backupFileName('2026-10-02')]);

    const remaining = readdirSync(dir).filter((n) => n.startsWith('licence-card-')).sort();
    expect(remaining).toHaveLength(BACKUP_KEEP);
    expect(remaining).toContain(backupFileName('2026-10-15'));
    expect(remaining).not.toContain(backupFileName('2026-10-01'));
    expect(existsSync(path.join(dir, 'notes.txt'))).toBe(true);
    expect(readdirSync(dir).some((n) => n.includes('.tmp-'))).toBe(false);

    // The copy is a real database with the same data and the same migrations applied.
    const copy = SqliteDb.open(result.file);
    try {
      expect(copy.raw.prepare("SELECT value FROM settings WHERE key = 'marker'").get()).toEqual({ value: 'present' });
      expect(copy.raw.prepare('SELECT COUNT(*) AS n FROM _migrations').get()).toEqual({ n: 5 });
    } finally {
      copy.close();
    }
  });

  it('overwrites the same day and reports nothing removed when under the cap', async () => {
    await setSettingRaw(env.DB, 'marker', 'second');
    const r = await backupDatabase(env.db, env.dir, { now: new Date('2026-10-15T01:15:00Z') });
    expect(r.removed).toEqual([]);
    const copy = SqliteDb.open(r.file);
    try {
      expect(copy.raw.prepare("SELECT value FROM settings WHERE key = 'marker'").get()).toEqual({ value: 'second' });
    } finally {
      copy.close();
    }
  });
});
