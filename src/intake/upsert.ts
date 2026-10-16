// Idempotent create-or-update of a card from validated fields (ARCHITECTURE C1, section 4 "Idempotency and updates").
import type { CanonicalFields, CardRow, CardSource, D1Database, Env, UpsertOutcome } from '../types.js';
import {
  findCardByLicence, getCardById, getIntSetting, insertCard, setCardExpiry, updateCardFields,
} from '../db/cards.js';
import { contentHash, randomToken } from '../util/crypto.js';
import { addDays, nowIso } from '../util/time.js';
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

/** Content hash over exactly the eight canonical keys, so a CardRow and a CanonicalFields hash alike. */
export async function hashFields(fields: CanonicalFields): Promise<string> {
  const {
    licence_number, company_name_en, company_name_ar, licence_type, activity_category, activity_category_ar, issued_on, preferred_language,
  } = fields;
  return contentHash({
    licence_number, company_name_en, company_name_ar, licence_type, activity_category, activity_category_ar, issued_on, preferred_language,
  });
}

/** Live cards expire `retention_days` (setting, default 730) from now; test cards are purged by age instead (C3). */
async function liveExpiry(db: D1Database): Promise<string> {
  const days = await getIntSetting(db, 'retention_days', 730);
  return addDays(nowIso(), days);
}

/**
 * Look up by (licence_number, is_test). New -> insert, mint token, enqueue, 'created'.
 * Known with the same hash -> 'unchanged', nothing written, nothing enqueued.
 * Known with a different hash -> fields replaced, status back to pending, enqueue, 'updated'. Same token, same URL.
 */
export async function upsertFromCanonical(env: Env, fields: CanonicalFields, opts: UpsertOptions): Promise<UpsertResult> {
  const db = env.DB;
  const hash = await hashFields(fields);

  const existing = await findCardByLicence(db, fields.licence_number, opts.is_test);
  if (existing) return reconcile(env, existing, fields, hash, opts);

  const expires_at = opts.is_test ? null : await liveExpiry(db);
  let created: CardRow | null = null;
  let insertError: unknown = null;
  try {
    created = await insertCard(db, {
      token: randomToken(),
      is_test: opts.is_test,
      fields,
      content_hash: hash,
      source: opts.source,
      template_version: env.TEMPLATE_VERSION,
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

  await env.RENDER_QUEUE.send({ card_id: created.id, content_hash: hash });
  console.log('card created', { licence_number: created.licence_number, card_id: created.id, is_test: opts.is_test });
  return { card: created, outcome: 'created', page_url: pageUrl(env, created.token) };
}

async function reconcile(
  env: Env, existing: CardRow, fields: CanonicalFields, hash: string, opts: UpsertOptions,
): Promise<UpsertResult> {
  if (existing.content_hash === hash) {
    return { card: existing, outcome: 'unchanged', page_url: pageUrl(env, existing.token) };
  }

  await updateCardFields(env.DB, existing.id, fields, hash, opts.source);
  // A correction or renewal restarts the retention clock; otherwise a card that had already expired would
  // be re-rendered and then expired again by the next housekeeping run.
  if (!opts.is_test) await setCardExpiry(env.DB, existing.id, await liveExpiry(env.DB));

  const card = await getCardById(env.DB, existing.id);
  if (!card) throw new Error('upsertFromCanonical: card row missing after update');

  await env.RENDER_QUEUE.send({ card_id: card.id, content_hash: hash });
  console.log('card updated', { licence_number: card.licence_number, card_id: card.id, is_test: opts.is_test });
  return { card, outcome: 'updated', page_url: pageUrl(env, card.token) };
}
