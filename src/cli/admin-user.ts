// Staff accounts for the admin sign-in (src/admin/auth.ts). Runs where the database is: inside the container on
// the server, or against the local copy's data folder.
//
//   node dist/cli/admin-user.js add <email>       create an account; asks for the password twice
//   node dist/cli/admin-user.js passwd <email>    set a new password; signs the account out everywhere
//   node dist/cli/admin-user.js unlock <email>    clear a lock after too many wrong passwords
//   node dist/cli/admin-user.js remove <email>    delete the account and its sessions
//   node dist/cli/admin-user.js list              accounts, last sign-in, lock state
//
// On the server:  ssh -t root@13.206.34.102 docker exec -it spcfz-licence-card node dist/cli/admin-user.js add you@spcfz.ae
// The password is typed, not passed as an argument, so it never lands in shell history or the process list. With
// no terminal (a pipe), the password is read from the first line of stdin; tools/local.mjs uses that.
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  deleteAdmin, findAdminByEmail, insertAdmin, listAdmins, normaliseEmail, setAdminPassword, unlockAdmin,
} from '../db/admin.js';
import { hashPassword, passwordProblem } from '../admin/password.js';
import { MIGRATIONS_DIR, applyMigrations } from '../platform/migrate.js';
import { SqliteDb } from '../platform/sqlite-db.js';
import { nowIso } from '../util/time.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USAGE = 'usage: node dist/cli/admin-user.js add|passwd|unlock|remove <email>   or   list';

/** Typed characters that arrived after the line a prompt consumed (a paste can deliver both lines at once). */
let pending = '';

/** Reads a line without echoing it when stdin is a terminal. */
async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  }
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (fn: () => void): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      fn();
    };
    const consume = (): boolean => {
      while (pending.length) {
        const ch = pending[0]!;
        pending = pending.slice(1);
        if (ch === '\r' || ch === '\n') {
          if (pending[0] === '\n' && ch === '\r') pending = pending.slice(1);
          finish(() => resolve(value));
          return true;
        }
        if (ch === '\u0003') { finish(() => reject(new Error('cancelled'))); return true; }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
      return false;
    };
    const onData = (chunk: string): void => { pending += chunk; consume(); };
    if (consume()) return;
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}

async function askNewPassword(): Promise<string> {
  const first = await readSecret('New password (at least 12 characters): ');
  const problem = passwordProblem(first);
  if (problem) throw new Error(`password not accepted: ${problem}`);
  if (process.stdin.isTTY) {
    const second = await readSecret('Type it again: ');
    if (second !== first) throw new Error('the two passwords did not match');
  }
  return first;
}

export async function main(argv: string[], dataDir: string): Promise<number> {
  const [cmd, rawEmail] = argv;
  if (!existsSync(dataDir)) {
    console.error(`No data folder at ${dataDir}. Set DATA_DIR to the folder that holds licence-card.sqlite (inside the container it is /data).`);
    return 1;
  }
  const db = SqliteDb.open(path.join(dataDir, 'licence-card.sqlite'));
  try {
    applyMigrations(db, MIGRATIONS_DIR);
    const now = nowIso();
    if (cmd === 'list') {
      const users = await listAdmins(db);
      if (!users.length) console.log('No admin accounts yet.');
      for (const u of users) {
        const locked = u.locked_until && Date.parse(u.locked_until) > Date.now() ? `  LOCKED until ${u.locked_until}` : '';
        console.log(`${u.email}  last sign-in ${u.last_login_at ?? 'never'}${locked}`);
      }
      return 0;
    }
    if (!cmd || !rawEmail || !['add', 'passwd', 'unlock', 'remove'].includes(cmd)) {
      console.error(USAGE);
      return 2;
    }
    const email = normaliseEmail(rawEmail);
    if (!EMAIL_RE.test(email)) {
      console.error(`not an email address: ${rawEmail}`);
      return 2;
    }
    const existing = await findAdminByEmail(db, email);
    if (cmd === 'add') {
      if (existing) { console.error(`${email} already has an account; use passwd to change its password`); return 1; }
      await insertAdmin(db, email, await hashPassword(await askNewPassword()), now);
      console.log(`Account created for ${email}.`);
      return 0;
    }
    if (!existing) { console.error(`no account for ${email}`); return 1; }
    if (cmd === 'passwd') {
      await setAdminPassword(db, existing.id, await hashPassword(await askNewPassword()), now);
      console.log(`Password changed for ${email}; it is signed out everywhere.`);
    } else if (cmd === 'unlock') {
      await unlockAdmin(db, existing.id, now);
      console.log(`${email} unlocked.`);
    } else {
      await deleteAdmin(db, existing.id);
      console.log(`Account removed for ${email}.`);
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    db.close();
  }
}

const isMain = ((): boolean => {
  try {
    return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMain) {
  main(process.argv.slice(2), process.env.DATA_DIR ?? '/data').then((code) => process.exit(code));
}
