// The real server on ephemeral ports with temp DATA_DIRs: proves the wiring from socket to Hono app,
// the data layout, and the three TRUST_PROXY modes end to end. No render job is ever created here.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerConfig } from '../src/platform/config.js';
import { appliedMigrations } from '../src/platform/migrate.js';
import { DB_FILE_NAME, startServer } from '../src/server.js';
import type { RunningServer } from '../src/server.js';
import type { TrustProxy } from '../src/types.js';
import { TEST_VARS, tempDir } from './env.js';

const TEST_PATH = '/v1/test/licence-issued';
const ALLOWED = '203.0.113.10';
const PAYLOAD = JSON.stringify({ licence_number: 'SPC-2026-00001', company_name_en: 'Nimbus Publishing FZE' });

function configFor(dir: string, trustProxy: TrustProxy, allowlist: string = TEST_VARS.ERP_IP_ALLOWLIST): ServerConfig {
  return {
    vars: { ...TEST_VARS, ERP_IP_ALLOWLIST: allowlist, DATA_DIR: dir, PORT: 0, TRUST_PROXY: trustProxy },
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    trustProxy,
    envFile: null,
    warnings: [],
  };
}

async function boot(trustProxy: TrustProxy, allowlist?: string): Promise<{ server: RunningServer; dir: string }> {
  const dir = tempDir('spcfz-server-');
  const server = await startServer({
    config: configFor(dir, trustProxy, allowlist),
    cloudflareFetch: null,
    schedulerEnabled: false,
    log: () => undefined,
  });
  return { server, dir };
}

async function intake(server: RunningServer, headers: Record<string, string>): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${TEST_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: PAYLOAD,
  });
}

describe('server (TRUST_PROXY=local-proxy, the production mode)', () => {
  let server: RunningServer;
  let dir: string;
  beforeAll(async () => {
    ({ server, dir } = await boot('local-proxy'));
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers /healthz', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers a 404 page for an unknown path and the generic card 404 for a bad token', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/no/such/path`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    const card = await fetch(`http://127.0.0.1:${server.port}/c/not-a-token`);
    expect(card.status).toBe(404);
    expect(await card.text()).toContain('This link is not valid');
  });

  it('lays out DATA_DIR: the SQLite file and every migration', () => {
    expect(existsSync(path.join(dir, DB_FILE_NAME))).toBe(true);
    expect(appliedMigrations(server.db)).toEqual(['0001_init.sql', '0002_jobs.sql', '0003_activity_ar.sql', '0004_founder_name.sql', '0005_admin_auth.sql', '0006_licence_expiry.sql', '0007_email_linkedin.sql']);
    expect(server.scheduler).toBeNull();
  });

  it('intake: without CF-Connecting-IP the client is unknown and the allowlist rejects with 403', async () => {
    const res = await intake(server, { 'X-SPC-Webhook-Secret': TEST_VARS.TEST_SECRET_CURRENT });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: 'rejected', errors: ['source address not allowed'] });
  });

  it('intake: a non-allowlisted CF-Connecting-IP from the local proxy is rejected with 403', async () => {
    const res = await intake(server, { 'CF-Connecting-IP': '192.0.2.1', 'X-SPC-Webhook-Secret': TEST_VARS.TEST_SECRET_CURRENT });
    expect(res.status).toBe(403);
  });

  it('intake: an allowlisted CF-Connecting-IP from the local proxy passes the IP check (the bad secret then gives 401)', async () => {
    const res = await intake(server, { 'CF-Connecting-IP': ALLOWED, 'X-SPC-Webhook-Secret': 'wrong' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: 'rejected', errors: ['invalid secret'] });
    // The event log saw the visitor's address, not the proxy's.
    const row = server.db.raw.prepare('SELECT source_ip, http_status FROM events ORDER BY received_at DESC LIMIT 1').get();
    expect(row).toEqual({ source_ip: ALLOWED, http_status: 401 });
  });
});

describe('server (TRUST_PROXY=off)', () => {
  let server: RunningServer;
  let dir: string;
  beforeAll(async () => {
    ({ server, dir } = await boot('off', `${ALLOWED},127.0.0.1`));
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores CF-Connecting-IP and uses the socket peer', async () => {
    // The header names an allowlisted address, but the peer (127.0.0.1) is what counts; it is allowlisted here too.
    const res = await intake(server, { 'CF-Connecting-IP': '192.0.2.1', 'X-SPC-Webhook-Secret': 'wrong' });
    expect(res.status).toBe(401);
    const row = server.db.raw.prepare('SELECT source_ip FROM events ORDER BY received_at DESC LIMIT 1').get();
    expect(row).toEqual({ source_ip: '127.0.0.1' });
  });

  it('rejects when the socket peer is not allowlisted', async () => {
    const strict = await boot('off');
    try {
      const res = await intake(strict.server, { 'CF-Connecting-IP': ALLOWED, 'X-SPC-Webhook-Secret': TEST_VARS.TEST_SECRET_CURRENT });
      expect(res.status).toBe(403);
    } finally {
      await strict.server.close();
      rmSync(strict.dir, { recursive: true, force: true });
    }
  });
});

describe('server (TRUST_PROXY=cloudflare)', () => {
  it('does not trust CF-Connecting-IP from a loopback peer, so a spoofed allowlisted address is rejected', async () => {
    const { server, dir } = await boot('cloudflare');
    try {
      const res = await intake(server, { 'CF-Connecting-IP': ALLOWED, 'X-SPC-Webhook-Secret': TEST_VARS.TEST_SECRET_CURRENT });
      expect(res.status).toBe(403);
      const row = server.db.raw.prepare('SELECT source_ip FROM events ORDER BY received_at DESC LIMIT 1').get();
      expect(row).toEqual({ source_ip: '127.0.0.1' });
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
