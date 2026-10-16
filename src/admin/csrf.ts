// Double-submit CSRF for the admin forms: a random value in a Secure, HttpOnly, SameSite=Strict cookie,
// echoed as a hidden `_csrf` field and compared on every POST. Mutations also require same-origin Sec-Fetch-Site.
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../types.js';
import { randomSecret } from '../util/crypto.js';

export const CSRF_COOKIE = 'admin_csrf';
export const CSRF_FIELD = '_csrf';
const CSRF_RE = /^[0-9A-Za-z]{32}$/;

/** Values minted during this request, so the first page a browser loads already carries a matching field. */
const issued = new WeakMap<Request, string>();

/** Returns the session's CSRF value, minting and setting the cookie when there is none. */
export function ensureCsrf(c: Context<AppEnv>): string {
  const fromCookie = getCookie(c, CSRF_COOKIE);
  if (fromCookie && CSRF_RE.test(fromCookie)) return fromCookie;
  let value = issued.get(c.req.raw);
  if (!value) {
    value = randomSecret(32);
    issued.set(c.req.raw, value);
    setCookie(c, CSRF_COOKIE, value, {
      path: '/admin',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
      maxAge: 60 * 60 * 12,
    });
  }
  return value;
}

/** The current CSRF value for forms rendered in this response. */
export function csrfToken(c: Context<AppEnv>): string {
  return ensureCsrf(c);
}

/**
 * Null when the POST is acceptable; otherwise a short reason. The caller answers 403.
 * `body` is the parsed form body.
 */
export function csrfFailure(c: Context<AppEnv>, body: Record<string, unknown>): string | null {
  const site = c.req.header('Sec-Fetch-Site');
  if (site !== undefined && site !== 'same-origin') return 'cross-site request';
  const cookie = getCookie(c, CSRF_COOKIE);
  if (!cookie || !CSRF_RE.test(cookie)) return 'missing session cookie';
  const field = body[CSRF_FIELD];
  if (typeof field !== 'string' || field !== cookie) return 'form token mismatch';
  return null;
}
