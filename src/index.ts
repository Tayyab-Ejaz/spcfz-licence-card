// The Hono application. Routers and handlers live in their own folders; this file only wires them.
// src/server.ts builds the Env, serves `app`, and runs the queue worker and the daily scheduler.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from './types.js';
import { intakeRoutes } from './intake/routes.js';
import { pageRoutes } from './page/routes.js';
import { adminRoutes } from './admin/routes.js';
import { createLinkedinRoutes } from './linkedin/routes.js';
import type { LinkedinRouteOptions } from './linkedin/routes.js';
import { fakeSigninRoutes } from './linkedin/fake.js';
import { studioStaticRoutes } from './page/studio.js';
import { ipAllowed, parseAllowlist, rateKeyForIp } from './util/ip.js';
import { FixedWindowLimiter, rateLimit } from './util/rate-limit.js';
import type { RateDecision, RateRule } from './util/rate-limit.js';

/** Per client address. The client address is resolved by src/server.ts and carried in CF-Connecting-IP. */
export interface RateLimits {
  /** GET/HEAD under /c/: the page, its status polling and the eight images. */
  page: RateRule;
  /** POST under /c/: the metric beacon. */
  beacon: RateRule;
  /** /v1/ from addresses NOT on the ERP allowlist; each rejection writes an event row, so this caps log growth. */
  intakeUnlisted: RateRule;
  /** "Post to LinkedIn": starting a post (POST /c/:token/linkedin, GET from the email) and the /linkedin/ pages. */
  linkedin: RateRule;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  page: { limit: 300, windowMs: 60_000 },
  beacon: { limit: 60, windowMs: 60_000 },
  intakeUnlisted: { limit: 20, windowMs: 60_000 },
  linkedin: { limit: 60, windowMs: 10 * 60_000 },
};

export interface AppOptions {
  limits?: Partial<RateLimits>;
  now?: () => number;
  linkedin?: LinkedinRouteOptions;
}

/** IPv4 address, or the /64 of an IPv6 address (see rateKeyForIp). */
const clientKey = (c: Context<AppEnv>): string => {
  const ip = c.req.header('CF-Connecting-IP');
  return ip ? rateKeyForIp(ip) : 'unknown';
};

function tooManyText(c: Context<AppEnv>, d: RateDecision): Response {
  c.header('Retry-After', String(d.retryAfterSec));
  c.header('Cache-Control', 'no-store');
  return c.text('Too many requests', 429);
}

export function createApp(o: AppOptions = {}): Hono<AppEnv> {
  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...(o.limits ?? {}) };
  const lo = o.now ? { now: o.now } : {};
  const page = new FixedWindowLimiter(limits.page, lo);
  const beacon = new FixedWindowLimiter(limits.beacon, lo);
  const intake = new FixedWindowLimiter(limits.intakeUnlisted, lo);
  const linkedin = new FixedWindowLimiter(limits.linkedin, lo);

  const app = new Hono<AppEnv>();

  app.use('/c/*', rateLimit(page, { applies: (c) => c.req.method === 'GET' || c.req.method === 'HEAD', key: clientKey, onLimit: tooManyText }));
  app.use('/c/*', rateLimit(beacon, { applies: (c) => c.req.method === 'POST', key: clientKey, onLimit: tooManyText }));
  const isLinkedin = (c: Context<AppEnv>): boolean => c.req.path.startsWith('/linkedin/') || /^\/c\/[^/]+\/linkedin$/.test(c.req.path);
  app.use('*', rateLimit(linkedin, { applies: isLinkedin, key: clientKey, onLimit: tooManyText }));
  app.use('/v1/*', rateLimit(intake, {
    applies: () => true,
    key: (c) => {
      const ip = c.req.header('CF-Connecting-IP');
      return ip && ipAllowed(ip, parseAllowlist(c.env.ERP_IP_ALLOWLIST)) ? null : clientKey(c);
    },
    onLimit: (c, d) => {
      c.header('Retry-After', String(d.retryAfterSec));
      return c.json({ status: 'rejected', errors: ['rate limited'] }, 429, { 'Cache-Control': 'no-store' });
    },
  }));

  app.get('/', (c) => c.redirect('https://www.spcfz.ae/', 302));
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));
  app.get('/favicon.ico', () => new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=86400' } }));

  app.route('/', studioStaticRoutes);
  app.route('/', intakeRoutes);
  app.route('/', createLinkedinRoutes(o.linkedin));
  app.route('/', fakeSigninRoutes);
  app.route('/', pageRoutes);
  app.route('/admin', adminRoutes);

  app.notFound((c) => c.text('Not found', 404));
  app.onError((err, c) => {
    console.error('unhandled', { path: c.req.path, message: err instanceof Error ? err.message : String(err) });
    return c.text('Something went wrong', 500);
  });
  return app;
}

const app = createApp();

export { app };
export default app;
