// Daily SQLite online backup into DATA_DIR/backups (docs/PORT-TO-NODE.md section 7). The host has no
// backup routine of its own, so the service keeps the last seven days of its database beside the live file.
// Images are not copied: they are regenerable from the database through the admin's Re-render screen.
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { todayInDubai } from '../util/time.js';
import type { SqliteDb } from './sqlite-db.js';

export const BACKUP_DIR_NAME = 'backups';
export const BACKUP_KEEP = 7;
const BACKUP_RE = /^licence-card-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export function backupFileName(day: string): string {
  return `licence-card-${day}.sqlite`;
}

export interface BackupResult {
  file: string;
  removed: string[];
}

/** Writes `backups/licence-card-YYYY-MM-DD.sqlite` (Dubai date; same day overwrites) and keeps the newest `keep`. */
export async function backupDatabase(db: SqliteDb, dataDir: string, options: { now?: Date; keep?: number } = {}): Promise<BackupResult> {
  const dir = path.join(dataDir, BACKUP_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, backupFileName(todayInDubai(options.now ?? new Date())));
  const tmp = `${target}.tmp-${randomUUID()}`;
  try {
    await db.backup(tmp);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }

  const keep = options.keep ?? BACKUP_KEEP;
  const names = (await fs.readdir(dir)).filter((n) => BACKUP_RE.test(n)).sort().reverse();
  const removed: string[] = [];
  for (const name of names.slice(keep)) {
    await fs.rm(path.join(dir, name), { force: true });
    removed.push(name);
  }
  return { file: target, removed };
}
