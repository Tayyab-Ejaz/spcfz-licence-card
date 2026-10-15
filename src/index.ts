// Entry point. Routers and handlers live in their own folders; this file only wires them.
import { Hono } from 'hono';
import type { AppEnv, Env, RenderJob } from './types';
import { intakeRoutes } from './intake/routes';
import { pageRoutes } from './page/routes';
import { adminRoutes } from './admin/routes';
import { handleDeadLetters, handleRenderBatch } from './render/consumer';
import { runHousekeeping } from './cron';

const app = new Hono<AppEnv>();

app.get('/', (c) => c.redirect('https://www.spcfz.ae/', 302));
app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

app.route('/', intakeRoutes);
app.route('/', pageRoutes);
app.route('/admin', adminRoutes);

app.notFound((c) => c.text('Not found', 404));
app.onError((err, c) => {
  console.error('unhandled', { path: c.req.path, message: err instanceof Error ? err.message : String(err) });
  return c.text('Something went wrong', 500);
});

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<RenderJob>, env: Env, ctx: ExecutionContext): Promise<void> {
    if (batch.queue.endsWith('-dlq')) await handleDeadLetters(batch, env, ctx);
    else await handleRenderBatch(batch, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runHousekeeping(env));
  },
} satisfies ExportedHandler<Env, RenderJob>;

export { app };
