// Staff sign-in for /admin (ARCHITECTURE section 8). From 19 October 2026 this replaces Cloudflare Access.
//
// - The sign-in page exists only at /admin/login?key=<ADMIN_LOGIN_KEY>. Without the key, it and every other
//   /admin address answer a plain 404, the same as any unknown path, so the admin cannot be found by probing.
// - Accounts are email + password (scrypt, ./password.ts), created on the server with dist/cli/admin-user.js.
// - A successful sign-in sets a random session cookie (HttpOnly, SameSite=Strict, Secure and __Host- on https);
//   only its SHA-256 is stored. Sessions end after 2 hours idle or 12 hours in total, or on Sign out.
// - Attempts are limited per client address (10 per 15 minutes), and an account locks for 15 minutes after
//   5 wrong passwords. Every failure gets the same message, and unknown emails cost the same time as known ones.
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../types.js';
import {
  deleteAdminSession, findAdminByEmail, getAdminSession, insertAdminSession, recordAdminFailure, recordAdminLogin,
  touchAdminSession,
} from '../db/admin.js';
import { randomSecret, sha256Hex, timingSafeEqualStr } from '../util/crypto.js';
import { rateKeyForIp } from '../util/ip.js';
import { FixedWindowLimiter } from '../util/rate-limit.js';
import type { RateRule } from '../util/rate-limit.js';
import { html, raw } from '../util/html.js';
import { CSRF_FIELD, csrfFailure, ensureCsrf } from './csrf.js';
import { burnPasswordCheck, verifyPassword } from './password.js';

export type AdminVerifier = (c: Context<AppEnv>) => Promise<{ email: string } | null>;

export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const LOGIN_RATE: RateRule = { limit: 10, windowMs: 15 * 60 * 1000 };
export const MIN_LOGIN_KEY_LENGTH = 24;
const TOUCH_EVERY_MS = 60 * 1000;
const SESSION_RE = /^[0-9A-Za-z]{48}$/;

const isHttps = (c: Context<AppEnv>): boolean => (c.env.BASE_URL ?? '').startsWith('https:');

/** `__Host-` pins the cookie to this exact host and path, but browsers accept it only over https. */
export const sessionCookieName = (c: Context<AppEnv>): string => (isHttps(c) ? '__Host-spc_admin' : 'spc_admin');

const iso = (ms: number): string => new Date(ms).toISOString();

/** The configured sign-in key, or null when sign-in is closed (missing or too short). */
function loginKey(c: Context<AppEnv>): string | null {
  const k = (c.env.ADMIN_LOGIN_KEY ?? '').trim();
  return k.length >= MIN_LOGIN_KEY_LENGTH ? k : null;
}

export async function loginKeyMatches(c: Context<AppEnv>, given: string | undefined): Promise<boolean> {
  const k = loginKey(c);
  if (!k || !given) return false;
  return timingSafeEqualStr(given, k);
}

/** The signed-in staff member, from the session cookie; slides the idle timeout forward. */
export const sessionVerifier: AdminVerifier = async (c) => {
  const token = getCookie(c, sessionCookieName(c));
  if (!token || !SESSION_RE.test(token)) return null;
  const hash = await sha256Hex(token);
  const s = await getAdminSession(c.env.DB, hash);
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) <= now) {
    await deleteAdminSession(c.env.DB, hash);
    return null;
  }
  if (now - Date.parse(s.last_seen_at) > TOUCH_EVERY_MS) {
    const expires = Math.min(Date.parse(s.created_at) + SESSION_MAX_MS, now + SESSION_IDLE_MS);
    await touchAdminSession(c.env.DB, hash, iso(now), iso(expires));
  }
  return { email: s.email };
};

// ------------------------------------------------------------------ pages

const PAGE_CSS = `
:root{--blue:#004dff;--ink:#071329;--muted:#53617c;--border:#dfe7f4;--bg:#f4f7fc;--danger:#b42318}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
main{width:100%;max-width:400px}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 18px;font-weight:800;font-size:15px;letter-spacing:-.01em}
.brand span{display:inline-block;width:12px;height:12px;background:#f0b429;transform:rotate(45deg);border-radius:2px}
.card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:28px 26px;box-shadow:0 18px 40px -24px rgba(7,19,41,.25)}
h1{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}
p.lead{margin:0 0 20px;color:var(--muted);font-size:14px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
input[type=email],input[type=password]{width:100%;font:inherit;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;background:#fff;color:var(--ink);margin:0 0 16px}
input:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,77,255,.15)}
button{width:100%;font:inherit;font-weight:700;padding:12px 16px;border:0;border-radius:999px;background:var(--blue);color:#fff;cursor:pointer}
button:hover{background:#003fd1}
.error{margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#fdecec;border:1px solid #f5bcbc;color:#7a1a1a;font-size:13.5px}
.note{margin:16px 0 0;color:var(--muted);font-size:12.5px;text-align:center}
`;

function page(title: string, body: string): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · SPC licence cards</title>
<style>${raw(PAGE_CSS)}</style>
</head>
<body><main>
<div class="brand"><span></span>SPC licence cards</div>
<div class="card">${raw(body)}</div>
</main></body>
</html>`;
}

export function loginPage(o: { key: string; csrf: string; email?: string; error?: string | null }): string {
  return page('Sign in', html`<h1>Sign in</h1>
<p class="lead">Staff access to the licence card admin.</p>
${o.error ? raw(html`<div class="error" role="alert">${o.error}</div>`) : ''}
<form method="post" action="/admin/login" autocomplete="on">
<input type="hidden" name="${CSRF_FIELD}" value="${o.csrf}">
<input type="hidden" name="key" value="${o.key}">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username" required maxlength="200" value="${o.email ?? ''}" ${o.email ? '' : raw('autofocus')}>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200" ${o.email ? raw('autofocus') : ''}>
<button type="submit">Sign in</button>
</form>
<p class="note">After 5 wrong passwords the account locks for 15 minutes.</p>`);
}

export function signedOutPage(): string {
  return page('Signed out', html`<h1>Signed out</h1>
<p class="lead">You have signed out of the licence card admin. Use your sign-in link to come back.</p>`);
}

const notFound = (c: Context<AppEnv>): Response => c.text('Not found', 404);

// ------------------------------------------------------------------ handlers

export interface AuthHandlers {
  showLogin(c: Context<AppEnv>): Promise<Response>;
  doLogin(c: Context<AppEnv>): Promise<Response>;
  doLogout(c: Context<AppEnv>): Promise<Response>;
}

export function createAuthHandlers(o: { rate?: RateRule; now?: () => number } = {}): AuthHandlers {
  const limiter = new FixedWindowLimiter(o.rate ?? LOGIN_RATE, o.now ? { now: o.now } : {});
  const clock = o.now ?? Date.now;
  const FAILED = `That email and password didn't work. After ${LOCK_AFTER} wrong tries the account locks for 15 minutes.`;

  return {
    async showLogin(c) {
      const key = c.req.query('key');
      if (!(await loginKeyMatches(c, key))) return notFound(c);
      if (await sessionVerifier(c)) return c.redirect('/admin', 303);
      return c.html(loginPage({ key: key ?? '', csrf: ensureCsrf(c) }));
    },

    async doLogin(c) {
      let body: Record<string, unknown> = {};
      try { body = (await c.req.parseBody()) as Record<string, unknown>; } catch { /* empty */ }
      const str = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
      const key = str('key');
      if (!(await loginKeyMatches(c, key))) return notFound(c);

      const ip = c.req.header('CF-Connecting-IP') ?? null;
      const decision = limiter.hit(ip ? rateKeyForIp(ip) : 'unknown');
      const email = str('email').trim().slice(0, 200);
      const again = (error: string, status: 400 | 401 | 403 | 429): Response =>
        c.html(loginPage({ key, csrf: ensureCsrf(c), email, error }), status);

      if (!decision.allowed) {
        c.header('Retry-After', String(decision.retryAfterSec));
        return again(`Too many sign-in attempts from here. Try again in ${Math.ceil(decision.retryAfterSec / 60)} minutes.`, 429);
      }
      if (csrfFailure(c, body)) return again('This page had expired. Please sign in again.', 403);

      const password = str('password');
      if (!email || !password || password.length > 200) return again(FAILED, 400);

      const user = await findAdminByEmail(c.env.DB, email);
      const now = clock();
      if (!user) {
        await burnPasswordCheck(password);
        console.warn('admin sign-in failed', { email, ip, reason: 'unknown' });
        return again(FAILED, 401);
      }
      const locked = user.locked_until !== null && Date.parse(user.locked_until) > now;
      const ok = await verifyPassword(password, user.password_hash);
      if (locked || !ok) {
        if (!locked) await recordAdminFailure(c.env.DB, user.id, LOCK_AFTER, iso(now + LOCK_MS));
        console.warn('admin sign-in failed', { email: user.email, ip, reason: locked ? 'locked' : 'password' });
        return again(FAILED, 401);
      }

      await recordAdminLogin(c.env.DB, user.id, iso(now));
      const token = randomSecret(48);
      await insertAdminSession(c.env.DB, await sha256Hex(token), user.id, iso(now), iso(now + SESSION_IDLE_MS), ip);
      setCookie(c, sessionCookieName(c), token, {
        path: '/', httpOnly: true, secure: isHttps(c), sameSite: 'Strict', maxAge: SESSION_MAX_MS / 1000,
      });
      console.log('admin signed in', { email: user.email, ip });
      return c.redirect('/admin', 303);
    },

    async doLogout(c) {
      const token = getCookie(c, sessionCookieName(c));
      if (token && SESSION_RE.test(token)) await deleteAdminSession(c.env.DB, await sha256Hex(token));
      deleteCookie(c, sessionCookieName(c), { path: '/', secure: isHttps(c) });
      return c.html(signedOutPage());
    },
  };
}
