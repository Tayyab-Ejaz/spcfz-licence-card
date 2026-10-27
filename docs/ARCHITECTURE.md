# Architecture

Version 0.1, 15 October 2026. This is the contract the service is built
against. Change the document first, then the code.

## 1. Purpose

When the ERP issues a business licence, produce a set of branded social images
that say the company is officially licensed at SPC Free Zone, and give the
customer one personal page where they can view, download and share them. The
ERP's licence-issued email links to that page. Since 27 October 2026 the
service also sends its own welcome email with the customer's card in it
(section 16), and can post the card to the customer's LinkedIn for them,
after they review it (section 17).

### In version one

- Intake endpoint for the ERP webhook, plus a test endpoint.
- Rendering of eight PNGs per licence: four sizes in English and Arabic.
- Personal page with language toggle, size picker, download, share and caption.
- Admin for SPC staff: cards, webhook log, replay, regenerate, manual create,
  CSV import, delete.
- Server-side counters for views, downloads and share clicks.

### Not in version one

WhatsApp sent by us (email: since 27 October 2026, section 16), QR referral codes, Zoho CRM write-back, print
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
| C3 | A separate test endpoint with its own secret, instead of a flag in the payload. Test cards say [TEST] in the page title and are excluded from counters. Since 19 October 2026 they are kept, like everything else. | The ERP team cannot be relied on to set a flag correctly. |
| C4 | The test endpoint keeps the raw request body (kept for good since 19 October 2026). The production endpoint never stores a raw body. | The user cannot get a sample ERP record any other way. |
| C5 | Only the licence number and the English company name are required. Everything else is optional with a fallback. ERP field names are mapped in config, not fixed. | The user has little control over what the ERP sends. |
| C6 | Personal data is limited to the founder's name (since 16 Oct 2026, so the studio can pre-fill it) and, since 27 Oct 2026, the customer's email and one copy-to email (for the welcome email, section 16). The mapper drops everything else, including phone numbers. Kept like the rest of the card (C8); deleted with the card. | The design pre-fills the founder; the welcome email needs an address; nothing else needs personal data. |
| C7 | Admin has its own sign-in (19 October 2026, replacing Cloudflare Access): a key-gated login page, staff accounts with scrypt passwords, server-side sessions. | SPC chose not to depend on Cloudflare's login; the key keeps the page unfindable, the accounts give per-person audit. |
| C8 | Nothing is deleted automatically (19 October 2026). A card expires when its licence does: from the licence expiry date the ERP (or staff) give, the page says the licence has expired, with nothing removed; a renewal brings it back at the same link. No expiry date, no expiry. | SPC's decision: keep all data; a card should follow the licence, not a fixed period. |
| C9 | Google Tag Manager is not loaded on the page by default. A config switch can add the site container GTM-PZ8R4DN. | Marketing decision; counters cover v1 needs. |
| C11 | The service sends the welcome email itself (27 October 2026), one per card: when a card arrives with an email, or when an email first arrives for an existing card. Staff can send it again. Through any SMTP provider; retries 5 times over 15 hours. | The email can carry the customer's own card and a one-tap LinkedIn button, which the ERP's email cannot. |
| C12 | Test cards only email addresses on `MAIL_TEST_ALLOWLIST` (default: spcfz.ae). CSV imports do not email unless staff tick the box. | Test data and back-fills must never reach customers by accident. |
| C13 | "Post to LinkedIn" always shows the customer the post (picture, text, their name) and posts only when they press Post now, once. The LinkedIn token is held in memory for at most 15 minutes and never stored; the database keeps only the outcome. | Posting under someone's name must be their explicit act; a stored token would be a standing credential for every customer's account. |
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
| Admin login | Own sign-in page, key in the link (src/admin/auth.ts) |
| Welcome email | outbox table + in-process worker every 30 s, SMTP via nodemailer (src/mail/) |
| Post to LinkedIn | LinkedIn OAuth + Posts API, drafts in memory (src/linkedin/) |
| Pictures drawn on the server | sharp: the link preview (1200x630) and the email's card (1080x1080 Day One), cached in memory |
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
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, rendered_at TEXT,
  expires_at TEXT,                -- end of licence_expires_on in Dubai; NULL = never
  licence_expires_on TEXT,        -- YYYY-MM-DD, the licence's last valid day (migration 0006)
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
  raw_body TEXT,                  -- test route only, kept (C4)
  raw_body_expires_at TEXT,       -- unused since 19 October 2026 (NULL)
  actor TEXT                      -- signed-in staff email for route = 'admin' rows
);

metrics (
  day TEXT NOT NULL,              -- YYYY-MM-DD live, YYYY-MM once compacted
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- view | download | share | caption
  lang TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', network TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, card_id, kind, lang, size, network)
);

settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- gtm_enabled (the retention_* and caption rows are no longer read)
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
  client/card-data.js). The design comparison (`npm run compare-design`)
  therefore differs from the exports on the Share step and the caption
  drawer, by intent.
- **Desktop Details walk-through** (18 October 2026): in the Details step,
  Next opens its four parts in order (Photo, Your details, Headline) and only
  the last leads to Share; Back walks back, and Back from Share lands on the
  headline. Each opened part is scrolled into view, and a part with rejected
  wording stops Next with the design's warning (`detailsNav` in
  client/card-data.js). The phone layout has no steps and is unchanged.
- **Share sends the image only** (19 October 2026): with the caption passed
  alongside, LinkedIn's app kept the text and dropped the image. The caption
  is copied to the clipboard first, and a message after sharing says to paste
  it (or, when the clipboard refused, where to copy it from). WhatsApp and
  other apps therefore also get the image without a caption.
- **Light card rendering** (19 October 2026, client/card-render.js): the
  design's export embedded all 142 font faces (6.6 MB) and re-downloaded
  them with cache-busting on every render, including the background render
  after the page opens. On a OnePlus with Chrome the tab ran out of memory
  and reloaded in a loop (a white page). Renders now embed only the faces the
  card's text uses, fetched once from the browser cache, and never run twice
  at once; the images are pixel-identical. Share sends a JPEG (about 210 KB),
  Download a PNG.
- **Link preview** (19 October 2026): the card page carries Open Graph and
  Twitter tags, so a pasted link shows a preview in WhatsApp, LinkedIn,
  iMessage and Slack: "<company> is officially licensed", the issue date, and
  a 1200 x 630 picture with the company's name big and the SPC logo small
  (src/page/preview-image.ts, drawn by sharp with Inter and Noto Kufi Arabic
  from assets/fonts, SIL OFL; Arabic is shaped right to left). It is served
  at /c/<token>/preview/<hash>-v<design>[-ar].jpg, a new address when the card
  or the picture's design (PREVIEW_DESIGN in src/page/studio.ts) changes,
  cached in memory; expired cards and any drawing failure get the generic
  picture (design/og/licence-preview.jpg). Fontconfig sees only those fonts
  (a config written to the temp folder at first use).
- **Desktop Done** (18 October 2026): the last step's bar ends with a Done
  button that opens the customer portal in the same tab, in place of the
  "Step 3 of 3" label.
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

Path prefix `/admin`, behind the service's own sign-in (C7, `src/admin/auth.ts`):

- **Hidden entrance.** The sign-in page exists only at
  `/admin/login?key=<ADMIN_LOGIN_KEY>`. Without the key, it and every other
  admin address answer the same plain 404 as an unknown path. No
  `ADMIN_LOGIN_KEY`, no sign-in at all.
- **Accounts.** Email and password, created on the server with
  `node dist/cli/admin-user.js` (add, passwd, unlock, remove, list); there is
  no sign-up. Passwords are scrypt hashes with a salt each, at least 12
  characters, and are typed into the command, never passed as arguments.
- **Sessions.** A random 48-character cookie, HttpOnly and SameSite=Strict,
  `__Host-` and Secure over https. Only its SHA-256 is stored. A session ends
  after 2 hours idle, 12 hours in total, or on Sign out; changing a password
  ends all of that account's sessions.
- **Brute force.** 10 attempts per client address per 15 minutes; an account
  locks for 15 minutes after 5 wrong passwords. One message for every
  failure, and unknown emails take as long as known ones.
- **Forms.** The sign-in and every admin form carry the CSRF double-submit
  token; the admin's CSP, no-store, noindex and frame headers apply to the
  sign-in page too.

Screens:

- **Cards.** Search by company or licence number; filter by status, test,
  source; open the page; set the licence expiry date; mark expired or
  restore (restore only undoes a manual expiry); delete. The card itself
  is seen by opening the page.
- **Events.** The webhook log: time, route, IP, status, outcome, errors, the
  card. Replay re-runs an event from its raw body (test route only).
- **Create.** The same canonical fields as a form, for back-fill and for
  licences the ERP never sent.
- **Import CSV.** Upload a CSV with canonical column names, see a dry-run
  table of what would be created, updated or rejected, then confirm.
- **Settings.** GTM switch; a note that nothing is deleted; the mapping
  preview. Secrets and the IP allowlist are not editable here; they live in
  the server's env file and the WAF rule.

## 9. Security and privacy

- Allowlist checked in the app and enforced again by a WAF rule on `/v1/*`;
  Apache admits Cloudflare's ranges only.
- Secrets live in the server's env file (mode 600), two slots per route for rotation. Rotation:
  set the new one as current, move the old one to previous, tell the ERP team,
  clear previous after they confirm.
- Constant-time comparison. 64 KB body limit. JSON only.
- Personal data is the founder's name and the two emails (C6). Logs record the licence
  number and card id, never payload fields or email addresses.
- LinkedIn: the access token stays in memory with its draft for at most 15 minutes and is dropped once the
  post is made (C13). The picture the customer made in the studio reaches the server only when they press
  Post to LinkedIn, and is held in memory with the draft, never written to disk. Drafts are bound to an
  HttpOnly, SameSite=Lax cookie; the review form carries a second key; the sign-in state is 40 random
  characters and works once; the studio's upload must come from our own origin.
- Rate limits in the app, per client per minute (an IPv4 address, or an IPv6 /64) (`DEFAULT_RATE_LIMITS` in src/index.ts): 300 GET/HEAD on `/c/*`, 60 POST on `/c/*`, 20 on `/v1/*` from addresses not on the ERP allowlist (allowlisted addresses are never limited); and 60 per 10 minutes for "Post to LinkedIn" (`/linkedin/*` and `/c/:token/linkedin`). Answers 429 with Retry-After. Cloudflare rules may add an outer layer.
- Strict CSP, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS from
  Cloudflare.
- Admin actions are written to the events table with the signed-in staff email.

## 10. Expiry and retention (C8)

Nothing is deleted automatically: cards (live and test), founder names, the
test route's raw bodies and daily metric rows all stay. Staff can still
delete a card by hand in the admin.

A card expires with its licence. `licence_expires_on` comes from the ERP
(`expiry_date`, `licence_expiry`, `valid_until` and similar) or from staff in
the admin; `expires_at` is the end of that day in Dubai. The page answers 410
with "This licence has expired" from that moment, naming the company,
licence number and date, with a link to renew in the customer portal. A
later date (a renewal from the ERP, or staff) brings the card back at the
same link. A card with no expiry date never expires.

The daily run marks cards past `expires_at` as `expired` (so the admin's
status is current; the page does not wait for it) and drops ended admin
sessions. The SQLite backups keep the newest seven daily copies.

## 11. Environments, repository, deployment

- **production**: the container on 13.206.34.102, reached as
  licensed.spcfz.ae. The production and test intake routes both live here;
  there is only one ERP.
- **local**: `npm run dev` with a `.env` copied from `.env.example`.
- There is no separate preview environment. Test cards on the test route
  say [TEST] in the page title and are kept.

Repository: private GitHub repository `Tayyab-Ejaz/spcfz-licence-card`.
Layout and deployment are in docs/DEV.md and docs/RUNBOOK.md.

## 12. Testing

- **Unit**: mapper, validation, idempotency decisions, caption rendering,
  filename sanitising, admin sign-in (key gate, passwords, sessions, lockout), auto-fit maths.
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

## 16. Welcome email (27 October 2026)

What the customer gets, in their preferred language (English or Arabic, right to left), from `MAIL_FROM`:

- A plain white email under SPC's header banner (white logo on brand blue, `assets/email/spc-header-<hash>.jpg`,
  served at `/static/email/` and cached for good; a new banner gets a new file name).
- SPC's copy (27 October 2026), English verbatim: subject and headline "Your Business Is Official. Let the World
  Know!", "A milestone worth celebrating. A story worth sharing.", "Hi <first name>," and the congratulations.
- Their own card as a picture (the Daylight style since 27 October 2026, SPC's choice: kicker, founder and role,
  the empty photo tile, "Officially in business.", company and activity, "Licensed with"; 1080x1080, drawn by the
  server: `/c/<token>/card/<hash>-v<n>[-ar].jpg`), linked to their studio. Without a founder, the company and
  activity take the top (the design's company-only layout).
- "Share Your Milestone" (the studio, `?via=email`, counted as a view from email) and, when LinkedIn is set up,
  "Post on LinkedIn" (section 17, with the server's card and the default caption).
- The closing lines, "Best regards, Team SPC Free Zone", and a black footer band (SPC, 27 October 2026): the SPC logo
  in white and social icons on dark circles (LinkedIn, Instagram, Facebook, YouTube, as on www.spcfz.ae; PNGs from
  tools/email-icons.mjs); a rule; SPC's Contact Us
  block (Toll Free Number 800 77239 and Email marketing@spcfz.ae, each a small label over the value); a rule;
  "© <year> Sharjah Publishing City (SPC) Free Zone / Sharjah, United Arab Emirates." with **Unsubscribe**
  opposite; and the reason they got it. Everything stacks on phones. No link to the other language (removed at SPC's request, 27 October
  2026); the card page has its own switch.
- Unsubscribe: the button opens `/c/<token>/unsubscribe`, which asks first (mailbox link checkers open links, so
  opening it changes nothing) and unsubscribes on its button. Every email also carries `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so Gmail and others show their own Unsubscribe,
  which posts to the same address. Unsubscribed addresses (table `email_suppressions`, migration 0008) get
  nothing more: checked when an email is queued and again before it is sent, on every card with that address.
  The admin card page says when and how an address unsubscribed.
- Built for real inboxes: tables and inline styles, a preheader, Outlook buttons, dark mode, alt text, and a
  plain-text part. Headers `Auto-Submitted: auto-generated` and `X-Auto-Response-Suppress`.

When it is sent (C11, C12): one per card, queued when a card is created or updated with a customer email it
did not have an email for; staff can send it again from the card in the admin (logged as `emailed`). Not for
expired cards. A worker sends what is due every 30 seconds and straight after queueing; a failure is retried
after 1, 5, 30, 120 and 720 minutes, then marked failed with its last error. Test cards email only
`MAIL_TEST_ALLOWLIST`; others get a `skipped` row that says why. CSV import emails only when ticked.

Transport (`MAIL_TRANSPORT`): `smtp` (`MAIL_SMTP_URL`, any provider: ZeptoMail, Amazon SES, Microsoft 365),
`file` (written to `DATA_DIR/mail-outbox`, the local copy), `off` (queued, not sent). `MAIL_REPLY_TO` and
`MAIL_BCC` are optional. The sender's domain needs SPF and DKIM for the provider (docs/RUNBOOK.md).

The admin shows each card's emails (queued, sent, failed, skipped), a Send again button and a preview in
both languages; Settings shows the transport and counts. Table `emails` (migration 0007).

## 17. Post to LinkedIn (27 October 2026)

Posts the card to the customer's own LinkedIn profile through LinkedIn's API, so the picture arrives
attached, which the phone share sheet cannot do from a web page.

    studio  POST /c/:token/linkedin   the picture the customer made (JPEG) + their caption, from the studio
    email   GET  /c/:token/linkedin   the server-drawn card + the default caption, from the welcome email
       -> LinkedIn sign-in (scope "openid profile w_member_social")
       -> GET /linkedin/callback   code -> access token -> who they are (name, photo)
       -> GET /linkedin/review     the post as it will appear; caption editable (3,000 characters)
       -> POST /linkedin/publish   upload the picture, create the post (public, main feed)
       -> GET /linkedin/done       "Your announcement is live", with a link to the post

- The caption goes as LinkedIn "little text": reserved characters escaped, `#Word` as hashtags and
  "@SPC Free Zone" as a mention of SPC's page when `LINKEDIN_ORG_URN` is set. If LinkedIn refuses the
  mention, the post is made once more with the name as plain text.
- Nothing is posted without Post now; two presses make one post. Cancelling at LinkedIn shows "Nothing was
  posted". An expired sign-in asks to sign in again and keeps the text.
- Recorded: a `linkedin_posts` row per attempt (posted with the post's URN, or failed with the reason; no
  token, no member id), and a `share` metric with network `linkedin` (not for test cards). The admin card
  page lists the posts with links.
- Needs a LinkedIn developer app with the products "Sign In with LinkedIn using OpenID Connect" and "Share on
  LinkedIn", the redirect URL `<BASE_URL>/linkedin/callback`, and `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
  in the env file. Without them the buttons are hidden. `LINKEDIN_API_VERSION` (YYYYMM) must be a version
  LinkedIn still supports (about a year).
- The local copy uses a pretend LinkedIn (`LINKEDIN_FAKE=1`, refused unless BASE_URL is localhost) and writes
  each post to `DATA_DIR/linkedin-outbox`.

## 18. Test flow (27 October 2026)

Admin, Test flow (`/admin/test-flow`, src/admin/test-flow.ts) tries the whole path before the ERP is connected.
Staff paste or pick a payload (six scenarios, English first: typical, ERP-style field names, an owner object, an
Arabic customer, no email, a missing company name) and press Send as the ERP. It runs the webhook's own steps
after its network checks (src/intake/accept.ts: mapping, validation, card, welcome email) as a TEST card, and
logs the run as a test-route event with the staff member as actor and the payload kept (so Replay works too).

Each run has a page: whether the run matched what the scenario expects; the JSON the ERP would get back; how each
payload field was read, and which fields the card ignores; the card (links, a QR code for a phone, the email
picture and the link preview); the welcome email (status, preview, send again; the page reloads while it
sends); Post to LinkedIn; and the ERP's follow-ups, each checked against its expected outcome: the same licence
again (unchanged), a renewal (updated), a correction (updated), and a lapsed licence (updated; the page says
expired). The dashboard links to it while ERP_IP_ALLOWLIST is empty. The email goes to the signed-in person when
MAIL_TEST_ALLOWLIST allows them.

