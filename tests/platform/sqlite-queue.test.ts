// The jobs-table queue and its worker, with the consumer replaced by stubs. Nothing here renders.
import path from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIGRATIONS_DIR, applyMigrations } from '../../src/platform/migrate.js';
import { SqliteDb } from '../../src/platform/sqlite-db.js';
import { DEAD_LETTER_QUEUE_NAME, RENDER_QUEUE_NAME, SqliteQueue } from '../../src/platform/sqlite-queue.js';
import type { QueueHandlers } from '../../src/platform/sqlite-queue.js';
import type { Env, MessageBatch, RenderJob } from '../../src/types.js';
import { tempDir } from '../env.js';

const JOB: RenderJob = { card_id: '01JA0000000000000000000000', content_hash: 'abc' };
const fakeEnv = { TEMPLATE_VERSION: 'placeholder-1' } as unknown as Env;

interface Harness {
  db: SqliteDb;
  queue: SqliteQueue;
  render: ReturnType<typeof vi.fn<QueueHandlers['render']>>;
  deadLetter: ReturnType<typeof vi.fn<QueueHandlers['deadLetter']>>;
  clock: { now: number };
  dir: string;
}

const open: Harness[] = [];

function harness(options: { enabled?: boolean; render?: QueueHandlers['render']; maxAttempts?: number } = {}): Harness {
  const dir = tempDir('spcfz-queue-');
  const db = SqliteDb.open(path.join(dir, 'q.sqlite'));
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = { now: Date.parse('2026-10-15T08:00:00.000Z') };
  const render = vi.fn<QueueHandlers['render']>(options.render ?? (async (batch) => batch.messages.forEach((m) => m.ack())));
  const deadLetter = vi.fn<QueueHandlers['deadLetter']>(async (batch) => batch.messages.forEach((m) => m.ack()));
  const queue = new SqliteQueue(db, {
    enabled: options.enabled ?? false,
    maxAttempts: options.maxAttempts,
    handlers: { render, deadLetter },
    now: () => clock.now,
    log: () => undefined,
  });
  const h: Harness = { db, queue, render, deadLetter, clock, dir };
  open.push(h);
  return h;
}

afterEach(async () => {
  for (const h of open.splice(0)) {
    await h.queue.stop();
    h.db.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});

describe('SqliteQueue', () => {
  it('send() inserts a queued row and, with the worker off, nothing else happens', async () => {
    const { queue, render } = harness();
    await queue.send(JOB);
    await queue.send({ ...JOB, content_hash: 'def' });
    const jobs = queue.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ queue: 'render', state: 'queued', attempts: 0, body: JOB, last_error: null });
    expect(jobs[0]?.available_at).toBe('2026-10-15T08:00:00.000Z');
    // Insertion order, even though both rows share a timestamp and their ULIDs sort randomly.
    expect(jobs[1]?.body).toEqual({ ...JOB, content_hash: 'def' });
    expect(queue.countByState()).toEqual({ queued: 2, running: 0, dead: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(render).not.toHaveBeenCalled();
  });

  it('delivers a MessageBatch-shaped object to the consumer and deletes the job on ack', async () => {
    const { queue, render } = harness();
    queue.start(fakeEnv);
    await queue.send(JOB);
    expect(await queue.processNext()).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    const [batch, env] = render.mock.calls[0]!;
    expect(env).toBe(fakeEnv);
    expect(batch.queue).toBe(RENDER_QUEUE_NAME);
    expect(batch.messages).toHaveLength(1);
    const msg = batch.messages[0]!;
    expect(msg.body).toEqual(JOB);
    expect(msg.attempts).toBe(1);
    expect(typeof msg.id).toBe('string');
    expect(msg.timestamp).toBeInstanceOf(Date);
    expect(typeof msg.ack).toBe('function');
    expect(typeof msg.retry).toBe('function');
    expect(typeof batch.ackAll).toBe('function');
    expect(typeof batch.retryAll).toBe('function');
    expect(queue.listJobs()).toEqual([]);
    expect(await queue.processNext()).toBe(false);
  });

  it('a handler that returns without ack or retry counts as an ack', async () => {
    const { queue } = harness({ render: async () => undefined });
    queue.start(fakeEnv);
    await queue.send(JOB);
    await queue.processNext();
    expect(queue.listJobs()).toEqual([]);
  });

  it('retry({ delaySeconds }) re-queues the job for exactly that much later and increments attempts', async () => {
    const { queue, clock } = harness({ render: async (batch) => batch.messages.forEach((m) => m.retry({ delaySeconds: 45 })) });
    queue.start(fakeEnv);
    await queue.send(JOB);
    expect(await queue.processNext()).toBe(true);
    const [job] = queue.listJobs();
    expect(job).toMatchObject({ state: 'queued', attempts: 1 });
    expect(Date.parse(job!.available_at) - clock.now).toBe(45_000);
    // Not due yet.
    clock.now += 44_000;
    expect(await queue.processNext()).toBe(false);
    clock.now += 1_000;
    expect(await queue.processNext()).toBe(true);
    expect(queue.listJobs()[0]?.attempts).toBe(2);
  });

  it('a throwing handler is retried with the default back-off and the error recorded', async () => {
    const { queue, clock } = harness({
      render: async () => {
        throw new Error('browser exploded');
      },
    });
    queue.start(fakeEnv);
    await queue.send(JOB);
    await queue.processNext();
    const [job] = queue.listJobs();
    expect(job?.state).toBe('queued');
    expect(job?.last_error).toBe('browser exploded');
    expect(Date.parse(job!.available_at) - clock.now).toBe(30_000);
  });

  it('dead-letters after three attempts, handing the same body to the dead-letter consumer', async () => {
    const { queue, clock, render, deadLetter } = harness({ render: async (batch) => batch.messages.forEach((m) => m.retry({ delaySeconds: 1 })) });
    queue.start(fakeEnv);
    await queue.send(JOB);
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await queue.processNext()).toBe(true);
      clock.now += 1_000;
    }
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls.map(([b]) => b.messages[0]?.attempts)).toEqual([1, 2, 3]);
    expect(deadLetter).toHaveBeenCalledTimes(1);
    const [dlq] = deadLetter.mock.calls[0]!;
    expect(dlq.queue).toBe(DEAD_LETTER_QUEUE_NAME);
    expect(dlq.messages[0]?.body).toEqual(JOB);
    expect(dlq.messages[0]?.attempts).toBe(3);
    const [job] = queue.listJobs();
    expect(job?.state).toBe('dead');
    expect(job?.attempts).toBe(3);
    expect(queue.countByState()).toEqual({ queued: 0, running: 0, dead: 1 });
    expect(await queue.processNext()).toBe(false);
  });

  it('a dead-letter consumer that throws still parks the job', async () => {
    const h = harness({ maxAttempts: 1, render: async (batch) => batch.messages.forEach((m) => m.retry()) });
    h.deadLetter.mockImplementation(async () => {
      throw new Error('dlq down');
    });
    h.queue.start(fakeEnv);
    await h.queue.send(JOB);
    await h.queue.processNext();
    expect(h.queue.listJobs()[0]?.state).toBe('dead');
  });

  it('start() puts jobs left running by a crash back in the queue', async () => {
    const { db, queue } = harness();
    await queue.send(JOB);
    db.raw.prepare("UPDATE jobs SET state = 'running', attempts = 1").run();
    queue.start(fakeEnv);
    expect(queue.listJobs()[0]).toMatchObject({ state: 'queued', attempts: 1 });
  });

  it('processes jobs oldest first', async () => {
    const seen: string[] = [];
    const { queue, clock } = harness({
      render: async (batch) => {
        for (const m of batch.messages) {
          seen.push(m.body.content_hash);
          m.ack();
        }
      },
    });
    queue.start(fakeEnv);
    await queue.send({ ...JOB, content_hash: 'first' });
    clock.now += 1;
    await queue.send({ ...JOB, content_hash: 'second' });
    while (await queue.processNext()) {
      // drain
    }
    expect(seen).toEqual(['first', 'second']);
  });

  it('with the worker on, send() is enough: the consumer runs on its own', async () => {
    const { queue, render } = harness({ enabled: true });
    queue.start(fakeEnv);
    await queue.send(JOB);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(queue.listJobs()).toEqual([]));
  });

  it('with the worker on, a retried job is picked up again when its delay has passed', async () => {
    let calls = 0;
    const { queue } = harness({
      enabled: true,
      render: async (batch) => {
        calls += 1;
        for (const m of batch.messages) {
          if (calls === 1) m.retry({ delaySeconds: 0.05 });
          else m.ack();
        }
      },
    });
    // The real clock drives timers here, so use it for availability too.
    (queue as unknown as { now: () => number }).now = Date.now;
    queue.start(fakeEnv);
    await queue.send(JOB);
    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 5000 });
    await vi.waitFor(() => expect(queue.listJobs()).toEqual([]));
  });

  it('processNext() refuses to run before start(env)', async () => {
    const { queue } = harness();
    await queue.send(JOB);
    await expect(queue.processNext()).rejects.toThrow(/start/);
  });
});

// Keep the type import used: the fake batch shape must satisfy MessageBatch.
const _shape: MessageBatch<RenderJob> | null = null;
void _shape;
