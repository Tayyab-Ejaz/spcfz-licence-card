// The product on this computer (docs/DEV.md "Local copy"). One command builds the service and the studio, starts
// it at http://localhost:8787, loads the five sample licences through the real test webhook on first run, and
// creates a local admin account for the sign-in page (/admin/login?key=..., the same sign-in as production).
//
//   npm run local                  build, start, load the samples the first time
//   npm run local -- --watch       rebuild and restart whenever src/, client/ or design/ change
//   npm run local -- --seed        load the five samples again (updates the same five cards)
//   npm run local -- --fresh       delete the local database first, then load the samples
//   npm run local -- --no-build    start the last build as it is
//
// State lives outside the repo, in ~/.spcfz-licence-card (or $SPCFZ_LOCAL_HOME): local.env with this copy's own
// random secrets and sign-in key, local-admin.txt with the local admin account, and data/ with the SQLite database. The repo sits in OneDrive, which should not sync a live
// database. Nothing here talks to the production server.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.resolve(process.env.SPCFZ_LOCAL_HOME || path.join(os.homedir(), '.spcfz-licence-card'));
const ENV_FILE = path.join(HOME, 'local.env');
const DATA_DIR = path.join(HOME, 'data');
const SEEDED = path.join(DATA_DIR, '.samples-loaded');
const ADMIN_FILE = path.join(HOME, 'local-admin.txt');
const LOCAL_ADMIN = 'admin@local.test';

const args = new Set(process.argv.slice(2));
const known = ['--watch', '--seed', '--fresh', '--no-build', '--help'];
for (const a of args) if (!known.includes(a)) { console.error(`unknown option ${a}; try --help`); process.exit(2); }
if (args.has('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Node 22 or later is needed, this is ${process.version}. Run: nvm use 22`);
  process.exit(1);
}

const say = (msg) => console.log(`\x1b[36m[local]\x1b[0m ${msg}`);

// ------------------------------------------------------------------ configuration

function secret() {
  return randomBytes(24).toString('base64url');
}

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return false;
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const lines = [
    '# Local copy of spcfz-licence-card, written by tools/local.mjs on first run. Edit freely; it never leaves this computer.',
    '# To use another port, change PORT and BASE_URL together.',
    'BASE_URL=http://localhost:8787',
    'HOST=127.0.0.1',
    'PORT=8787',
    `DATA_DIR=${DATA_DIR}`,
    '# The socket peer is the client.',
    'TRUST_PROXY=off',
    '# Opens the admin sign-in page at /admin/login?key=<this>; the account is in local-admin.txt.',
    `ADMIN_LOGIN_KEY=${secret()}`,
    '# The webhooks accept this machine only. Secrets are random and local to this copy.',
    'ERP_IP_ALLOWLIST=127.0.0.1,::1',
    `WEBHOOK_SECRET_CURRENT=${secret()}`,
    `TEST_SECRET_CURRENT=${secret()}`,
    'FIELD_MAP={}',
    'GTM_CONTAINER=',
    '',
  ];
  writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
  return true;
}

/** Copies made before 19 October 2026 opened the admin with LOCAL_ADMIN_EMAIL; move them to the sign-in key. */
function upgradeEnvFile() {
  const text = readFileSync(ENV_FILE, 'utf8');
  let next = text.split(/\r?\n/).filter((l) => !/^LOCAL_ADMIN_EMAIL=/.test(l) && !/src\/admin\/local\.ts/.test(l)).join('\n');
  if (!/^ADMIN_LOGIN_KEY=/m.test(next)) {
    next = next.replace(/\n*$/, '\n') + '# Opens the admin sign-in page at /admin/login?key=<this>; the account is in local-admin.txt.\n' + `ADMIN_LOGIN_KEY=${secret()}\n`;
  }
  if (next !== text) {
    writeFileSync(ENV_FILE, next, { mode: 0o600 });
    say(`updated ${ENV_FILE}: the admin now uses the sign-in page`);
  }
}

function readEnvFile() {
  const out = {};
  for (const raw of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// ------------------------------------------------------------------ build

function runNode(scriptArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, scriptArgs, { cwd: ROOT, stdio: 'inherit', ...opts });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function build() {
  const started = Date.now();
  say('building the service and the studio');
  if ((await runNode([path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'])) !== 0) return false;
  if ((await runNode([path.join(ROOT, 'tools/build-studio.mjs')])) !== 0) return false;
  say(`built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return true;
}

// ------------------------------------------------------------------ server

let server = null;
let stopping = false;

function startServer(fileVars) {
  // Keys set in local.env win over the shell, so a stray BASE_URL or PORT in the environment cannot redirect the copy.
  const env = { ...process.env, ENV_FILE };
  for (const k of Object.keys(fileVars)) delete env[k];
  const child = spawn(process.execPath, ['dist/server.js'], { cwd: ROOT, env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (server === child) server = null;
    if (stopping || child.expected) return;
    say(`the service stopped (${signal ?? `exit ${code}`})${code === 1 ? '; if the port is taken, change PORT and BASE_URL in ' + ENV_FILE : ''}`);
    if (!args.has('--watch')) process.exit(code ?? 1);
  });
  server = child;
  return child;
}

function stopServer() {
  const child = server;
  if (!child) return Promise.resolve();
  child.expected = true;
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  });
}

async function waitHealthy(base, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || server !== child) return false;
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ------------------------------------------------------------------ samples and links

async function loadSamples(base, testSecret) {
  say('loading the five sample licences through the test webhook');
  const code = await runNode([path.join(ROOT, 'tools/erp-samples.mjs'), '--http', base, testSecret]);
  if (code === 0) writeFileSync(SEEDED, `${new Date().toISOString()}\n`);
  return code === 0;
}

/** One local admin account, created the first time; its password is kept in local-admin.txt (owner-only). */
async function ensureLocalAdmin() {
  let count = 0;
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(DATA_DIR, 'licence-card.sqlite'), { readonly: true, fileMustExist: true });
    count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
    db.close();
  } catch {
    return;
  }
  if (count > 0) return;
  const password = secret().slice(0, 20);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['dist/cli/admin-user.js', 'add', LOCAL_ADMIN], {
      cwd: ROOT, env: { ...process.env, DATA_DIR }, stdio: ['pipe', 'ignore', 'inherit'],
    });
    child.on('exit', (c) => resolve(c ?? 1));
    child.stdin.end(`${password}\n`);
  });
  if (code !== 0) { say('could not create the local admin account'); return; }
  writeFileSync(ADMIN_FILE, `Local admin for http://localhost (this computer only)\nemail    ${LOCAL_ADMIN}\npassword ${password}\n`, { mode: 0o600 });
  say(`created the local admin account; its password is in ${ADMIN_FILE}`);
}

async function printLinks(base) {
  let rows = [];
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(DATA_DIR, 'licence-card.sqlite'), { readonly: true, fileMustExist: true });
    rows = db.prepare(
      "SELECT token, licence_number, company_name_en, is_test, status FROM cards WHERE status != 'expired' ORDER BY created_at LIMIT 20",
    ).all();
    db.close();
  } catch (err) {
    say(`could not list the cards: ${err instanceof Error ? err.message : String(err)}`);
  }
  const key = readEnvFile().ADMIN_LOGIN_KEY ?? '';
  const out = ['', `  Admin       ${base}/admin/login?key=${key}`, `              account ${LOCAL_ADMIN}, password in ${ADMIN_FILE}`];
  if (rows.length) {
    out.push('  Cards       (add ?lang=ar for the Arabic layout)');
    for (const r of rows) out.push(`    ${r.is_test ? 'TEST ' : 'LIVE '}${r.company_name_en}\n      ${base}/c/${r.token}`);
  } else {
    out.push('  Cards       none yet: npm run local -- --seed');
  }
  out.push(`  Settings    ${ENV_FILE}`, `  Data        ${DATA_DIR}`, '');
  console.log(out.join('\n'));
}

// ------------------------------------------------------------------ main

async function boot(fileVars) {
  const child = startServer(fileVars);
  if (!(await waitHealthy(fileVars.BASE_URL, child))) {
    say('the service did not answer /healthz');
    return false;
  }
  return true;
}

async function main() {
  if (ensureEnvFile()) say(`first run: wrote ${ENV_FILE}`);
  upgradeEnvFile();
  const vars = readEnvFile();
  if (!vars.BASE_URL || !vars.TEST_SECRET_CURRENT) {
    console.error(`${ENV_FILE} needs BASE_URL and TEST_SECRET_CURRENT; delete it to have it written again`);
    process.exit(1);
  }
  if (args.has('--fresh')) {
    // Only ever the folder this tool owns.
    if (path.dirname(DATA_DIR) !== HOME) throw new Error(`refusing to delete ${DATA_DIR}`);
    rmSync(DATA_DIR, { recursive: true, force: true });
    say('deleted the local database');
  }
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  if (!args.has('--no-build') && !(await build())) process.exit(1);
  if (!existsSync(path.join(ROOT, 'dist/server.js'))) {
    console.error('dist/server.js is missing; run without --no-build');
    process.exit(1);
  }

  if (!(await boot(vars))) { await stopServer(); process.exit(1); }
  if (args.has('--seed') || args.has('--fresh') || !existsSync(SEEDED)) await loadSamples(vars.BASE_URL, vars.TEST_SECRET_CURRENT);
  await ensureLocalAdmin();
  await printLinks(vars.BASE_URL);

  if (args.has('--watch')) watchAndReload(vars);
  else say('running; Ctrl-C stops it');
}

function watchAndReload(vars) {
  let timer = null;
  let busy = false;
  let again = false;
  const reload = async () => {
    if (busy) { again = true; return; }
    busy = true;
    do {
      again = false;
      if (await build()) {
        await stopServer();
        if (await boot(vars)) say(`reloaded at ${new Date().toLocaleTimeString()}; refresh the browser`);
      } else {
        say('build failed; the previous version keeps running');
      }
    } while (again);
    busy = false;
  };
  const onChange = (dir) => (_event, file) => {
    const rel = path.join(dir, String(file ?? ''));
    if (rel.includes(`${path.sep}generated${path.sep}`) || rel.endsWith('.DS_Store') || /~$|\.swp$/.test(rel)) return;
    clearTimeout(timer);
    timer = setTimeout(reload, 300);
  };
  for (const dir of ['src', 'client', 'design', 'migrations']) watch(path.join(ROOT, dir), { recursive: true }, onChange(dir));
  // The folder, not the file: git checkout and most editors replace the file, which ends a watch on it.
  const studioBuild = onChange('tools');
  watch(path.join(ROOT, 'tools'), (event, file) => { if (String(file ?? '') === 'build-studio.mjs') studioBuild(event, file); });
  say('watching src/, client/, design/ and migrations/; Ctrl-C stops it');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    stopServer().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(err);
  stopping = true;
  stopServer().then(() => process.exit(1));
});
