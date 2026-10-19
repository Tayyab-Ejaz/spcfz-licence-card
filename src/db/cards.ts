// Repository layer over the D1-shaped database (src/platform/sqlite-db.ts). Every SQL statement in the service lives in src/db.
import type {
  CanonicalFields, CardRow, CardSource, CardStatus, D1Database, EventOutcome, EventRoute, EventRow, MetricKind, SettingKey,
} from '../types.js';
import { ulid } from '../util/crypto.js';
import { nowIso } from '../util/time.js';

type RawCard = Omit<CardRow, 'is_test'> & { is_test: number };
type RawEvent = Omit<EventRow, 'errors'> & { errors: string | null };

function rowToCard(r: RawCard): CardRow {
  return { ...r, is_test: r.is_test === 1 };
}
function rowToEvent(r: RawEvent): EventRow {
  let errors: string[] | null = null;
  if (r.errors) {
    try {
      const parsed = JSON.parse(r.errors);
      errors = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      errors = [r.errors];
    }
  }
  return { ...r, errors };
}

const CARD_COLS =
  'id, token, licence_number, is_test, company_name_en, company_name_ar, licence_type, activity_category, activity_category_ar, founder_name_en, founder_name_ar, issued_on, ' +
  'preferred_language, content_hash, status, render_error, source, template_version, created_at, updated_at, rendered_at, expires_at, licence_expires_on';

// ------------------------------------------------------------------ cards

export async function findCardByLicence(db: D1Database, licence_number: string, is_test: boolean): Promise<CardRow | null> {
  const r = await db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE licence_number = ?1 AND is_test = ?2`)
    .bind(licence_number, is_test ? 1 : 0)
    .first<RawCard>();
  return r ? rowToCard(r) : null;
}

export async function getCardByToken(db: D1Database, token: string): Promise<CardRow | null> {
  const r = await db.prepare(`SELECT ${CARD_COLS} FROM cards WHERE token = ?1`).bind(token).first<RawCard>();
  return r ? rowToCard(r) : null;
}

export async function getCardById(db: D1Database, id: string): Promise<CardRow | null> {
  const r = await db.prepare(`SELECT ${CARD_COLS} FROM cards WHERE id = ?1`).bind(id).first<RawCard>();
  return r ? rowToCard(r) : null;
}

export interface NewCard {
  token: string;
  is_test: boolean;
  fields: CanonicalFields;
  content_hash: string;
  source: CardSource;
  expires_at: string | null;
}

export async function insertCard(db: D1Database, c: NewCard): Promise<CardRow> {
  const id = ulid();
  const ts = nowIso();
  const f = c.fields;
  await db
    .prepare(
      `INSERT INTO cards (id, token, licence_number, is_test, company_name_en, company_name_ar, licence_type, activity_category,
         issued_on, preferred_language, content_hash, status, render_error, source, template_version, created_at, updated_at, rendered_at, expires_at,
         activity_category_ar, founder_name_en, founder_name_ar, licence_expires_on)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'ready', NULL, ?12, NULL, ?13, ?13, NULL, ?14, ?15, ?16, ?17, ?18)`,
    )
    .bind(
      id, c.token, f.licence_number, c.is_test ? 1 : 0, f.company_name_en, f.company_name_ar, f.licence_type,
      f.activity_category, f.issued_on, f.preferred_language, c.content_hash, c.source, ts, c.expires_at,
      f.activity_category_ar, f.founder_name_en, f.founder_name_ar, f.licence_expires_on ?? null,
    )
    .run();
  const row = await getCardById(db, id);
  if (!row) throw new Error('insertCard: row not found after insert');
  return row;
}

/** Replace the canonical fields; the card is ready again (it may have expired). The token and URL never change (C1). */
export async function updateCardFields(
  db: D1Database, id: string, fields: CanonicalFields, content_hash: string, source: CardSource,
): Promise<void> {
  await db
    .prepare(
      `UPDATE cards SET licence_number = ?2, company_name_en = ?3, company_name_ar = ?4, licence_type = ?5, activity_category = ?6,
         issued_on = ?7, preferred_language = ?8, content_hash = ?9, source = ?10, status = 'ready', render_error = NULL, updated_at = ?11,
         activity_category_ar = ?12, founder_name_en = ?13, founder_name_ar = ?14, licence_expires_on = ?15
       WHERE id = ?1`,
    )
    .bind(
      id, fields.licence_number, fields.company_name_en, fields.company_name_ar, fields.licence_type, fields.activity_category,
      fields.issued_on, fields.preferred_language, content_hash, source, nowIso(), fields.activity_category_ar,
      fields.founder_name_en, fields.founder_name_ar, fields.licence_expires_on ?? null,
    )
    .run();
}

export interface StatusUpdate {
  render_error?: string | null;
  rendered_at?: string | null;
  template_version?: string;
}

export async function setCardStatus(db: D1Database, id: string, status: CardStatus, u: StatusUpdate = {}): Promise<void> {
  const sets = ['status = ?2', 'updated_at = ?3'];
  const binds: unknown[] = [id, status, nowIso()];
  if (u.render_error !== undefined) {
    binds.push(u.render_error);
    sets.push(`render_error = ?${binds.length}`);
  }
  if (u.rendered_at !== undefined) {
    binds.push(u.rendered_at);
    sets.push(`rendered_at = ?${binds.length}`);
  }
  if (u.template_version !== undefined) {
    binds.push(u.template_version);
    sets.push(`template_version = ?${binds.length}`);
  }
  await db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?1`).bind(...binds).run();
}

/** Expiry: the page then says the card is no longer available, and the founder's name is no longer kept. */
/** Marks the card expired. Nothing is cleared: the page says the licence has expired, the data stays. */
export async function expireCard(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE cards SET status = 'expired', updated_at = ?2 WHERE id = ?1")
    .bind(id, nowIso())
    .run();
}

export async function setCardExpiry(db: D1Database, id: string, expires_at: string | null): Promise<void> {
  await db.prepare('UPDATE cards SET expires_at = ?2, updated_at = ?3 WHERE id = ?1').bind(id, expires_at, nowIso()).run();
}

/** Staff set the licence's expiry date; expires_at and the status follow it. */
export async function setLicenceExpiry(
  db: D1Database, id: string, licence_expires_on: string | null, expires_at: string | null, status: CardStatus,
): Promise<void> {
  await db.prepare('UPDATE cards SET licence_expires_on = ?2, expires_at = ?3, status = ?4, updated_at = ?5 WHERE id = ?1')
    .bind(id, licence_expires_on, expires_at, status, nowIso()).run();
}

export async function deleteCard(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM metrics WHERE card_id = ?1').bind(id),
    db.prepare('DELETE FROM cards WHERE id = ?1').bind(id),
  ]);
}

export interface CardFilter {
  q?: string;
  status?: CardStatus;
  is_test?: boolean;
  source?: CardSource;
  template_version?: string;
  created_before?: string;
  created_after?: string;
  limit?: number;
  offset?: number;
}

function cardWhere(f: CardFilter): { where: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    binds.push(v);
    clauses.push(sql.replace('?', `?${binds.length}`));
  };
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    binds.push(like);
    const a = binds.length;
    binds.push(f.q.trim().toUpperCase());
    const b = binds.length;
    clauses.push(`(company_name_en LIKE ?${a} OR company_name_ar LIKE ?${a} OR licence_number = ?${b} OR licence_number LIKE ?${a} OR token = ?${a})`);
  }
  if (f.status) add('status = ?', f.status);
  if (f.is_test !== undefined) add('is_test = ?', f.is_test ? 1 : 0);
  if (f.source) add('source = ?', f.source);
  if (f.template_version) add('template_version = ?', f.template_version);
  if (f.created_before) add('created_at < ?', f.created_before);
  if (f.created_after) add('created_at >= ?', f.created_after);
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', binds };
}

export async function listCards(db: D1Database, f: CardFilter = {}): Promise<{ rows: CardRow[]; total: number }> {
  const { where, binds } = cardWhere(f);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const [list, count] = await db.batch<RawCard | { n: number }>([
    db.prepare(`SELECT ${CARD_COLS} FROM cards ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`).bind(...binds),
    db.prepare(`SELECT COUNT(*) AS n FROM cards ${where}`).bind(...binds),
  ]);
  const rows = ((list?.results ?? []) as RawCard[]).map(rowToCard);
  const total = Number(((count?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0);
  return { rows, total };
}

export async function countCards(db: D1Database, f: CardFilter = {}): Promise<number> {
  const { where, binds } = cardWhere(f);
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM cards ${where}`).bind(...binds).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** Live cards whose expires_at has passed. */
export async function listExpiredCandidates(db: D1Database, now: string, limit = 200): Promise<CardRow[]> {
  const r = await db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE status != 'expired' AND expires_at IS NOT NULL AND expires_at <= ?1 ORDER BY expires_at LIMIT ${limit}`)
    .bind(now)
    .all<RawCard>();
  return (r.results ?? []).map(rowToCard);
}

/** Test cards created before the cut-off. */
export async function listTestCardsOlderThan(db: D1Database, before: string, limit = 200): Promise<CardRow[]> {
  const r = await db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE is_test = 1 AND created_at < ?1 ORDER BY created_at LIMIT ${limit}`)
    .bind(before)
    .all<RawCard>();
  return (r.results ?? []).map(rowToCard);
}

export async function countByStatus(db: D1Database): Promise<Record<CardStatus, number>> {
  const r = await db.prepare('SELECT status, COUNT(*) AS n FROM cards WHERE is_test = 0 GROUP BY status').all<{ status: CardStatus; n: number }>();
  const out: Record<CardStatus, number> = { pending: 0, ready: 0, failed: 0, expired: 0 };
  for (const row of r.results ?? []) out[row.status] = Number(row.n);
  return out;
}

// ------------------------------------------------------------------ events

export interface NewEvent {
  route: EventRoute;
  source_ip: string;
  http_status: number;
  outcome: EventOutcome;
  errors?: string[] | null;
  card_id?: string | null;
  raw_body?: string | null;
  raw_body_expires_at?: string | null;
  actor?: string | null;
}

export async function insertEvent(db: D1Database, e: NewEvent): Promise<string> {
  const id = ulid();
  await db
    .prepare(
      `INSERT INTO events (id, received_at, route, source_ip, http_status, outcome, errors, card_id, raw_body, raw_body_expires_at, actor)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      id, nowIso(), e.route, e.source_ip, e.http_status, e.outcome, e.errors && e.errors.length ? JSON.stringify(e.errors) : null,
      e.card_id ?? null, e.raw_body ?? null, e.raw_body_expires_at ?? null, e.actor ?? null,
    )
    .run();
  return id;
}

export interface EventFilter {
  route?: EventRoute;
  outcome?: EventOutcome;
  card_id?: string;
  limit?: number;
  offset?: number;
}

export async function listEvents(db: D1Database, f: EventFilter = {}): Promise<{ rows: EventRow[]; total: number }> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    binds.push(v);
    clauses.push(sql.replace('?', `?${binds.length}`));
  };
  if (f.route) add('route = ?', f.route);
  if (f.outcome) add('outcome = ?', f.outcome);
  if (f.card_id) add('card_id = ?', f.card_id);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const [list, count] = await db.batch<RawEvent | { n: number }>([
    db.prepare(`SELECT * FROM events ${where} ORDER BY received_at DESC LIMIT ${limit} OFFSET ${offset}`).bind(...binds),
    db.prepare(`SELECT COUNT(*) AS n FROM events ${where}`).bind(...binds),
  ]);
  const rows = ((list?.results ?? []) as RawEvent[]).map(rowToEvent);
  const total = Number(((count?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0);
  return { rows, total };
}

export async function getEvent(db: D1Database, id: string): Promise<EventRow | null> {
  const r = await db.prepare('SELECT * FROM events WHERE id = ?1').bind(id).first<RawEvent>();
  return r ? rowToEvent(r) : null;
}

export async function purgeRawBodies(db: D1Database, now: string): Promise<number> {
  const r = await db
    .prepare('UPDATE events SET raw_body = NULL, raw_body_expires_at = NULL WHERE raw_body IS NOT NULL AND raw_body_expires_at IS NOT NULL AND raw_body_expires_at <= ?1')
    .bind(now)
    .run();
  return r.meta.changes ?? 0;
}

// ------------------------------------------------------------------ metrics

export interface MetricKey {
  card_id: string;
  kind: MetricKind;
  lang?: string | null;
  size?: string | null;
  network?: string | null;
}

export async function bumpMetric(db: D1Database, m: MetricKey, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO metrics (day, card_id, kind, lang, size, network, count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
       ON CONFLICT (day, card_id, kind, lang, size, network) DO UPDATE SET count = count + 1`,
    )
    .bind(day, m.card_id, m.kind, m.lang ?? '', m.size ?? '', m.network ?? '')
    .run();
}

export interface MetricTotal {
  kind: MetricKind;
  lang: string;
  size: string;
  network: string;
  count: number;
}

export async function metricsForCard(db: D1Database, card_id: string): Promise<MetricTotal[]> {
  const r = await db
    .prepare('SELECT kind, lang, size, network, SUM(count) AS count FROM metrics WHERE card_id = ?1 GROUP BY kind, lang, size, network')
    .bind(card_id)
    .all<MetricTotal>();
  return (r.results ?? []).map((x) => ({ ...x, count: Number(x.count) }));
}

export async function metricsTotals(db: D1Database, sinceDay: string): Promise<Record<MetricKind, number>> {
  const r = await db
    .prepare('SELECT kind, SUM(count) AS count FROM metrics WHERE day >= ?1 GROUP BY kind')
    .bind(sinceDay)
    .all<{ kind: MetricKind; count: number }>();
  const out: Record<MetricKind, number> = { view: 0, download: 0, share: 0, caption: 0 };
  for (const row of r.results ?? []) out[row.kind] = Number(row.count);
  return out;
}

/** Fold daily rows older than `beforeDay` (YYYY-MM-DD) into monthly rows keyed YYYY-MM. */
export async function compactOldMetrics(db: D1Database, beforeDay: string): Promise<number> {
  const [, del] = await db.batch([
    db
      .prepare(
        `INSERT INTO metrics (day, card_id, kind, lang, size, network, count)
         SELECT substr(day, 1, 7), card_id, kind, lang, size, network, SUM(count)
         FROM metrics WHERE length(day) = 10 AND day < ?1
         GROUP BY substr(day, 1, 7), card_id, kind, lang, size, network
         ON CONFLICT (day, card_id, kind, lang, size, network) DO UPDATE SET count = count + excluded.count`,
      )
      .bind(beforeDay),
    db.prepare('DELETE FROM metrics WHERE length(day) = 10 AND day < ?1').bind(beforeDay),
  ]);
  return del?.meta.changes ?? 0;
}

// ------------------------------------------------------------------ settings

export async function getSetting(db: D1Database, key: SettingKey, fallback = ''): Promise<string> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
  return r?.value ?? fallback;
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const r = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of r.results ?? []) out[row.key] = row.value;
  return out;
}

export async function setSetting(db: D1Database, key: SettingKey, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export async function getIntSetting(db: D1Database, key: SettingKey, fallback: number): Promise<number> {
  const v = Number(await getSetting(db, key, String(fallback)));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Operational values outside SETTING_KEYS (the scheduler's last run). Not shown in the admin. */
export async function getSettingRaw(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSettingRaw(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}
