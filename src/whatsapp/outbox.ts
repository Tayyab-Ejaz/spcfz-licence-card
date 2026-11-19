// Queueing and sending the welcome WhatsApp message, beside the welcome email (src/mail/outbox.ts) and in the same
// worker (src/server.ts): every 30 seconds and straight after something is queued. One message per card, when it is
// created with a mobile number or a number first arrives; staff can send it again. Failures are retried after 1, 5,
// 30, 120 and 720 minutes. Messages the ERP triggers outside 09:00-21:00 Dubai time wait for the morning. Test cards
// only message the numbers in Admin → Settings. After Gallabox accepts a message, its delivery (delivered, read,
// failed) is read back a few times over three days.
import type { CardRow, Env } from '../types.js';
import { getCardById, getSetting } from '../db/cards.js';
import {
  FINAL_DELIVERY, dueDeliveryChecks, dueWhatsapp, hasActiveWhatsapp, insertWhatsapp, markDelivery, markWhatsappRetry,
  markWhatsappSent, markWhatsappSkipped, whatsappSuppression,
} from '../db/whatsapp.js';
import { RETRY_MINUTES, nudgeOutbox } from '../mail/outbox.js';
import { isPast, nowIso } from '../util/time.js';
import { recipientName, welcomeWhatsapp } from './message.js';
import { parsePhoneList } from './phone.js';
import type { WhatsappTransport } from './transport.js';

export type WhatsappQueueResult = 'queued' | 'no-phone' | 'already-sent' | 'expired' | 'skipped-test' | 'stopped';

/** Dubai is UTC+4 all year. WhatsApp messages the ERP triggers go out between these hours, Dubai time. */
export const SEND_HOURS = { from: 9, to: 21 } as const;
const DUBAI_OFFSET_MS = 4 * 3600_000;

/** Now, when it is daytime in Dubai; otherwise the next 09:00 Dubai time. */
export function nextDaytime(now: Date): Date {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= SEND_HOURS.from && hour < SEND_HOURS.to) return now;
  const morning = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), SEND_HOURS.from) - DUBAI_OFFSET_MS);
  return hour >= SEND_HOURS.to ? new Date(morning.getTime() + 86_400_000) : morning;
}

/** The numbers test cards may message (Admin → Settings, whatsapp_test_to). Empty: test cards message nobody. */
export async function testPhones(env: Env): Promise<string[]> {
  return parsePhoneList(await getSetting(env.DB, 'whatsapp_test_to')).phones;
}

/**
 * Queue the welcome WhatsApp message for a card, unless it has no number, already had one (without `force`), has
 * expired, or the number was stopped. `actor` null means the ERP: then the message waits for Dubai daytime. Staff
 * actions send at once.
 */
export async function queueWelcomeWhatsapp(env: Env, card: CardRow, o: { actor: string | null; force?: boolean; now?: Date }): Promise<WhatsappQueueResult> {
  const nowDate = o.now ?? new Date();
  const now = nowIso(nowDate);
  if (!card.customer_phone) return 'no-phone';
  if (card.status === 'expired' || isPast(card.expires_at, nowDate.getTime())) return 'expired';
  if (!o.force && (await hasActiveWhatsapp(env.DB, card.id, 'welcome'))) return 'already-sent';
  const base = { card_id: card.id, kind: 'welcome' as const, to_phone: card.customer_phone, lang: card.preferred_language, actor: o.actor, now };
  if (await whatsappSuppression(env.DB, card.customer_phone)) {
    await insertWhatsapp(env.DB, { ...base, status: 'skipped', last_error: 'stopped: staff stopped WhatsApp messages to this number' });
    return 'stopped';
  }
  if (card.is_test && !(await testPhones(env)).includes(card.customer_phone)) {
    await insertWhatsapp(env.DB, { ...base, status: 'skipped', last_error: 'test card: the number is not in Settings → WhatsApp test numbers' });
    return 'skipped-test';
  }
  const sendAt = o.actor === null ? nowIso(nextDaytime(nowDate)) : now;
  await insertWhatsapp(env.DB, { ...base, status: 'queued', sendAt });
  nudgeOutbox();
  return 'queued';
}

/** When to read a sent message's delivery back, in minutes after it was sent. Then it is left as it is. */
export const CHECK_MINUTES = [2, 15, 60, 360, 1440, 4320];

function nextCheck(sentAt: string, checksDone: number, now: Date): string | null {
  const wait = CHECK_MINUTES[checksDone];
  if (wait === undefined) return null;
  const at = Math.max(Date.parse(sentAt) + wait * 60_000, now.getTime() + 60_000);
  return new Date(at).toISOString();
}

export interface WhatsappSummary { sent: number; retried: number; failed: number; skipped: number; checked: number }

/** Send what is due, then read back deliveries that are due. Never throws: each outcome is written to its row. */
export async function processWhatsapp(env: Env, transport: WhatsappTransport | null, now: Date = new Date()): Promise<WhatsappSummary> {
  const summary: WhatsappSummary = { sent: 0, retried: 0, failed: 0, skipped: 0, checked: 0 };
  if (!transport) return summary;
  const nowStr = nowIso(now);
  const templates = { en: env.WHATSAPP_TEMPLATE_EN, ar: env.WHATSAPP_TEMPLATE_AR };
  const header = env.WHATSAPP_HEADER === 'none' ? 'none' : 'image';
  for (const m of await dueWhatsapp(env.DB, nowStr, 10)) {
    const card = await getCardById(env.DB, m.card_id);
    if (!card) { await markWhatsappSkipped(env.DB, m.id, 'card no longer exists'); summary.skipped++; continue; }
    if (card.status === 'expired' || isPast(card.expires_at, now.getTime())) { await markWhatsappSkipped(env.DB, m.id, 'card expired before sending'); summary.skipped++; continue; }
    if (await whatsappSuppression(env.DB, m.to_phone)) { await markWhatsappSkipped(env.DB, m.id, 'stopped: staff stopped WhatsApp messages to this number'); summary.skipped++; continue; }
    const message = welcomeWhatsapp(card, { baseUrl: env.BASE_URL, lang: m.lang === 'ar' ? 'ar' : 'en', templates, header });
    try {
      const sent = await transport.send({ to: m.to_phone, name: recipientName(card), message });
      const checkAt = transport.mode === 'gallabox' && env.GALLABOX_ACCOUNT_ID ? nextCheck(nowStr, 0, now) : null;
      await markWhatsappSent(env.DB, m.id, { template: message.template, providerId: sent.id, now: nowStr, checkAt });
      console.log('whatsapp sent', { card_id: m.card_id, mode: transport.mode, template: message.template });
      summary.sent++;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const wait = RETRY_MINUTES[m.attempts];
      const next = wait === undefined ? null : new Date(now.getTime() + wait * 60_000).toISOString();
      await markWhatsappRetry(env.DB, m.id, text, next, message.template);
      console.warn('whatsapp failed', { card_id: m.card_id, attempt: m.attempts + 1, giving_up: next === null, message: text });
      if (next === null) summary.failed++;
      else summary.retried++;
    }
  }
  for (const m of await dueDeliveryChecks(env.DB, nowStr, 20)) {
    if (!m.provider_id || !m.sent_at) { await markDelivery(env.DB, m.id, { delivery: null, at: null, error: null, checkAt: null }); continue; }
    try {
      const report = await transport.delivery(m.provider_id);
      const final = report !== null && FINAL_DELIVERY.has(report.status);
      await markDelivery(env.DB, m.id, {
        delivery: report?.status ?? null,
        at: report?.at ?? (report ? nowStr : null),
        error: report?.error ?? null,
        checkAt: final || (report === null && transport.mode !== 'gallabox') ? null : nextCheck(m.sent_at, m.checks + 1, now),
      });
      summary.checked++;
    } catch (err) {
      // Gallabox busy or down: ask again at the next step; the delivery is not urgent.
      await markDelivery(env.DB, m.id, { delivery: null, at: null, error: null, checkAt: nextCheck(m.sent_at, m.checks + 1, now) });
      console.warn('whatsapp delivery check failed', { card_id: m.card_id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
