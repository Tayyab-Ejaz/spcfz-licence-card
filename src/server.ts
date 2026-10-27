// Process entry (docs/PORT-TO-NODE.md section 3): reads the configuration, opens DATA_DIR, applies the
// migrations, starts the daily scheduler, and serves the Hono app with
// @hono/node-server. `startServer` is exported so tests can run the real thing on an ephemeral port.
import { realpathSync, promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import type { Http2Bindings, HttpBindings, ServerType } from '@hono/node-server';
import { runHousekeeping } from './cron.js';
import { app } from './index.js';
import { backupDatabase } from './platform/backup.js';
import { CLIENT_IP_HEADER, resolveClientIp, withClientIp } from './platform/client-ip.js';
import { CACHE_FILE_NAME, CloudflareRanges } from './platform/cloudflare-ips.js';
import { loadConfig } from './platform/config.js';
import type { ServerConfig } from './platform/config.js';
import { MIGRATIONS_DIR, applyMigrations } from './platform/migrate.js';
import { Scheduler } from './platform/scheduler.js';
import { onEmailQueued, processOutbox } from './mail/outbox.js';
import { transportFromEnv } from './mail/transport.js';
import { SqliteDb } from './platform/sqlite-db.js';
import type { Env } from './types.js';

export const DB_FILE_NAME = 'licence-card.sqlite';

export type Logger = (message: string, data?: Record<string, unknown>) => void;

const defaultLog: Logger = (message, data) => {
  console.log(`${new Date().toISOString()} ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
};

export interface StartOptions {
  config: ServerConfig;
  /** fetch used for Cloudflare's range list under TRUST_PROXY=cloudflare; null keeps to the bundled list (tests). */
  cloudflareFetch?: typeof fetch | null;
  /** False keeps the daily scheduler off (tests). */
  schedulerEnabled?: boolean;
  log?: Logger;
}

export interface RunningServer {
  host: string;
  port: number;
  env: Env;
  db: SqliteDb;
  scheduler: Scheduler | null;
  close(): Promise<void>;
}

/** Everything the daily scheduler does: housekeeping, the SQLite backup, and a refresh of Cloudflare's ranges. */
export async function dailyTask(env: Env, db: SqliteDb, cloudflare: CloudflareRanges | null, log: Logger): Promise<void> {
  await runHousekeeping(env);
  const backup = await backupDatabase(db, env.DATA_DIR);
  log('backup written', { file: backup.file, removed: backup.removed });
  if (cloudflare) {
    const source = await cloudflare.refresh();
    log('cloudflare ranges refreshed', { source, count: cloudflare.set.size });
  }
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { config } = options;
  const log = options.log ?? defaultLog;

  await fs.mkdir(config.dataDir, { recursive: true });
  const db = SqliteDb.open(path.join(config.dataDir, DB_FILE_NAME));
  const applied = applyMigrations(db, MIGRATIONS_DIR);
  if (applied.length) log('migrations applied', { applied });

  const env: Env = { DB: db, ...config.vars };

  let cloudflare: CloudflareRanges | null = null;
  if (config.trustProxy === 'cloudflare') {
    cloudflare = await CloudflareRanges.load({
      cacheFile: path.join(config.dataDir, CACHE_FILE_NAME),
      fetchImpl: options.cloudflareFetch === undefined ? fetch : options.cloudflareFetch,
      log,
    });
    log('cloudflare ranges loaded', { source: cloudflare.source, count: cloudflare.set.size });
  }

  // The only place the socket is visible: establish the client address and hand the app a request whose
  // CF-Connecting-IP header is exactly that (docs/PORT-TO-NODE.md section 5).
  const fetchHandler = (request: Request, bindings: HttpBindings | Http2Bindings): Response | Promise<Response> => {
    const peer = bindings.incoming.socket?.remoteAddress;
    const client = resolveClientIp(config.trustProxy, peer, request.headers.get(CLIENT_IP_HEADER), cloudflare);
    return app.fetch(withClientIp(request, client), env);
  };

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: fetchHandler, port: config.port, hostname: config.host }, () => resolve(s));
  });
  const address = server.address() as AddressInfo;

  let scheduler: Scheduler | null = null;
  if (options.schedulerEnabled ?? true) {
    scheduler = new Scheduler(env, (e) => dailyTask(e, db, cloudflare, log), { log });
    await scheduler.start();
  }

  // The email outbox (src/mail/outbox.ts): every 30 seconds, and a moment after something is queued.
  const transport = transportFromEnv(env);
  let sending = false;
  const sendDue = (): void => {
    if (sending || !transport) return;
    sending = true;
    processOutbox(env, transport).catch((err: unknown) => log('outbox failed', { message: err instanceof Error ? err.message : String(err) })).finally(() => { sending = false; });
  };
  const outboxTimer = (options.schedulerEnabled ?? true) ? setInterval(sendDue, 30_000) : null;
  outboxTimer?.unref();
  onEmailQueued(() => setTimeout(sendDue, 250).unref());
  log('mail', { transport: transport?.mode ?? 'off' });

  log('listening', { host: address.address, port: address.port, dataDir: config.dataDir, trustProxy: config.trustProxy, pid: process.pid });
  for (const w of config.warnings) log(`warning: ${w}`);

  let closed = false;
  return {
    host: address.address,
    port: address.port,
    env,
    db,
    scheduler,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (outboxTimer) clearInterval(outboxTimer);
      onEmailQueued(null);
      if (scheduler) await scheduler.stop();
      db.close();
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const running = await startServer({ config });
  const shutdown = (signal: string): void => {
    defaultLog('shutting down', { signal });
    running.close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error('shutdown failed', err);
        process.exit(1);
      },
    );
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain = ((): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err: unknown) => {
    console.error('fatal', err);
    process.exit(1);
  });
}
