// The WhatsApp log (migrations/0011_whatsapp.sql): every WhatsApp message the service sends or means to send, and the
// numbers staff stopped. Shaped like the email log (./emails.ts).
import type { D1Database } from '../types.js';
import { ulid } from '../util/crypto.js';

export type WhatsappStatus = 'queued' | 'sent' | 'failed' | 'skipped';
/** welcome: to the customer, beside the welcome email. */
export type WhatsappKind = 'welcome';

/** What WhatsApp reported after Gallabox accepted the message. read, failed and the like are final. */
export type WhatsappDelivery = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'error' | 'unknown' | 'received';
export const FINAL_DELIVERY: ReadonlySet<string> = new Set(['read', 'failed', 'deleted', 'error']);

export interface WhatsappRow {
  id: string;
  card_id: string;
  kind: WhatsappKind;
  to_phone: string;
  lang: string;
  template: string | null;
  status: WhatsappStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  provider_id: string | null;
  actor: string | null;
  created_at: string;
  sent_at: string | null;
  delivery: WhatsappDelivery | null;
  delivery_at: string | null;
  check_at: string | null;
  checks: number;
}

export async function insertWhatsapp(
  db: D1Database,
  m: {
    card_id: string; kind: WhatsappKind; to_phone: string; lang: string; status: WhatsappStatus; last_error?: string | null;
    actor: string | null; now: string;
    /** Send no earlier than this (ISO); default now. */
    sendAt?: string;
  },
): Promise<string> {
  const id = ulid();
  await db.prepare(
    `INSERT INTO whatsapp_messages (id, card_id, kind, to_phone, lang, status, attempts, next_attempt_at, last_error, actor, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10)`,
  ).bind(id, m.card_id, m.kind, m.to_phone, m.lang, m.status, m.status === 'queued' ? (m.sendAt ?? m.now) : null, m.last_error ?? null, m.actor, m.now).run();
  return id;
}

export async function whatsappForCard(db: D1Database, cardId: string): Promise<WhatsappRow[]> {
  return (await db.prepare('SELECT * FROM whatsapp_messages WHERE card_id = ?1 ORDER BY created_at DESC, id DESC').bind(cardId).all<WhatsappRow>()).results ?? [];
}

/** Has this card already had (or is about to have) a WhatsApp message of this kind? */
export async function hasActiveWhatsapp(db: D1Database, cardId: string, kind: WhatsappKind): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM whatsapp_messages WHERE card_id = ?1 AND kind = ?2 AND status IN ('queued', 'sent') LIMIT 1").bind(cardId, kind).first<{ x: number }>();
  return Boolean(r);
}

export async function dueWhatsapp(db: D1Database, now: string, limit = 10): Promise<WhatsappRow[]> {
  return (await db.prepare("SELECT * FROM whatsapp_messages WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?1) ORDER BY created_at LIMIT ?2")
    .bind(now, limit).all<WhatsappRow>()).results ?? [];
}

export async function markWhatsappSent(db: D1Database, id: string, o: { template: string; providerId: string; now: string; checkAt: string | null }): Promise<void> {
  await db.prepare(
    "UPDATE whatsapp_messages SET status = 'sent', template = ?2, provider_id = ?3, sent_at = ?4, attempts = attempts + 1, last_error = NULL, next_attempt_at = NULL, check_at = ?5 WHERE id = ?1",
  ).bind(id, o.template, o.providerId, o.now, o.checkAt).run();
}

export async function markWhatsappRetry(db: D1Database, id: string, error: string, nextAt: string | null, template: string | null): Promise<void> {
  await db.prepare(
    "UPDATE whatsapp_messages SET attempts = attempts + 1, last_error = ?2, next_attempt_at = ?3, status = CASE WHEN ?3 IS NULL THEN 'failed' ELSE 'queued' END, template = COALESCE(?4, template) WHERE id = ?1",
  ).bind(id, error.slice(0, 500), nextAt, template).run();
}

export async function markWhatsappSkipped(db: D1Database, id: string, reason: string): Promise<void> {
  await db.prepare("UPDATE whatsapp_messages SET status = 'skipped', last_error = ?2, next_attempt_at = NULL WHERE id = ?1").bind(id, reason).run();
}

/** Sent messages whose delivery should be read back from Gallabox now. */
export async function dueDeliveryChecks(db: D1Database, now: string, limit = 20): Promise<WhatsappRow[]> {
  return (await db.prepare("SELECT * FROM whatsapp_messages WHERE status = 'sent' AND check_at IS NOT NULL AND check_at <= ?1 ORDER BY check_at LIMIT ?2")
    .bind(now, limit).all<WhatsappRow>()).results ?? [];
}

/** Record what Gallabox said (or only that we asked: delivery null keeps the last answer) and when to ask again. */
export async function markDelivery(
  db: D1Database, id: string, o: { delivery: string | null; at: string | null; error: string | null; checkAt: string | null },
): Promise<void> {
  await db.prepare(
    `UPDATE whatsapp_messages SET delivery = COALESCE(?2, delivery), delivery_at = COALESCE(?3, delivery_at),
       last_error = COALESCE(?4, last_error), check_at = ?5, checks = checks + 1 WHERE id = ?1`,
  ).bind(id, o.delivery, o.at, o.error ? o.error.slice(0, 500) : null, o.checkAt).run();
}

export async function whatsappCounts(db: D1Database): Promise<Record<WhatsappStatus, number> & { delivered: number; read: number; undelivered: number }> {
  const out = { queued: 0, sent: 0, failed: 0, skipped: 0, delivered: 0, read: 0, undelivered: 0 };
  const rows = (await db.prepare('SELECT status, delivery, COUNT(*) AS n FROM whatsapp_messages GROUP BY status, delivery').all<{ status: WhatsappStatus; delivery: string | null; n: number }>()).results ?? [];
  for (const r of rows) {
    out[r.status] += r.n;
    if (r.delivery === 'delivered') out.delivered += r.n;
    if (r.delivery === 'read') { out.read += r.n; out.delivered += r.n; }
    if (r.delivery === 'failed' || r.delivery === 'error') out.undelivered += r.n;
  }
  return out;
}

// ------------------------------------------------------------------ stopped numbers

export interface WhatsappSuppressionRow {
  phone: string;
  card_id: string | null;
  /** staff: stopped from the card page (the customer asked, or the number belongs to someone else). */
  source: 'staff';
  actor: string | null;
  created_at: string;
}

export async function whatsappSuppression(db: D1Database, phone: string): Promise<WhatsappSuppressionRow | null> {
  return (await db.prepare('SELECT * FROM whatsapp_suppressions WHERE phone = ?1').bind(phone).first<WhatsappSuppressionRow>()) ?? null;
}

/** First request wins; asking twice changes nothing. */
export async function suppressWhatsapp(db: D1Database, s: WhatsappSuppressionRow): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO whatsapp_suppressions (phone, card_id, source, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(s.phone, s.card_id, s.source, s.actor, s.created_at).run();
}

/** Staff undo a stop (the customer asked to hear from us again). */
export async function unsuppressWhatsapp(db: D1Database, phone: string): Promise<void> {
  await db.prepare('DELETE FROM whatsapp_suppressions WHERE phone = ?1').bind(phone).run();
}
