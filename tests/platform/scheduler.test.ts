import { describe, expect, it, vi } from 'vitest';
import { getSettingRaw, setSettingRaw } from '../../src/db/cards.js';
import { LAST_RUN_KEY, Scheduler, isRunOverdue, nextDailyRun } from '../../src/platform/scheduler.js';
import { createTestEnv } from '../env.js';

const env = createTestEnv();

describe('nextDailyRun', () => {
  it('is the next 01:15 UTC (05:15 Asia/Dubai), strictly after now', () => {
    expect(nextDailyRun(new Date('2026-10-15T00:00:00Z')).toISOString()).toBe('2026-10-15T01:15:00.000Z');
    expect(nextDailyRun(new Date('2026-10-15T01:14:59Z')).toISOString()).toBe('2026-10-15T01:15:00.000Z');
    expect(nextDailyRun(new Date('2026-10-15T01:15:00Z')).toISOString()).toBe('2026-10-16T01:15:00.000Z');
    expect(nextDailyRun(new Date('2026-10-15T23:59:59Z')).toISOString()).toBe('2026-10-16T01:15:00.000Z');
    expect(nextDailyRun(new Date('2026-12-31T02:00:00Z')).toISOString()).toBe('2027-01-01T01:15:00.000Z');
  });
});

describe('isRunOverdue', () => {
  const now = new Date('2026-10-15T08:00:00Z');
  it('is true with no record, a bad record, or one older than a day', () => {
    expect(isRunOverdue(null, now)).toBe(true);
    expect(isRunOverdue('', now)).toBe(true);
    expect(isRunOverdue('yesterday-ish', now)).toBe(true);
    expect(isRunOverdue('2026-10-14T07:59:59Z', now)).toBe(true);
    expect(isRunOverdue('2026-10-14T08:00:01Z', now)).toBe(false);
    expect(isRunOverdue('2026-10-15T01:15:00Z', now)).toBe(false);
  });
});

describe('Scheduler', () => {
  it('runs the task on start when the last run is overdue and records the time', async () => {
    const task = vi.fn(async () => undefined);
    const clock = { now: new Date('2026-10-15T08:00:00Z') };
    const scheduler = new Scheduler(env, task, { now: () => clock.now, log: () => undefined });
    await setSettingRaw(env.DB, LAST_RUN_KEY, '2026-10-13T01:15:00.000Z');
    await scheduler.start();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await getSettingRaw(env.DB, LAST_RUN_KEY)).toBe('2026-10-15T08:00:00.000Z'));
    expect(scheduler.nextRun().toISOString()).toBe('2026-10-16T01:15:00.000Z');
    await scheduler.stop();
  });

  it('does not run on start when the last run is recent', async () => {
    const task = vi.fn(async () => undefined);
    const clock = { now: new Date('2026-10-15T08:00:00Z') };
    await setSettingRaw(env.DB, LAST_RUN_KEY, '2026-10-15T01:15:00.000Z');
    const scheduler = new Scheduler(env, task, { now: () => clock.now, log: () => undefined });
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(task).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it('a failing task is logged and the last run is left unchanged; run() does not overlap', async () => {
    const logs: string[] = [];
    await setSettingRaw(env.DB, LAST_RUN_KEY, '2026-10-15T01:15:00.000Z');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const task = vi.fn(async () => {
      await gate;
      throw new Error('boom');
    });
    const scheduler = new Scheduler(env, task, { now: () => new Date('2026-10-15T08:00:00Z'), log: (m) => logs.push(m) });
    const a = scheduler.run('manual');
    const b = scheduler.run('manual');
    expect(a).toBe(b);
    release();
    await a;
    expect(task).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes('failed'))).toBe(true);
    expect(await getSettingRaw(env.DB, LAST_RUN_KEY)).toBe('2026-10-15T01:15:00.000Z');
  });
});
