// The owner's referral link (src/referral/, 24 November 2026): the code, the link and its cookie, and the lookup SPC's
// website makes when a lead comes from the landing page with the cookie. BASE_URL is https://licensed.test.
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow } from '../src/types.js';
import { ensureRefCode, getCardById, insertCard, metricsForCard } from '../src/db/cards.js';
import { REF_CODE_RE, newRefCode, readRefCode } from '../src/referral/code.js';
import { referUrl } from '../src/referral/links.js';
import { referralRoutes, referrerOf } from '../src/referral/routes.js';
import { pageRoutes } from '../src/page/routes.js';
import { randomToken } from '../src/util/crypto.js';
import { flushBackground } from '../src/util/background.js';
import { createTestEnv } from './env.js';

const KEY = 'k'.repeat(40);
const env = createTestEnv({ REFERRER_API_KEY: KEY });
const app = new Hono<AppEnv>().route('/', referralRoutes).route('/', pageRoutes);

let seq = 0;
async function seedCard(fields: Partial<CanonicalFields> = {}, is_test = false): Promise<CardRow> {
  seq += 1;
  return insertCard(env.DB, {
    token: randomToken(),
    is_test,
    fields: {
      licence_number: `REF-${seq}`, company_name_en: `Referral ${seq} FZE`, company_name_ar: null, licence_type: null,
      activity_category: 'Publishing', activity_category_ar: null, founder_name_en: 'Aisha Rahman', founder_name_ar: null,
      issued_on: '2026-11-01', preferred_language: 'en', licence_expires_on: null,
      customer_email: 'aisha@example.com', cc_email: null, customer_phone: '+971501234567',
      ...fields,
    },
    content_hash: `h${seq}`, source: 'manual', expires_at: null,
  });
}

const lookup = (code: string, key: string | null = KEY, query = '') =>
  app.request(`/api/referrer/${code}${query}`, key === null ? {} : { headers: { Authorization: `Bearer ${key}` } }, env);

describe('referral code', () => {
  it('is seven unambiguous characters, random each time', () => {
    const codes = new Set(Array.from({ length: 500 }, () => newRefCode()));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(REF_CODE_RE);
    expect([...codes].join('')).not.toMatch(/[01ILO]/);
  });

  it('reads a code in any case and refuses anything else', () => {
    expect(readRefCode(' k7q2mxa ')).toBe('K7Q2MXA');
    expect(readRefCode('K7Q2MX')).toBeNull();
    expect(readRefCode('K7Q2MXO')).toBeNull(); // O is not in the alphabet
    expect(readRefCode('../etc')).toBeNull();
    expect(readRefCode(undefined)).toBeNull();
  });

  it('is given to every new card, and to older cards the first time they are needed, then never changes', async () => {
    const card = await seedCard();
    expect(card.ref_code).toMatch(REF_CODE_RE);
    env.db.raw.prepare('UPDATE cards SET ref_code = NULL WHERE id = ?').run(card.id);
    const old = (await getCardById(env.DB, card.id)) as CardRow;
    expect(old.ref_code).toBeNull();
    const given = await ensureRefCode(env.DB, old);
    expect(given.ref_code).toMatch(REF_CODE_RE);
    expect((await ensureRefCode(env.DB, given)).ref_code).toBe(given.ref_code);
    expect((await ensureRefCode(env.DB, old)).ref_code).toBe(given.ref_code); // a stale row does not draw a second one
  });

  it('makes the link from BASE_URL, with /ar for the Arabic caption, and nothing about the owner', () => {
    expect(referUrl('https://licensed.spcfz.ae/', 'K7Q2MXA', 'en')).toBe('https://licensed.spcfz.ae/r/K7Q2MXA');
    expect(referUrl('https://licensed.spcfz.ae', 'K7Q2MXA', 'ar')).toBe('https://licensed.spcfz.ae/r/K7Q2MXA/ar');
    expect(referUrl('https://licensed.spcfz.ae', null, 'en')).toBeNull();
    expect(referUrl('', 'K7Q2MXA', 'en')).toBeNull();
  });
});

describe('GET /r/<code>', () => {
  it('keeps the code in a 30-day cookie on .spcfz.ae and opens the landing page with nothing added to its address', async () => {
    const card = await seedCard();
    const res = await app.request(`/r/${card.ref_code}`, {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://www.spcfz.ae/single-visa-promotion/');
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain(`spcfz_ref=${card.ref_code}`);
    expect(cookie).toMatch(/Domain=\.spcfz\.ae/i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'ref_click', lang: 'en', size: '', network: 'en', count: 1 }]);
  });

  it('opens the Arabic landing page from the Arabic caption\'s link', async () => {
    const card = await seedCard();
    const res = await app.request(`/r/${card.ref_code}/ar`, {}, env);
    expect(res.headers.get('Location')).toBe('https://www.spcfz.ae/ar/single-visa-promotion/');
    expect(res.headers.get('Set-Cookie') ?? '').toContain(`spcfz_ref=${card.ref_code}`);
  });

  it('opens the page without a cookie for an unknown or broken code: a friend never sees an error', async () => {
    for (const code of ['ZZZZZZZ', 'nope', 'K7Q2MX%3Cscript']) {
      const res = await app.request(`/r/${code}`, {}, env);
      expect(res.status, code).toBe(302);
      expect(res.headers.get('Location'), code).toBe('https://www.spcfz.ae/single-visa-promotion/');
      expect(res.headers.get('Set-Cookie'), code).toBeNull();
    }
  });

  it('works for test cards but does not count them', async () => {
    const card = await seedCard({}, true);
    const res = await app.request(`/r/${card.ref_code}`, {}, env);
    expect(res.headers.get('Set-Cookie') ?? '').toContain(`spcfz_ref=${card.ref_code}`);
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('follows the landing page and cookie settings (the local copy: its own site, a host-only cookie)', async () => {
    const local = createTestEnv({ REFER_LANDING_EN: 'http://localhost:8081/single-visa-promotion/', REFER_COOKIE_DOMAIN: 'host', BASE_URL: 'http://localhost:8787' });
    const card = await insertCard(local.DB, {
      token: randomToken(), is_test: true, content_hash: 'h', source: 'manual', expires_at: null,
      fields: {
        licence_number: 'LOCAL-1', company_name_en: 'Local FZE', company_name_ar: null, licence_type: null, activity_category: null,
        activity_category_ar: null, founder_name_en: null, founder_name_ar: null, issued_on: '2026-11-01', preferred_language: 'en',
        licence_expires_on: null, customer_email: null, cc_email: null, customer_phone: null,
      },
    });
    const res = await app.request(`/r/${card.ref_code}`, {}, local);
    expect(res.headers.get('Location')).toBe('http://localhost:8081/single-visa-promotion/');
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i);
  });
});

describe('GET /api/referrer/<code>', () => {
  it('names the owner as the referrer: founder, email and mobile, for the website only', async () => {
    const card = await seedCard();
    const res = await lookup(card.ref_code as string, KEY, '?form=13&entry=4567');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      code: card.ref_code, name: 'Aisha Rahman', email: 'aisha@example.com', phone: '+971501234567',
      company: card.company_name_en, licence_number: card.licence_number, test: false,
    });
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'ref_lead', lang: 'en', size: '', network: '', count: 1 }]);
  });

  it('refuses a wrong or missing key, and does not exist without one', async () => {
    const card = await seedCard();
    expect((await lookup(card.ref_code as string, null)).status).toBe(401);
    expect((await lookup(card.ref_code as string, 'x'.repeat(40))).status).toBe(401);
    const closed = createTestEnv();
    expect((await app.request(`/api/referrer/${card.ref_code}`, { headers: { Authorization: `Bearer ${KEY}` } }, closed)).status).toBe(404);
    const short = createTestEnv({ REFERRER_API_KEY: 'short' });
    expect((await app.request(`/api/referrer/${card.ref_code}`, { headers: { Authorization: 'Bearer short' } }, short)).status).toBe(404);
  });

  it('answers 404 for a code nobody has', async () => {
    expect((await lookup('ZZZZZZZ')).status).toBe(404);
    expect((await lookup('bad')).status).toBe(404);
  });

  it('falls back to the Arabic name, then the company, when the ERP sent no English name', async () => {
    const ar = await seedCard({ founder_name_en: null, founder_name_ar: 'عائشة رحمن' });
    expect(referrerOf(ar).name).toBe('عائشة رحمن');
    const none = await seedCard({ founder_name_en: null, founder_name_ar: null, customer_email: null, customer_phone: null });
    expect(referrerOf(none)).toEqual({ name: none.company_name_en, email: null, phone: null });
    const res = await lookup(none.ref_code as string);
    expect(await res.json()).toMatchObject({ name: none.company_name_en, email: null, phone: null });
  });

  it('flags test cards for the website, and does not count them', async () => {
    const card = await seedCard({}, true);
    expect(await (await lookup(card.ref_code as string)).json()).toMatchObject({ test: true });
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });
});

describe('the card page', () => {
  it('gives the studio the owner\'s links for the caption, making the code for an older card', async () => {
    const card = await seedCard();
    env.db.raw.prepare('UPDATE cards SET ref_code = NULL WHERE id = ?').run(card.id);
    const page = await (await app.request(`/c/${card.token}`, {}, env)).text();
    const code = ((await getCardById(env.DB, card.id)) as CardRow).ref_code;
    expect(code).toMatch(REF_CODE_RE);
    expect(page).toContain(`"refer_en":"https://licensed.test/r/${code}"`);
    expect(page).toContain(`"refer_ar":"https://licensed.test/r/${code}/ar"`);
    // Personal data stays off the page.
    expect(page).not.toContain('aisha@example.com');
    expect(page).not.toContain('501234567');
  });
});
