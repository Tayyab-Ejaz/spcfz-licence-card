// The welcome email (ARCHITECTURE section 16): what it says and links to, who it may go to, and the outbox's
// sending and retries, against a fake transport.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalFields, CardRow } from '../src/types.js';
import { getCardById, insertCard, setCardStatus } from '../src/db/cards.js';
import { emailsForCard } from '../src/db/emails.js';
import { randomToken } from '../src/util/crypto.js';
import { renderWelcome } from '../src/mail/welcome.js';
import { processOutbox, queueWelcome, testRecipientAllowed } from '../src/mail/outbox.js';
import type { MailTransport, OutgoingEmail } from '../src/mail/transport.js';
import { CARD_DESIGN } from '../src/page/studio.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();

let seq = 0;
async function seedCard(o: { fields?: Partial<CanonicalFields>; is_test?: boolean; expires_at?: string | null } = {}): Promise<CardRow> {
  seq += 1;
  const created = await insertCard(env.DB, {
    token: randomToken(),
    is_test: o.is_test ?? false,
    fields: {
      licence_number: `SPC-2026-${String(seq).padStart(5, '0')}`,
      company_name_en: 'Nimbus Publishing FZE',
      company_name_ar: 'نيمبوس للنشر',
      licence_type: null,
      activity_category: 'Publishing',
      activity_category_ar: null,
      founder_name_en: 'Layla Haddad',
      founder_name_ar: 'ليلى حداد',
      issued_on: '2026-10-01',
      preferred_language: 'en',
      licence_expires_on: '2027-09-30',
      customer_email: 'layla@nimbus.example',
      cc_email: null,
      ...o.fields,
    },
    content_hash: `0123456789abcdef${seq}`,
    source: 'manual',
    expires_at: o.expires_at ?? null,
  });
  await setCardStatus(env.DB, created.id, 'ready');
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed');
  return card;
}

function fakeTransport(fail = 0): MailTransport & { sent: OutgoingEmail[] } {
  let left = fail;
  const t = {
    mode: 'file' as const,
    sent: [] as OutgoingEmail[],
    async send(m: OutgoingEmail) {
      if (left > 0) {
        left -= 1;
        throw new Error('421 try later');
      }
      t.sent.push(m);
      return { id: `msg-${t.sent.length}` };
    },
  };
  return t;
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM emails'), env.DB.prepare('DELETE FROM cards')]);
});

describe('the welcome email', () => {
  it('greets the founder, shows their card and links to the studio and to LinkedIn', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test/', linkedin: true });
    expect(m.subject).toBe('Nimbus Publishing FZE is officially licensed. Your announcement card is ready');
    expect(m.html).toContain('Congratulations, Layla.');
    expect(m.html).toContain(`https://licensed.test/c/${card.token}/card/${card.content_hash.slice(0, 10)}-v${CARD_DESIGN}.jpg`);
    expect(m.html).toContain(`https://licensed.test/c/${card.token}?lang=en&amp;via=email`);
    expect(m.html).toContain(`https://licensed.test/c/${card.token}/linkedin?lang=en&amp;via=email`);
    expect(m.html).toContain('dir="ltr"');
    expect(m.text).toContain(`https://licensed.test/c/${card.token}?lang=en&via=email`);
  });

  it('has no LinkedIn button until LinkedIn is set up', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test', linkedin: false });
    expect(m.html).not.toContain('/linkedin?');
    expect(m.text).not.toContain('/linkedin?');
  });

  it('is right to left in Arabic, with the Arabic names and the Arabic card', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'ar', baseUrl: 'https://licensed.test', linkedin: true });
    expect(m.html).toContain('dir="rtl"');
    expect(m.html).toContain('lang="ar"');
    expect(m.subject).toContain('نيمبوس للنشر');
    expect(m.html).toContain('-ar.jpg');
  });

  it('escapes what the ERP sends', async () => {
    const card = await seedCard({ fields: { company_name_en: 'Evil <script>alert(1)</script> FZE', founder_name_en: '"><img src=x onerror=alert(1)>' } });
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test', linkedin: false });
    expect(m.html).not.toContain('<script>alert');
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('Evil &lt;script&gt;');
  });
});

describe('queueing', () => {
  it('queues once per card; sending again needs force', async () => {
    const card = await seedCard();
    expect(await queueWelcome(env, card, { actor: null })).toBe('queued');
    expect(await queueWelcome(env, card, { actor: null })).toBe('already-sent');
    expect(await queueWelcome(env, card, { actor: 'staff@spcfz.ae', force: true })).toBe('queued');
    expect((await emailsForCard(env.DB, card.id)).map((e) => e.status)).toEqual(['queued', 'queued']);
  });

  it('needs an address and a card that has not expired', async () => {
    expect(await queueWelcome(env, await seedCard({ fields: { customer_email: null } }), { actor: null })).toBe('no-email');
    expect(await queueWelcome(env, await seedCard({ expires_at: '2025-01-01T00:00:00.000Z' }), { actor: null })).toBe('expired');
  });

  it('test cards only email the allowlist, and say so in the log', async () => {
    const outside = await seedCard({ is_test: true });
    expect(await queueWelcome(env, outside, { actor: null })).toBe('skipped-test');
    expect((await emailsForCard(env.DB, outside.id))[0]).toMatchObject({ status: 'skipped' });
    const inside = await seedCard({ is_test: true, fields: { customer_email: 'tayyab@spcfz.ae' } });
    expect(await queueWelcome(env, inside, { actor: null })).toBe('queued');
    expect(testRecipientAllowed({ MAIL_TEST_ALLOWLIST: 'example.com, one@other.test' }, 'One@Other.test')).toBe(true);
    expect(testRecipientAllowed({ MAIL_TEST_ALLOWLIST: 'example.com' }, 'x@notexample.com')).toBe(false);
  });
});

describe('sending', () => {
  it('sends what is due, with the copy address, and records it', async () => {
    const card = await seedCard({ fields: { cc_email: 'rm@spcfz.ae' } });
    await queueWelcome(env, card, { actor: null });
    const t = fakeTransport();
    expect(await processOutbox(env, t)).toMatchObject({ sent: 1 });
    expect(t.sent[0]).toMatchObject({ to: 'layla@nimbus.example', cc: 'rm@spcfz.ae' });
    const [row] = await emailsForCard(env.DB, card.id);
    expect(row).toMatchObject({ status: 'sent', provider_id: 'msg-1', attempts: 1 });
    expect(await processOutbox(env, t)).toMatchObject({ sent: 0 });
  });

  it('retries after 1, 5, 30, 120 and 720 minutes, then gives up', async () => {
    const card = await seedCard();
    await queueWelcome(env, card, { actor: null });
    const t = fakeTransport(99);
    let now = new Date();
    for (const wait of [1, 5, 30, 120, 720]) {
      expect(await processOutbox(env, t, now)).toMatchObject({ retried: 1 });
      const [row] = await emailsForCard(env.DB, card.id);
      expect(row?.next_attempt_at).toBe(new Date(now.getTime() + wait * 60_000).toISOString());
      expect(await processOutbox(env, t, now)).toMatchObject({ retried: 0 }); // not due yet
      now = new Date(now.getTime() + wait * 60_000);
    }
    expect(await processOutbox(env, t, now)).toMatchObject({ failed: 1 });
    expect((await emailsForCard(env.DB, card.id))[0]).toMatchObject({ status: 'failed', attempts: 6, last_error: '421 try later' });
  });

  it('skips an email whose card expired while it waited', async () => {
    const card = await seedCard();
    await queueWelcome(env, card, { actor: null });
    await env.DB.prepare('UPDATE cards SET expires_at = ?1 WHERE id = ?2').bind('2025-01-01T00:00:00.000Z', card.id).run();
    const t = fakeTransport();
    expect(await processOutbox(env, t)).toMatchObject({ skipped: 1 });
    expect(t.sent).toHaveLength(0);
  });

  it('sends nothing when mail is off', async () => {
    const card = await seedCard();
    await queueWelcome(env, card, { actor: null });
    expect(await processOutbox(env, null)).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 0 });
    expect((await emailsForCard(env.DB, card.id))[0]?.status).toBe('queued');
  });
});
