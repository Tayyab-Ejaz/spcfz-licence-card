# Developer notes

## State

Ported on 15 and 16 October 2026 from Cloudflare Workers to a Node 22
service in Docker (docs/PORT-TO-NODE.md). Typecheck clean, all tests
passing, `npm run build` working, and a local end-to-end run rendered all
eight images in about six seconds. Live on 13.206.34.102 since 16 October
2026 (docs/RUNBOOK.md). The same day the personal page became the studio and
the server-side render (queue, Chromium, image storage) was retired.

## Toolchain

Node 22 via nvm in `~/.nvm` (loaded by `~/.zshrc`). In a fresh shell:

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
```

npm 12 runs install scripts only for packages listed under `allowScripts`
in `package.json` (esbuild, better-sqlite3, puppeteer). After a version bump
of one of them: `npm install-scripts approve <pkg>` then `npm rebuild <pkg>`.
puppeteer (a development dependency) downloads Chrome for Testing into
`~/.cache/puppeteer`; only the design comparison and browser checks use it.

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
| `src/platform/` | SQLite database, config, migrations, scheduler, backup, client address, Cloudflare ranges |
| `src/intake` | webhook checks, field mapping, validation, idempotent upsert |
| `src/page` | personal page, image delivery, status, metric beacon |
| `src/admin` | Cloudflare Access verification and staff screens |
| `src/db` | every SQL statement |
| `src/util` | tokens, hashing, HTML escaping, dates, IP allowlist, CSV, background tasks |
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

## Customer studio (client/)

The personal page is a React app built from the approved design. Sources:

| Path | What |
|---|---|
| `design/source/{studio,mobile}/template.html` | the design's templates, unpacked from the exports |
| `design/source/{studio,mobile}/logic.js` | the design's logic classes, verbatim; never edit by hand |
| `design/source/assets/` | fonts and images, named by content hash |
| `client/` | renderer (`dc.js`), design-system components (`ds.js`), data injection (`card-data.js`), entry (`main.js`) |
| `tools/build-studio.mjs` | design + client → `public/studio/` (run by `npm run build`) |

`npm run build` compiles the server and the studio. `client/generated/` and
`public/` are build output and are not committed.

### Updating the design

1. Export both studio designs from Claude Design as Standalone HTML.
2. Unpack them:
   ```
   node tools/extract-design.mjs "<…>/License Announcement Studio - Standalone.html" studio
   node tools/extract-design.mjs "<…>/License Announcement Mobile - Standalone.html" mobile
   ```
3. `npm run build`. If a data patch in `tools/build-studio.mjs` no longer
   matches (the designer moved the sample company, date, activity, licence
   number or portal link), the build stops and names it; update the patch.
4. Prove it: `npm run compare-design -- "<dir with the exports>" <out dir>`.
   Every state should report 0 differing pixels. Diff images land in the
   out dir.
5. Commit `design/source/` with the code.
