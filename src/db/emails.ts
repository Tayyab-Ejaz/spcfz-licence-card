// The email log (migrations/0007_email_linkedin.sql): every email the service sends or means to send.
import type { D1Database } from '../types.js';
import { ulid } from '../util/crypto.js';

export type EmailStatus = 'queued' | 'sent' | 'failed' | 'skipped';
export type EmailKind = 'welcome';

export interface EmailRow {
  id: string;
  card_id: string;
  kind: EmailKind;
  to_email: string;
  cc_email: string | null;
  lang: string;
  subject: string | null;
  status: EmailStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  provider_id: string | null;
  actor: string | null;
  created_at: string;
  sent_at: string | null;
}

export async function insertEmail(
  db: D1Database,
  e: { card_id: string; kind: EmailKind; to_email: string; cc_email: string | null; lang: string; status: EmailStatus; last_error?: string | null; actor: string | null; now: string },
): Promise<string> {
  const id = ulid();
  await db.prepare(
    `INSERT INTO emails (id, card_id, kind, to_email, cc_email, lang, status, attempts, next_attempt_at, last_error, actor, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?8)`,
  ).bind(id, e.card_id, e.kind, e.to_email, e.cc_email, e.lang, e.status, e.now, e.last_error ?? null, e.actor).run();
  return id;
}

export async function emailsForCard(db: D1Database, cardId: string): Promise<EmailRow[]> {
  return (await db.prepare('SELECT * FROM emails WHERE card_id = ?1 ORDER BY created_at DESC').bind(cardId).all<EmailRow>()).results ?? [];
}

/** Has this card already had (or is about to have) an email of this kind? */
export async function hasActiveEmail(db: D1Database, cardId: string, kind: EmailKind): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM emails WHERE card_id = ?1 AND kind = ?2 AND status IN ('queued', 'sent') LIMIT 1").bind(cardId, kind).first<{ x: number }>();
  return Boolean(r);
}

export async function dueEmails(db: D1Database, now: string, limit = 10): Promise<EmailRow[]> {
  return (await db.prepare("SELECT * FROM emails WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?1) ORDER BY created_at LIMIT ?2")
    .bind(now, limit).all<EmailRow>()).results ?? [];
}

export async function markEmailSent(db: D1Database, id: string, subject: string, providerId: string, now: string): Promise<void> {
  await db.prepare("UPDATE emails SET status = 'sent', subject = ?2, provider_id = ?3, sent_at = ?4, attempts = attempts + 1, last_error = NULL WHERE id = ?1")
    .bind(id, subject, providerId, now).run();
}

export async function markEmailRetry(db: D1Database, id: string, error: string, nextAt: string | null, subject: string | null): Promise<void> {
  await db.prepare(
    "UPDATE emails SET attempts = attempts + 1, last_error = ?2, next_attempt_at = ?3, status = CASE WHEN ?3 IS NULL THEN 'failed' ELSE 'queued' END, subject = COALESCE(?4, subject) WHERE id = ?1",
  ).bind(id, error.slice(0, 500), nextAt, subject).run();
}

export async function markEmailSkipped(db: D1Database, id: string, reason: string): Promise<void> {
  await db.prepare("UPDATE emails SET status = 'skipped', last_error = ?2, next_attempt_at = NULL WHERE id = ?1").bind(id, reason).run();
}

export async function emailCounts(db: D1Database): Promise<Record<EmailStatus, number>> {
  const out: Record<EmailStatus, number> = { queued: 0, sent: 0, failed: 0, skipped: 0 };
  const rows = (await db.prepare('SELECT status, COUNT(*) AS n FROM emails GROUP BY status').all<{ status: EmailStatus; n: number }>()).results ?? [];
  for (const r of rows) out[r.status] = r.n;
  return out;
}

// ------------------------------------------------------------------ unsubscribed addresses (migration 0008)

export interface SuppressionRow {
  email: string;
  card_id: string | null;
  /** page: the unsubscribe page's button; one-click: the mail app's own Unsubscribe (RFC 8058). */
  source: 'page' | 'one-click';
  created_at: string;
}

export async function suppression(db: D1Database, email: string): Promise<SuppressionRow | null> {
  return (await db.prepare('SELECT * FROM email_suppressions WHERE email = ?1').bind(email.toLowerCase()).first<SuppressionRow>()) ?? null;
}

/** First request wins; asking twice changes nothing. */
export async function suppress(db: D1Database, s: SuppressionRow): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO email_suppressions (email, card_id, source, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(s.email.toLowerCase(), s.card_id, s.source, s.created_at).run();
}
