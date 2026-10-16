# Developer notes

## State

Ported on 15 and 16 October 2026 from Cloudflare Workers to a Node 22
service in Docker (docs/PORT-TO-NODE.md). Typecheck clean, all tests
passing, `npm run build` working, and a local end-to-end run rendered all
eight images in about six seconds. Live on 13.206.34.102 since 16 October
2026 (docs/RUNBOOK.md).

## Toolchain

Node 22 via nvm in `~/.nvm` (loaded by `~/.zshrc`). In a fresh shell:

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
```

npm 12 runs install scripts only for packages listed under `allowScripts`
in `package.json` (esbuild, better-sqlite3, puppeteer). After a version bump
of one of them: `npm install-scripts approve <pkg>` then `npm rebuild <pkg>`.
puppeteer's install script downloads Chrome for Testing into
`~/.cache/puppeteer`; that is the browser used on this Mac.

```
npm install
npm run typecheck
npm test
npm run build
cp .env.example .env && npm run dev     # http://localhost:8787
```

With the `.env.example` defaults, post a test licence from this machine:

```
curl -X POST http://localhost:8787/v1/test/licence-issued \
  -H 'content-type: application/json' -H 'X-SPC-Webhook-Secret: dev-test-secret' \
  -d '{"licence_number":"SPC-2026-00001","company_name_en":"Nimbus Publishing FZE"}'
```

The answer's `page_url` opens the card a few seconds later.

## Layout

| Path | Owns |
|---|---|
| `src/server.ts` | process entry: config, migrations, queue worker, scheduler, HTTP |
| `src/platform/` | SQLite database, filesystem bucket, SQLite queue, config, migrations, scheduler, backup, client address, Cloudflare ranges |
| `src/intake` | webhook checks, field mapping, validation, idempotent upsert |
| `src/render` | queue consumer, browser session, HTML template, fonts |
| `src/page` | personal page, image delivery, status, metric beacon |
| `src/admin` | Cloudflare Access verification and staff screens |
| `src/db` | every SQL statement |
| `src/util` | tokens, hashing, HTML escaping, dates, IP allowlist, CSV, background tasks |
| `templates/` | placeholder design and embedded fonts |
| `migrations/` | SQLite schema, applied at startup |
| `deploy/` | Dockerfile companions: run script, env example, Apache site, Cloudflare ranges |
| `tools/deploy.sh` | deployment from this Mac, one subcommand per approval |

## Conventions

- Hono routers, one per folder, exported as `xxxRoutes`.
- All HTML goes through the `html` tagged template in `src/util/html.ts`.
- Nothing from the ERP payload is stored except the canonical fields.
- SQL uses `?1`-style placeholders. The SQLite adapter binds them by number;
  better-sqlite3 rejects them as positional values.
- Tests build a fresh environment per file with `tests/env.ts`: temp SQLite,
  temp image folder, queue worker off. `flushBackground()` waits for
  fire-and-forget work such as metric counters.

## Things learned the hard way

- better-sqlite3 treats `?1` as a named parameter. Spreading positional
  values fails with "Too many parameter values were provided".
- Inside the container the socket peer is the Docker gateway, so the
  Cloudflare check happens in Apache and the app runs `TRUST_PROXY=local-proxy`.
- Under Workers, `routes` was inherited by every environment. That design is
  gone, but the lesson stands: check that nothing but production can claim
  licensed.spcfz.ae.
