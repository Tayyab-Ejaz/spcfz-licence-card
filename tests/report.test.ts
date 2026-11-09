// The monthly impact report (src/report/): the figures for a Dubai month with test cards left out, the email, and
// when it is queued and sent.
import { describe, expect, it } from 'vitest';
import type { CardRow } from '../src/types.js';
import { bumpMetric, getCardById, insertCard, setCardStatus, setSetting } from '../src/db/cards.js';
import { insertEmail } from '../src/db/emails.js';
import { insertLinkedinPost } from '../src/db/linkedin.js';
import { randomToken } from '../src/util/crypto.js';
import { buildReport, change, monthLabel, monthRange, previousMonth } from '../src/report/impact.js';
import { renderReportEmail } from '../src/report/email.js';
import { processReports, queueMonthlyReport, queueReport, reportSends } from '../src/report/send.js';
import type { MailTransport, OutgoingEmail } from '../src/mail/transport.js';
import { createTestEnv } from './env.js';

let seq = 0;
async function seed(env: ReturnType<typeof createTestEnv>, o: { company: string; created: string; is_test?: boolean }): Promise<CardRow> {
  seq += 1;
  const c = await insertCard(env.DB, {
    token: randomToken(),
    is_test: o.is_test ?? false,
    fields: {
      licence_number: `SPC-R-${seq}`, company_name_en: o.company, company_name_ar: null, licence_type: null, activity_category: 'Publishing',
      activity_category_ar: null, founder_name_en: null, founder_name_ar: null, issued_on: '2026-10-01', preferred_language: 'en',
      licence_expires_on: null, customer_email: null, cc_email: null,
    },
    content_hash: `h${seq}`, source: 'manual', expires_at: null,
  });
  await setCardStatus(env.DB, c.id, 'ready');
  env.db.raw.prepare('UPDATE cards SET created_at = ? WHERE id = ?').run(o.created, c.id);
  return (await getCardById(env.DB, c.id)) as CardRow;
}

function fakeTransport(fail = 0): MailTransport & { sent: OutgoingEmail[] } {
  let left = fail;
  const t = {
    mode: 'file' as const,
    sent: [] as OutgoingEmail[],
    async send(m: OutgoingEmail) { if (left > 0) { left--; throw new Error('smtp down'); } t.sent.push(m); return { id: `m${t.sent.length}` }; },
  };
  return t;
}

describe('months', () => {
  it('are Dubai months (UTC+4), with the month before and the change on it', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-09-30T20:00:00.000Z', to: '2026-10-31T20:00:00.000Z', firstDay: '2026-10-01', lastDay: '2026-10-31' });
    expect(monthRange('2026-02').lastDay).toBe('2026-02-28');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect([change(5, 2), change(2, 5), change(3, 3), change(0, 0)]).toEqual(['+3', '−3', 'no change', '']);
  });
});

describe('buildReport', () => {
  it('counts real customers in the month only: cards, emails, opens, shares, posts, reviews', async () => {
    const env = createTestEnv();
    const a = await seed(env, { company: 'Alpha FZE', created: '2026-10-03T08:00:00.000Z' });
    const b = await seed(env, { company: 'Beta FZE', created: '2026-09-30T21:00:00.000Z' }); // 1 Oct, 01:00 Dubai
    await seed(env, { company: 'September FZE', created: '2026-09-30T19:00:00.000Z' });    // 30 Sep, 23:00 Dubai
    const t = await seed(env, { company: 'Test FZE', created: '2026-10-05T08:00:00.000Z', is_test: true });
    await insertEmail(env.DB, { card_id: a.id, kind: 'welcome', to_email: 'a@x.ae', cc_email: null, lang: 'en', status: 'sent', actor: null, now: '2026-10-03T08:01:00.000Z' });
    env.db.raw.prepare("UPDATE emails SET sent_at = '2026-10-03T08:02:00.000Z'").run();
    const m = (card: CardRow, kind: Parameters<typeof bumpMetric>[1]['kind'], day: string, network: string | null = null) =>
      bumpMetric(env.DB, { card_id: card.id, kind, lang: 'en', network }, day);
    await m(a, 'view', '2026-10-03', 'email');
    await m(a, 'view', '2026-10-04');
    await m(b, 'view', '2026-10-10');
    await m(a, 'download', '2026-10-04');
    await m(b, 'share', '2026-10-11', 'native');
    await m(a, 'li_start', '2026-10-04');
    await m(a, 'li_post', '2026-10-04');
    await m(a, 'share', '2026-10-04', 'linkedin');
    await m(a, 'review_ask', '2026-10-04');
    await m(a, 'review_click', '2026-10-04');
    await m(b, 'view', '2026-11-01'); // next month
    await insertLinkedinPost(env.DB, { card_id: a.id, status: 'posted', post_urn: 'urn:li:share:1', error: null, lang: 'en', created_at: '2026-10-04T09:00:00.000Z' });
    await insertLinkedinPost(env.DB, { card_id: t.id, status: 'posted', post_urn: 'urn:li:share:2', error: null, lang: 'en', created_at: '2026-10-05T09:00:00.000Z' });
    await insertLinkedinPost(env.DB, { card_id: a.id, status: 'failed', post_urn: null, error: 'x', lang: 'en', created_at: '2026-10-04T09:05:00.000Z' });

    const r = await buildReport(env.DB, '2026-10');
    expect(r.label).toBe('October 2026');
    expect(r.current).toMatchObject({
      newCards: 2, welcomeSent: 1, openedCards: 2, views: 3, viewsFromEmail: 1, sharedCards: 2, downloads: 1, shares: 1,
      posts: 1, liStarted: 1, reviewAsks: 1, reviewClicks: 1,
    });
    expect(r.previous.newCards).toBe(1);
    expect(r.posts.map((p) => p.company_name_en)).toEqual(['Alpha FZE']);
    expect(r.sinceLaunch).toEqual({ cards: 3, sharedCards: 2, posts: 1 });

    const mail = renderReportEmail(r, 'https://licensed.test');
    expect(mail.subject).toBe('Licence cards: October 2026 report');
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('New licence cards');
      expect(body).toContain('+1');
      expect(body).toContain('Alpha FZE');
      expect(body).toContain('https://www.linkedin.com/feed/update/urn:li:share:1/');
      expect(body).toContain('https://licensed.test/admin/report?month=2026-10');
      expect(body).not.toContain('Test FZE');
    }
    expect(mail.html).toContain('/static/email/');
  });
});

describe('sending', () => {
  it('the daily run on the 1st queues the month before for report_to, to go at 09:00 Dubai, once', async () => {
    const env = createTestEnv();
    const first = new Date('2026-11-01T01:15:00.000Z'); // 05:15 Dubai, the daily run
    await setSetting(env.DB, 'report_to', 'off');
    expect(await queueMonthlyReport(env, first)).toBe(0); // switched off
    await setSetting(env.DB, 'report_to', 'boss@spcfz.ae, team@spcfz.ae');
    expect(await queueMonthlyReport(env, first)).toBe(2);
    expect(await queueMonthlyReport(env, new Date('2026-11-02T01:15:00.000Z'))).toBe(0);
    const rows = await reportSends(env.DB, '2026-10');
    expect(rows.map((x) => [x.to_email, x.next_attempt_at, x.actor])).toEqual(expect.arrayContaining([
      ['boss@spcfz.ae', '2026-11-01T05:00:00.000Z', null], ['team@spcfz.ae', '2026-11-01T05:00:00.000Z', null],
    ]));
    expect(await queueMonthlyReport(env, new Date('2026-12-04T01:15:00.000Z'))).toBe(0); // after the 3rd: not on its own

    const t = fakeTransport();
    expect(await processReports(env, t, new Date('2026-11-01T04:59:00.000Z'))).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(await processReports(env, t, new Date('2026-11-01T05:00:30.000Z'))).toMatchObject({ sent: 2 });
    expect(t.sent.map((m) => m.subject)).toEqual(['Licence cards: October 2026 report', 'Licence cards: October 2026 report']);
    expect((await reportSends(env.DB, '2026-10')).every((x) => x.status === 'sent')).toBe(true);
  });

  it('goes to tayyab@spcfz.ae when Admin → Settings names nobody', async () => {
    const env = createTestEnv();
    expect(await queueMonthlyReport(env, new Date('2026-12-01T01:15:00.000Z'))).toBe(1);
    expect((await reportSends(env.DB, '2026-11')).map((x) => x.to_email)).toEqual(['tayyab@spcfz.ae']);
  });

  it('a late daily run (server down on the 1st) still sends it on the 2nd or 3rd', async () => {
    const env = createTestEnv();
    await setSetting(env.DB, 'report_to', 'boss@spcfz.ae');
    const third = new Date('2026-11-03T08:00:00.000Z');
    expect(await queueMonthlyReport(env, third)).toBe(1);
    expect((await reportSends(env.DB, '2026-10'))[0]?.next_attempt_at).toBe(third.toISOString());
  });

  it('Send in the admin queues the month shown; a failed send is tried again', async () => {
    const env = createTestEnv();
    const now = '2026-11-05T10:00:00.000Z';
    expect(await queueReport(env.DB, { month: '2026-11', to: ['me@spcfz.ae'], actor: 'me@spcfz.ae', now })).toBe(1);
    const t = fakeTransport(1);
    expect(await processReports(env, t, new Date('2026-11-05T10:00:10.000Z'))).toMatchObject({ retried: 1 });
    expect((await reportSends(env.DB, '2026-11'))[0]).toMatchObject({ status: 'queued', attempts: 1, last_error: 'smtp down' });
    expect(await processReports(env, t, new Date('2026-11-05T10:02:00.000Z'))).toMatchObject({ sent: 1 });
    expect((await reportSends(env.DB, '2026-11'))[0]).toMatchObject({ status: 'sent', actor: 'me@spcfz.ae' });
  });
});
