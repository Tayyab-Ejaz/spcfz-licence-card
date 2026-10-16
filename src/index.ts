// The Hono application. Routers and handlers live in their own folders; this file only wires them.
// src/server.ts builds the Env, serves `app`, and runs the queue worker and the daily scheduler.
import { Hono } from 'hono';
import type { AppEnv } from './types.js';
import { intakeRoutes } from './intake/routes.js';
import { pageRoutes } from './page/routes.js';
import { adminRoutes } from './admin/routes.js';

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

export { app };
export default app;
