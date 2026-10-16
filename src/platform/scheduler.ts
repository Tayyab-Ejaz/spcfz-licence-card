// Daily job scheduler (docs/PORT-TO-NODE.md section 3): runs the daily task once a day at 05:15
// Asia/Dubai (01:15 UTC; the Gulf has no daylight saving) and on startup when the last recorded run is
// more than a day old. The last run is kept in the settings table so a restart does not lose it.
import type { Env } from '../types.js';
import { getSettingRaw, setSettingRaw } from '../db/cards.js';

export const DAILY_HOUR_UTC = 1;
export const DAILY_MINUTE_UTC = 15;
export const LAST_RUN_KEY = 'housekeeping_last_run';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The next 01:15:00 UTC strictly after `after`. */
export function nextDailyRun(after: Date): Date {
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), DAILY_HOUR_UTC, DAILY_MINUTE_UTC, 0, 0));
  if (next.getTime() <= after.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** True when there is no recorded run, it is unreadable, or it is older than a day. */
export function isRunOverdue(lastRun: string | null | undefined, now: Date, maxAgeMs = DAY_MS): boolean {
  if (!lastRun) return true;
  const t = Date.parse(lastRun);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > maxAgeMs;
}

export type DailyTask = (env: Env) => Promise<unknown>;

export interface SchedulerOptions {
  now?: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly now: () => Date;
  private readonly log: (message: string, data?: Record<string, unknown>) => void;

  constructor(private readonly env: Env, private readonly task: DailyTask, options: SchedulerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((message, data) => console.log(message, data ?? ''));
  }

  async lastRun(): Promise<string | null> {
    return getSettingRaw(this.env.DB, LAST_RUN_KEY);
  }

  /** Arms the daily timer and, when the last run is overdue, runs the task right away (not awaited). */
  async start(): Promise<void> {
    this.stopped = false;
    if (isRunOverdue(await this.lastRun(), this.now())) void this.run('startup');
    this.arm();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) await this.running;
  }

  /** Runs the task now unless a run is in progress; records the time when it succeeds. */
  run(reason: string): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      const started = this.now();
      this.log('scheduler: daily task starting', { reason });
      try {
        await this.task(this.env);
        await setSettingRaw(this.env.DB, LAST_RUN_KEY, started.toISOString());
        this.log('scheduler: daily task done', { reason, ms: this.now().getTime() - started.getTime() });
      } catch (err) {
        this.log('scheduler: daily task failed', { reason, message: err instanceof Error ? err.message : String(err) });
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** When the next run is due, for the health output and tests. */
  nextRun(): Date {
    return nextDailyRun(this.now());
  }

  private arm(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(1000, this.nextRun().getTime() - this.now().getTime());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run('daily').finally(() => this.arm());
    }, delay);
    this.timer.unref();
  }
}
