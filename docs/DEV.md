# Developer notes

## State

Ported on 15 and 16 October 2026 from Cloudflare Workers to a Node 22
service in Docker (docs/PORT-TO-NODE.md). Live on 13.206.34.102 since
16 October 2026 (docs/RUNBOOK.md). The same day the personal page became the
studio and the server-side render (queue, Chromium, image storage) was
retired.

From 16 October 2026 the product is built and checked on the local copy
first (below). Production changes wait until SPC says the product is ready.

## Local copy

One command runs the whole product on this Mac:

```
npm run local
```

It compiles the service and the studio, starts them at
http://localhost:8787, and on first run loads the five sample licences
(`tools/erp-samples.mjs`) through the real test webhook. It then prints the
admin link and one link per card. Ctrl-C stops it.

| Option | Does |
|---|---|
| `--watch` | rebuilds and restarts on any change under `src/`, `client/`, `design/` or `migrations/`; refresh the browser after "reloaded" |
| `--seed` | loads the five samples again; the same licence numbers update the same five cards |
| `--fresh` | deletes the local database, then loads the samples |
| `--no-build` | starts the last build as it is |

Pass options after `--`, for example `npm run local -- --watch`.

The copy keeps its state in `~/.spcfz-licence-card/`, outside the repo,
because OneDrive should not sync a live SQLite file:

- `local.env` is written on first run, with this copy's own random webhook
  secrets. To change the port, change `PORT` and `BASE_URL` together.
- `data/` holds the database and its daily backups.
- `data/mail-outbox/` gets every welcome email as `.html` (open it in a
  browser) and `.txt`; nothing is sent (`MAIL_TRANSPORT=file`). The sample
  cards' addresses are at example.com, which `MAIL_TEST_ALLOWLIST` allows here.
- `data/linkedin-outbox/` gets every "Post to LinkedIn" post, the text as
  LinkedIn would receive it and the picture. The sign-in is a pretend page
  (`LINKEDIN_FAKE=1`), with Allow and Cancel.

**The admin uses the same sign-in as production.** The first run writes a
random `ADMIN_LOGIN_KEY` into `local.env` and creates the account
`admin@local.test`, whose password is in `local-admin.txt` (owner-only). The
start-up summary prints the sign-in link with the key. A yellow band on
every admin screen says it is the local copy. More local accounts:

```
DATA_DIR=~/.spcfz-licence-card/data node dist/cli/admin-user.js add you@example.com
```

To post your own payload to the local test webhook:

```
S=$(grep '^TEST_SECRET_CURRENT=' ~/.spcfz-licence-card/local.env | cut -d= -f2-)
curl -X POST http://localhost:8787/v1/test/licence-issued \
  -H 'content-type: application/json' -H "X-SPC-Webhook-Secret: $S" \
  -d '{"licence_number":"TEST-2026-0099","company_name_en":"Nimbus Publishing FZE","founder_name_en":"Sara Khan"}'
```

The answer's `page_url` opens the card.

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
npm run local                           # the product at http://localhost:8787 (see "Local copy")
```

`npm run dev` (tsx watch on `src/` only, with `.env` from `.env.example`)
still works for server-only work; it does not rebuild the studio.

## Layout

| Path | Owns |
|---|---|
| `src/server.ts` | process entry: config, migrations, scheduler, HTTP |
| `src/platform/` | SQLite database, config, migrations, scheduler, backup, client address, Cloudflare ranges |
| `src/intake` | webhook checks, field mapping, validation, idempotent upsert |
| `src/page` | personal page (the studio shell and its static files), metric beacon |
| `src/admin` | sign-in (key gate, passwords, sessions) and staff screens |
| `src/db` | every SQL statement |
| `src/util` | tokens, hashing, HTML escaping, dates, IP allowlist, CSV, background tasks |
| `migrations/` | SQLite schema, applied at startup |
| `deploy/` | Dockerfile companions: run script, env example, Apache site, Cloudflare ranges |
| `tools/local.mjs` | the local copy (`npm run local`) |
| `src/cli/admin-user.ts` | staff accounts: add, passwd, unlock, remove, list |
| `tools/deploy.sh` | deployment from this Mac, one subcommand per approval |

## Conventions

- Hono routers, one per folder, exported as `xxxRoutes`.
- All HTML goes through the `html` tagged template in `src/util/html.ts`.
- Nothing from the ERP payload is stored except the canonical fields.
- SQL uses `?1`-style placeholders. The SQLite adapter binds them by number;
  better-sqlite3 rejects them as positional values.
- Tests build a fresh environment per file with `tests/env.ts`: a temp
  folder with its own SQLite file. `flushBackground()` waits for
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
5. Stress it: `npm run stress-cards -- <out dir>` (378 cases with awkward
   data; add `--shots all` to save every card for review). Fix anything it
   reports with a robustness patch in tools/build-studio.mjs.
6. Commit `design/source/` with the code.

### Test data

`tools/erp-samples.mjs` holds five fictional licences shaped like ERP
payloads (both languages, Arabic preference with an owner object, English
only with a long name, ERP-style field names with a DD/MM/YYYY date, a long
legal founder name). `npm run local` loads them on first run; `--seed`
loads them again. The file's header also shows how to load them inside the
container on the server.
