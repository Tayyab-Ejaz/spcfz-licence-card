// Per-address rate limits in front of the routes (src/index.ts, src/util/rate-limit.ts).
import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../src/util/rate-limit.js';
import { createApp } from '../src/index.js';
import { createTestEnv } from './env.js';

describe('FixedWindowLimiter', () => {
  it('allows up to the limit, then refuses until the window resets', () => {
    let t = 1_000_000;
    const l = new FixedWindowLimiter({ limit: 3, windowMs: 60_000 }, { now: () => t });
    expect([1, 2, 3].map(() => l.hit('a').allowed)).toEqual([true, true, true]);
    const d = l.hit('a');
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSec).toBe(60);
    t += 30_000;
    expect(l.hit('a').retryAfterSec).toBe(30);
    t += 30_000;
    expect(l.hit('a').allowed).toBe(true);
  });

  it('counts keys separately', () => {
    const l = new FixedWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('b').allowed).toBe(true);
    expect(l.hit('a').allowed).toBe(false);
  });

  it('never tracks more than maxKeys', () => {
    let t = 0;
    const l = new FixedWindowLimiter({ limit: 5, windowMs: 1000 }, { maxKeys: 100, now: () => t });
    for (let i = 0; i < 1000; i++) l.hit(`ip-${i}`);
    expect(l.size).toBeLessThanOrEqual(100);
    t += 2000;
    l.hit('fresh');
    expect(l.size).toBe(1);
  });

  it('rejects a nonsensical rule', () => {
    expect(() => new FixedWindowLimiter({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
  });
});

describe('app rate limits', () => {
  const env = createTestEnv();
  const req = (path: string, ip: string, init: RequestInit = {}) =>
    createAppFor().request(path, { ...init, headers: { 'CF-Connecting-IP': ip, ...(init.headers ?? {}) } }, env);
  let shared: ReturnType<typeof createApp> | null = null;
  function createAppFor() {
    shared ??= createApp({ limits: { page: { limit: 3, windowMs: 60_000 }, beacon: { limit: 2, windowMs: 60_000 }, intakeUnlisted: { limit: 2, windowMs: 60_000 } } });
    return shared;
  }

  it('limits page requests per address with a Retry-After header', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await req('/c/AAAAAAAAAAAAAAAAAAAAAA', '192.0.2.1')).status);
    expect(codes).toEqual([404, 404, 404, 429]);
    const limited = await req('/c/AAAAAAAAAAAAAAAAAAAAAA', '192.0.2.1');
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    expect((await req('/c/AAAAAAAAAAAAAAAAAAAAAA', '192.0.2.2')).status).toBe(404);
  });

  it('limits the beacon separately from page views', async () => {
    const beacon = () => req('/c/AAAAAAAAAAAAAAAAAAAAAA/m', '192.0.2.3', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const codes = [(await beacon()).status, (await beacon()).status, (await beacon()).status];
    expect(codes[2]).toBe(429);
    expect(codes.slice(0, 2)).not.toContain(429);
    expect((await req('/c/AAAAAAAAAAAAAAAAAAAAAA', '192.0.2.3')).status).toBe(404);
  });

  it('caps webhook calls from unlisted addresses before they reach the event log', async () => {
    const hook = (ip: string) => req('/v1/licence-issued', ip, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const codes = [(await hook('192.0.2.9')).status, (await hook('192.0.2.9')).status, (await hook('192.0.2.9')).status];
    expect(codes).toEqual([403, 403, 429]);
    const limited = await hook('192.0.2.9');
    expect(await limited.json()).toEqual({ status: 'rejected', errors: ['rate limited'] });
    const logged = env.db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE source_ip = '192.0.2.9'").get() as { n: number };
    expect(logged.n).toBe(2);
  });

  it('never limits the ERP allowlist', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await req('/v1/licence-issued', '203.0.113.10', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status);
    }
    expect(codes).not.toContain(429);
  });

  it('leaves health checks and the admin alone', async () => {
    for (let i = 0; i < 10; i++) expect((await req('/healthz', '192.0.2.50')).status).toBe(200);
  });
});
