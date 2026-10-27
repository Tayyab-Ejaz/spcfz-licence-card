// The welcome email (ARCHITECTURE section 16): what it says and links to, who it may go to, and the outbox's
// sending and retries, against a fake transport.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow } from '../src/types.js';
import { pageRoutes } from '../src/page/routes.js';
import { EMAIL_HEADER, SOCIAL, emailAssetRoutes } from '../src/mail/assets.js';
import { renderDaylight } from '../src/page/card-image.js';
import sharp from 'sharp';
import { getCardById, insertCard, setCardStatus } from '../src/db/cards.js';
import { emailsForCard, suppression } from '../src/db/emails.js';
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
  await env.DB.batch([env.DB.prepare('DELETE FROM emails'), env.DB.prepare('DELETE FROM email_suppressions'), env.DB.prepare('DELETE FROM cards')]);
});

describe('the welcome email', () => {
  it('greets the founder, shows their card and links to the studio and to LinkedIn', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test/', linkedin: true });
    expect(m.subject).toBe('Your Business Is Official. Let the World Know!');
    expect(m.html).toContain('Hi Layla,');
    expect(m.html).toContain('Congratulations on receiving your business license with <strong style="white-space:nowrap;">SPC Free Zone!</strong>');
    expect(m.html).toContain('Share Your Milestone');
    expect(m.html).toContain('Team SPC Free Zone');
    expect(m.html).toContain('Sharjah, United Arab Emirates.');
    expect(m.html).not.toContain('Prefer Arabic?');
    expect(m.text).toContain('Your announcement is ready to share!');
    expect(m.html).toContain(`https://licensed.test/c/${card.token}/card/${card.content_hash.slice(0, 10)}-v${CARD_DESIGN}.jpg`);
    expect(m.html).toContain(`https://licensed.test/c/${card.token}?lang=en&amp;via=email`);
    expect(m.html).toContain(`https://licensed.test/c/${card.token}/linkedin?lang=en&amp;via=email`);
    expect(m.html).toContain('dir="ltr"');
    expect(m.text).toContain(`https://licensed.test/c/${card.token}?lang=en&via=email`);
  });

  it('opens with the SPC banner, served from this service and cached for good', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test', linkedin: false });
    expect(m.html).toContain(`src="https://licensed.test/static/email/${EMAIL_HEADER}"`);
    const app = new Hono<AppEnv>().route('/', emailAssetRoutes);
    const res = await app.request(`/static/email/${EMAIL_HEADER}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect((await app.request('/static/email/..%2Fsecret.jpg')).status).toBe(404);
  });

  it('ends with Contact Us, the copyright and the social links, every icon served', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test', linkedin: false });
    expect(m.html).toContain('>CONTACT US</p>');
    expect(m.html).toContain('>Toll Free Number</span>');
    expect(m.html).toMatch(/<a href="tel:80077239" dir="ltr"[^>]*>800 77239<\/a>/);
    expect(m.html).toContain('href="mailto:marketing@spcfz.ae"');
    expect(m.html).toContain(`© ${new Date().getFullYear()} Sharjah Publishing City (SPC) Free Zone<br>Sharjah, United Arab Emirates.`);
    expect(m.text).toContain('Toll Free Number: 800 77239\nEmail: marketing@spcfz.ae');
    const app = new Hono<AppEnv>().route('/', emailAssetRoutes);
    for (const n of SOCIAL) {
      expect(m.html).toContain(`href="${n.href}"`);
      expect((await app.request(`/static/email/${n.icon}`)).status).toBe(200);
    }
    const ar = renderWelcome({ card, lang: 'ar', baseUrl: 'https://licensed.test', linkedin: false });
    expect(ar.html).toContain('>الرقم المجاني</span>');
    expect(ar.html).toMatch(/<a href="tel:80077239" dir="ltr"/); // the number keeps its order inside Arabic
  });

  it('pictures the card in the Daylight style, square', async () => {
    const img = await renderDaylight({ company: 'Nimbus Publishing FZE', activity: 'Publishing', founder: 'Layla Haddad', issuedOn: '2026-10-01', lang: 'en' });
    const meta = await sharp(img).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, 1080]);
  }, 30_000);

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
    expect(m.subject).toBe('أعمالك أصبحت رسمية. شارك الخبر مع العالم!');
    expect(m.html).toContain('مرحباً ليلى،');
    expect(m.html).toContain('-ar.jpg');
  });

  it('greets without a name when the ERP sends no founder', async () => {
    const card = await seedCard({ fields: { founder_name_en: null, founder_name_ar: null } });
    expect(renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test', linkedin: false }).html).toContain('>Hello,</p>');
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

describe('unsubscribe', () => {
  const app = new Hono<AppEnv>().route('/', pageRoutes);
  const call = (path: string, init?: RequestInit): Promise<Response> => Promise.resolve(app.request(path, init, env));

  it('the email has an Unsubscribe button, and mail apps get the one-click header', async () => {
    const card = await seedCard();
    const m = renderWelcome({ card, lang: 'en', baseUrl: 'https://licensed.test', linkedin: false });
    expect(m.unsubscribeUrl).toBe(`https://licensed.test/c/${card.token}/unsubscribe?lang=en`);
    expect(m.html).toContain(`href="https://licensed.test/c/${card.token}/unsubscribe?lang=en"`);
    expect(m.html).toContain('>Unsubscribe</a>');
    expect(m.text).toContain(`Unsubscribe: https://licensed.test/c/${card.token}/unsubscribe?lang=en`);
    await queueWelcome(env, card, { actor: null });
    const t = fakeTransport();
    await processOutbox(env, t);
    expect(t.sent[0]?.unsubscribeUrl).toBe(m.unsubscribeUrl);
  });

  it('opening the link only asks; the button unsubscribes', async () => {
    const card = await seedCard();
    const page = await call(`/c/${card.token}/unsubscribe?lang=en`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Security-Policy')).toContain("form-action 'self'");
    const html = await page.text();
    expect(html).toContain('Unsubscribe from these emails?');
    // SPC's logo in the header, never the name typed out in colours.
    expect(html).toContain('<img src="/static/studio/a/a18673349b740aa2.png" alt="SPC Free Zone"');
    expect(html).not.toContain('<b>Free Zone</b>');
    expect(html).toContain('<footer>SPC Free Zone · Sharjah, UAE · <a href="https://www.spcfz.ae/">spcfz.ae</a></footer>');
    expect(html).toContain('la•••@nimbus.example');
    expect(html).not.toContain('layla@nimbus.example');
    expect(await suppression(env.DB, 'layla@nimbus.example')).toBeNull();

    const res = await call(`/c/${card.token}/unsubscribe?lang=en`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/c/${card.token}/unsubscribe?lang=en`);
    expect(await suppression(env.DB, 'layla@nimbus.example')).toMatchObject({ card_id: card.id, source: 'page' });
    expect(await (await call(`/c/${card.token}/unsubscribe`)).text()).toContain('You are unsubscribed');
  });

  it('a mail app\'s one-click Unsubscribe works without the page', async () => {
    const card = await seedCard();
    const res = await call(`/c/${card.token}/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Unsubscribed');
    expect((await suppression(env.DB, 'layla@nimbus.example'))?.source).toBe('one-click');
  });

  it('no email is queued or sent to an address that unsubscribed', async () => {
    const card = await seedCard();
    await queueWelcome(env, card, { actor: null }); // queued before the customer unsubscribed
    await call(`/c/${card.token}/unsubscribe`, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
    const t = fakeTransport();
    expect(await processOutbox(env, t)).toMatchObject({ sent: 0, skipped: 1 });
    expect(await queueWelcome(env, card, { actor: 'staff@spcfz.ae', force: true })).toBe('unsubscribed');
    const other = await seedCard({ fields: { customer_email: 'LAYLA@nimbus.example' } }); // the same address on another card
    expect(await queueWelcome(env, other, { actor: null })).toBe('unsubscribed');
    expect(t.sent).toHaveLength(0);
  });

  it('works on expired cards, says when there is no address, and 404s for unknown links', async () => {
    const old = await seedCard({ expires_at: '2025-01-01T00:00:00.000Z' });
    expect((await call(`/c/${old.token}/unsubscribe`)).status).toBe(200);
    const none = await seedCard({ fields: { customer_email: null } });
    expect(await (await call(`/c/${none.token}/unsubscribe`)).text()).toContain('nothing to unsubscribe');
    expect((await call('/c/0000000000000000000000/unsubscribe')).status).toBe(404);
  });
});

