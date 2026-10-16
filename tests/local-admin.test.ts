// The local copy's admin gate (src/admin/local.ts) and the configuration rules that keep it off any deployment
// reachable from outside the machine (src/platform/config.ts).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types.js';
import { createAdminRoutes } from '../src/admin/routes.js';
import { isLoopbackIp, verifyAdmin } from '../src/admin/local.js';
import { readConfig } from '../src/platform/config.js';
import { createTestEnv, tempDir } from './env.js';

const LOCAL = {
  BASE_URL: 'http://localhost:8787',
  DATA_DIR: path.join(tempDir('spcfz-local-'), 'data'),
  HOST: '127.0.0.1',
  TRUST_PROXY: 'off',
  LOCAL_ADMIN_EMAIL: 'Local-Admin@localhost',
};

describe('isLoopbackIp', () => {
  it('accepts 127/8, ::1 and mapped 127.x, and nothing else', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) expect(isLoopbackIp(ip)).toBe(true);
    for (const ip of [undefined, null, '', '10.0.0.1', '172.17.0.1', '128.0.0.1', '::ffff:10.0.0.1', '::2', '1127.0.0.1', '127.0.0.1.evil']) {
      expect(isLoopbackIp(ip)).toBe(false);
    }
  });
});

describe('LOCAL_ADMIN_EMAIL in the configuration', () => {
  it('is accepted for a loopback copy, lower-cased, with a warning instead of the Access one', () => {
    const r = readConfig(LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.vars.LOCAL_ADMIN_EMAIL).toBe('local-admin@localhost');
    expect(r.config.warnings.some((w) => w.startsWith('LOCAL_ADMIN_EMAIL is set'))).toBe(true);
    expect(r.config.warnings.some((w) => w.startsWith('ACCESS_TEAM_DOMAIN'))).toBe(false);
  });

  it('accepts ::1 and 127.0.0.1 as BASE_URL hosts', () => {
    expect(readConfig({ ...LOCAL, BASE_URL: 'http://[::1]:8787', HOST: '::1' }).ok).toBe(true);
    expect(readConfig({ ...LOCAL, BASE_URL: 'http://127.0.0.1:8787', HOST: 'localhost' }).ok).toBe(true);
  });

  it.each([
    ['HOST', { HOST: '0.0.0.0' }],
    ['BASE_URL', { BASE_URL: 'https://licensed.spcfz.ae' }],
    ['BASE_URL', { BASE_URL: 'http://localhost.evil.example:8787' }],
    ['TRUST_PROXY', { TRUST_PROXY: 'local-proxy' }],
    ['NODE_ENV', { NODE_ENV: 'production' }],
    ['ACCESS', { ACCESS_TEAM_DOMAIN: 'spcfz' }],
    ['email', { LOCAL_ADMIN_EMAIL: 'not an email' }],
  ])('is refused when %s says the copy is not local', (_label, change) => {
    const r = readConfig({ ...LOCAL, ...change });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => e.startsWith('LOCAL_ADMIN_EMAIL is for a local copy only'))).toBe(true);
  });

  it('is refused with every reason under the production container settings', () => {
    const r = readConfig({
      BASE_URL: 'https://licensed.spcfz.ae', DATA_DIR: '/data', HOST: '0.0.0.0', NODE_ENV: 'production',
      TRUST_PROXY: 'local-proxy', LOCAL_ADMIN_EMAIL: 'someone@spcfz.ae',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(4);
  });
});

describe('the local admin gate', () => {
  const env = createTestEnv({
    BASE_URL: 'http://localhost:8787', TRUST_PROXY: 'off', LOCAL_ADMIN_EMAIL: 'local-admin@localhost',
    ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined,
  });
  const app = new Hono<AppEnv>().route('/admin', createAdminRoutes(verifyAdmin));
  const at = (url: string, ip?: string, e = env): Promise<Response> =>
    Promise.resolve(app.request(url, ip ? { headers: { 'CF-Connecting-IP': ip } } : undefined, e));

  it('opens the admin to this machine at BASE_URL, marks it local, and drops Secure from the cookie on http', async () => {
    const res = await at('http://localhost:8787/admin', '127.0.0.1');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('local-admin@localhost');
    expect(body).toContain('Local copy on this computer');
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('admin_csrf=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect((await at('http://localhost:8787/admin', '::1')).status).toBe(200);
    expect((await at('http://127.0.0.1:8787/admin', '127.0.0.1')).status).toBe(200);
    expect((await at('http://[::1]:8787/admin', '::1')).status).toBe(200);
  });

  it('refuses another machine, a missing address, another host name pointed at 127.0.0.1, and another port', async () => {
    for (const [url, ip] of [
      ['http://localhost:8787/admin', '192.168.1.20'],
      ['http://localhost:8787/admin', undefined],
      ['http://rebound.example:8787/admin', '127.0.0.1'],
      ['http://localhost.rebound.example:8787/admin', '127.0.0.1'],
      ['http://localhost:9999/admin', '127.0.0.1'],
    ] as const) {
      const res = await at(url, ip);
      expect(res.status, `${url} from ${ip}`).toBe(403);
      expect(await res.text()).toContain('Local admin only');
    }
  });

  it('refuses even a loopback request when TRUST_PROXY is not off', async () => {
    const proxied = { ...env, TRUST_PROXY: 'local-proxy' as const };
    expect((await at('http://localhost:8787/admin', '127.0.0.1', proxied)).status).toBe(403);
  });

  it('falls back to Cloudflare Access when LOCAL_ADMIN_EMAIL is not set', async () => {
    const access = { ...env, LOCAL_ADMIN_EMAIL: undefined, ACCESS_TEAM_DOMAIN: 'spcfz-test', ACCESS_AUD: 'aud', BASE_URL: 'https://licensed.test' };
    const res = await at('https://licensed.test/admin', '127.0.0.1', access);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('Local copy');
  });
});
