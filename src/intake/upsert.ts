// Idempotent create-or-update of a card from validated fields (ARCHITECTURE C1, section 4 "Idempotency and updates").
import type { CanonicalFields, CardRow, CardSource, Env, UpsertOutcome } from '../types.js';
import {
  expireCard, findCardByLicence, getCardById, insertCard, setCardExpiry, updateCardFields,
} from '../db/cards.js';
import { contentHash, randomToken } from '../util/crypto.js';
import { endOfDubaiDay, isPast } from '../util/time.js';
import { pageUrl } from '../storage.js';

export interface UpsertOptions {
  is_test: boolean;
  source: CardSource;
}

export interface UpsertResult {
  card: CardRow;
  outcome: UpsertOutcome;
  page_url: string;
}

/**
 * Content hash over the canonical keys, so a CardRow and a CanonicalFields hash alike. The licence expiry date
 * and the emails join the hash only when present, so cards stored before they existed keep their hash.
 */
export async function hashFields(fields: CanonicalFields): Promise<string> {
  const {
    licence_number, company_name_en, company_name_ar, licence_type, activity_category, activity_category_ar,
    founder_name_en, founder_name_ar, issued_on, preferred_language, licence_expires_on, customer_email, cc_email,
  } = fields;
  return contentHash({
    licence_number, company_name_en, company_name_ar, licence_type, activity_category, activity_category_ar,
    founder_name_en, founder_name_ar, issued_on, preferred_language,
    ...(licence_expires_on ? { licence_expires_on } : {}),
    ...(customer_email ? { customer_email } : {}),
    ...(cc_email ? { cc_email } : {}),
  });
}

/** A card expires when its licence does (the end of the expiry day in Dubai); no expiry date, no expiry. */
export function cardExpiry(fields: Pick<CanonicalFields, 'licence_expires_on'>): string | null {
  return fields.licence_expires_on ? endOfDubaiDay(fields.licence_expires_on) : null;
}

/**
 * Look up by (licence_number, is_test). New -> insert, mint token, 'created'.
 * Known with the same hash -> 'unchanged', nothing written.
 * Known with a different hash -> fields replaced, 'updated'. Same token, same URL.
 * Cards are ready at once: the studio builds the image in the customer's browser.
 */
export async function upsertFromCanonical(env: Env, fields: CanonicalFields, opts: UpsertOptions): Promise<UpsertResult> {
  const db = env.DB;
  const hash = await hashFields(fields);

  const existing = await findCardByLicence(db, fields.licence_number, opts.is_test);
  if (existing) return reconcile(env, existing, fields, hash, opts);

  const expires_at = cardExpiry(fields);
  let created: CardRow | null = null;
  let insertError: unknown = null;
  try {
    created = await insertCard(db, {
      token: randomToken(),
      is_test: opts.is_test,
      fields,
      content_hash: hash,
      source: opts.source,
      expires_at,
    });
  } catch (err) {
    insertError = err;
  }
  if (!created) {
    // Two events for a new licence in the same instant: the UNIQUE (licence_number, is_test) index let one in.
    const raced = await findCardByLicence(db, fields.licence_number, opts.is_test);
    if (!raced) throw insertError;
    return reconcile(env, raced, fields, hash, opts);
  }

  if (isPast(expires_at)) {
    await expireCard(db, created.id);
    created = (await getCardById(db, created.id)) ?? created;
  }
  console.log('card created', { licence_number: created.licence_number, card_id: created.id, is_test: opts.is_test });
  return { card: created, outcome: 'created', page_url: pageUrl(env, created.token) };
}

async function reconcile(
  env: Env, existing: CardRow, fields: CanonicalFields, hash: string, opts: UpsertOptions,
): Promise<UpsertResult> {
  if (existing.content_hash === hash) {
    return { card: existing, outcome: 'unchanged', page_url: pageUrl(env, existing.token) };
  }

  // updateCardFields makes the card ready again; a renewal (a later expiry date) brings an expired card back.
  await updateCardFields(env.DB, existing.id, fields, hash, opts.source);
  const expires_at = cardExpiry(fields);
  await setCardExpiry(env.DB, existing.id, expires_at);
  if (isPast(expires_at)) await expireCard(env.DB, existing.id);

  const card = await getCardById(env.DB, existing.id);
  if (!card) throw new Error('upsertFromCanonical: card row missing after update');

  console.log('card updated', { licence_number: card.licence_number, card_id: card.id, is_test: opts.is_test });
  return { card, outcome: 'updated', page_url: pageUrl(env, card.token) };
}
