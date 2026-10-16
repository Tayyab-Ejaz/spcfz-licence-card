// In-process fixed-window rate limiting per client address. Defence in depth: Cloudflare's own rules sit in
// front, but the service must not depend on them. One process serves the whole site, so in-memory counters
// are exact; they reset on restart, which is acceptable for abuse control.
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';

export interface RateRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; what the Retry-After header carries. */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface LimiterOptions {
  /** Upper bound on tracked keys, so a flood of distinct addresses cannot grow memory without limit. */
  maxKeys?: number;
  now?: () => number;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(readonly rule: RateRule, opts: LimiterOptions = {}) {
    if (!(rule.limit > 0) || !(rule.windowMs > 0)) throw new RangeError('rate rule needs a positive limit and window');
    this.maxKeys = opts.maxKeys ?? 50_000;
    this.now = opts.now ?? Date.now;
  }

  hit(key: string): RateDecision {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (!b && this.buckets.size >= this.maxKeys) this.evict(now);
      b = { count: 0, resetAt: now + this.rule.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    return {
      allowed: b.count <= this.rule.limit,
      remaining: Math.max(0, this.rule.limit - b.count),
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }

  /** Tracked keys; for tests and diagnostics. */
  get size(): number {
    return this.buckets.size;
  }

  private evict(now: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    // Still full of live windows: drop the oldest-inserted keys. Under a flood this forgets some counters,
    // which errs towards letting requests through rather than towards unbounded memory.
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

export interface RateLimitOptions {
  /** Which requests this limiter counts; others pass untouched. */
  applies: (c: Context<AppEnv>) => boolean;
  /** The bucket key; null means "do not limit" (for example an allowlisted ERP address). */
  key: (c: Context<AppEnv>) => string | null;
  onLimit: (c: Context<AppEnv>, d: RateDecision) => Response | Promise<Response>;
}

export function rateLimit(limiter: FixedWindowLimiter, o: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!o.applies(c)) return next();
    const key = o.key(c);
    if (key === null) return next();
    const d = limiter.hit(key);
    if (!d.allowed) return o.onLimit(c, d);
    return next();
  };
}
