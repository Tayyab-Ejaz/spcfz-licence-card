// Staff admin behind its own sign-in (./auth.ts, ARCHITECTURE section 8). Server-rendered screens, plain forms, POST for
// every mutation, CSRF double-submit (./csrf.ts). Every mutation is written to the events table with the actor.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  AppEnv, CanonicalFields, CardRow, CardSource, CardStatus, Env, EventOutcome, EventRoute, EventRow, SettingKey,
} from '../types.js';
import { LANGS } from '../types.js';
import type { CardFilter } from '../db/cards.js';
import {
  countByStatus, deleteCard, findCardByLicence, getCardById, getEvent, getIntSetting, getSettings,
  expireCard, insertEvent, listCards, listEvents, metricsForCard, metricsTotals, setCardStatus, setLicenceExpiry, setSetting,
} from '../db/cards.js';
import { pageUrl } from '../storage.js';
import { csvToObjects } from '../util/csv.js';
import { raw } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { addDays, endOfDubaiDay, isPast, nowIso, parseDate, todayInDubai } from '../util/time.js';
import { mapPayload } from '../intake/mapper.js';
import { validateCanonical } from '../intake/validate.js';
import { hashFields, upsertFromCanonical } from '../intake/upsert.js';
import type { AdminVerifier, AuthHandlers } from './auth.js';
import { createAuthHandlers, sessionVerifier } from './auth.js';
import { csrfFailure, csrfToken, ensureCsrf } from './csrf.js';
import type { AdminStatus } from './layout.js';
import {
  EMPTY, actionForm, adminHeaders, badge, csrfField, fmtDateTime, h, kv, pager, respond, table, testBadge,
} from './layout.js';

const PER_PAGE = 50;
const IMPORT_CAP = 500;

const STATUSES: readonly CardStatus[] = ['pending', 'ready', 'failed', 'expired'];
const SOURCES: readonly CardSource[] = ['webhook', 'test', 'manual', 'csv', 'replay'];
const EVENT_ROUTES: readonly EventRoute[] = ['production', 'test', 'admin'];
const EVENT_OUTCOMES: readonly EventOutcome[] = [
  'created', 'unchanged', 'updated', 'rejected', 'replayed', 'deleted', 'expired', 'unexpired', 'imported', 'settings',
];

const FLASH: Record<string, string> = {
  expired: 'Card marked expired; the page now says the licence has expired. Nothing was removed.',
  unexpired: 'Card restored; the page works again.',
  expiry: 'Licence expiry date saved; the card follows it.',
  deleted: 'Card deleted.',
  created: 'Card created; the page is ready now.',
  updated: 'Card updated; the page shows the new details now.',
  unchanged: 'No change: a card with these exact details already exists.',
  saved: 'Settings saved.',
};

type Body = Record<string, unknown>;

// ------------------------------------------------------------------ small helpers

function pick<T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((x) => x === v);
}

async function readForm(c: Context<AppEnv>): Promise<Body> {
  try {
    return (await c.req.parseBody()) as Body;
  } catch {
    return {};
  }
}

function field(body: Body, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v.trim() : '';
}

function checked(body: Body, key: string): boolean {
  const v = body[key];
  return typeof v === 'string' && v !== '' && v !== '0' && v !== 'false';
}

function pageNo(c: Context<AppEnv>): number {
  const n = Number(c.req.query('page') ?? '1');
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function flashOf(c: Context<AppEnv>): string | null {
  const m = c.req.query('m');
  return m ? FLASH[m] ?? null : null;
}

function sourceIp(c: Context<AppEnv>): string {
  return c.req.header('CF-Connecting-IP') ?? '-';
}

function originOf(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return "'self'";
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Audit trail: every admin mutation lands in the events table with the Access identity (ARCHITECTURE section 9). */
async function audit(c: Context<AppEnv>, outcome: EventOutcome, card_id: string | null, errors: string[] | null = null): Promise<void> {
  await insertEvent(c.env.DB, {
    route: 'admin',
    source_ip: sourceIp(c),
    http_status: 200,
    outcome,
    card_id,
    errors,
    actor: c.get('actor') ?? null,
  });
}

function forbidden(c: Context<AppEnv>, reason: string): Response | Promise<Response> {
  return respond(
    c,
    { title: 'Request blocked', body: h`<p>This action was not applied: ${reason}. Go back, reload the page and try again.</p>` },
    403,
  );
}

function notFoundPage(c: Context<AppEnv>, what: string): Response | Promise<Response> {
  return respond(c, { title: 'Not found', body: h`<p>No such ${what}.</p><p><a href="/admin">Back to the dashboard</a></p>` }, 404);
}

function cardLink(card: Pick<CardRow, 'id' | 'company_name_en'>): RawHtml {
  return h`<a href="/admin/cards/${card.id}">${card.company_name_en}</a>`;
}

function cardsTable(env: Pick<Env, 'BASE_URL'>, rows: CardRow[], emptyText: string): RawHtml {
  return table(
    ['Company', 'Licence', 'Status', 'Test', 'Source', 'Created', 'Page', ''],
    rows.map((r) => [
      h`${r.company_name_en}${r.company_name_ar ? h`<br><span class="muted" dir="rtl">${r.company_name_ar}</span>` : EMPTY}`,
      h`<code>${r.licence_number}</code>`,
      badge(r.status),
      testBadge(r.is_test),
      h`${r.source}`,
      h`${fmtDateTime(r.created_at)}`,
      h`<a href="${pageUrl(env, r.token)}" target="_blank" rel="noopener">Open</a>`,
      h`<a href="/admin/cards/${r.id}">Detail</a>`,
    ]),
    emptyText,
  );
}

function eventsTable(rows: EventRow[]): RawHtml {
  return table(
    ['Time', 'Route', 'IP', 'HTTP', 'Outcome', 'Errors', 'Card', 'Actor', ''],
    rows.map((e) => [
      h`${fmtDateTime(e.received_at)}`,
      h`${e.route}`,
      h`<code>${e.source_ip}</code>`,
      h`${e.http_status}`,
      e.outcome === 'rejected' ? h`<span class="outcome-rejected">${e.outcome}</span>` : h`${e.outcome}`,
      h`${e.errors ? e.errors.join('; ') : ''}`,
      e.card_id ? h`<a href="/admin/cards/${e.card_id}"><code>${e.card_id}</code></a>` : EMPTY,
      h`${e.actor ?? ''}`,
      h`<a href="/admin/events/${e.id}">Detail</a>`,
    ]),
    'No events.',
  );
}

// ------------------------------------------------------------------ create

interface CreateField {
  key: keyof CanonicalFields;
  label: string;
  required: boolean;
  type: 'text' | 'date';
  hint: string;
}

const CREATE_FIELDS: readonly CreateField[] = [
  { key: 'licence_number', label: 'Licence number', required: true, type: 'text', hint: '3 to 40 characters; stored upper-case.' },
  { key: 'company_name_en', label: 'Company name (English)', required: true, type: 'text', hint: '2 to 120 characters.' },
  { key: 'company_name_ar', label: 'Company name (Arabic)', required: false, type: 'text', hint: 'Optional. The English name is used on the Arabic card when empty.' },
  { key: 'licence_type', label: 'Licence type', required: false, type: 'text', hint: 'Optional, up to 60 characters.' },
  { key: 'activity_category', label: 'Activity category', required: false, type: 'text', hint: 'Optional, up to 80 characters.' },
  { key: 'activity_category_ar', label: 'Activity category (Arabic)', required: false, type: 'text', hint: 'Optional. The English activity is used on the Arabic card when empty.' },
  { key: 'founder_name_en', label: 'Founder name', required: false, type: 'text', hint: 'Optional. Pre-filled on the card; the customer can change it.' },
  { key: 'founder_name_ar', label: 'Founder name (Arabic)', required: false, type: 'text', hint: 'Optional. The English name is used on the Arabic card when empty.' },
  { key: 'issued_on', label: 'Issued on', required: false, type: 'date', hint: 'Today in Asia/Dubai when empty.' },
  { key: 'licence_expires_on', label: 'Licence expires on', required: false, type: 'date', hint: "Optional. The card shows \"expired\" after this day; it never expires when empty." },
];

function createForm(
  c: Context<AppEnv>, values: Record<string, string>, isTest: boolean, errors: string[], status: AdminStatus = 200,
): Response | Promise<Response> {
  const token = csrfToken(c);
  const lang = values['preferred_language'] || 'en';
  const body = h`<form class="form" method="post" action="/admin/create">${csrfField(token)}
${CREATE_FIELDS.map(
  (f) => h`<label>${f.label}${f.required ? ' *' : ''}<input type="${f.type}" name="${f.key}" value="${values[f.key] ?? ''}"${f.required ? raw(' required') : EMPTY} dir="auto"><small>${f.hint}</small></label>`,
)}
<label>Preferred language<select name="preferred_language">${LANGS.map(
  (l) => h`<option value="${l}"${l === lang ? raw(' selected') : EMPTY}>${l === 'en' ? 'English' : 'Arabic'}</option>`,
)}</select><small>The language the page opens in; the visitor can switch.</small></label>
<label class="check"><input type="checkbox" name="is_test" value="1"${isTest ? raw(' checked') : EMPTY}> Test card <small>([TEST] in the page title, excluded from counters)</small></label>
<div><button class="btn" type="submit">Create card</button></div>
</form>`;
  return respond(c, { title: 'Create card', active: 'create', error: errors.length ? errors : null, flash: flashOf(c), body }, status);
}

// ------------------------------------------------------------------ import

interface DryRow {
  n: number;
  licence: string;
  company: string;
  outcome: 'create' | 'update' | 'unchanged' | 'rejected';
  errors: string[];
  fields: CanonicalFields | null;
}

async function dryRun(env: Env, rows: Record<string, string>[], isTest: boolean): Promise<DryRow[]> {
  const out: DryRow[] = [];
  for (const [i, row] of rows.entries()) {
    const n = i + 2; // spreadsheet line number: header is line 1
    const v = validateCanonical(row);
    if (!v.ok) {
      out.push({ n, licence: row['licence_number'] ?? '', company: row['company_name_en'] ?? '', outcome: 'rejected', errors: v.errors, fields: null });
      continue;
    }
    const existing = await findCardByLicence(env.DB, v.fields.licence_number, isTest);
    let outcome: DryRow['outcome'] = 'create';
    if (existing) outcome = (await hashFields(v.fields)) === existing.content_hash ? 'unchanged' : 'update';
    out.push({ n, licence: v.fields.licence_number, company: v.fields.company_name_en, outcome, errors: [], fields: v.fields });
  }
  return out;
}

function tally(dry: DryRow[]): { create: number; update: number; unchanged: number; rejected: number; valid: number } {
  const t = { create: 0, update: 0, unchanged: 0, rejected: 0, valid: 0 };
  for (const d of dry) {
    t[d.outcome] += 1;
    if (d.fields) t.valid += 1;
  }
  return t;
}

function dryTable(dry: DryRow[]): RawHtml {
  return table(
    ['Row', 'Licence', 'Company', 'Outcome', 'Errors'],
    dry.map((d) => [
      h`${d.n}`,
      h`<code>${d.licence}</code>`,
      h`${d.company}`,
      h`<span class="outcome-${d.outcome}">${d.outcome}</span>`,
      h`${d.errors.join('; ')}`,
    ]),
    'No rows.',
  );
}

interface ImportFormOptions {
  csv?: string;
  isTest?: boolean;
  errors?: string[] | null;
  status?: AdminStatus;
}

function importForm(c: Context<AppEnv>, o: ImportFormOptions): Response | Promise<Response> {
  const token = csrfToken(c);
  const body = h`<p class="muted">Header row with canonical column names: <code>licence_number</code> and <code>company_name_en</code> are required; <code>company_name_ar</code>, <code>licence_type</code>, <code>activity_category</code>, <code>activity_category_ar</code>, <code>founder_name_en</code>, <code>founder_name_ar</code>, <code>issued_on</code>, <code>licence_expires_on</code> and <code>preferred_language</code> are optional. Headers are matched case-insensitively. Up to ${IMPORT_CAP} rows per run.</p>
<form class="form" method="post" action="/admin/import" enctype="multipart/form-data">${csrfField(token)}
<label>CSV file<input type="file" name="file" accept=".csv,text/csv"></label>
<label>…or paste CSV<textarea name="csv" rows="10" dir="auto">${o.csv ?? ''}</textarea></label>
<label class="check"><input type="checkbox" name="is_test" value="1"${o.isTest ? raw(' checked') : EMPTY}> Import as test cards</label>
<div><button class="btn" type="submit">Dry run</button> <span class="muted">Nothing is written until you confirm on the next screen.</span></div>
</form>`;
  return respond(c, { title: 'Import CSV', active: 'import', error: o.errors ?? null, body }, o.status ?? 200);
}

// ------------------------------------------------------------------ settings

function settingsForm(c: Context<AppEnv>, values: Record<string, string>, errors: string[] | null, status: AdminStatus = 200): Response | Promise<Response> {
  const token = csrfToken(c);
  const v = (k: string): string => values[k] ?? '';
  const body = h`<form class="form" method="post" action="/admin/settings">${csrfField(token)}
<label class="check"><input type="checkbox" name="gtm_enabled" value="1"${v('gtm_enabled') === '1' ? raw(' checked') : EMPTY}> Load Google Tag Manager on the personal page <small>(container <code>${c.env.GTM_CONTAINER || 'not set'}</code>)</small></label>
<div><button class="btn" type="submit">Save settings</button></div>
</form>
<h2>Keeping data</h2>
<p class="muted">Nothing is deleted automatically: cards, test cards, the request bodies the test webhook received, founder names and daily counters all stay. A card shows "expired" once its licence expiry date has passed, and comes back when the ERP sends a renewal.</p>
<h2>Field mapping (read-only)</h2>
<p class="muted">From the <code>FIELD_MAP</code> environment variable; change it in the service's env file and recreate the container (docs/RUNBOOK.md). Secrets and the ERP IP allowlist are not editable here.</p>
<pre>${prettyJson(c.env.FIELD_MAP || '{}')}</pre>`;
  return respond(c, { title: 'Settings', active: 'settings', error: errors, flash: flashOf(c), body }, status);
}

// ------------------------------------------------------------------ the router

export function createAdminRoutes(verify: AdminVerifier, auth: AuthHandlers = createAuthHandlers()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Sign-in and sign-out sit in front of the session check (./auth.ts). The sign-in page needs ?key=.
  app.use('*', async (c, next) => {
    adminHeaders(c, originOf(c.env.BASE_URL ?? ''));
    await next();
  });
  app.get('/login', (c) => auth.showLogin(c));
  app.post('/login', (c) => auth.doLogin(c));

  app.use('*', async (c, next) => {
    const identity = await verify(c);
    // No session: the same plain 404 as any unknown address, so the admin does not announce itself.
    if (!identity) return c.text('Not found', 404);
    c.set('actor', identity.email);
    ensureCsrf(c);
    await next();
  });

  app.post('/logout', async (c) => {
    const bad = csrfFailure(c, await readForm(c));
    if (bad) return forbidden(c, bad);
    return auth.doLogout(c);
  });

  // ---------------------------------------------------------------- dashboard

  app.get('/', async (c) => {
    const db = c.env.DB;
    const since = addDays(`${todayInDubai()}T00:00:00.000Z`, -7).slice(0, 10);
    const [byStatus, totals, rejected] = await Promise.all([
      countByStatus(db),
      metricsTotals(db, since),
      listEvents(db, { outcome: 'rejected', limit: 10 }),
    ]);
    const body = h`
<h2>Live cards by status</h2>
<div class="cards">${STATUSES.map(
  (s) => h`<div class="stat"><b>${byStatus[s]}</b><span><a href="/admin/cards?status=${s}&amp;is_test=0">${s}</a></span></div>`,
)}</div>
<h2>Last 7 days, since ${since}</h2>
<div class="cards">
<div class="stat"><b>${totals.view}</b><span>Page views</span></div>
<div class="stat"><b>${totals.download}</b><span>Downloads</span></div>
<div class="stat"><b>${totals.share}</b><span>Share clicks</span></div>
<div class="stat"><b>${totals.caption}</b><span>Caption copies</span></div>
</div>
<h2>Recent rejected events</h2>
${eventsTable(rejected.rows)}`;
    return respond(c, { title: 'Dashboard', active: 'dashboard', flash: flashOf(c), body });
  });

  // ---------------------------------------------------------------- cards

  app.get('/cards', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const status = pick(c.req.query('status'), STATUSES);
    const source = pick(c.req.query('source'), SOURCES);
    const isTestQ = c.req.query('is_test');
    const page = pageNo(c);

    const filter: CardFilter = { limit: PER_PAGE, offset: (page - 1) * PER_PAGE };
    const query: Record<string, string> = {};
    if (q) {
      filter.q = q;
      query['q'] = q;
    }
    if (status) {
      filter.status = status;
      query['status'] = status;
    }
    if (source) {
      filter.source = source;
      query['source'] = source;
    }
    if (isTestQ === '1' || isTestQ === '0') {
      filter.is_test = isTestQ === '1';
      query['is_test'] = isTestQ;
    }

    const { rows, total } = await listCards(c.env.DB, filter);
    const sel = (on: boolean): RawHtml => (on ? raw(' selected') : EMPTY);
    const body = h`
<form class="filters" method="get" action="/admin/cards">
<label>Search<input type="search" name="q" value="${q}" placeholder="Company, licence number or token"></label>
<label>Status<select name="status"><option value="">Any</option>${STATUSES.map((s) => h`<option value="${s}"${sel(s === status)}>${s}</option>`)}</select></label>
<label>Test<select name="is_test"><option value="">Any</option><option value="0"${sel(isTestQ === '0')}>Live only</option><option value="1"${sel(isTestQ === '1')}>Test only</option></select></label>
<label>Source<select name="source"><option value="">Any</option>${SOURCES.map((s) => h`<option value="${s}"${sel(s === source)}>${s}</option>`)}</select></label>
<button class="btn" type="submit">Filter</button>
<a class="btn secondary" href="/admin/cards">Reset</a>
</form>
${cardsTable(c.env, rows, 'No cards match.')}
${pager('/admin/cards', query, page, total, PER_PAGE)}`;
    return respond(c, { title: 'Cards', active: 'cards', flash: flashOf(c), body });
  });

  app.get('/cards/:id', async (c) => {
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    const [metrics, events] = await Promise.all([
      metricsForCard(c.env.DB, card.id),
      listEvents(c.env.DB, { card_id: card.id, limit: 20 }),
    ]);
    const token = csrfToken(c);
    const url = pageUrl(c.env, card.token);
    const licencePast = isPast(card.expires_at);
    const body = h`
${kv([
  ['Company (English)', card.company_name_en],
  ['Company (Arabic)', card.company_name_ar ? h`<span dir="rtl">${card.company_name_ar}</span>` : null],
  ['Licence number', h`<code>${card.licence_number}</code>`],
  ['Licence type', card.licence_type],
  ['Activity', card.activity_category],
  ['Activity (Arabic)', card.activity_category_ar ? h`<span dir="rtl">${card.activity_category_ar}</span>` : null],
  ['Founder', card.founder_name_en],
  ['Founder (Arabic)', card.founder_name_ar ? h`<span dir="rtl">${card.founder_name_ar}</span>` : null],
  ['Issued on', card.issued_on],
  ['Licence expires on', card.licence_expires_on ?? h`<span class="muted">not known: the card does not expire</span>`],
  ['Preferred language', card.preferred_language],
  ['Status', badge(card.status)],
  ['Test card', card.is_test ? 'yes' : 'no'],
  ['Source', card.source],
  ['Content hash', h`<code>${card.content_hash}</code>`],
  ['Page', h`<a href="${url}" target="_blank" rel="noopener">${url}</a>`],
  ['Created', fmtDateTime(card.created_at)],
  ['Updated', fmtDateTime(card.updated_at)],
  ['Card expires', card.expires_at ? fmtDateTime(card.expires_at) : 'never'],
  ['Card id', h`<code>${card.id}</code>`],
])}
<div class="actions">
${licencePast
  ? h`<span class="muted">The licence expired on ${card.licence_expires_on}. Set a later expiry date below to bring the card back.</span>`
  : card.status === 'expired'
    ? actionForm(`/admin/cards/${card.id}/unexpire`, 'Restore', token, 'btn small secondary')
    : actionForm(`/admin/cards/${card.id}/expire`, 'Mark expired', token, 'btn small secondary')}
<a class="btn small danger" href="/admin/cards/${card.id}/delete">Delete…</a>
</div>
<form class="form inline" method="post" action="/admin/cards/${card.id}/licence-expiry">${csrfField(token)}
<label>Licence expires on<input type="date" name="licence_expires_on" value="${card.licence_expires_on ?? ''}"><small>The card shows "expired" after this day. Leave empty if it is not known. The ERP's next update for this licence replaces it.</small></label>
<div><button class="btn small" type="submit">Save expiry date</button></div>
</form>
<p class="muted">The card is built in the customer's browser: open the page to see it.</p>
<h2>Metrics (all time)</h2>
${table(
  ['Kind', 'Lang', 'Size', 'Network', 'Count'],
  metrics.map((m) => [h`${m.kind}`, h`${m.lang}`, h`${m.size}`, h`${m.network}`, h`${m.count}`]),
  'No activity yet.',
)}
<h2>Last 20 events</h2>
${eventsTable(events.rows)}`;
    return respond(c, { title: card.company_name_en, active: 'cards', flash: flashOf(c), body });
  });

  app.post('/cards/:id/expire', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    await expireCard(c.env.DB, card.id);
    await audit(c, 'expired', card.id);
    return c.redirect(`/admin/cards/${card.id}?m=expired`, 303);
  });

  app.post('/cards/:id/unexpire', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    // Restore undoes "Mark expired". A licence that has itself expired needs a later expiry date instead.
    if (isPast(card.expires_at)) return c.redirect(`/admin/cards/${card.id}`, 303);
    await setCardStatus(c.env.DB, card.id, 'ready');
    await audit(c, 'unexpired', card.id);
    return c.redirect(`/admin/cards/${card.id}?m=unexpired`, 303);
  });

  app.post('/cards/:id/licence-expiry', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    const raw = field(body, 'licence_expires_on');
    const date = raw ? parseDate(raw) : null;
    if (raw && !date) return forbidden(c, 'that is not a date');
    if (date && date < card.issued_on) return forbidden(c, `the expiry date is before the issue date (${card.issued_on})`);
    const expires_at = date ? endOfDubaiDay(date) : null;
    // A future (or no) expiry brings an expired card back; a past one expires it.
    const status = isPast(expires_at) ? 'expired' : card.status === 'expired' && !isPast(card.expires_at) ? 'expired' : 'ready';
    await setLicenceExpiry(c.env.DB, card.id, date, expires_at, status);
    await audit(c, 'updated', card.id);
    return c.redirect(`/admin/cards/${card.id}?m=expiry`, 303);
  });

  app.get('/cards/:id/delete', async (c) => {
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    const token = csrfToken(c);
    const body = h`
<p>Delete <strong>${card.company_name_en}</strong> (<code>${card.licence_number}</code>${card.is_test ? ', test card' : ''})?</p>
<p>The row and its counters are removed. The page link stops working. If the ERP sends this licence again a new card with a new link is created.</p>
<form method="post" action="/admin/cards/${card.id}/delete" class="actions">${csrfField(token)}
<button type="submit" class="btn danger">Yes, delete this card</button>
<a class="btn secondary" href="/admin/cards/${card.id}">Cancel</a>
</form>`;
    return respond(c, { title: 'Delete card', active: 'cards', body });
  });

  app.post('/cards/:id/delete', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    await deleteCard(c.env.DB, card.id);
    await audit(c, 'deleted', card.id);
    return c.redirect('/admin/cards?m=deleted', 303);
  });

  // ---------------------------------------------------------------- events

  app.get('/events', async (c) => {
    const route = pick(c.req.query('route'), EVENT_ROUTES);
    const outcome = pick(c.req.query('outcome'), EVENT_OUTCOMES);
    const page = pageNo(c);
    const { rows, total } = await listEvents(c.env.DB, { route, outcome, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
    const query: Record<string, string> = {};
    if (route) query['route'] = route;
    if (outcome) query['outcome'] = outcome;
    const sel = (on: boolean): RawHtml => (on ? raw(' selected') : EMPTY);
    const body = h`
<form class="filters" method="get" action="/admin/events">
<label>Route<select name="route"><option value="">Any</option>${EVENT_ROUTES.map((r) => h`<option value="${r}"${sel(r === route)}>${r}</option>`)}</select></label>
<label>Outcome<select name="outcome"><option value="">Any</option>${EVENT_OUTCOMES.map((o) => h`<option value="${o}"${sel(o === outcome)}>${o}</option>`)}</select></label>
<button class="btn" type="submit">Filter</button>
<a class="btn secondary" href="/admin/events">Reset</a>
</form>
${eventsTable(rows)}
${pager('/admin/events', query, page, total, PER_PAGE)}`;
    return respond(c, { title: 'Events', active: 'events', flash: flashOf(c), body });
  });

  app.get('/events/:id', async (c) => {
    const ev = await getEvent(c.env.DB, c.req.param('id'));
    if (!ev) return notFoundPage(c, 'event');
    const token = csrfToken(c);
    const card = ev.card_id ? await getCardById(c.env.DB, ev.card_id) : null;
    const body = h`
${kv([
  ['Received', fmtDateTime(ev.received_at)],
  ['Route', ev.route],
  ['Source IP', h`<code>${ev.source_ip}</code>`],
  ['HTTP status', ev.http_status],
  ['Outcome', ev.outcome],
  ['Errors', ev.errors ? h`<ul>${ev.errors.map((e) => h`<li>${e}</li>`)}</ul>` : null],
  ['Card', card ? cardLink(card) : ev.card_id ? h`<code>${ev.card_id}</code> <span class="muted">(no longer exists)</span>` : null],
  ['Actor', ev.actor],
  ['Event id', h`<code>${ev.id}</code>`],
])}
${ev.raw_body
  ? h`<h2>Raw body</h2><pre>${prettyJson(ev.raw_body)}</pre>`
  : h`<p class="muted">No raw body stored for this event${ev.route === 'test' ? '' : ' (only the test route keeps raw bodies)'}.</p>`}
<div class="actions">
${ev.raw_body
  ? actionForm(`/admin/events/${ev.id}/replay`, 'Replay from raw body', token)
  : h`<span class="muted">Nothing to replay: only test-route events keep their raw body.</span>`}
</div>`;
    return respond(c, { title: `Event ${ev.id}`, active: 'events', flash: flashOf(c), body });
  });

  const replayError = (c: Context<AppEnv>, ev: EventRow, errors: string[]): Response | Promise<Response> =>
    respond(
      c,
      {
        title: 'Replay not applied',
        active: 'events',
        error: errors,
        body: h`<p><a href="/admin/events/${ev.id}">Back to the event</a></p>`,
      },
      400,
    );

  app.post('/events/:id/replay', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const ev = await getEvent(c.env.DB, c.req.param('id'));
    if (!ev) return notFoundPage(c, 'event');

    if (ev.raw_body) {
      let payload: unknown;
      try {
        payload = JSON.parse(ev.raw_body);
      } catch {
        return replayError(c, ev, ['The stored raw body is not valid JSON.']);
      }
      const mapped = mapPayload(payload, c.env.FIELD_MAP || '{}');
      const v = validateCanonical(mapped);
      if (!v.ok) return replayError(c, ev, v.errors);
      const r = await upsertFromCanonical(c.env, v.fields, { is_test: ev.route === 'test', source: 'replay' });
      await audit(c, 'replayed', r.card.id);
      const result = h`${kv([
        ['Source event', h`<a href="/admin/events/${ev.id}">${ev.id}</a>`],
        ['Outcome', r.outcome],
        ['Card', cardLink(r.card)],
        ['Page URL', h`<a href="${r.page_url}" target="_blank" rel="noopener">${r.page_url}</a>`],
        ['Test card', r.card.is_test ? 'yes' : 'no'],
      ])}`;
      return respond(c, { title: 'Replay applied', active: 'events', flash: `Event replayed: ${r.outcome}.`, body: result });
    }

    return replayError(c, ev, ['This event has no raw body, so there is nothing to replay.']);
  });

  // ---------------------------------------------------------------- create

  app.get('/create', (c) => createForm(c, {}, false, []));

  app.post('/create', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const values: Record<string, string> = {};
    for (const f of CREATE_FIELDS) values[f.key] = field(body, f.key);
    values['preferred_language'] = field(body, 'preferred_language');
    const isTest = checked(body, 'is_test');
    const v = validateCanonical(values);
    if (!v.ok) return createForm(c, values, isTest, v.errors, 400);
    const r = await upsertFromCanonical(c.env, v.fields, { is_test: isTest, source: 'manual' });
    await audit(c, r.outcome, r.card.id);
    return c.redirect(`/admin/cards/${r.card.id}?m=${r.outcome}`, 303);
  });

  // ---------------------------------------------------------------- import

  app.get('/import', (c) => importForm(c, {}));

  app.post('/import', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);

    const fileV = body['file'];
    const csv = fileV instanceof File && fileV.size > 0 ? await fileV.text() : field(body, 'csv');
    const isTest = checked(body, 'is_test');
    if (!csv.trim()) return importForm(c, { isTest, errors: ['Upload a file or paste CSV text.'], status: 400 });

    const rows = csvToObjects(csv);
    if (rows.length === 0) return importForm(c, { csv, isTest, errors: ['No data rows found under the header row.'], status: 400 });
    if (rows.length > IMPORT_CAP) {
      return importForm(c, { csv, isTest, errors: [`Too many rows (${rows.length}); the limit is ${IMPORT_CAP} per run.`], status: 400 });
    }

    const dry = await dryRun(c.env, rows, isTest);
    const counts = tally(dry);
    const summary = `${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged, ${counts.rejected} rejected.`;

    if (field(body, 'confirm') !== '1') {
      const token = csrfToken(c);
      const preview = h`<p><strong>Dry run</strong>${isTest ? ' (as test cards)' : ''}: ${summary} Nothing has been written.</p>
${dryTable(dry)}
<form method="post" action="/admin/import" class="actions">${csrfField(token)}
<textarea name="csv" hidden>${csv}</textarea>
<input type="hidden" name="confirm" value="1">
${isTest ? h`<input type="hidden" name="is_test" value="1">` : EMPTY}
<button class="btn" type="submit"${counts.valid === 0 ? raw(' disabled') : EMPTY}>Apply ${counts.valid} valid ${counts.valid === 1 ? 'row' : 'rows'}</button>
<a class="btn secondary" href="/admin/import">Start over</a>
</form>`;
      return respond(c, { title: 'Import CSV: dry run', active: 'import', body: preview });
    }

    const applied = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    const rejected: string[] = [];
    for (const d of dry) {
      if (!d.fields) {
        applied.rejected += 1;
        rejected.push(`row ${d.n}: ${d.errors.join('; ')}`);
        continue;
      }
      const r = await upsertFromCanonical(c.env, d.fields, { is_test: isTest, source: 'csv' });
      applied[r.outcome] += 1;
    }
    await audit(c, 'imported', null, rejected.length ? rejected.slice(0, 50) : null);
    const result = h`<div class="cards">
<div class="stat"><b>${applied.created}</b><span>Created</span></div>
<div class="stat"><b>${applied.updated}</b><span>Updated</span></div>
<div class="stat"><b>${applied.unchanged}</b><span>Unchanged</span></div>
<div class="stat"><b>${applied.rejected}</b><span>Rejected</span></div>
</div>
${dryTable(dry)}
<p><a class="btn secondary" href="/admin/import">Import another file</a> <a class="btn secondary" href="/admin/cards?source=csv">View imported cards</a></p>`;
    return respond(c, {
      title: 'Import CSV: applied',
      active: 'import',
      flash: 'Import applied. Created and updated cards are ready now.',
      body: result,
    });
  });

  // ---------------------------------------------------------------- settings

  app.get('/settings', async (c) => settingsForm(c, await getSettings(c.env.DB), null));

  app.post('/settings', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);

    const submitted: Record<string, string> = { ...(await getSettings(c.env.DB)) };
    const errors: string[] = [];
    const updates: Array<[SettingKey, string]> = [];

    const gtm = checked(body, 'gtm_enabled') ? '1' : '0';
    submitted['gtm_enabled'] = gtm;
    updates.push(['gtm_enabled', gtm]);

    if (errors.length) return settingsForm(c, submitted, errors, 400);
    for (const [k, v] of updates) await setSetting(c.env.DB, k, v);
    await audit(c, 'settings', null);
    return c.redirect('/admin/settings?m=saved', 303);
  });

  return app;
}

export const adminRoutes: Hono<AppEnv> = createAdminRoutes(sessionVerifier);
