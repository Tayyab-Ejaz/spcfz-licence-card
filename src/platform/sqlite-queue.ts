// Queue-shaped render queue over a SQLite `jobs` table with an in-process worker
// (docs/PORT-TO-NODE.md section 2, migrations/0002_jobs.sql).
//
// `send(body)` inserts a row and nudges the worker. The worker claims the oldest row that is due, wraps
// it in a MessageBatch-shaped object with ack() / retry({ delaySeconds }) and hands it to the existing
// consumer (`handleRenderBatch`). Acked jobs are deleted, retried jobs go back to `queued` with a new
// `available_at`, and a job that has used up its attempts is handed to `handleDeadLetters` and parked
// as `dead`. One job runs at a time, in order; rows survive a restart.
import type { Env, Message, MessageBatch, Queue, RenderJob } from '../types.js';
import { handleDeadLetters, handleRenderBatch } from '../render/consumer.js';
import { ulid } from '../util/crypto.js';
// Ties on time are broken by rowid (insertion order): ULIDs from the same millisecond sort randomly.
import type { SqliteDb } from './sqlite-db.js';

export const RENDER_QUEUE_NAME = 'spcfz-licence-card-render';
export const DEAD_LETTER_QUEUE_NAME = 'spcfz-licence-card-dlq';
/** Deliveries before a job is dead-lettered: the first attempt plus two retries. */
export const DEFAULT_MAX_ATTEMPTS = 3;

export type JobState = 'queued' | 'running' | 'dead';

export interface JobRow {
  id: string;
  queue: string;
  body: RenderJob;
  attempts: number;
  available_at: string;
  state: JobState;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

type RawJob = Omit<JobRow, 'body'> & { body: string };

export interface QueueHandlers {
  render: (batch: MessageBatch<RenderJob>, env: Env) => Promise<void>;
  deadLetter: (batch: MessageBatch<RenderJob>, env: Env) => Promise<void>;
}

export interface SqliteQueueOptions {
  /** False keeps the worker off: send() only inserts rows. Tests use this. */
  enabled?: boolean;
  maxAttempts?: number;
  /** Replace the consumer, for tests. Defaults to the real render and dead-letter handlers. */
  handlers?: QueueHandlers;
  /** Clock, for tests. */
  now?: () => number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

const DEFAULT_HANDLERS: QueueHandlers = {
  render: (batch, env) => handleRenderBatch(batch, env),
  deadLetter: (batch, env) => handleDeadLetters(batch, env),
};

/** Back-off when the consumer throws instead of calling retry(): 30 s, 60 s, 90 s. */
function defaultDelaySeconds(attempts: number): number {
  return Math.min(Math.max(attempts, 1) * 30, 600);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseJob(r: RawJob): JobRow {
  let body: RenderJob;
  try {
    body = JSON.parse(r.body) as RenderJob;
  } catch {
    body = { card_id: '', content_hash: '' };
  }
  return { ...r, body };
}

export class SqliteQueue implements Queue<RenderJob> {
  readonly enabled: boolean;
  private readonly maxAttempts: number;
  private readonly handlers: QueueHandlers;
  private readonly now: () => number;
  private readonly log: (message: string, data?: Record<string, unknown>) => void;

  private env: Env | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private timerAt = Infinity;
  private loop: Promise<void> | null = null;

  constructor(private readonly db: SqliteDb, options: SqliteQueueOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.handlers = options.handlers ?? DEFAULT_HANDLERS;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((message, data) => console.log(message, data ?? ''));
  }

  // ---------------------------------------------------------------- producer side

  async send(body: RenderJob): Promise<void> {
    const ts = new Date(this.now()).toISOString();
    this.db.raw
      .prepare(
        `INSERT INTO jobs (id, queue, body, attempts, available_at, state, last_error, created_at, updated_at)
         VALUES (?, 'render', ?, 0, ?, 'queued', NULL, ?, ?)`,
      )
      .run(ulid(this.now()), JSON.stringify(body), ts, ts, ts);
    this.wake(0);
  }

  // ---------------------------------------------------------------- lifecycle

  /** Attach the Env the consumer needs and start the worker (when enabled). Safe to call once per process. */
  start(env: Env): void {
    this.env = env;
    this.stopped = false;
    // Rows left 'running' by a crash go back to the queue. Their attempt has already been counted.
    const recovered = this.db.raw
      .prepare(`UPDATE jobs SET state = 'queued', updated_at = ? WHERE state = 'running'`)
      .run(new Date(this.now()).toISOString()).changes;
    if (recovered) this.log('queue: recovered interrupted jobs', { count: recovered });
    this.wake(0);
  }

  /** Stop taking new jobs and wait for the one in flight. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = Infinity;
    if (this.loop) await this.loop;
  }

  // ---------------------------------------------------------------- inspection

  listJobs(): JobRow[] {
    return (this.db.raw.prepare('SELECT * FROM jobs ORDER BY created_at, rowid').all() as RawJob[]).map(parseJob);
  }

  countByState(): Record<JobState, number> {
    const out: Record<JobState, number> = { queued: 0, running: 0, dead: 0 };
    for (const row of this.db.raw.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').all() as Array<{ state: JobState; n: number }>) {
      out[row.state] = Number(row.n);
    }
    return out;
  }

  // ---------------------------------------------------------------- worker

  /**
   * Claim and process the oldest job that is due. Returns false when nothing is due. The worker loop
   * calls this until it returns false; tests call it directly.
   */
  async processNext(): Promise<boolean> {
    const env = this.env;
    if (!env) throw new Error('queue: start(env) before processing');
    const job = this.claim();
    if (!job) return false;
    await this.process(job, env);
    return true;
  }

  private claim(): JobRow | null {
    const nowIso = new Date(this.now()).toISOString();
    const tx = this.db.raw.transaction((): RawJob | null => {
      const row = this.db.raw
        .prepare(`SELECT * FROM jobs WHERE state = 'queued' AND available_at <= ? ORDER BY available_at, rowid LIMIT 1`)
        .get(nowIso) as RawJob | undefined;
      if (!row) return null;
      this.db.raw
        .prepare(`UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
        .run(nowIso, row.id);
      return { ...row, state: 'running', attempts: row.attempts + 1, updated_at: nowIso };
    });
    const claimed = tx();
    return claimed ? parseJob(claimed) : null;
  }

  private message(job: JobRow, onAck: () => void, onRetry: (o?: { delaySeconds?: number }) => void): Message<RenderJob> {
    return {
      id: job.id,
      timestamp: new Date(job.created_at),
      body: job.body,
      attempts: job.attempts,
      ack: onAck,
      retry: onRetry,
    };
  }

  private batch(queue: string, msg: Message<RenderJob>, onAck: () => void, onRetry: (o?: { delaySeconds?: number }) => void): MessageBatch<RenderJob> {
    return { queue, messages: [msg], ackAll: onAck, retryAll: onRetry };
  }

  private async process(job: JobRow, env: Env): Promise<void> {
    let acked = false;
    let retried = false;
    let delaySeconds: number | undefined;
    let lastError: string | null = null;
    const onAck = (): void => {
      acked = true;
    };
    const onRetry = (o?: { delaySeconds?: number }): void => {
      retried = true;
      if (o && typeof o.delaySeconds === 'number' && Number.isFinite(o.delaySeconds)) delaySeconds = Math.max(0, o.delaySeconds);
    };

    const msg = this.message(job, onAck, onRetry);
    try {
      await this.handlers.render(this.batch(RENDER_QUEUE_NAME, msg, onAck, onRetry), env);
    } catch (err) {
      // The consumer catches its own errors; this is a safety net. Cloudflare retries a throwing handler too.
      lastError = errorMessage(err);
      retried = !acked;
    }

    const nowIso = new Date(this.now()).toISOString();
    if (acked || !retried) {
      // Explicit ack, or the handler returned without saying anything: the message is done.
      this.db.raw.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
      return;
    }

    if (job.attempts >= this.maxAttempts) {
      await this.deadLetter(job, env, lastError);
      return;
    }

    const delay = delaySeconds ?? defaultDelaySeconds(job.attempts);
    const availableAt = new Date(this.now() + delay * 1000).toISOString();
    this.db.raw
      .prepare(`UPDATE jobs SET state = 'queued', available_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(availableAt, lastError, nowIso, job.id);
    this.log('queue: job retried', { id: job.id, card_id: job.body.card_id, attempts: job.attempts, delaySeconds: delay });
  }

  private async deadLetter(job: JobRow, env: Env, lastError: string | null): Promise<void> {
    const noop = (): void => undefined;
    const msg = this.message(job, noop, noop);
    try {
      await this.handlers.deadLetter(this.batch(DEAD_LETTER_QUEUE_NAME, msg, noop, noop), env);
    } catch (err) {
      this.log('queue: dead-letter handler failed', { id: job.id, message: errorMessage(err) });
    }
    this.db.raw
      .prepare(`UPDATE jobs SET state = 'dead', last_error = ?, updated_at = ? WHERE id = ?`)
      .run(lastError ?? `failed after ${job.attempts} attempts`, new Date(this.now()).toISOString(), job.id);
    this.log('queue: job dead-lettered', { id: job.id, card_id: job.body.card_id, attempts: job.attempts });
  }

  /** Schedule a worker pass in `delayMs`, unless an earlier one is already scheduled. */
  private wake(delayMs: number): void {
    if (!this.enabled || !this.env || this.stopped) return;
    const at = this.now() + delayMs;
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerAt = Infinity;
      this.runLoop();
    }, Math.max(0, delayMs));
    this.timer.unref();
  }

  private runLoop(): void {
    if (this.loop || this.stopped) return;
    this.loop = (async () => {
      try {
        while (!this.stopped) {
          if (!(await this.processNext())) break;
        }
      } catch (err) {
        this.log('queue: worker loop error', { message: errorMessage(err) });
      } finally {
        this.loop = null;
        this.armForFuture();
      }
    })();
  }

  /** After draining, sleep until the earliest retry comes due. */
  private armForFuture(): void {
    if (this.stopped) return;
    const row = this.db.raw.prepare(`SELECT MIN(available_at) AS next FROM jobs WHERE state = 'queued'`).get() as { next: string | null } | undefined;
    if (!row?.next) return;
    this.wake(Math.max(0, Date.parse(row.next) - this.now()));
  }
}
