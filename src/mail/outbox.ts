// Queueing and sending the welcome email. Cards get one welcome email: when they are created with a customer email,
// or when an email first arrives for an existing card; staff can send it again from the admin. A worker in
// src/server.ts sends what is due every 30 seconds (and straight after something is queued), retrying failures
// after 1, 5, 30, 120 and 720 minutes before giving up. Test cards only email addresses on MAIL_TEST_ALLOWLIST.
// After each Post to LinkedIn, SPC staff get a post alert (src/mail/post-alert.ts) through the same outbox.
import type { CardRow, Env } from '../types.js';
import { getCardById } from '../db/cards.js';
import { getLinkedinPost } from '../db/linkedin.js';
import {
  dueEmails, hasActiveEmail, insertEmail, markEmailRetry, markEmailSent, markEmailSkipped, suppression,
} from '../db/emails.js';
import type { EmailKind } from '../db/emails.js';
import { isPast, nowIso } from '../util/time.js';
import { renderWelcome } from './welcome.js';
import { alertRecipients, renderPostAlert } from './post-alert.js';
import type { MailTransport } from './transport.js';

const RETRY_MINUTES = [1, 5, 30, 120, 720];

/** Is this recipient allowed for a test card? MAIL_TEST_ALLOWLIST: domains or full addresses, comma separated. */
export function testRecipientAllowed(env: Pick<Env, 'MAIL_TEST_ALLOWLIST'>, email: string): boolean {
  const list = (env.MAIL_TEST_ALLOWLIST ?? 'spcfz.ae').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const e = email.toLowerCase();
  return list.some((entry) => (entry.includes('@') ? e === entry : e.endsWith(`@${entry.replace(/^@/, '')}`)));
}

export type QueueResult = 'queued' | 'no-email' | 'already-sent' | 'expired' | 'skipped-test' | 'unsubscribed';

let kick: (() => void) | null = null;
/** src/server.ts registers the worker so a newly queued email goes out within seconds. */
export function onEmailQueued(fn: (() => void) | null): void {
  kick = fn;
}

/** Queue the welcome email for a card, unless it has no email, already had one (without `force`), or has expired. */
export async function queueWelcome(env: Env, card: CardRow, o: { actor: string | null; force?: boolean; now?: string }): Promise<QueueResult> {
  const now = o.now ?? nowIso();
  if (!card.customer_email) return 'no-email';
  if (card.status === 'expired' || isPast(card.expires_at)) return 'expired';
  const kind: EmailKind = 'welcome';
  if (!o.force && (await hasActiveEmail(env.DB, card.id, kind))) return 'already-sent';
  const base = { card_id: card.id, kind, to_email: card.customer_email, cc_email: card.cc_email, lang: card.preferred_language, actor: o.actor, now };
  if (await suppression(env.DB, card.customer_email)) {
    await insertEmail(env.DB, { ...base, status: 'skipped', last_error: 'unsubscribed: the customer asked for no more emails' });
    return 'unsubscribed';
  }
  if (card.is_test && !testRecipientAllowed(env, card.customer_email)) {
    await insertEmail(env.DB, { ...base, status: 'skipped', last_error: 'test card: recipient is not on MAIL_TEST_ALLOWLIST' });
    return 'skipped-test';
  }
  await insertEmail(env.DB, { ...base, status: 'queued' });
  kick?.();
  return 'queued';
}

/** Queue the post alert for a post just made (linkedin_posts id); returns how many addresses it goes to. */
export async function queuePostAlert(env: Env, o: { cardId: string; postId: string; now?: string }): Promise<number> {
  const now = o.now ?? nowIso();
  const to = alertRecipients(env);
  for (const address of to) {
    await insertEmail(env.DB, { card_id: o.cardId, kind: 'post_alert', to_email: address, cc_email: null, lang: 'en', status: 'queued', actor: null, ref: o.postId, now });
  }
  if (to.length) kick?.();
  return to.length;
}

export interface OutboxSummary { sent: number; retried: number; failed: number; skipped: number }

/** Send what is due. Never throws: each email's outcome is written to its row. */
export async function processOutbox(env: Env, transport: MailTransport | null, now: Date = new Date()): Promise<OutboxSummary> {
  const summary: OutboxSummary = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  if (!transport) return summary;
  const nowStr = nowIso(now);
  for (const e of await dueEmails(env.DB, nowStr, 10)) {
    const card = await getCardById(env.DB, e.card_id);
    if (!card) { await markEmailSkipped(env.DB, e.id, 'card no longer exists'); summary.skipped++; continue; }
    // A post alert goes to SPC staff, so the card's expiry and the customer's unsubscribe do not apply to it.
    const alert = e.kind === 'post_alert';
    const post = alert && e.ref ? await getLinkedinPost(env.DB, e.ref) : null;
    if (alert && !post?.post_urn) { await markEmailSkipped(env.DB, e.id, 'the LinkedIn post is not on record'); summary.skipped++; continue; }
    if (!alert && (card.status === 'expired' || isPast(card.expires_at))) { await markEmailSkipped(env.DB, e.id, 'card expired before sending'); summary.skipped++; continue; }
    if (!alert && (await suppression(env.DB, e.to_email))) { await markEmailSkipped(env.DB, e.id, 'unsubscribed before sending'); summary.skipped++; continue; }
    const lang = e.lang === 'ar' ? 'ar' : 'en';
    let subject: string | null = null;
    try {
      const mail: { subject: string; html: string; text: string; unsubscribeUrl?: string } = post
        ? renderPostAlert({ card, post, baseUrl: env.BASE_URL })
        : renderWelcome({ card, lang, baseUrl: env.BASE_URL });
      subject = mail.subject;
      const sent = await transport.send({ to: e.to_email, cc: e.cc_email, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl });
      await markEmailSent(env.DB, e.id, mail.subject, sent.id, nowIso());
      console.log('email sent', { kind: e.kind, card_id: e.card_id, mode: transport.mode });
      summary.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const wait = RETRY_MINUTES[e.attempts];
      const next = wait === undefined ? null : new Date(now.getTime() + wait * 60_000).toISOString();
      await markEmailRetry(env.DB, e.id, message, next, subject);
      console.warn('email failed', { kind: e.kind, card_id: e.card_id, attempt: e.attempts + 1, giving_up: next === null, message });
      if (next === null) summary.failed++;
      else summary.retried++;
    }
  }
  return summary;
}
