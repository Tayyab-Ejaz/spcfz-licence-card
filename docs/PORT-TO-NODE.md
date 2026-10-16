# Port to a self-hosted Node service

> **16 October 2026:** the render queue, the filesystem bucket and Chromium described below were retired when the personal page became the studio (docs/ARCHITECTURE.md sections 6 and 7). The rest of this document still describes the platform.

Decided by the user on 15 October 2026: the service runs on an SPC server
(AWS, 13.206.34.102, the marketing-dashboard box, Ubuntu 24.04 with aaPanel
Apache) instead of Cloudflare Workers. Cloudflare stays as the
DNS and proxy layer for licensed.spcfz.ae on the existing Pro zone, which
also provides Access for the admin login and the WAF rules. The Workers Paid
plan, Queues, R2, D1 and Browser Rendering are dropped.

This document is the contract for the port. ARCHITECTURE.md stays the
contract for behaviour; nothing a customer, the ERP or an admin sees changes.

## 1. Single target

One runtime: Node 22 on Linux. No dual Workers/Node build. Cloudflare-only
files go away: `wrangler.toml`, `src/assets.d.ts`, the `@cloudflare/*`
packages, `tests/env.d.ts`'s `Cloudflare.Env` declaration, and the deploy
workflow's Wrangler steps.

## 2. The `Env` object becomes a set of adapters

`src/types.ts` keeps the `Env` interface so the application code (intake,
render, page, admin, cron, db) changes as little as possible. Each binding
is replaced by a small adapter that implements the subset of the Cloudflare
API the code actually uses:

| Binding | Adapter | Backed by |
|---|---|---|
| `DB` | `src/platform/sqlite-db.ts`, D1-shaped: `prepare(sql).bind(...).first<T>() / all<T>() / run()`, `batch([...])`, `exec(sql)`; `run()` returns `{ meta: { changes } }`, `all()` returns `{ results }` | `better-sqlite3`, file `DATA_DIR/licence-card.sqlite`, WAL mode, `?1`-style positional parameters are native SQLite |
| `BUCKET` | `src/platform/fs-bucket.ts`, R2-shaped: `put(key, body, { httpMetadata })`, `get(key)` → `{ body: ReadableStream, httpEtag, httpMetadata, size } \| null`, `delete(key \| key[])`, `list({ prefix })` → `{ objects: [{ key }] }` | files under `DATA_DIR/images/<key>`; etag = sha1 of content stored beside the file as `<name>.meta.json` with contentType |
| `RENDER_QUEUE` | `src/platform/sqlite-queue.ts`: `send(body)` inserts into a `jobs` table (own migration) and nudges an in-process worker; the worker builds a `MessageBatch`-shaped object with `ack()` / `retry({ delaySeconds })` and calls the existing `handleRenderBatch`; after 3 failed attempts the job goes to `handleDeadLetters` | the SQLite file, `jobs(id, body, attempts, available_at, state)`; survives restarts; one job at a time |
| `BROWSER` | removed. `src/render/browser.ts` uses `puppeteer` (full package, downloads Chrome for Testing into the user's cache) with `headless: true`, `--no-sandbox`, `--disable-dev-shm-usage`; `CHROME_PATH` overrides the executable | the server's Chromium |
| `caches.default` | removed. Image URLs gain a version query `?v=<first 8 chars of content_hash>` so a regenerated card has a new URL; `purgeImageCache` becomes a no-op kept for call sites | Cloudflare's edge cache in front, driven by `Cache-Control` |

`Env` also gains `DATA_DIR`, `PORT`, `TRUST_PROXY` (see section 5) and the
existing vars and secrets, all read from `process.env` and an optional
`.env` file by `src/platform/config.ts`, which validates presence and types
and exits with a clear message when something is missing.

## 3. Entry points

- `src/server.ts`: builds the `Env`, runs migrations (`src/platform/migrate.ts`
  applies `migrations/*.sql` in order, tracked in a `_migrations` table),
  starts the queue worker, starts the scheduler, serves the Hono app with
  `@hono/node-server` on `PORT` (default 8787, loopback only).
- `src/platform/scheduler.ts`: runs `runHousekeeping` once a day at 05:15
  Asia/Dubai and on startup if the last run was more than a day ago (stored
  in `settings`).
- `src/index.ts` keeps exporting the Hono `app` and drops the Workers
  `queue` / `scheduled` handlers.

## 4. Code changes outside platform/

- `c.executionCtx.waitUntil(p)` → a helper `background(p)` in
  `src/util/background.ts` that logs rejections; Node has no execution
  context.
- `crypto.subtle.timingSafeEqual` → `timingSafeEqual` from `node:crypto`.
- Fonts: `fs.readFileSync` of the two `.woff2` files at module load; drop
  the import-as-ArrayBuffer trick.
- `src/render/browser.ts`: `puppeteer.launch({...})` instead of
  `puppeteer.launch(env.BROWSER)`; one browser per job as before.
- Image route: `ETag` from the adapter, `Cache-Control: public, max-age=31536000, immutable`
  now that URLs are versioned; no `caches.default`.
- Everything else (intake, validate, mapper, upsert, template, page, admin,
  cron, db/cards.ts) stays as is.

## 5. Trusting the proxy

Production chain: Cloudflare, then Apache on the host, then docker-proxy on
`127.0.0.1:8787`, then the container. Apache's `Require ip` block admits only
Cloudflare's ranges; mod_remoteip is not enabled on that server, so Apache
checks the real connecting address. Inside the container the socket peer is
the Docker bridge gateway, never a Cloudflare address.

`TRUST_PROXY` therefore has three values:

| Value | Client address | Used |
|---|---|---|
| `off` | the socket peer | local development and tests |
| `cloudflare` | `CF-Connecting-IP` only when the peer is in Cloudflare's ranges (fetched at startup, cached in `DATA_DIR`, bundled fallback) | an origin reached directly by Cloudflare |
| `local-proxy` | `CF-Connecting-IP` only when the peer is loopback or a private address, i.e. a reverse proxy on the same host that has already enforced Cloudflare-only | **production** |

Under `local-proxy`, a request without `CF-Connecting-IP` has an unknown
client address and the intake allowlist rejects it, which is the safe
failure. Cloudflare overwrites `CF-Connecting-IP` on every request, so a
visitor cannot forge it through Cloudflare, and Apache refuses anyone who
bypasses Cloudflare.

## 6. Tests

Vitest in the Node environment. `tests/env.ts` builds a fresh `Env` per test
file: SQLite in a temp file, images in a temp directory, a queue adapter with
the worker disabled, and applies the migrations. `createExecutionContext()`
and `waitOnExecutionContext()` are replaced by `background()`'s
`flushBackground()` helper that awaits everything queued so far. Test logic
and assertions stay the same; only the imports from `cloudflare:test` change.

## 7. Build, run, deploy

- `npm run build` = `tsc -p tsconfig.build.json` to `dist/`; `npm start` =
  `node dist/server.js`; `npm run dev` = `tsx watch src/server.ts`.
- **One Docker container on the host**, so nothing is installed on a server
  that runs other production portals. `Dockerfile` builds on
  `node:22-bookworm-slim` and adds Debian's `chromium`; the app runs as uid
  10001. `deploy/run.sh` starts it with `--restart unless-stopped`,
  `-p 127.0.0.1:8787:8787`, `--memory 1500m --memory-swap 1500m --cpus 2
  --pids-limit 512`, capped JSON logs, the env file
  `/opt/spcfz-licence-card/licence-card.env` (mode 600) and the data volume
  `/opt/spcfz-licence-card/data`. The host has no swap, so the memory cap
  is what protects MySQL, Postgres and the other sites.
- Apache: `deploy/apache-licensed.spcfz.ae.conf`, installed as
  `/www/server/panel/vhost/apache/licensed.spcfz.ae.conf`, proxies to the
  container and admits Cloudflare's ranges only. Its certificate is a copy of
  the `*.spcfz.ae` Cloudflare Origin certificate the coworking site already
  uses, in `/www/server/panel/vhost/cert/licensed.spcfz.ae/`. The file is
  added by hand and does not appear in aaPanel's site list.
- Deploy runs from the Mac with `tools/deploy.sh`, one subcommand per
  approval: `release` (upload the commit, build the image), `env-init` (once),
  `start`, `cert` (once), `vhost` (once). Every remote command is printed
  first; `--dry-run` prints only. Nothing runs without the user's approval for
  that step. CI on GitHub runs typecheck, tests, build and a syntax check of
  both scripts on every push.
- Backups: the host has none, by the user's decision. The daily housekeeping
  writes an online SQLite backup into `DATA_DIR/backups/` and keeps seven.
  That protects against a corrupt database, not against losing the server.

## 8. Order of work

1. Platform adapters and config, with their own unit tests.
2. Code changes in section 4; typecheck clean.
3. Test harness migration; the existing 152 tests pass under Node.
4. Server entry, scheduler, build scripts, deploy script, systemd unit and
   web server snippet in `deploy/`.
5. Update DEV.md, RUNBOOK.md, CLOUDFLARE-SETUP.md (now DNS, Access and WAF
   only) and README.md.
