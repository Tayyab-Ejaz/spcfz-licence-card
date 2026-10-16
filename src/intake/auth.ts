// Webhook authentication: source IP allowlist, then the per-route shared secret (ARCHITECTURE D7, section 4 and 9).
import { timingSafeEqualStr } from '../util/crypto.js';
import { ipAllowed, parseAllowlist } from '../util/ip.js';

export type AuthFailure = { status: 401 | 403; reason: string };

/** `X-SPC-Webhook-Secret: <x>`, else `Authorization: Bearer <x>`; null when neither carries a value. */
export function extractSecret(headers: Headers): string | null {
  const direct = headers.get('x-spc-webhook-secret')?.trim();
  if (direct) return direct;
  const auth = headers.get('authorization')?.trim();
  if (auth) {
    const m = /^Bearer\s+(.+?)\s*$/i.exec(auth);
    const token = m?.[1];
    if (token) return token;
  }
  return null;
}

/**
 * True when `provided` equals the current or the previous secret, compared in constant time.
 * An unconfigured route (both secrets empty or undefined) accepts nothing. An empty previous is skipped.
 */
export async function checkSecret(
  provided: string | null,
  current: string | undefined,
  previous: string | undefined,
): Promise<boolean> {
  if (!provided) return false;
  const given: string = provided;
  const candidates = [current, previous].filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (candidates.length === 0) return false;
  const results = await Promise.all(candidates.map((secret) => timingSafeEqualStr(given, secret)));
  return results.includes(true);
}

/** `c_ip` is the CF-Connecting-IP header; `allowlistVar` is the raw ERP_IP_ALLOWLIST var. Empty list allows nothing. */
export function checkIp(c_ip: string | undefined, allowlistVar: string): boolean {
  return ipAllowed(c_ip, parseAllowlist(allowlistVar));
}

/** Both checks in contract order. Null means the request may proceed. */
export async function authorise(
  c_ip: string | undefined,
  headers: Headers,
  allowlistVar: string,
  current: string | undefined,
  previous: string | undefined,
): Promise<AuthFailure | null> {
  if (!checkIp(c_ip, allowlistVar)) return { status: 403, reason: 'source address not allowed' };
  if (!(await checkSecret(extractSecret(headers), current, previous))) return { status: 401, reason: 'invalid secret' };
  return null;
}
