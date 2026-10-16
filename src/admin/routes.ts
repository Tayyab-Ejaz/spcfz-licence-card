// Staff admin behind Cloudflare Access (ARCHITECTURE section 8). Server-rendered screens, plain forms, POST for
// every mutation, CSRF double-submit (./csrf.ts). Every mutation is written to the events table with the actor.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  AppEnv, CanonicalFields, CardRow, CardSource, CardStatus, Env, EventOutcome, EventRoute, EventRow, SettingKey,
} from '../types.js';
import { LANGS, SIZE_NAMES } from '../types.js';
import type { CardFilter } from '../db/cards.js';
import {
  countByStatus, countCards, deleteCard, findCardByLicence, getCardById, getEvent, getIntSetting, getSettings,
  insertEvent, listCards, listEvents, metricsForCard, metricsTotals, setCardExpiry, setCardStatus, setSetting,
} from '../db/cards.js';
import { deleteCardImages, imageUrl, pageUrl, purgeImageCache } from '../storage.js';
import { csvToObjects } from '../util/csv.js';
import { raw } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { addDays, nowIso, todayInDubai } from '../util/time.js';
import { mapPayload } from '../intake/mapper.js';
import { validateCanonical } from '../intake/validate.js';
import { hashFields, upsertFromCanonical } from '../intake/upsert.js';
import type { AccessVerifier } from './access.js';
import { isAccessConfigured, verifyAccessJwt } from './access.js';
import { csrfFailure, csrfToken, ensureCsrf } from './csrf.js';
import type { AdminStatus } from './layout.js';
import {
  EMPTY, actionForm, adminHeaders, badge, csrfField, fmtDateTime, h, kv, pager, respond, table, testBadge,
} from './layout.js';

const PER_PAGE = 50;
const RERENDER_CAP = 500;
const IMPORT_CAP = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES: readonly CardStatus[] = ['pending', 'ready', 'failed', 'expired'];
const SOURCES: readonly CardSource[] = ['webhook', 'test', 'manual', 'csv', 'replay'];
const EVENT_ROUTES: readonly EventRoute[] = ['production', 'test', 'admin'];
const EVENT_OUTCOMES: readonly EventOutcome[] = [
  'created', 'unchanged', 'updated', 'rejected', 'replayed', 'regenerated', 'deleted', 'expired', 'imported', 'settings', 'rerender',
];

const FLASH: Record<string, string> = {
  regenerated: 'Re-render queued.',
  expired: 'Card marked expired; its images were deleted.',
  unexpired: 'Card restored with a fresh expiry; a re-render is queued.',
  deleted: 'Card deleted.',
  created: 'Card created; a render is queued.',
  updated: 'Card updated; a re-render is queued.',
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

/** Back to pending and onto the render queue; the consumer purges the edge cache once new images are written. */
async function enqueueRender(env: Env, card: CardRow): Promise<void> {
  await setCardStatus(env.DB, card.id, 'pending', { render_error: null });
  await env.RENDER_QUEUE.send({ card_id: card.id, content_hash: card.content_hash });
}

async function removeImages(env: Env, token: string): Promise<void> {
  await deleteCardImages(env.BUCKET, token);
  try {
    await purgeImageCache(env, token);
  } catch (err) {
    console.warn('admin: cache purge failed', { token, message: err instanceof Error ? err.message : String(err) });
  }
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
  { key: 'issued_on', label: 'Issued on', required: false, type: 'date', hint: 'Today in Asia/Dubai when empty.' },
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
<label class="check"><input type="checkbox" name="is_test" value="1"${isTest ? raw(' checked') : EMPTY}> Test card <small>(TEST ribbon, excluded from counters, purged after the test retention period)</small></label>
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
  const body = h`<p class="muted">Header row with canonical column names: <code>licence_number</code> and <code>company_name_en</code> are required; <code>company_name_ar</code>, <code>licence_type</code>, <code>activity_category</code>, <code>activity_category_ar</code>, <code>issued_on</code> and <code>preferred_language</code> are optional. Headers are matched case-insensitively. Up to ${IMPORT_CAP} rows per run.</p>
<form class="form" method="post" action="/admin/import" enctype="multipart/form-data">${csrfField(token)}
<label>CSV file<input type="file" name="file" accept=".csv,text/csv"></label>
<label>…or paste CSV<textarea name="csv" rows="10" dir="auto">${o.csv ?? ''}</textarea></label>
<label class="check"><input type="checkbox" name="is_test" value="1"${o.isTest ? raw(' checked') : EMPTY}> Import as test cards</label>
<div><button class="btn" type="submit">Dry run</button> <span class="muted">Nothing is written until you confirm on the next screen.</span></div>
</form>`;
  return respond(c, { title: 'Import CSV', active: 'import', error: o.errors ?? null, body }, o.status ?? 200);
}

// ------------------------------------------------------------------ re-render

interface RerenderValues {
  template_version: string;
  created_after: string;
  created_before: string;
}

function rerenderForm(c: Context<AppEnv>, v: RerenderValues, errors: string[] | null, status: AdminStatus = 200): Response | Promise<Response> {
  const token = csrfToken(c);
  const body = h`<p class="muted">Queues a fresh render for live cards matching every filter you set (test and expired cards are skipped). Up to ${RERENDER_CAP} cards per run; run again for the rest. The current template version is <code>${c.env.TEMPLATE_VERSION}</code>.</p>
<form class="form" method="post" action="/admin/rerender">${csrfField(token)}
<label>Template version<input name="template_version" value="${v.template_version}" placeholder="e.g. placeholder-1"><small>Cards whose stamped template_version equals this. Leave empty to ignore.</small></label>
<div class="row">
<label>Created on or after<input type="date" name="created_after" value="${v.created_after}"></label>
<label>Created on or before<input type="date" name="created_before" value="${v.created_before}"></label>
</div>
<div><button class="btn" type="submit">Count matching cards</button></div>
</form>`;
  return respond(c, { title: 'Re-render', active: 'rerender', error: errors, body }, status);
}

// ------------------------------------------------------------------ settings

const TEXT_SETTINGS = ['caption_en', 'caption_ar'] as const;
const NUMERIC_SETTINGS = ['retention_days', 'test_retention_days', 'raw_body_days'] as const;

function settingsForm(c: Context<AppEnv>, values: Record<string, string>, errors: string[] | null, status: AdminStatus = 200): Response | Promise<Response> {
  const token = csrfToken(c);
  const v = (k: string): string => values[k] ?? '';
  const body = h`<form class="form" method="post" action="/admin/settings">${csrfField(token)}
<label>Caption (English)<textarea name="caption_en" rows="4" dir="ltr">${v('caption_en')}</textarea><small>Placeholders: <code>{company}</code> and <code>{link}</code>.</small></label>
<label>Caption (Arabic)<textarea name="caption_ar" rows="4" dir="rtl">${v('caption_ar')}</textarea><small>Same placeholders. Must be reviewed by a native reader before launch.</small></label>
<label class="check"><input type="checkbox" name="gtm_enabled" value="1"${v('gtm_enabled') === '1' ? raw(' checked') : EMPTY}> Load Google Tag Manager on the personal page <small>(container <code>${c.env.GTM_CONTAINER || 'not set'}</code>)</small></label>
<div class="row">
<label>Live card retention (days)<input type="number" min="0" step="1" name="retention_days" value="${v('retention_days')}"></label>
<label>Test card retention (days)<input type="number" min="0" step="1" name="test_retention_days" value="${v('test_retention_days')}"></label>
<label>Raw body retention (days)<input type="number" min="0" step="1" name="raw_body_days" value="${v('raw_body_days')}"></label>
</div>
<div><button class="btn" type="submit">Save settings</button></div>
</form>
<h2>Field mapping (read-only)</h2>
<p class="muted">From the <code>FIELD_MAP</code> environment variable; change it in the service's env file and restart the container. Secrets and the ERP IP allowlist are not editable here.</p>
<pre>${prettyJson(c.env.FIELD_MAP || '{}')}</pre>`;
  return respond(c, { title: 'Settings', active: 'settings', error: errors, flash: flashOf(c), body }, status);
}

// ------------------------------------------------------------------ the router

export function createAdminRoutes(verify: AccessVerifier): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    adminHeaders(c, originOf(c.env.BASE_URL ?? ''));
    const identity = await verify(c);
    if (!identity) {
      if (!isAccessConfigured(c.env)) {
        return respond(
          c,
          {
            title: 'Admin is not configured',
            body: h`<p>Cloudflare Access is not set up for this deployment: the <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code> variables are missing (docs/CLOUDFLARE-SETUP.md).</p>`,
          },
          503,
        );
      }
      return respond(
        c,
        { title: 'Sign in required', body: h`<p>Your Cloudflare Access session was not accepted. <a href="/admin">Sign in again</a>.</p>` },
        401,
      );
    }
    c.set('actor', identity.email);
    ensureCsrf(c);
    await next();
  });

  // ---------------------------------------------------------------- dashboard

  app.get('/', async (c) => {
    const db = c.env.DB;
    const since = addDays(`${todayInDubai()}T00:00:00.000Z`, -7).slice(0, 10);
    const [byStatus, totals, failed, rejected] = await Promise.all([
      countByStatus(db),
      metricsTotals(db, since),
      listCards(db, { status: 'failed', limit: 10 }),
      listEvents(db, { outcome: 'rejected', limit: 10 }),
    ]);
    const token = csrfToken(c);
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
<h2>Recent failed cards</h2>
${table(
  ['Company', 'Licence', 'Updated', 'Error', ''],
  failed.rows.map((r) => [
    cardLink(r),
    h`<code>${r.licence_number}</code>`,
    h`${fmtDateTime(r.updated_at)}`,
    h`${r.render_error ?? ''}`,
    actionForm(`/admin/cards/${r.id}/regenerate`, 'Regenerate', token),
  ]),
  'No failed cards.',
)}
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
    const body = h`
${kv([
  ['Company (English)', card.company_name_en],
  ['Company (Arabic)', card.company_name_ar ? h`<span dir="rtl">${card.company_name_ar}</span>` : null],
  ['Licence number', h`<code>${card.licence_number}</code>`],
  ['Licence type', card.licence_type],
  ['Activity', card.activity_category],
  ['Activity (Arabic)', card.activity_category_ar ? h`<span dir="rtl">${card.activity_category_ar}</span>` : null],
  ['Issued on', card.issued_on],
  ['Preferred language', card.preferred_language],
  ['Status', h`${badge(card.status)} ${card.render_error ? h`<span class="muted">${card.render_error}</span>` : EMPTY}`],
  ['Test card', card.is_test ? 'yes' : 'no'],
  ['Source', card.source],
  ['Template version', card.template_version],
  ['Content hash', h`<code>${card.content_hash}</code>`],
  ['Page', h`<a href="${url}" target="_blank" rel="noopener">${url}</a>`],
  ['Created', fmtDateTime(card.created_at)],
  ['Updated', fmtDateTime(card.updated_at)],
  ['Rendered', fmtDateTime(card.rendered_at)],
  ['Expires', fmtDateTime(card.expires_at)],
  ['Card id', h`<code>${card.id}</code>`],
])}
<div class="actions">
${actionForm(`/admin/cards/${card.id}/regenerate`, 'Regenerate', token)}
${card.status === 'expired'
  ? actionForm(`/admin/cards/${card.id}/unexpire`, 'Un-expire', token, 'btn small secondary')
  : actionForm(`/admin/cards/${card.id}/expire`, 'Mark expired', token, 'btn small secondary')}
<a class="btn small danger" href="/admin/cards/${card.id}/delete">Delete…</a>
</div>
<h2>Images</h2>
<div class="thumbs">${LANGS.flatMap((lang) =>
  SIZE_NAMES.map((size) => {
    const src = imageUrl(c.env, card, lang, size);
    return h`<figure><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${lang} ${size}" loading="lazy"></a><figcaption>${lang}-${size}</figcaption></figure>`;
  }),
)}</div>
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

  app.post('/cards/:id/regenerate', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    await enqueueRender(c.env, card);
    await audit(c, 'regenerated', card.id);
    return c.redirect(`/admin/cards/${card.id}?m=regenerated`, 303);
  });

  app.post('/cards/:id/expire', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    await setCardStatus(c.env.DB, card.id, 'expired');
    await removeImages(c.env, card.token);
    await audit(c, 'expired', card.id);
    return c.redirect(`/admin/cards/${card.id}?m=expired`, 303);
  });

  app.post('/cards/:id/unexpire', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    const days = await getIntSetting(c.env.DB, 'retention_days', 730);
    await setCardExpiry(c.env.DB, card.id, addDays(nowIso(), days));
    await enqueueRender(c.env, card);
    await audit(c, 'regenerated', card.id);
    return c.redirect(`/admin/cards/${card.id}?m=unexpired`, 303);
  });

  app.get('/cards/:id/delete', async (c) => {
    const card = await getCardById(c.env.DB, c.req.param('id'));
    if (!card) return notFoundPage(c, 'card');
    const token = csrfToken(c);
    const body = h`
<p>Delete <strong>${card.company_name_en}</strong> (<code>${card.licence_number}</code>${card.is_test ? ', test card' : ''})?</p>
<p>The row, its counters and all eight images are removed. The page link stops working. If the ERP sends this licence again a new card with a new link is created.</p>
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
    await removeImages(c.env, card.token);
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
  ? h`<h2>Raw body <span class="muted">(kept until ${fmtDateTime(ev.raw_body_expires_at)})</span></h2><pre>${prettyJson(ev.raw_body)}</pre>`
  : h`<p class="muted">No raw body stored for this event${ev.route === 'test' ? ' (purged after the raw body retention period)' : ' (only the test route keeps raw bodies)'}.</p>`}
<div class="actions">
${ev.raw_body
  ? actionForm(`/admin/events/${ev.id}/replay`, 'Replay from raw body', token)
  : card
    ? actionForm(`/admin/events/${ev.id}/replay`, 'Re-render the card', token)
    : h`<span class="muted">Nothing to replay: no raw body and no card.</span>`}
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

    if (ev.card_id) {
      const card = await getCardById(c.env.DB, ev.card_id);
      if (!card) return replayError(c, ev, ['The card this event points to no longer exists.']);
      await enqueueRender(c.env, card);
      await audit(c, 'replayed', card.id);
      return c.redirect(`/admin/cards/${card.id}?m=regenerated`, 303);
    }

    return replayError(c, ev, ['This event has no raw body and no card, so there is nothing to replay.']);
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
      flash: 'Import applied. Renders are queued for created and updated cards.',
      body: result,
    });
  });

  // ---------------------------------------------------------------- re-render

  app.get('/rerender', (c) => rerenderForm(c, { template_version: '', created_after: '', created_before: '' }, null));

  app.post('/rerender', async (c) => {
    const body = await readForm(c);
    const bad = csrfFailure(c, body);
    if (bad) return forbidden(c, bad);

    const values: RerenderValues = {
      template_version: field(body, 'template_version'),
      created_after: field(body, 'created_after'),
      created_before: field(body, 'created_before'),
    };
    const errors: string[] = [];
    if (values.created_after && !DATE_RE.test(values.created_after)) errors.push('created_after must be YYYY-MM-DD');
    if (values.created_before && !DATE_RE.test(values.created_before)) errors.push('created_before must be YYYY-MM-DD');
    if (!values.template_version && !values.created_after && !values.created_before) {
      errors.push('Set at least one filter; re-rendering every card is not offered here.');
    }
    if (errors.length) return rerenderForm(c, values, errors, 400);

    const filter: CardFilter = { is_test: false };
    if (values.template_version) filter.template_version = values.template_version;
    if (values.created_after) filter.created_after = `${values.created_after}T00:00:00.000Z`;
    if (values.created_before) filter.created_before = addDays(`${values.created_before}T00:00:00.000Z`, 1);

    if (field(body, 'confirm') !== '1') {
      const count = await countCards(c.env.DB, filter);
      const token = csrfToken(c);
      const preview = h`<p><strong>${count}</strong> live ${count === 1 ? 'card matches' : 'cards match'} (expired ones among them are skipped).${
        count > RERENDER_CAP ? h` Only the newest ${RERENDER_CAP} are queued in this run; run again for the rest.` : EMPTY
      }</p>
<form method="post" action="/admin/rerender" class="actions">${csrfField(token)}
<input type="hidden" name="template_version" value="${values.template_version}">
<input type="hidden" name="created_after" value="${values.created_after}">
<input type="hidden" name="created_before" value="${values.created_before}">
<input type="hidden" name="confirm" value="1">
<button class="btn" type="submit"${count === 0 ? raw(' disabled') : EMPTY}>Queue re-render</button>
<a class="btn secondary" href="/admin/rerender">Back</a>
</form>`;
      return respond(c, { title: 'Re-render: confirm', active: 'rerender', body: preview });
    }

    const { rows } = await listCards(c.env.DB, { ...filter, limit: RERENDER_CAP });
    let queued = 0;
    for (const card of rows) {
      if (card.status === 'expired') continue;
      await enqueueRender(c.env, card);
      queued += 1;
    }
    await audit(c, 'rerender', null, [`${queued} cards queued`, `filter ${JSON.stringify(values)}`]);
    return respond(c, {
      title: 'Re-render queued',
      active: 'rerender',
      flash: `${queued} ${queued === 1 ? 'card' : 'cards'} set to pending and queued.`,
      body: h`<p><a href="/admin/cards?status=pending&amp;is_test=0">Watch them in the cards list</a> or <a href="/admin/rerender">queue another batch</a>.</p>`,
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

    for (const key of TEXT_SETTINGS) {
      if (!(key in body)) continue;
      const v = field(body, key);
      submitted[key] = v;
      if (!v) errors.push(`${key}: cannot be empty`);
      else updates.push([key, v]);
    }

    const gtm = checked(body, 'gtm_enabled') ? '1' : '0';
    submitted['gtm_enabled'] = gtm;
    updates.push(['gtm_enabled', gtm]);

    for (const key of NUMERIC_SETTINGS) {
      if (!(key in body)) continue;
      const v = field(body, key);
      submitted[key] = v;
      if (!/^\d{1,5}$/.test(v)) errors.push(`${key}: must be a whole number of days, 0 or more`);
      else updates.push([key, String(Number(v))]);
    }

    if (errors.length) return settingsForm(c, submitted, errors, 400);
    for (const [k, v] of updates) await setSetting(c.env.DB, k, v);
    await audit(c, 'settings', null);
    return c.redirect('/admin/settings?m=saved', 303);
  });

  return app;
}

export const adminRoutes: Hono<AppEnv> = createAdminRoutes(verifyAccessJwt);
