# Architecture

Version 0.1, 15 October 2026. This is the contract the service is built
against. Change the document first, then the code.

## 1. Purpose

When the ERP issues a business licence, produce a set of branded social images
that say the company is officially licensed at SPC Free Zone, and give the
customer one personal page where they can view, download and share them. The
ERP's licence-issued email links to that page. Nothing else is sent.

### In version one

- Intake endpoint for the ERP webhook, plus a test endpoint.
- Rendering of eight PNGs per licence: four sizes in English and Arabic.
- Personal page with language toggle, size picker, download, share and caption.
- Admin for SPC staff: cards, webhook log, replay, regenerate, manual create,
  CSV import, delete.
- Server-side counters for views, downloads and share clicks.

### Not in version one

Email or WhatsApp sent by us, QR referral codes, Zoho CRM write-back, print
files, any change to www.spcfz.ae, customer accounts, customer-editable text.

## 2. Decisions

### Taken by the user, 15 October 2026

| # | Decision |
|---|---|
| D1 | The card is a social creative. |
| D2 | All four sizes: 1080x1080, 1080x1350, 1080x1920, 1200x628. |
| D3 | Personal page is the hub; the ERP email carries the link. |
| D4 | Both languages for every customer, with a toggle. |
| D5 | Missing Arabic name: English name inside the Arabic layout. |
| D6 | The licence number appears on the creative. |
| D7 | ERP team fires the webhook. Auth is a long static secret in a header, plus IP allowlist, plus TLS. |
| D8 | Do not rely on ERP retries or on a test flag in the payload. |
| D9 | Hosting on Cloudflare. Subdomain licensed.spcfz.ae. |
| D10 | The design is supplied by SPC. |

### Taken here, open to revision if they cause trouble

| # | Call | Why |
|---|---|---|
| C1 | One URL per licence, stable for life. A second event for the same licence number with changed data regenerates the images in place. | ERP corrections flow through without a second link in the wild. |
| C2 | Tokens are 128 bits of randomness, base62, 22 characters. Never derived from the licence number. | The licence number is on the image; the URL must not be guessable from it. |
| C3 | A separate test endpoint with its own secret, instead of a flag in the payload. Test cards carry a TEST ribbon, are excluded from counters, and are purged after 30 days. | D8, and the ERP team can test without being able to mark payloads. |
| C4 | The test endpoint keeps the raw request body for 7 days. The production endpoint never stores a raw body. | The user cannot get a sample ERP record any other way. |
| C5 | Only the licence number and the English company name are required. Everything else is optional with a fallback. ERP field names are mapped in config, not fixed. | The user has little control over what the ERP sends. |
| C6 | Personal data is not stored. The mapper drops anything that is not on the field list, including emails and phone numbers if the ERP sends them. | Nothing in v1 needs it. |
| C7 | Admin sits behind Cloudflare Access with an SPC email allowlist. No passwords in our code. | Free at this size, gives SSO and audit for nothing. |
| C8 | Images and records are kept two years, then the images are deleted and the page says the card has expired. | A retention rule has to exist; two years covers a licence term and a renewal. |
| C9 | Google Tag Manager is not loaded on the page by default. A config switch can add the site container GTM-PZ8R4DN. | Marketing decision; counters cover v1 needs. |
| C10 | Deployment runs from GitHub Actions. Nothing depends on the development laptop, which has no Node. | Repeatable, auditable, same pattern as spcfz-forms. |

## 3. System overview

Everything runs on one Cloudflare Worker with these bindings:

| Need | Cloudflare product |
|---|---|
| HTTP endpoints, page, admin | Workers, custom domain licensed.spcfz.ae |
| Background rendering | Queues, one queue plus a dead-letter queue |
| Headless Chromium | Browser Rendering |
| Image storage | R2, one private bucket |
| Records and counters | D1, one database |
| Daily housekeeping | Cron Trigger |
| Admin login | Cloudflare Access |
| Rate limits and IP allowlist | WAF custom rules, plus checks in the Worker |

Flow:

1. ERP posts to `/v1/licence-issued`.
2. Worker checks IP, secret, size and shape; normalises; finds or creates the
   card row; enqueues a render job; answers with the page URL in under a second.
3. Queue consumer launches one browser, renders the eight images, writes them
   to R2, marks the card ready.
4. Customer opens the page from the ERP email, sees the card in their language,
   downloads or shares.

## 4. Intake

### Routes

| Route | Secret | Purpose |
|---|---|---|
| `POST /v1/licence-issued` | production | Real licences |
| `POST /v1/test/licence-issued` | test | ERP integration testing, sample capture |

### Checks, in order

1. Source IP (`CF-Connecting-IP`) is on the allowlist. Else 403.
2. Header `X-SPC-Webhook-Secret` or `Authorization: Bearer` equals the current
   or the previous secret for that route, compared in constant time. Else 401.
3. Body is at most 64 KB and parses as JSON. Else 413 or 400.
4. Mapped fields pass validation. Else 400 with a list of field errors.

### Field mapping

A config object maps ERP field names to ours, with dotted paths allowed, so
the ERP sends whatever it natively has. The canonical fields:

| Canonical | Required | Fallback | Validation |
|---|---|---|---|
| `licence_number` | yes | none | 3 to 40 chars after trim and uppercase |
| `company_name_en` | yes | none | 2 to 120 chars, HTML stripped |
| `company_name_ar` | no | empty, see D5 | up to 120 chars |
| `licence_type` | no | empty | up to 60 chars |
| `activity_category` | no | empty | up to 80 chars; first item if a list arrives |
| `issued_on` | no | today in Asia/Dubai | ISO date, or any date the parser accepts |
| `preferred_language` | no | `en` | `en` or `ar`, case-insensitive |

Everything else in the payload is dropped (C6).

### Idempotency and updates (C1)

The key is the normalised licence number per route. A content hash of the
canonical fields is stored with the card.

| Situation | Behaviour |
|---|---|
| New licence number | Create card, mint token, enqueue render, 200 with `ready: false`. |
| Known number, same hash | No change, 200 with existing URL and current `ready`. |
| Known number, different hash | Update fields, status back to `pending`, enqueue render, same URL. |

A renewal that fires the same event regenerates the card with the new issue
date. That is acceptable and noted.

### Response

```json
{ "status": "accepted", "card_id": "…", "page_url": "https://licensed.spcfz.ae/c/7Hk2bQ…", "ready": false }
```

Target under 1 second at the 95th percentile. The render never happens in the
request.

## 5. Data model (D1)

```sql
cards (
  id TEXT PRIMARY KEY,            -- ULID
  token TEXT UNIQUE NOT NULL,     -- 22-char base62, C2
  licence_number TEXT NOT NULL,   -- normalised
  is_test INTEGER NOT NULL DEFAULT 0,
  company_name_en TEXT NOT NULL,
  company_name_ar TEXT,
  licence_type TEXT,
  activity_category TEXT,
  issued_on TEXT NOT NULL,        -- YYYY-MM-DD
  preferred_language TEXT NOT NULL DEFAULT 'en',
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,           -- pending | ready | failed | expired
  render_error TEXT,
  source TEXT NOT NULL,           -- webhook | test | manual | csv | replay
  template_version TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, rendered_at TEXT, expires_at TEXT,
  UNIQUE (licence_number, is_test)
);

events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  route TEXT NOT NULL,            -- production | test | admin
  source_ip TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  outcome TEXT NOT NULL,          -- created | unchanged | updated | rejected, or an admin action
  errors TEXT,                    -- JSON list, rejected only
  card_id TEXT,
  raw_body TEXT,                  -- test route only, purged after 7 days (C4)
  raw_body_expires_at TEXT,
  actor TEXT                      -- Access email for route = 'admin' rows
);

metrics (
  day TEXT NOT NULL,              -- YYYY-MM-DD live, YYYY-MM once compacted
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- view | download | share | caption
  lang TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', network TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, card_id, kind, lang, size, network)
);

settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- caption_en, caption_ar, gtm_enabled, retention_days, test_retention_days, raw_body_days
```

## 6. Rendering

### Job

One queue message per card: `{ card_id, content_hash }`. The consumer reloads
the card, skips the job if the hash no longer matches (a newer event
superseded it), otherwise renders.

### Browser session

One browser per job. For each of the eight variants: `setContent` with the
template HTML, wait for `document.fonts.ready` and for the auto-fit script to
finish, `setViewport` to the exact pixel size at scale 1, `screenshot` as PNG.
Budget about 6 to 10 seconds per card, so roughly 2 to 3 browser-hours a month
at 1,000 licences, inside the plan's 10 included hours.

### Template

- One HTML and CSS template per size, with a `dir="rtl"` variant for Arabic.
  Built from the approved design (see DESIGN-HANDOFF.md). A placeholder
  template exists until then.
- Fonts embedded as base64 `@font-face` in the HTML: Inter and Noto Kufi
  Arabic unless the design says otherwise. Browser Rendering's Chromium has
  no Arabic system fonts, so nothing may rely on a system font.
- Variable text zones carry a maximum font size and a minimum; the auto-fit
  script shrinks the company name until it fits, then wraps to the allowed
  number of lines, then truncates with an ellipsis as the last resort.
- Every variable is HTML-escaped before insertion.
- `template_version` is stamped on the card so a design change can be
  re-rendered selectively from the admin.

### Storage

R2 keys: `cards/{token}/{lang}-{size}.png`, with `size` in
`square | portrait | story | landscape`. A failed render leaves the previous
images in place.

### Retries

Queue `max_retries` 3 with backoff, then the dead-letter queue. The consumer
of the dead-letter queue marks the card `failed` with the error. The admin
shows failed cards and offers a retry.

## 7. Personal page

### Routes

| Route | Purpose |
|---|---|
| `GET /c/{token}` | The page. `?lang=ar` or `?lang=en` overrides the default. |
| `GET /c/{token}/{lang}-{size}.png` | The image from R2. `?download=1` adds a `Content-Disposition: attachment` header with a filename built from the company name. |
| `GET /c/{token}/status` | `{ status }` JSON, polled every 3 seconds while pending. |
| `POST /c/{token}/m` | Counter beacon: `{ kind, lang, size, network }`. |

### Behaviour

- Default language is `preferred_language`; the toggle switches both the UI
  and the images shown.
- States: `pending` shows "preparing your card" and polls; `ready` shows the
  card; `failed` shows the pending view with a contact line, never an error
  code; `expired` says the card is no longer available and gives the SPC
  contact page.
- Size picker with a preview and a Download button per size.
- Share buttons: LinkedIn, X, Facebook and WhatsApp share the page URL.
  Instagram has no web share, so the page says "download the square or story
  image and paste the caption".
- "Copy caption" copies a language-specific caption containing the company
  name and a tracked link to www.spcfz.ae. Default captions ship in English and
  Arabic as settings; the Arabic one must be reviewed by a native reader
  before launch.
- Open Graph tags: title "{company} is officially licensed at SPC Free Zone",
  the landscape image in the page language, `summary_large_image` for X.
- `noindex` via meta and `X-Robots-Tag`. This does not stop social previews.
- Content Security Policy with no third-party scripts unless `gtm_enabled`.
- Visiting a test card shows a TEST ribbon over the image and in the title.

### Caching

Pages are served with `Cache-Control: private, no-store`. Images are cached
at the edge for a day; a regenerate purges the eight image URLs.

## 8. Admin

Path prefix `/admin`, protected by Cloudflare Access (C7). The Worker also
verifies the `Cf-Access-Jwt-Assertion` header against the team's keys, so the
routes are useless if the Access policy is ever removed by mistake.

Screens:

- **Cards.** Search by company or licence number; filter by status, test,
  source; open the page; regenerate; delete; mark expired.
- **Events.** The webhook log: time, route, IP, status, outcome, errors, the
  card. Replay re-runs a rejected or unchanged event from its stored fields,
  or from the raw body on the test route.
- **Create.** The same canonical fields as a form, for back-fill and for
  licences the ERP never sent.
- **Import CSV.** Upload a CSV with canonical column names, see a dry-run
  table of what would be created, updated or rejected, then confirm.
- **Re-render.** Pick a template version or a date range and queue a
  re-render, with a count shown first.
- **Settings.** Caption templates, GTM switch, retention days, mapping
  preview. Secrets and the IP allowlist are not editable here; they live in
  Worker secrets and the WAF rule.

## 9. Security and privacy

- Allowlist checked in the Worker and enforced again by a WAF rule on `/v1/*`.
- Secrets live in Worker secrets, two slots per route for rotation. Rotation:
  set the new one as current, move the old one to previous, tell the ERP team,
  clear previous after they confirm.
- Constant-time comparison. 64 KB body limit. JSON only.
- No personal data stored (C6). Logs record the licence number and card id,
  never payload fields.
- Rate limits: WAF rules on `/c/*` and `/v1/*` sized for the expected traffic.
- Image download filenames are sanitised to ASCII letters, digits and dashes.
- Strict CSP, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS from
  Cloudflare.
- Admin actions are written to the events table with the Access identity.

## 10. Retention (C8)

A daily cron:

- deletes raw bodies past `raw_body_expires_at`;
- deletes test cards and their images older than 30 days;
- marks cards past `expires_at` as `expired` and deletes their images;
- compacts metrics older than 13 months to monthly rows (day becomes `YYYY-MM`).

## 11. Environments, repository, deployment

- **production**: the Worker on licensed.spcfz.ae, with the production and
  test intake routes. There is only one ERP, so the test route lives here.
- **preview**: `wrangler deploy --env preview` to a workers.dev hostname with
  its own D1, R2 and queue, for our own QA before a production deploy.

Repository: a dedicated private GitHub repository, `spcfz-licence-card`.

```
wrangler.toml
package.json
src/
  index.ts          router
  intake/           checks, mapper, validation, idempotency
  render/           queue consumer, browser session, auto-fit, fonts
  page/             personal page, images, status, beacon
  admin/            Access verification, screens
  db/               D1 helpers, migrations/*.sql
  cron.ts
templates/
  placeholder/      until the design arrives
  spc/              the approved design, one folder per template_version
tests/              Vitest with the Workers pool
.github/workflows/
  ci.yml            typecheck, tests, template render smoke test
  deploy.yml        on main: migrations, deploy production
docs/
```

TypeScript throughout. CI is where tests run; the development machine has no
Node (C10).

## 12. Testing

- **Unit**: mapper, validation, idempotency decisions, caption rendering,
  filename sanitising, Access JWT verification, auto-fit maths.
- **Integration in CI**: intake to queue to a mocked render to page, against
  a local D1 and R2.
- **Visual**: render every template variant with a 12-character and a
  60-character company name in each script and compare to the designer's
  PNGs with a pixel diff. Thresholds set once the design lands.
- **ERP end to end**: the ERP team posts to the test endpoint; the raw bodies
  drive the final field mapping.
- **Arabic**: a native reader signs off the Arabic layout, the caption and the
  page strings before launch.

## 13. Operations

- Worker error-rate alert through Cloudflare notifications.
- Admin shows failed cards and rejected events on its first screen.
- Dead-letter queue depth is checked by the daily cron and surfaced in admin.
- A runbook in docs covers: ERP secret rotation, allowlist change, template
  update and re-render, restoring a deleted card from R2 versioning.

## 14. Phase 2 hooks already in place

- A reserved QR zone in every template and a `referral_code` column added when
  needed.
- Metrics table already distinguishes network and size.
- Settings table carries the GTM switch.
- The card row has everything a CRM write-back or a notification would need
  except contact details, which would be fetched from the CRM, not stored here.

## 15. Open questions

1. Exact ERP field names and date format. Answered by the first posts to the
   test endpoint.
2. ERP source IP addresses for the allowlist. The user will obtain them.
3. Whether marketing wants GTM on the page at launch (C9).
4. ~~Who signs off the Arabic strings~~ Answered 15 Oct 2026: the user.
5. ~~Which GitHub account owns the repository~~ Answered 15 Oct 2026: the
   personal account that holds spcfz-forms (`Tayyab-Ejaz/spcfz-licence-card`).
