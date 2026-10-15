# Developer notes

## State

Phase 1 code written 15 October 2026. **Typecheck clean and all tests
passing locally** as of the same day (Node 22 via nvm, Vitest 4, the
`@cloudflare/vitest-plugin` Workers runtime). `wrangler deploy --dry-run`
bundles cleanly at about 365 KB gzipped. Not yet deployed anywhere.

## Toolchain

Node 22 or later. On this Mac it was installed on 15 October 2026 with nvm
(v0.40.8) into `~/.nvm`, no administrator rights; `~/.zshrc` loads it. npm
was upgraded to 12 inside that Node because npm 10 crashed resolving the
dependency tree. In a fresh shell:

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
```

npm 12 blocks post-install scripts unless allowed; `package.json`
`allowScripts` approves `esbuild` and `workerd`, which the toolchain needs.
When either package's version changes, run
`npm install-scripts approve esbuild workerd` and `npm rebuild esbuild workerd`.

Then, in this folder:

```
npm install
npm run typecheck
npm test
```

`npm run dev` starts a local Worker with local D1, R2 and queues. Browser
Rendering has no local emulation; `wrangler dev --remote` uses the real
binding and needs the account set up first (docs/CLOUDFLARE-SETUP.md).

## Layout

See docs/ARCHITECTURE.md section 11. Short version:

| Folder | Owns |
|---|---|
| `src/intake` | webhook checks, field mapping, validation, idempotent upsert |
| `src/render` | queue consumer, browser session, HTML template, fonts |
| `src/page` | personal page, image delivery, status, metric beacon |
| `src/admin` | Cloudflare Access verification and staff screens |
| `src/db` | every SQL statement |
| `src/util` | tokens, hashing, HTML escaping, dates, IP allowlist, CSV |
| `templates/placeholder` | stand-in design until SPC's arrives |
| `migrations` | D1 schema, applied by wrangler |

## Conventions

- Hono routers, one per folder, exported as `xxxRoutes`.
- All HTML goes through the `html` tagged template in `src/util/html.ts`,
  which escapes by default.
- Nothing from the ERP payload is stored except the canonical fields.
- Secrets come from Worker secrets; see the comment block in `wrangler.toml`.
- Tests run in the Workers runtime through `@cloudflare/vitest-plugin`
  (the renamed `vitest-pool-workers`); the D1 schema is applied once per file
  by `tests/setup.ts`. Tests use the `test` environment in `wrangler.toml`,
  which has no queue consumers and whose vars are overridden in
  `vitest.config.ts`.

## Deploy

`.github/workflows/deploy.yml` is manual (`workflow_dispatch`). Choosing
`production` and pressing Run is the approval step. CI runs on every push.

## What the first run taught us (15 October 2026)

- The code written blind compiled with one real error (the `scheduled`
  handler's parameter type) and one test bug (a helper not sending the CSRF
  cookie). Everything else was toolchain drift: `workers-types` 5 dropped
  the dated entrypoints, and the Workers test pool became a Vite plugin
  (`cloudflareTest(...)` in `plugins`) with `env` typed as `Cloudflare.Env`,
  which `tests/env.d.ts` now declares.
- Queue messages sent during tests were delivered to the main worker during
  teardown and produced an `EnvironmentTeardownError`. The `test` environment
  in `wrangler.toml` has no consumers, which removed it.
- The `[browser]` binding and the `[[rules]] type = "Data"` font imports both
  work in the test runtime.
- **Fonts are variable.** `templates/fonts/` holds one file per family with
  `font-weight: 400 700`; `tools/fetch-fonts.sh` re-downloads them.
