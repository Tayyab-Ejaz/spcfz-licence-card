// Staff sign-in (src/admin/auth.ts): the key-gated page, passwords, sessions, lockout, rate limit, sign-out.
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types.js';
import { createAdminRoutes } from '../src/admin/routes.js';
import { LOCK_MS, createAuthHandlers, sessionVerifier } from '../src/admin/auth.js';
import { hashPassword, passwordProblem, verifyPassword } from '../src/admin/password.js';
import { findAdminByEmail, insertAdmin } from '../src/db/admin.js';
import { nowIso } from '../src/util/time.js';
import { createTestEnv } from './env.js';

const KEY = 'test-login-key-0123456789abcdef';
const CSRF = 'c'.repeat(32);
const PASSWORD = 'correct horse battery';

describe('passwords', () => {
  it('hashes with a fresh salt and verifies only the right password', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword('correct horse batterY', a)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'scrypt$1$1$1$xx$yy')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'plain')).toBe(false);
  });

  it('asks for at least 12 characters and no padding', () => {
    expect(passwordProblem('short')).toMatch(/12/);
    expect(passwordProblem(' leading space here')).toMatch(/spaces/);
    expect(passwordProblem(PASSWORD)).toBeNull();
  });
});

function setup(o: { base?: string; rate?: number } = {}) {
  let clock = Date.now(); // sessions are checked against the real clock, so the test clock starts now
  const env = createTestEnv({ BASE_URL: o.base ?? 'https://licensed.test' });
  const handlers = createAuthHandlers({ rate: { limit: o.rate ?? 100, windowMs: 60_000 }, now: () => clock });
  const app = new Hono<AppEnv>().route('/admin', createAdminRoutes(sessionVerifier, handlers));
  const call = (path: string, init: RequestInit = {}) => Promise.resolve(app.request(path, init, env));
  const login = (fields: Record<string, string>, cookie = `admin_csrf=${CSRF}`) =>
    call('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'CF-Connecting-IP': '198.51.100.7' },
      body: new URLSearchParams({ _csrf: CSRF, key: KEY, ...fields }).toString(),
    });
  return { env, call, login, advance: (ms: number) => { clock += ms; } };
}

const sessionCookie = (res: Response): string => {
  const set = res.headers.get('Set-Cookie') ?? '';
  const m = /(__Host-spc_admin|spc_admin)=([0-9A-Za-z]{48})/.exec(set);
  if (!m) throw new Error(`no session cookie in: ${set}`);
  return `${m[1]}=${m[2]}`;
};

describe('the sign-in page', () => {
  it('exists only with the right key; anything else is the same 404 as an unknown address', async () => {
    const { call } = setup();
    for (const q of ['', '?key=', '?key=wrong', `?key=${KEY.slice(0, -1)}`, `?key=${KEY}x`]) {
      const res = await call(`/admin/login${q}`);
      expect(res.status, q).toBe(404);
      expect(await res.text()).toBe('Not found');
    }
    const ok = await call(`/admin/login?key=${KEY}`);
    expect(ok.status).toBe(200);
    const body = await ok.text();
    expect(body).toContain('<form method="post" action="/admin/login"');
    expect(body).toContain('autocomplete="current-password"');
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(ok.headers.get('X-Frame-Options')).toBe('DENY');
    expect(ok.headers.get('Set-Cookie')).toContain('admin_csrf=');
  });

  it('stays closed when ADMIN_LOGIN_KEY is missing or too short', async () => {
    const { call, env } = setup();
    for (const k of [undefined, '', 'short-key']) {
      env.ADMIN_LOGIN_KEY = k;
      expect((await call(`/admin/login?key=${k ?? ''}`)).status).toBe(404);
    }
  });
});

describe('signing in', () => {
  it('refuses a wrong key, a forged form, a wrong password and an unknown email, with one message', async () => {
    const { env, login } = setup();
    await insertAdmin(env.DB, 'Staff@SPCFZ.ae', await hashPassword(PASSWORD), nowIso());
    expect((await login({ email: 'staff@spcfz.ae', password: PASSWORD, key: 'wrong' })).status).toBe(404);
    const forged = await login({ email: 'staff@spcfz.ae', password: PASSWORD }, 'admin_csrf=' + 'd'.repeat(32));
    expect(forged.status).toBe(403);
    const wrong = await login({ email: 'staff@spcfz.ae', password: 'not the password' });
    const unknown = await login({ email: 'nobody@spcfz.ae', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const msg = (t: string) => /<div class="error" role="alert">([^<]*)<\/div>/.exec(t)?.[1];
    expect(msg(await wrong.text())).toBe(msg(await unknown.text()));
    expect(wrong.headers.get('Set-Cookie') ?? '').not.toContain('spc_admin=');
  });

  it('signs in, opens the admin, stores only a hash of the cookie, and signs out', async () => {
    const { env, call, login } = setup();
    await insertAdmin(env.DB, 'staff@spcfz.ae', await hashPassword(PASSWORD), nowIso());
    const res = await login({ email: ' STAFF@spcfz.ae ', password: PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin');
    const set = res.headers.get('Set-Cookie') ?? '';
    expect(set).toMatch(/^__Host-spc_admin=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(set).toContain(flag);
    const cookie = sessionCookie(res);
    const token = cookie.split('=')[1]!;
    const rows = env.db.raw.prepare('SELECT token_hash FROM admin_sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);

    const dash = await call('/admin', { headers: { cookie: `${cookie}; admin_csrf=${CSRF}` } });
    expect(dash.status).toBe(200);
    const html = await dash.text();
    expect(html).toContain('staff@spcfz.ae');
    expect(html).toContain('action="/admin/logout"');
    expect((await findAdminByEmail(env.DB, 'staff@spcfz.ae'))?.last_login_at).toBeTruthy();

    // already signed in: the sign-in page sends you to the dashboard
    expect((await call(`/admin/login?key=${KEY}`, { headers: { cookie } })).status).toBe(303);

    const out = await call('/admin/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${cookie}; admin_csrf=${CSRF}` },
      body: `_csrf=${CSRF}`,
    });
    expect(out.status).toBe(200);
    expect(await out.text()).toContain('Signed out');
    expect(out.headers.get('Set-Cookie')).toMatch(/__Host-spc_admin=;/);
    expect((await call('/admin', { headers: { cookie } })).status).toBe(404);
  });

  it('sign-out needs the form token', async () => {
    const { env, call, login } = setup();
    await insertAdmin(env.DB, 'staff@spcfz.ae', await hashPassword(PASSWORD), nowIso());
    const cookie = sessionCookie(await login({ email: 'staff@spcfz.ae', password: PASSWORD }));
    const res = await call('/admin/logout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: '' });
    expect(res.status).toBe(403);
    expect((await call('/admin', { headers: { cookie } })).status).toBe(200);
  });

  it('locks the account for 15 minutes after 5 wrong passwords, even for the right one', async () => {
    const { env, login, advance } = setup();
    await insertAdmin(env.DB, 'staff@spcfz.ae', await hashPassword(PASSWORD), nowIso());
    for (let i = 0; i < 5; i++) expect((await login({ email: 'staff@spcfz.ae', password: `wrong ${i}` })).status).toBe(401);
    expect((await login({ email: 'staff@spcfz.ae', password: PASSWORD })).status).toBe(401);
    advance(LOCK_MS + 1000);
    expect((await login({ email: 'staff@spcfz.ae', password: PASSWORD })).status).toBe(303);
    expect((await findAdminByEmail(env.DB, 'staff@spcfz.ae'))?.failed_logins).toBe(0);
  });

  it('limits attempts per client address', async () => {
    const { login } = setup({ rate: 3 });
    for (let i = 0; i < 3; i++) expect((await login({ email: 'x@spcfz.ae', password: 'whatever pass' })).status).toBe(401);
    const res = await login({ email: 'x@spcfz.ae', password: 'whatever pass' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await res.text()).toContain('Too many sign-in attempts');
  });

  it('ends a session at its expiry and removes the row', async () => {
    const { env, call, login } = setup();
    await insertAdmin(env.DB, 'staff@spcfz.ae', await hashPassword(PASSWORD), nowIso());
    const cookie = sessionCookie(await login({ email: 'staff@spcfz.ae', password: PASSWORD }));
    env.db.raw.prepare("UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await call('/admin', { headers: { cookie } })).status).toBe(404);
    expect((env.db.raw.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get() as { n: number }).n).toBe(0);
  });

  it('uses a plain cookie name without Secure on a local http copy', async () => {
    const { env, call, login } = setup({ base: 'http://localhost:8787' });
    await insertAdmin(env.DB, 'admin@localhost.test', await hashPassword(PASSWORD), nowIso());
    const res = await login({ email: 'admin@localhost.test', password: PASSWORD });
    const set = res.headers.get('Set-Cookie') ?? '';
    expect(set).toMatch(/^spc_admin=/);
    expect(set).not.toContain('Secure');
    const dash = await call('/admin', { headers: { cookie: sessionCookie(res) } });
    expect(dash.status).toBe(200);
    expect(await dash.text()).toContain('Local copy on this computer');
  });
});
