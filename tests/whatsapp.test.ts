// The welcome WhatsApp message (19 November 2026): reading phone numbers, the ERP mapping, who it may go to and
// when, the outbox's sending, retries and delivery read-back, Gallabox's request, and the admin screens.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow } from '../src/types.js';
import { createAdminRoutes } from '../src/admin/routes.js';
import { pageRoutes } from '../src/page/routes.js';
import { findCardByLicence, getCardById, insertCard, metricsForCard, setCardStatus, setSetting } from '../src/db/cards.js';
import { suppressWhatsapp, whatsappForCard } from '../src/db/whatsapp.js';
import { acceptPayload } from '../src/intake/accept.js';
import { mapPayload } from '../src/intake/mapper.js';
import { hashFields } from '../src/intake/upsert.js';
import { validateCanonical } from '../src/intake/validate.js';
import { randomToken } from '../src/util/crypto.js';
import { flushBackground } from '../src/util/background.js';
import { gallaboxTemplateBody, welcomeWhatsapp } from '../src/whatsapp/message.js';
import { CHECK_MINUTES, nextDaytime, processWhatsapp, queueWelcomeWhatsapp } from '../src/whatsapp/outbox.js';
import { formatPhone, normalisePhone, parsePhoneList, phoneDigits } from '../src/whatsapp/phone.js';
import { GallaboxError, readDelivery, whatsappTransportFromEnv } from '../src/whatsapp/transport.js';
import type { DeliveryReport, OutgoingWhatsapp, WhatsappTransport } from '../src/whatsapp/transport.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();
const ACTOR = 'staff@spcfz.ae';
const staff = new Hono<AppEnv>().route('/admin', createAdminRoutes(async () => ({ email: ACTOR })));
const CSRF = 'x'.repeat(32);
const LAYLA = '+971501234567';

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
      customer_email: null,
      cc_email: null,
      customer_phone: LAYLA,
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

function fakeTransport(o: { fail?: number; mode?: 'gallabox' | 'file'; reports?: Array<DeliveryReport | null> } = {}): WhatsappTransport & { sent: OutgoingWhatsapp[]; asked: string[] } {
  let left = o.fail ?? 0;
  const reports = [...(o.reports ?? [])];
  const t = {
    mode: o.mode ?? ('file' as const),
    sent: [] as OutgoingWhatsapp[],
    asked: [] as string[],
    async send(m: OutgoingWhatsapp) {
      if (left > 0) {
        left -= 1;
        throw new GallaboxError(503, 'Gallabox answered 503: busy');
      }
      t.sent.push(m);
      return { id: `gb-${t.sent.length}` };
    },
    async delivery(id: string) {
      t.asked.push(id);
      return reports.shift() ?? null;
    },
  };
  return t;
}

async function get(path: string): Promise<Response> {
  return staff.request(path, { headers: { cookie: `admin_csrf=${CSRF}` } }, env);
}

async function post(path: string, fields: Record<string, string> = {}): Promise<Response> {
  const params = new URLSearchParams({ ...fields, _csrf: CSRF });
  return staff.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `admin_csrf=${CSRF}` }, body: params.toString() }, env);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM whatsapp_messages'),
    env.DB.prepare('DELETE FROM whatsapp_suppressions'),
    env.DB.prepare('DELETE FROM emails'),
    env.DB.prepare('DELETE FROM metrics'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM cards'),
    env.DB.prepare("DELETE FROM settings WHERE key = 'whatsapp_test_to'"),
  ]);
});

describe('phone numbers', () => {
  it('reads UAE numbers in every common shape, and international ones with their code', () => {
    for (const s of ['050 123 4567', '0501234567', '+971 50 123 4567', '+971 (0) 50 123 4567', '00971501234567', '971501234567', '501234567', '٠٥٠١٢٣٤٥٦٧', 'tel:+971-50-123-4567', 971501234567]) {
      expect(normalisePhone(s), String(s)).toBe('+971501234567');
    }
    expect(normalisePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalisePhone('919876543210')).toBe('+919876543210');
    expect(normalisePhone('+44 7911 123456')).toBe('+447911123456');
  });

  it('refuses landlines, foreign local numbers, junk and blanks', () => {
    for (const s of ['04 123 4567', '+971 6 555 1234', '0300 1234567', 'N/A', '0', '', '   ', '12345', null, undefined, { phone: 1 }, '+971 50 123 4567 ext 9 and some more text that goes on']) {
      expect(normalisePhone(s), String(s)).toBeNull();
    }
  });

  it('formats for people and for Gallabox, and reads a list', () => {
    expect(formatPhone('+971501234567')).toBe('+971 50 123 4567');
    expect(phoneDigits('+971501234567')).toBe('971501234567');
    expect(parsePhoneList('050 123 4567, +91 98765 43210; 0501234567\nnope')).toEqual({ phones: ['+971501234567', '+919876543210'], bad: ['nope'] });
    expect(parsePhoneList('')).toEqual({ phones: [], bad: [] });
  });
});

describe('the ERP payload', () => {
  it('maps the mobile from common field names and from the owner object', () => {
    expect(mapPayload({ MobileNumber: '050 123 4567' }, '{}')).toEqual({ customer_phone: '050 123 4567' });
    expect(mapPayload({ whatsapp_number: '+971501234567' }, '{}')).toEqual({ customer_phone: '+971501234567' });
    expect(mapPayload({ owner: { name: 'Omar', mobile: '0501234567' } }, '{}')).toEqual({ founder_name_en: 'Omar', customer_phone: '0501234567' });
    expect(mapPayload({ Mobile: '1', customer_phone: '2' }, '{}')).toEqual({ customer_phone: '2' });
    expect(mapPayload({ cell: '0501234567' }, '{"cell":"customer_phone"}')).toEqual({ customer_phone: '0501234567' });
  });

  it('stores the number in international form; a bad number is a note, never a rejection', () => {
    const ok = validateCanonical({ licence_number: 'SPC-1', company_name_en: 'Nimbus FZE', customer_phone: '050 123 4567' });
    expect(ok.ok && [ok.fields.customer_phone, ok.notes]).toEqual(['+971501234567', []]);
    const bad = validateCanonical({ licence_number: 'SPC-1', company_name_en: 'Nimbus FZE', customer_phone: '0300 1234567' });
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      expect(bad.fields.customer_phone).toBeNull();
      expect(bad.notes[0]).toMatch(/^customer_phone: not a mobile number/);
    }
  });

  it('leaves the content hash of cards without a number as it was', async () => {
    const v = validateCanonical({ licence_number: 'SPC-1', company_name_en: 'Nimbus FZE' });
    if (!v.ok) throw new Error('valid');
    const { customer_phone: _drop, ...before } = v.fields;
    expect(await hashFields(v.fields)).toBe(await hashFields(before as CanonicalFields));
    expect(await hashFields({ ...v.fields, customer_phone: LAYLA })).not.toBe(await hashFields(v.fields));
  });

  it('queues the message from the webhook path and reports a number it cannot use', async () => {
    const r = await acceptPayload(env, { licence_number: 'SPC-2026-70001', company_name_en: 'Webhook Co FZE', mobile: '050 123 4567' }, { is_test: false, source: 'webhook', actor: null });
    expect(r.ok && [r.whatsapp, r.notes]).toEqual(['queued', []]);
    const card = await findCardByLicence(env.DB, 'SPC-2026-70001', false);
    expect(card?.customer_phone).toBe(LAYLA);
    const bad = await acceptPayload(env, { licence_number: 'SPC-2026-70002', company_name_en: 'Typo Co FZE', mobile: '12' }, { is_test: false, source: 'webhook', actor: null });
    expect(bad.ok && [bad.whatsapp, bad.notes.length]).toEqual(['no-phone', 1]);
    // The same licence again: unchanged, no second message.
    const again = await acceptPayload(env, { licence_number: 'SPC-2026-70001', company_name_en: 'Webhook Co FZE', mobile: '050 123 4567' }, { is_test: false, source: 'webhook', actor: null });
    expect(again.ok && again.whatsapp).toBe('not-sent');
    expect(await whatsappForCard(env.DB, card?.id ?? '')).toHaveLength(1);
  });
});

describe('who gets it, and when', () => {
  it('sends in Dubai daytime: 09:00 to 21:00, else the next 09:00', () => {
    expect(nextDaytime(new Date('2026-11-19T06:00:00Z')).toISOString()).toBe('2026-11-19T06:00:00.000Z'); // 10:00 Dubai
    expect(nextDaytime(new Date('2026-11-19T01:30:00Z')).toISOString()).toBe('2026-11-19T05:00:00.000Z'); // 05:30 → 09:00
    expect(nextDaytime(new Date('2026-11-19T17:00:00Z')).toISOString()).toBe('2026-11-20T05:00:00.000Z'); // 21:00 → tomorrow
    expect(nextDaytime(new Date('2026-11-19T21:30:00Z')).toISOString()).toBe('2026-11-20T05:00:00.000Z'); // 01:30 next day
  });

  it('queues once per card; the ERP waits for the morning, staff send at once', async () => {
    const night = new Date('2026-11-19T19:00:00Z'); // 23:00 Dubai
    const card = await seedCard();
    expect(await queueWelcomeWhatsapp(env, card, { actor: null, now: night })).toBe('queued');
    expect(await queueWelcomeWhatsapp(env, card, { actor: null, now: night })).toBe('already-sent');
    const [m] = await whatsappForCard(env.DB, card.id);
    expect([m?.status, m?.to_phone, m?.next_attempt_at]).toEqual(['queued', LAYLA, '2026-11-20T05:00:00.000Z']);
    expect(await queueWelcomeWhatsapp(env, card, { actor: ACTOR, force: true, now: night })).toBe('queued');
    expect((await whatsappForCard(env.DB, card.id))[0]?.next_attempt_at).toBe('2026-11-19T19:00:00.000Z');
  });

  it('skips cards without a number, expired cards, stopped numbers and test cards off the list', async () => {
    expect(await queueWelcomeWhatsapp(env, await seedCard({ fields: { customer_phone: null } }), { actor: null })).toBe('no-phone');
    expect(await queueWelcomeWhatsapp(env, await seedCard({ expires_at: '2020-01-01T00:00:00.000Z' }), { actor: null })).toBe('expired');
    const stopped = await seedCard();
    await suppressWhatsapp(env.DB, { phone: LAYLA, card_id: stopped.id, source: 'staff', actor: ACTOR, created_at: '2026-11-19T08:00:00.000Z' });
    expect(await queueWelcomeWhatsapp(env, stopped, { actor: null })).toBe('stopped');
    expect((await whatsappForCard(env.DB, stopped.id))[0]?.status).toBe('skipped');
    await env.DB.prepare('DELETE FROM whatsapp_suppressions').run();
    const test = await seedCard({ is_test: true });
    expect(await queueWelcomeWhatsapp(env, test, { actor: ACTOR })).toBe('skipped-test');
    await setSetting(env.DB, 'whatsapp_test_to', '+971 50 123 4567');
    expect(await queueWelcomeWhatsapp(env, test, { actor: ACTOR, force: true })).toBe('queued');
  });
});

describe('the message', () => {
  it("fills the approved template from the card: the studio link in the text and a per-customer button, no picture", async () => {
    const card = await seedCard({ fields: { founder_name_en: 'Layla Haddad', company_name_en: 'Nimbus Publishing FZE' } });
    const m = welcomeWhatsapp(card, { baseUrl: 'https://licensed.test/', header: 'none' });
    const link = `https://licensed.test/c/${card.token}?lang=en&via=whatsapp`;
    expect(m.template).toBe('19112026_linkedin_milestone');
    expect(m.values).toEqual({ variable_1: link });
    expect(m.buttonSuffix).toBe(`${card.token}?lang=en&via=whatsapp`);
    expect(m.studioUrl).toBe(link);
    expect(m.imageUrl).toBeNull();
    expect(m.text).toContain(`Click the link below: ${link}\n\nWelcome to the SPC Free Zone family!`);
    expect(m.text).not.toContain('{{');
  });

  it('is English for every customer, Arabic-speaking ones included (SPC, 24 November 2026); a picture only when asked', async () => {
    const card = await seedCard({ fields: { preferred_language: 'ar', founder_name_en: null, founder_name_ar: 'ليلى حداد' } });
    const m = welcomeWhatsapp(card, { baseUrl: 'https://licensed.test', template: 'welcome_en', header: 'none' });
    expect(m.template).toBe('welcome_en');
    expect(m.values.variable_1).toBe(`https://licensed.test/c/${card.token}?lang=en&via=whatsapp`);
    expect(m.text.startsWith("*You're Officially A Business Owner")).toBe(true);
    const withPicture = welcomeWhatsapp(card, { baseUrl: 'https://licensed.test', header: 'image' });
    expect(withPicture.imageUrl).toMatch(new RegExp(`^https://licensed\\.test/c/${card.token}/card/[0-9a-f]{10}-v\\d+\\.jpg$`));
    expect(withPicture.imageUrl).not.toMatch(/-ar\.jpg$/);
  });

  it('queues and logs the message as English, whatever the customer\'s language', async () => {
    const card = await seedCard({ fields: { preferred_language: 'ar' } });
    expect(await queueWelcomeWhatsapp(env, card, { actor: ACTOR })).toBe('queued');
    expect((await whatsappForCard(env.DB, card.id))[0]?.lang).toBe('en');
  });

  it("builds Gallabox's template request as delivered on 24 November 2026: digits-only phone, variable_1, URL button, no header", async () => {
    const card = await seedCard();
    const m = welcomeWhatsapp(card, { baseUrl: 'https://licensed.test', header: 'none' });
    expect(gallaboxTemplateBody(m, { channelId: 'ch1', phone: LAYLA, name: 'Layla Haddad' })).toEqual({
      channelId: 'ch1',
      channelType: 'whatsapp',
      recipient: { name: 'Layla Haddad', phone: '971501234567' },
      whatsapp: {
        type: 'template',
        template: {
          templateName: '19112026_linkedin_milestone',
          bodyValues: { variable_1: `https://licensed.test/c/${card.token}?lang=en&via=whatsapp` },
          buttonValues: [{ index: 0, sub_type: 'url', parameters: { type: 'text', text: `${card.token}?lang=en&via=whatsapp` } }],
        },
      },
    });
  });

  it('adds the card picture as an image header only with WHATSAPP_HEADER=image', async () => {
    const card = await seedCard();
    const m = welcomeWhatsapp(card, { baseUrl: 'https://licensed.test', header: 'image' });
    const body = gallaboxTemplateBody(m, { channelId: 'ch1', phone: LAYLA, name: 'Layla Haddad' }) as { whatsapp: { template: Record<string, unknown> } };
    expect(body.whatsapp.template.headerValues).toEqual({ mediaUrl: m.imageUrl, mediaName: 'announcement-card.jpg' });
  });
});

describe('Gallabox', () => {
  const gbEnv = { ...env, WHATSAPP_TRANSPORT: 'gallabox' as const, GALLABOX_API_KEY: 'key-123', GALLABOX_API_SECRET: 'secret-456', GALLABOX_CHANNEL_ID: 'chan-1', GALLABOX_ACCOUNT_ID: 'acct-9' };

  it('posts the template with the key and secret as headers, and keeps the message id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: '6690f72bc78c4af10bf384ff', status: 'ACCEPTED' }), { status: 202 });
    }) as unknown as typeof fetch;
    const t = whatsappTransportFromEnv(gbEnv, fetchImpl);
    const card = await seedCard();
    const message = welcomeWhatsapp(card, { baseUrl: env.BASE_URL, header: 'none' });
    expect(await t?.send({ to: LAYLA, name: 'Layla Haddad', message })).toEqual({ id: '6690f72bc78c4af10bf384ff' });
    expect(calls[0]?.url).toBe('https://server.gallabox.com/devapi/messages/whatsapp');
    expect(calls[0]?.init.headers).toMatchObject({ apiKey: 'key-123', apiSecret: 'secret-456' });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ channelId: 'chan-1', recipient: { phone: '971501234567' } });
  });

  it("explains a refusal with Gallabox's own words and never the keys", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: 'Template not found' }), { status: 400 })) as unknown as typeof fetch;
    const t = whatsappTransportFromEnv(gbEnv, fetchImpl);
    const card = await seedCard();
    const message = welcomeWhatsapp(card, { baseUrl: env.BASE_URL, header: 'none' });
    const err = await t?.send({ to: LAYLA, name: 'x', message }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GallaboxError);
    expect(String((err as Error).message)).toBe('Gallabox answered 400: Template not found');
    expect(String((err as Error).message)).not.toContain('secret-456');
  });

  it('reads the delivery back from the account, with the reason when it failed', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ id: 'm1', status: 'failed', timestamp: '1722247764', errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Message Undeliverable.' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const report = await whatsappTransportFromEnv(gbEnv, fetchImpl)?.delivery('m1');
    expect(urls).toEqual(['https://server.gallabox.com/devapi/accounts/acct-9/messages/m1/status']);
    expect(report).toEqual({ status: 'failed', at: '2024-07-29T10:09:24.000Z', error: 'WhatsApp: Message undeliverable: Message Undeliverable. (131026)' });
    expect(readDelivery({ status: 'read', timestamp: '2024-07-11T10:19:11.157Z' })).toEqual({ status: 'read', at: '2024-07-11T10:19:11.157Z', error: null });
    expect(readDelivery({})).toBeNull();
  });

  it('is off without a key, and needs all three settings to send', () => {
    expect(whatsappTransportFromEnv(env)).toBeNull();
    expect(whatsappTransportFromEnv({ ...env, WHATSAPP_TRANSPORT: 'gallabox', GALLABOX_API_KEY: 'k' })).toBeNull();
    expect(whatsappTransportFromEnv({ ...env, WHATSAPP_TRANSPORT: 'file' })?.mode).toBe('file');
  });
});

describe('the outbox', () => {
  it('sends what is due, keeps the template and Gallabox id, and leaves later messages alone', async () => {
    const t = fakeTransport();
    const now = new Date('2026-11-19T06:00:00Z');
    const card = await seedCard();
    await queueWelcomeWhatsapp(env, card, { actor: ACTOR, now });
    const later = await seedCard();
    await queueWelcomeWhatsapp(env, later, { actor: null, now: new Date('2026-11-19T19:00:00Z') });
    expect(await processWhatsapp(env, t, now)).toMatchObject({ sent: 1, retried: 0 });
    expect(t.sent.map((s) => [s.to, s.name, s.message.template])).toEqual([[LAYLA, 'Layla Haddad', '19112026_linkedin_milestone']]);
    const [m] = await whatsappForCard(env.DB, card.id);
    expect([m?.status, m?.provider_id, m?.template, m?.check_at]).toEqual(['sent', 'gb-1', '19112026_linkedin_milestone', null]);
    expect((await whatsappForCard(env.DB, later.id))[0]?.status).toBe('queued');
  });

  it('retries a failure after 1, 5, 30, 120 and 720 minutes, then gives up', async () => {
    const t = fakeTransport({ fail: 99 });
    const card = await seedCard();
    await queueWelcomeWhatsapp(env, card, { actor: ACTOR, now: new Date('2026-11-19T06:00:00Z') });
    let clock = Date.parse('2026-11-19T06:00:00Z');
    for (const wait of [1, 5, 30, 120, 720]) {
      await processWhatsapp(env, t, new Date(clock));
      const [m] = await whatsappForCard(env.DB, card.id);
      expect([m?.status, m?.next_attempt_at]).toEqual(['queued', new Date(clock + wait * 60_000).toISOString()]);
      clock += wait * 60_000;
    }
    await processWhatsapp(env, t, new Date(clock));
    const [m] = await whatsappForCard(env.DB, card.id);
    expect([m?.status, m?.attempts, m?.last_error]).toEqual(['failed', 6, 'Gallabox answered 503: busy']);
  });

  it('reads the delivery back on a schedule until it is final', async () => {
    const gb = { ...env, GALLABOX_ACCOUNT_ID: 'acct-9' };
    const t = fakeTransport({ mode: 'gallabox', reports: [{ status: 'sent', at: null, error: null }, { status: 'delivered', at: '2026-11-19T06:03:00.000Z', error: null }, { status: 'read', at: '2026-11-19T06:20:00.000Z', error: null }] });
    const card = await seedCard();
    const sentAt = new Date('2026-11-19T06:00:00Z');
    await queueWelcomeWhatsapp(gb, card, { actor: ACTOR, now: sentAt });
    await processWhatsapp(gb, t, sentAt);
    let [m] = await whatsappForCard(env.DB, card.id);
    expect(Date.parse(m?.check_at ?? '')).toBeGreaterThanOrEqual(sentAt.getTime() + CHECK_MINUTES[0]! * 60_000);
    for (const minutes of [3, 16, 61]) await processWhatsapp(gb, t, new Date(sentAt.getTime() + minutes * 60_000));
    [m] = await whatsappForCard(env.DB, card.id);
    expect([m?.delivery, m?.delivery_at, m?.check_at, m?.checks]).toEqual(['read', '2026-11-19T06:20:00.000Z', null, 3]);
    expect(t.asked).toEqual(['gb-1', 'gb-1', 'gb-1']);
  });

  it('records a delivery failure with its reason and stops asking', async () => {
    const gb = { ...env, GALLABOX_ACCOUNT_ID: 'acct-9' };
    const t = fakeTransport({ mode: 'gallabox', reports: [{ status: 'failed', at: '2026-11-19T06:01:00.000Z', error: 'WhatsApp: Message undeliverable (131026)' }] });
    const card = await seedCard();
    const now = new Date('2026-11-19T06:00:00Z');
    await queueWelcomeWhatsapp(gb, card, { actor: ACTOR, now });
    await processWhatsapp(gb, t, now);
    await processWhatsapp(gb, t, new Date(now.getTime() + 3 * 60_000));
    const [m] = await whatsappForCard(env.DB, card.id);
    expect([m?.status, m?.delivery, m?.last_error, m?.check_at]).toEqual(['sent', 'failed', 'WhatsApp: Message undeliverable (131026)', null]);
  });

  it('does not send to a number stopped after it was queued, or for a card that expired', async () => {
    const t = fakeTransport();
    const now = new Date('2026-11-19T06:00:00Z');
    const card = await seedCard();
    await queueWelcomeWhatsapp(env, card, { actor: ACTOR, now });
    await suppressWhatsapp(env.DB, { phone: LAYLA, card_id: card.id, source: 'staff', actor: ACTOR, created_at: now.toISOString() });
    expect(await processWhatsapp(env, t, now)).toMatchObject({ sent: 0, skipped: 1 });
    expect(t.sent).toEqual([]);
  });
});

describe('admin', () => {
  it('creates a card with a mobile number and queues the message; refuses a number it cannot read', async () => {
    expect(await (await get('/admin/create')).text()).toMatch(/name="send_whatsapp" value="1" checked/);
    await post('/admin/create', { licence_number: 'SPC-2026-80001', company_name_en: 'Phone Co FZE', issued_on: '2026-10-10', customer_phone: '050 123 4567', send_whatsapp: '1' });
    const card = await findCardByLicence(env.DB, 'SPC-2026-80001', false);
    expect(card?.customer_phone).toBe(LAYLA);
    expect((await whatsappForCard(env.DB, card?.id ?? '')).map((m) => m.status)).toEqual(['queued']);
    const bad = await post('/admin/create', { licence_number: 'SPC-2026-80002', company_name_en: 'Typo Co FZE', customer_phone: '0300 1234567' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('customer_phone: not a mobile number');
    expect(await findCardByLicence(env.DB, 'SPC-2026-80002', false)).toBeNull();
  });

  it('shows the number and history on the card; sends again, stops and allows the number', async () => {
    const card = await seedCard();
    let page = await (await get(`/admin/cards/${card.id}`)).text();
    expect(page).toContain('+971 50 123 4567');
    expect(page).toContain('Welcome WhatsApp message');
    const sent = await post(`/admin/cards/${card.id}/whatsapp`);
    expect(sent.headers.get('Location')).toBe(`/admin/cards/${card.id}?m=whatsapped`);
    expect(await whatsappForCard(env.DB, card.id)).toHaveLength(1);
    expect((await post(`/admin/cards/${card.id}/whatsapp-stop`)).headers.get('Location')).toBe(`/admin/cards/${card.id}?m=wa-stop`);
    expect((await post(`/admin/cards/${card.id}/whatsapp`)).headers.get('Location')).toBe(`/admin/cards/${card.id}?m=wa-stopped`);
    page = await (await get(`/admin/cards/${card.id}`)).text();
    expect(page).toContain('Allow WhatsApp again');
    await post(`/admin/cards/${card.id}/whatsapp-allow`);
    expect((await post(`/admin/cards/${card.id}/whatsapp`)).headers.get('Location')).toBe(`/admin/cards/${card.id}?m=whatsapped`);
    const none = await seedCard({ fields: { customer_phone: null } });
    expect((await post(`/admin/cards/${none.id}/whatsapp`)).headers.get('Location')).toBe(`/admin/cards/${none.id}?m=wa-none`);
  });

  it('previews the message, in English even for an Arabic-speaking customer', async () => {
    const card = await seedCard({ fields: { preferred_language: 'ar' } });
    const page = await (await get(`/admin/cards/${card.id}/whatsapp-preview?lang=ar`)).text();
    expect(page).toContain("You&#39;re Officially A Business Owner");
    expect(page).toContain(`Click the link below: https://licensed.test/c/${card.token}?lang=en&amp;via=whatsapp`);
    expect(page).toContain('View My Post');
    expect(page).toContain('Every customer gets this English message.');
    expect(page).not.toContain('dir="rtl"');
  });

  it('keeps the WhatsApp test numbers in Settings, and refuses ones it cannot read', async () => {
    const saved = await post('/admin/settings', { whatsapp_test_to: '050 123 4567, +91 98765 43210' });
    expect(saved.status).toBe(303);
    const page = await (await get('/admin/settings')).text();
    expect(page).toContain('+971 50 123 4567, +91 98765 43210');
    const bad = await post('/admin/settings', { whatsapp_test_to: '0300 1234567' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('WhatsApp test numbers: 0300 1234567');
  });

  it('test flow offers the WhatsApp step with the first test number', async () => {
    await setSetting(env.DB, 'whatsapp_test_to', '+971 50 123 4567');
    const form = await (await get('/admin/test-flow')).text();
    expect(form).toContain('&quot;customer_phone&quot;: &quot;+971501234567&quot;');
    expect(form).toMatch(/name="send_whatsapp" value="1" checked/);
  });
});

describe('the card page', () => {
  it('counts a visit from the WhatsApp button apart', async () => {
    const card = await seedCard();
    const app = new Hono<AppEnv>().route('/', pageRoutes);
    const res = await app.request(`/c/${card.token}?lang=en&via=whatsapp`, {}, env);
    expect(res.status).toBe(200);
    await flushBackground();
    expect((await metricsForCard(env.DB, card.id)).filter((m) => m.kind === 'view').map((m) => m.network)).toEqual(['whatsapp']);
  });
});
