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
| C6 | Personal data is limited to the founder's name (since 16 Oct 2026, the user's decision: the ERP sends it so the studio can pre-fill it). The mapper drops everything else, including emails and phone numbers. The name is cleared when a card expires and deleted with the card. | The design pre-fills the founder; nothing else needs personal data. |
| C7 | Admin sits behind Cloudflare Access with an SPC email allowlist. No passwords in our code. | Free at this size, gives SSO and audit for nothing. |
| C8 | Images and records are kept two years, then the images are deleted and the page says the card has expired. | A retention rule has to exist; two years covers a licence term and a renewal. |
| C9 | Google Tag Manager is not loaded on the page by default. A config switch can add the site container GTM-PZ8R4DN. | Marketing decision; counters cover v1 needs. |
| C10 | ~~Deployment runs from GitHub Actions.~~ Since 15 Oct 2026: deployment runs from the Mac with `tools/deploy.sh`, one approved step at a time; CI on GitHub runs the checks. | The server is SPC's own and every write on it needs the user's approval. |

## 3. System overview

Since 15 October 2026 the service is one Node 22 process in a Docker
container on SPC's own server (13.206.34.102), behind Apache and
Cloudflare. docs/PORT-TO-NODE.md describes the port from the original
Cloudflare Workers design; the behaviour in this document is unchanged.

| Need | Implementation |
|---|---|
| HTTP endpoints, page, admin | Hono on `@hono/node-server`, port 8787 inside the container |
| Card images | built in the customer's browser by the studio (section 7); the server stores none |
| Records and counters | SQLite file `DATA_DIR/licence-card.sqlite`, WAL mode |
| Daily housekeeping | in-process scheduler at 05:15 Asia/Dubai, plus a SQLite backup |
| Admin login | Cloudflare Access |
| Edge, TLS, rate limits, IP allowlist | Cloudflare proxy and WAF on the spcfz.ae Pro zone; Apache admits Cloudflare only; the app checks the ERP allowlist itself |

Flow:

1. ERP posts to `/v1/licence-issued` through Cloudflare and Apache.
2. The app checks IP, secret, size and shape; normalises; finds or creates
   the card row, ready at once; answers with the page URL in under a second.
3. Customer opens the page from the ERP email and builds, downloads or shares
   the card in the browser.

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
| `activity_category_ar` | no | empty; the Arabic card then shows `activity_category` | up to 80 chars; an explicit Arabic field, else the Arabic sibling (`name_ar`, `Description_AR`, …) of the activity object the English name came from; never an English value |
| `founder_name_en` | no | empty; the customer types it | up to 120 chars (a long legal name never rejects the licence; the studio shortens names over 40 characters to first and last name); a plain field, or the name inside an owner/founder object or the first of a shareholder list |
| `founder_name_ar` | no | empty; the Arabic card then shows `founder_name_en` | up to 120 chars; an explicit field, else the Arabic sibling (`name_ar`, …) of the person object |
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

## 5. Data model (SQLite)

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
  activity_category_ar TEXT,      -- migration 0003
  founder_name_en TEXT,           -- migration 0004; personal data, cleared at expiry
  founder_name_ar TEXT,           -- migration 0004
  issued_on TEXT NOT NULL,        -- YYYY-MM-DD
  preferred_language TEXT NOT NULL DEFAULT 'en',
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,           -- ready | expired (pending/failed only on rows from the server-render era)
  render_error TEXT,              -- legacy, null
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

Retired on 16 October 2026. The studio (section 7) builds the card in the
customer's browser and exports the PNG there, so the server has no render
queue, no Chromium and no image storage. The `jobs` table and the
`render_error`, `rendered_at` and `template_version` columns are left in
place, unused, so an older image can still be rolled back to.

## 7. Personal page: the customer studio

Since 16 October 2026 the personal page is the **License Announcement
Studio**, implemented from the approved design exports ("License
Announcement Studio" for desktop, "License Announcement Mobile" for
phones). The customer builds the card in the browser and exports it there;
the server only provides the licence data and the static files.

### What the customer can do (from the design)

- Choose one of three styles (Daylight, Launch Pass, Day One), a format
  (square 1080 × 1080, portrait 1080 × 1350, landscape 1200 × 627) and the
  card language (English or Arabic, right to left).
- Choose who the card is about (you and your company, the company, just
  you), an image (photo with pan and zoom, logo, or initials), name, role and
  activity in each language, and a headline (six presets or their own).
- Get a suggested caption in three tones, edit it, copy it.
- Download a PNG at twice the native size, share it through the device
  share sheet where supported, or open LinkedIn with the caption copied.
- Custom text is checked in the browser for profanity, implied endorsement by
  SPC or the Government of Sharjah, and claims such as "best" or "#1".
- The company name is locked to the licence ("as registered on license …").

Photos and logos are read in the browser and never sent to the server.

### Implementation

- `design/source/` holds the exports unpacked by `tools/extract-design.mjs`:
  each layout's template, its logic class verbatim, and the fonts and images.
- `tools/build-studio.mjs` turns the sample values in the templates
  (company, issue date, activity, licence number, portal link) into
  bindings, compiles each template to an AST, wraps each logic class as a
  module, and bundles `client/` with esbuild into `public/studio/`.
- `client/dc.js` renders the AST with React 18.3.1, reproducing the design
  runtime's behaviour. `client/card-data.js` subclasses each logic class to
  inject the licence's data. `client/ds.js` holds the design system's Button,
  Input and Toast. html-to-image 1.11.11 produces the PNG, as in the design.
- The mobile layout is used below 760 px viewport width, the desktop layout
  above; edits carry over when the layout switches.
- `tools/compare-design.mjs` renders the exports and the build side by side
  in headless Chrome and diffs 30 states pixel by pixel. On 16 October 2026
  every state matched with zero differing pixels.

### Routes

| Route | Purpose |
|---|---|
| `GET /c/{token}` | The studio shell: the stylesheet, the bundle, and the card data as JSON in `<script id="card-data">`. Served for pending, ready and failed cards alike; nothing waits for the server render. Expired cards get 410, unknown tokens 404. |
| `GET /static/studio/…` | The bundle, stylesheet, fonts and images; content-hashed names, cached for a year. |
| `POST /c/{token}/m` | Counter beacon: download, share (network `native` or `linkedin`), caption. |

### Robustness for real data (16 October 2026)

The design was drawn with one sample licence. Real licences vary, so a few
bindings adapt while leaving the design's sample exactly as drawn
(`ROBUSTNESS_PATCHES` in tools/build-studio.mjs, values in
client/card-data.js):

- **Day One day number.** Sized for one digit ("8"); two-digit days are drawn
  at 68 % so they stay inside the diamond.
- **Launch Pass founder name.** The stub drew one line with an ellipsis, which
  cut even the design's own "Mariam Fawzy" to "Mariam Fa…". A name that does
  not fit now wraps to two balanced lines, shrinking to 75 % if needed, then
  three lines down to 60 %; it breaks at spaces and hyphens, never mid-word
  unless nothing else fits. The client measures the laid-out element and
  adjusts, so the export (which clones the DOM) matches the preview.
- **Long legal names** from the ERP are shortened to first and last name when
  over the design's 40-character field.
- **Phone layout** (16 October 2026, SPC's request): the six editing controls
  sit in one toolbar row, and the share bar holds only its main button (no
  Download or LinkedIn links). The card preview is sized from the height the
  page measures around it, so headline, card, controls and Share fit one
  screen on phones 360 px wide and up; a 320 × 568 phone scrolls a little.
- **Phone motion** (17 October 2026): the editing drawer slides up and down,
  the card preview glides between its two positions as one piece, and what
  the drawer hides rises back in when it closes. A tap outside the drawer
  closes it and is absorbed, so it never follows a link underneath; while the
  photo is being adjusted, touches on the card stay with the card. All motion
  is skipped under the system's reduce-motion setting.
- **No LinkedIn shortcuts** (17 October 2026): the desktop Share step has no
  "Open LinkedIn" button, and neither layout shows the "@SPC Free Zone"
  tagging tip. The desktop Share step leads with Share and stacks a
  full-width Download under it, with no hint text (`shareIntro` in
  client/card-data.js). The
- **Desktop Details walk-through** (18 October 2026): in the Details step,
  Next opens its four parts in order (Photo, Your details, Headline) and only
  the last leads to Share; Back walks back, and Back from Share lands on the
  headline. Each opened part is scrolled into view, and a part with rejected
  wording stops Next with the design's warning (`detailsNav` in
  client/card-data.js). The phone layout has no steps and is unchanged.
  design comparison (`npm run compare-design`) therefore differs from the
  exports on the Share step and the caption drawer, by intent.
- **Test cards** look exactly like live ones; SPC removed the TEST
  watermark on 16 October 2026. Only the browser tab title says [TEST].

`tools/stress-cards.mjs` renders every style, format, language, "who it is
about" and headline with long, short, missing and two-digit-date data
(378 cases on 16 October 2026) and fails on text outside the card, clipped
text, overlapping text, truncated text, or a day number outside its diamond.
`tools/compare-design.mjs` renders with `designExact` so it still proves the
design's own rendering is pixel-identical.

### Deviations from the design runtime, on purpose

- Style strings are split on ";" only outside quotes and parentheses. The
  runtime split on every ";", which broke uploaded photos and logos (they are
  `data:image/...;base64,` URLs); in the original export an uploaded photo
  does not appear on the card.
- The logic's `componentDidUpdate` receives the previous state, so the mobile
  layout's share pre-render works as written.

### Headers

`Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, and a
CSP of `script-src 'self'` plus a nonce for the optional GTM snippet,
`style-src 'self'`, `img-src 'self' data: blob:`, `font-src 'self' data:`,
`connect-src 'self'`, `base-uri 'self'` (html-to-image sets a same-origin
base while inlining fonts), `frame-ancestors 'none'`.

## 8. Admin

Path prefix `/admin`, protected by Cloudflare Access (C7). The app also
verifies the `Cf-Access-Jwt-Assertion` header against the team's keys, so the
routes are useless if the Access policy is ever removed by mistake.

On a local copy only, `LOCAL_ADMIN_EMAIL` replaces Access (`src/admin/local.ts`,
docs/DEV.md "Local copy"). Configuration refuses it unless the service is
reachable from the machine alone, and each request must come from loopback
with a loopback host name.

Screens:

- **Cards.** Search by company or licence number; filter by status, test,
  source; open the page; mark expired or restore; delete. The card itself
  is seen by opening the page.
- **Events.** The webhook log: time, route, IP, status, outcome, errors, the
  card. Replay re-runs an event from its raw body (test route only).
- **Create.** The same canonical fields as a form, for back-fill and for
  licences the ERP never sent.
- **Import CSV.** Upload a CSV with canonical column names, see a dry-run
  table of what would be created, updated or rejected, then confirm.
- **Settings.** GTM switch, retention days, mapping
  preview. Secrets and the IP allowlist are not editable here; they live in
  the server's env file and the WAF rule.

## 9. Security and privacy

- Allowlist checked in the app and enforced again by a WAF rule on `/v1/*`;
  Apache admits Cloudflare's ranges only.
- Secrets live in the server's env file (mode 600), two slots per route for rotation. Rotation:
  set the new one as current, move the old one to previous, tell the ERP team,
  clear previous after they confirm.
- Constant-time comparison. 64 KB body limit. JSON only.
- The founder's name is the only personal data (C6). Logs record the licence
  number and card id, never payload fields.
- Rate limits in the app, per client per minute (an IPv4 address, or an IPv6 /64) (`DEFAULT_RATE_LIMITS` in src/index.ts): 300 GET/HEAD on `/c/*`, 60 POST on `/c/*`, 20 on `/v1/*` from addresses not on the ERP allowlist (allowlisted addresses are never limited). Answers 429 with Retry-After. Cloudflare rules may add an outer layer.
- Strict CSP, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS from
  Cloudflare.
- Admin actions are written to the events table with the Access identity.

## 10. Retention (C8)

A daily cron:

- deletes raw bodies past `raw_body_expires_at`;
- deletes test cards older than 30 days;
- marks cards past `expires_at` as `expired` and clears the founder's name;
- compacts metrics older than 13 months to monthly rows (day becomes `YYYY-MM`).

## 11. Environments, repository, deployment

- **production**: the container on 13.206.34.102, reached as
  licensed.spcfz.ae. The production and test intake routes both live here;
  there is only one ERP.
- **local**: `npm run dev` with a `.env` copied from `.env.example`.
- There is no separate preview environment. Test cards on the test route are
  marked TEST and purged after 30 days.

Repository: private GitHub repository `Tayyab-Ejaz/spcfz-licence-card`.
Layout and deployment are in docs/DEV.md and docs/RUNBOOK.md.

## 12. Testing

- **Unit**: mapper, validation, idempotency decisions, caption rendering,
  filename sanitising, Access JWT verification, auto-fit maths.
- **Integration in CI**: intake to queue to a mocked render to page, against
  a temp SQLite file and a temp image folder; plus the real server on an
  ephemeral port.
- **Visual**: render every template variant with a 12-character and a
  60-character company name in each script and compare to the designer's
  PNGs with a pixel diff. Thresholds set once the design lands.
- **ERP end to end**: the ERP team posts to the test endpoint; the raw bodies
  drive the final field mapping.
- **Arabic**: a native reader signs off the Arabic layout, the caption and the
  page strings before launch.

## 13. Operations

- Container health check; `docker logs` for errors.
- Admin shows failed cards and rejected events on its first screen.
- Failed renders are surfaced on the admin dashboard.
- A runbook in docs covers: ERP secret rotation, allowlist change, template
  update and re-render, removal of the whole service.

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
