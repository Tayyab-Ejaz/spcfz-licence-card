// Daily housekeeping (ARCHITECTURE section 10): raw bodies, old test cards, expired live cards, metric compaction.
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
  it('purges raw bodies past their expiry and keeps the rest', async () => {
    const now = new Date();
    const old = await insertEvent(env.DB, {
      route: 'test', source_ip: '203.0.113.10', http_status: 200, outcome: 'created',
      raw_body: '{"old":true}', raw_body_expires_at: new Date(now.getTime() - DAY).toISOString(),
    });
    const fresh = await insertEvent(env.DB, {
      route: 'test', source_ip: '203.0.113.10', http_status: 200, outcome: 'created',
      raw_body: '{"fresh":true}', raw_body_expires_at: new Date(now.getTime() + 6 * DAY).toISOString(),
    });
    const summary = await runHousekeeping(env, now);
    expect(summary.rawBodiesPurged).toBe(1);
    expect((await getEvent(env.DB, old))?.raw_body).toBeNull();
    expect((await getEvent(env.DB, old))?.raw_body_expires_at).toBeNull();
    expect((await getEvent(env.DB, fresh))?.raw_body).toBe('{"fresh":true}');
  });

  it('deletes test cards older than the retention period', async () => {
    const test = await seedCard({ is_test: true });
    const live = await seedCard({ expires_at: new Date(Date.now() + 700 * DAY).toISOString() });

    // Run as if 40 days have passed: the test card (created now) is past the 30-day default.
    const summary = await runHousekeeping(env, new Date(Date.now() + 40 * DAY));
    expect(summary.testCardsDeleted).toBe(1);
    expect(await getCardById(env.DB, test.id)).toBeNull();
    // The live card is not a test card and has not expired.
    expect((await getCardById(env.DB, live.id))?.status).toBe('ready');
  });

  it("marks live cards past expires_at as expired and clears the founder's name, keeping the row", async () => {
    const gone = await seedCard({ expires_at: new Date(Date.now() - DAY).toISOString(), fields: { founder_name_en: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي' } });
    await bumpMetric(env.DB, { card_id: gone.id, kind: 'view', lang: 'en' }, '2026-10-01');

    const summary = await runHousekeeping(env);
    expect(summary.cardsExpired).toBe(1);
    const after = await getCardById(env.DB, gone.id);
    expect(after?.status).toBe('expired');
    expect(after?.token).toBe(gone.token);
    expect(after?.founder_name_en).toBeNull();
    expect(after?.founder_name_ar).toBeNull();
    expect(await metricsForCard(env.DB, gone.id)).toHaveLength(1);

    // Already expired: not counted again.
    expect((await runHousekeeping(env)).cardsExpired).toBe(0);
  });

  it('leaves fresh cards untouched and reports zeros', async () => {
    const live = await seedCard({ expires_at: new Date(Date.now() + 700 * DAY).toISOString() });
    const test = await seedCard({ is_test: true });
    const noExpiry = await seedCard({ expires_at: null });

    const summary = await runHousekeeping(env);
    expect(summary).toEqual({ rawBodiesPurged: 0, testCardsDeleted: 0, cardsExpired: 0, metricRowsCompacted: 0 });
    expect((await getCardById(env.DB, live.id))?.status).toBe('ready');
    expect(await getCardById(env.DB, test.id)).not.toBeNull();
    expect((await getCardById(env.DB, noExpiry.id))?.status).toBe('ready');
  });

  it('compacts daily metric rows older than 13 months into monthly rows', async () => {
    const card = await seedCard({ expires_at: new Date(Date.now() + 700 * DAY).toISOString() });
    await bumpMetric(env.DB, { card_id: card.id, kind: 'view', lang: 'en' }, '2024-01-05');
    await bumpMetric(env.DB, { card_id: card.id, kind: 'view', lang: 'en' }, '2024-01-05');
    await bumpMetric(env.DB, { card_id: card.id, kind: 'view', lang: 'en' }, '2024-01-20');
    await bumpMetric(env.DB, { card_id: card.id, kind: 'download', lang: 'en', size: 'square' }, '2024-02-02');
    await bumpMetric(env.DB, { card_id: card.id, kind: 'view', lang: 'en' }, '2026-10-01');

    const summary = await runHousekeeping(env, new Date('2026-10-15T01:15:00Z'));
    expect(summary.metricRowsCompacted).toBe(3);

    const rows = (
      await env.DB.prepare('SELECT day, kind, count FROM metrics WHERE card_id = ?1 ORDER BY day, kind').bind(card.id).all<{ day: string; kind: string; count: number }>()
    ).results;
    expect(rows).toEqual([
      { day: '2024-01', kind: 'view', count: 3 },
      { day: '2024-02', kind: 'download', count: 1 },
      { day: '2026-10-01', kind: 'view', count: 1 },
    ]);
    // Totals are preserved either way.
    const totals = await metricsForCard(env.DB, card.id);
    expect(totals.find((m) => m.kind === 'view')?.count).toBe(4);
  });
});
