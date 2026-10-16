// The admin gate for a local copy (tools/local.mjs, docs/DEV.md). Cloudflare Access does not exist on a laptop,
// so LOCAL_ADMIN_EMAIL names the actor instead. src/platform/config.ts refuses the setting unless the service
// listens on loopback with TRUST_PROXY=off and BASE_URL on localhost; this check repeats the conditions per
// request, so a mistake in one place is not enough to open the admin.
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import type { AccessVerifier } from './access.js';
import { verifyAccessJwt } from './access.js';

/** 127.0.0.0/8, ::1, and the IPv4-mapped form of 127.x. */
export function isLoopbackIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::1' || s === '0:0:0:0:0:0:0:1') return true;
  const v4 = s.startsWith('::ffff:') ? s.slice(7) : s;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

export function isLocalAdminEnabled(env: Pick<AppEnv['Bindings'], 'LOCAL_ADMIN_EMAIL'>): boolean {
  return (env.LOCAL_ADMIN_EMAIL ?? '').trim().length > 0;
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The configured address, when the request comes from this machine (the socket peer, which server.ts puts in
 * CF-Connecting-IP under TRUST_PROXY=off) and names a loopback host on BASE_URL's port. The host check stops
 * DNS rebinding: a page elsewhere can point its own name at 127.0.0.1, but the browser still sends that name.
 */
export const verifyLocalAdmin: AccessVerifier = async (c: Context<AppEnv>) => {
  const email = (c.env.LOCAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!email || c.env.TRUST_PROXY !== 'off') return null;
  if (!isLoopbackIp(c.req.header('CF-Connecting-IP'))) return null;
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(c.env.BASE_URL);
    actual = new URL(c.req.url);
  } catch {
    return null;
  }
  return LOOPBACK_NAMES.has(actual.hostname.toLowerCase()) && actual.port === expected.port ? { email } : null;
};

/** The verifier the service uses: the local one when LOCAL_ADMIN_EMAIL is set, Cloudflare Access otherwise. */
export const verifyAdmin: AccessVerifier = (c) => (isLocalAdminEnabled(c.env) ? verifyLocalAdmin(c) : verifyAccessJwt(c));
