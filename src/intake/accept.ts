// What happens to a payload once it is through the network checks: map, validate, create or update the card,
// queue the welcome email and the welcome WhatsApp message. Shared by the webhook (./routes.ts) and the admin's Test flow, so a test there runs
// exactly what the ERP's request will.
import type { CardRow, CardSource, Env, UpsertOutcome } from '../types.js';
import { queueWelcome } from '../mail/outbox.js';
import type { QueueResult } from '../mail/outbox.js';
import { queueWelcomeWhatsapp } from '../whatsapp/outbox.js';
import type { WhatsappQueueResult } from '../whatsapp/outbox.js';
import { mapPayload } from './mapper.js';
import { upsertFromCanonical } from './upsert.js';
import { validateCanonical } from './validate.js';

export type Accepted =
  | { ok: false; errors: string[] }
  | {
    ok: true; outcome: UpsertOutcome; card: CardRow; page_url: string; email: QueueResult | 'not-sent' | 'error';
    whatsapp: WhatsappQueueResult | 'not-sent' | 'error';
    /** Received but not used, e.g. a phone number we cannot WhatsApp (src/intake/validate.ts). */
    notes: string[];
  };

export async function acceptPayload(
  env: Env,
  payload: Record<string, unknown>,
  o: { is_test: boolean; source: CardSource; actor: string | null; sendEmail?: boolean; sendWhatsapp?: boolean },
): Promise<Accepted> {
  const validated = validateCanonical(mapPayload(payload, env.FIELD_MAP));
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const result = await upsertFromCanonical(env, validated.fields, { is_test: o.is_test, source: o.source });
  // The welcome email, once per card (src/mail/outbox.ts). A mail problem never fails the request.
  let email: QueueResult | 'not-sent' | 'error' = 'not-sent';
  if (result.outcome !== 'unchanged' && o.sendEmail !== false) {
    try {
      email = await queueWelcome(env, result.card, { actor: o.actor });
    } catch (err) {
      email = 'error';
      console.error('welcome email not queued', { card_id: result.card.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  // The welcome WhatsApp message, once per card (src/whatsapp/outbox.ts). It never fails the request either.
  let whatsapp: WhatsappQueueResult | 'not-sent' | 'error' = 'not-sent';
  if (result.outcome !== 'unchanged' && o.sendWhatsapp !== false) {
    try {
      whatsapp = await queueWelcomeWhatsapp(env, result.card, { actor: o.actor });
    } catch (err) {
      whatsapp = 'error';
      console.error('welcome whatsapp not queued', { card_id: result.card.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, outcome: result.outcome, card: result.card, page_url: result.page_url, email, whatsapp, notes: validated.notes };
}
