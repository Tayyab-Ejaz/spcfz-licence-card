// Fire-and-forget work that must not delay the response (counters, cache writes). Node has no
// `executionCtx.waitUntil`; this keeps the promises in a set so rejections are logged and tests can
// wait for everything queued so far with `flushBackground()` (docs/PORT-TO-NODE.md section 4).
const pending = new Set<Promise<unknown>>();

export function background(task: Promise<unknown> | (() => Promise<unknown>), label = 'background task'): void {
  const source = typeof task === 'function' ? Promise.resolve().then(task) : task;
  const tracked: Promise<unknown> = source
    .catch((err: unknown) => {
      console.error(`${label} failed`, { message: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      pending.delete(tracked);
    });
  pending.add(tracked);
}

/** Resolves once every background task queued so far (including ones they queue) has settled. */
export async function flushBackground(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

export function pendingBackground(): number {
  return pending.size;
}
