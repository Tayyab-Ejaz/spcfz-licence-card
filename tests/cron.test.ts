// Daily housekeeping (ARCHITECTURE section 10): marks cards expired once their licence has; deletes nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalFields, CardRow } from '../src/types.js';
import { runHousekeeping } from '../src/cron.js';
import { bumpMetric, getCardById, getEvent, insertCard, insertEvent, metricsForCard } from '../src/db/cards.js';
import { randomToken } from '../src/util/crypto.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();
const DAY = 24 * 3600 * 1000;

let seq = 0;

async function seedCard(o: { is_test?: boolean; expires_at?: string | null; fields?: Partial<CanonicalFields> } = {}): Promise<CardRow> {
  seq += 1;
  const created = await insertCard(env.DB, {
    token: randomToken(),
    is_test: o.is_test ?? false,
    fields: {
      licence_number: `SPC-2026-${String(seq).padStart(5, '0')}`,
      company_name_en: `Company ${seq} FZE`,
      company_name_ar: null,
      licence_type: null,
      activity_category: null,
      activity_category_ar: null,
      founder_name_en: null,
      founder_name_ar: null,
      issued_on: '2026-10-01',
      preferred_language: 'en',
      licence_expires_on: null,
      customer_email: null,
      cc_email: null,
      ...o.fields,
    },
    content_hash: `hash-${seq}`,
    source: 'webhook',
    expires_at: o.expires_at ?? null,
  });
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed: card not found after insert');
  return card;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM metrics'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM cards'),
  ]);
});

describe('runHousekeeping', () => {
  it('deletes nothing: old test cards, stored request bodies, founder names and old daily counters all stay', async () => {
    const test = await seedCard({ is_test: true, fields: { founder_name_en: 'Layla Haddad' } });
    const ev = await insertEvent(env.DB, {
      route: 'test', source_ip: '203.0.113.10', http_status: 200, outcome: 'created',
      raw_body: '{"kept":true}', raw_body_expires_at: new Date(Date.now() - DAY).toISOString(),
    });
    await bumpMetric(env.DB, { card_id: test.id, kind: 'view', lang: 'en' }, '2024-01-05');
    await bumpMetric(env.DB, { card_id: test.id, kind: 'view', lang: 'en' }, '2024-01-20');

    const summary = await runHousekeeping(env, new Date(Date.now() + 1000 * DAY));
    expect(summary).toEqual({ cardsExpired: 0, adminSessionsPurged: 0 });
    expect((await getCardById(env.DB, test.id))?.founder_name_en).toBe('Layla Haddad');
    expect((await getEvent(env.DB, ev))?.raw_body).toBe('{"kept":true}');
    const days = (await env.DB.prepare('SELECT day FROM metrics WHERE card_id = ?1 ORDER BY day').bind(test.id).all<{ day: string }>()).results;
    expect(days.map((d) => d.day)).toEqual(['2024-01-05', '2024-01-20']);
  });

  it('marks cards whose licence has expired as expired, live and test alike, and keeps everything on them', async () => {
    const past = new Date(Date.now() - DAY).toISOString();
    const live = await seedCard({ expires_at: past, fields: { founder_name_en: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي', licence_expires_on: '2026-10-01' } });
    const test = await seedCard({ is_test: true, expires_at: past });
    await bumpMetric(env.DB, { card_id: live.id, kind: 'view', lang: 'en' }, '2026-10-01');

    const summary = await runHousekeeping(env);
    expect(summary.cardsExpired).toBe(2);
    const after = await getCardById(env.DB, live.id);
    expect(after?.status).toBe('expired');
    expect(after?.token).toBe(live.token);
    expect(after?.founder_name_en).toBe('Mariam Fawzy');
    expect(after?.founder_name_ar).toBe('مريم فوزي');
    expect(await metricsForCard(env.DB, live.id)).toHaveLength(1);
    expect((await getCardById(env.DB, test.id))?.status).toBe('expired');

    // Already expired: not counted again.
    expect((await runHousekeeping(env)).cardsExpired).toBe(0);
  });

  it('leaves cards with a future or unknown licence expiry untouched', async () => {
    const future = await seedCard({ expires_at: new Date(Date.now() + 300 * DAY).toISOString() });
    const unknown = await seedCard({ expires_at: null });
    const summary = await runHousekeeping(env, new Date(Date.now() + 100 * DAY));
    expect(summary.cardsExpired).toBe(0);
    expect((await getCardById(env.DB, future.id))?.status).toBe('ready');
    expect((await getCardById(env.DB, unknown.id))?.status).toBe('ready');
  });
});
