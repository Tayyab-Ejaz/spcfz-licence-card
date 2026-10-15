// Cloudflare Access verification for /admin (ARCHITECTURE C7, section 8).
// The Access policy in front of the Worker is the real gate; this check makes the routes useless if it is removed.
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../types';

export type AccessVerifier = (c: Context<AppEnv>) => Promise<{ email: string } | null>;

type JwksGetter = ReturnType<typeof createRemoteJWKSet>;
const jwksByTeam = new Map<string, JwksGetter>();

const TEAM_RE = /^[a-z0-9-]+$/i;

/** Accepts "spcfz" or "spcfz.cloudflareaccess.com"; returns the bare team name or null. */
export function normaliseTeam(raw: string | undefined): string | null {
  const team = (raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.cloudflareaccess\.com\/?$/, '');
  return team && TEAM_RE.test(team) ? team : null;
}

export function isAccessConfigured(env: Pick<AppEnv['Bindings'], 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>): boolean {
  return normaliseTeam(env.ACCESS_TEAM_DOMAIN) !== null && (env.ACCESS_AUD ?? '').trim().length > 0;
}

function jwksFor(team: string): JwksGetter {
  let getter = jwksByTeam.get(team);
  if (!getter) {
    getter = createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
    jwksByTeam.set(team, getter);
  }
  return getter;
}

export const verifyAccessJwt: AccessVerifier = async (c) => {
  const team = normaliseTeam(c.env.ACCESS_TEAM_DOMAIN);
  const aud = (c.env.ACCESS_AUD ?? '').trim();
  if (!team || !aud) return null;

  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwksFor(team), {
      issuer: `https://${team}.cloudflareaccess.com`,
      audience: aud,
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    return email ? { email } : null;
  } catch (err) {
    console.warn('access jwt rejected', { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
};
