// Personal page: states, headers, images, download, beacon (ARCHITECTURE section 7). Runs against a fresh
// SQLite database and image folder; BASE_URL is https://licensed.test (tests/env.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow, CardStatus } from '../src/types.js';
import { pageRoutes } from '../src/page/routes.js';
import { getCardById, insertCard, metricsForCard, setCardStatus } from '../src/db/cards.js';
import { randomToken } from '../src/util/crypto.js';
import { flushBackground } from '../src/util/background.js';
import { createTestEnv } from './env.js';
import sharp from 'sharp';
import { unbreakable } from '../src/page/preview-image.js';

const env = createTestEnv();
const app = new Hono<AppEnv>().route('/', pageRoutes);

let seq = 0;

interface SeedOptions {
  fields?: Partial<CanonicalFields>;
  is_test?: boolean;
  status?: CardStatus;
  expires_at?: string | null;
}

async function seedCard(o: SeedOptions = {}): Promise<CardRow> {
  seq += 1;
  const created = await insertCard(env.DB, {
    token: randomToken(),
    is_test: o.is_test ?? false,
    fields: {
      licence_number: `SPC-2026-${String(seq).padStart(5, '0')}`,
      company_name_en: 'Nimbus Publishing FZE',
      company_name_ar: null,
      licence_type: 'Commercial',
      activity_category: 'Publishing',
      activity_category_ar: null,
      founder_name_en: null,
      founder_name_ar: null,
      issued_on: '2026-10-01',
      preferred_language: 'en',
      licence_expires_on: null,
      ...o.fields,
    },
    content_hash: `hash-${seq}`,
    source: 'manual',
    expires_at: o.expires_at ?? null,
  });
  if (o.status && o.status !== 'pending') await setCardStatus(env.DB, created.id, o.status);
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed: card not found after insert');
  return card;
}

async function call(path: string, init?: RequestInit): Promise<{ res: Response }> {
  const res = await app.request(path, init, env);
  return { res };
}

function nonceFromCsp(csp: string): string {
  const m = /script-src [^;]*'nonce-([^']+)'/.exec(csp);
  if (!m || !m[1]) throw new Error(`no script nonce in CSP: ${csp}`);
  return m[1];
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM metrics'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM cards'),
  ]);
});

describe('GET /c/:token', () => {
  it('answers a malformed token with the generic 404 page', async () => {
    const { res } = await call('/c/not-a-real-token');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('This link is not valid');
    expect(body).toContain('https://www.spcfz.ae/contact-us/');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('answers an unknown well-formed token with the same 404 page', async () => {
    const { res } = await call(`/c/${randomToken()}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('This link is not valid');
  });

  function embedded(body: string): Record<string, unknown> {
    const m = /<script type="application\/json" id="card-data">([\s\S]*?)<\/script>/.exec(body);
    if (!m || m[1] === undefined) throw new Error('no card-data script');
    return JSON.parse(m[1]) as Record<string, unknown>;
  }

  for (const status of ['pending', 'ready', 'failed'] as const) {
    it(`serves the studio straight away for a ${status} card`, async () => {
      const card = await seedCard({ status });
      const { res } = await call(`/c/${card.token}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('<div id="dc-root"></div>');
      expect(body).toContain('<title>Nimbus Publishing FZE is licensed · SPC Free Zone</title>');
      expect(body).toMatch(/<link rel="stylesheet" href="\/static\/studio\/[^"]+\.css">/);
      expect(body).toMatch(/<script src="\/static\/studio\/[^"]+\.js" defer><\/script>/);
    });
  }

  it('embeds only what the card shows', async () => {
    const card = await seedCard({ status: 'ready' });
    const body = await (await call(`/c/${card.token}`)).res.text();
    expect(embedded(body)).toEqual({
      token: card.token, company_en: 'Nimbus Publishing FZE', company_ar: null, licence_number: card.licence_number,
      issued_on: '2026-10-01', activity_en: 'Publishing', activity_ar: null, name_en: null, name_ar: null, lang: 'en', is_test: false,
    });
  });

  it('carries the Arabic names and the preferred language', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_ar: 'نيمبوس للنشر', activity_category_ar: 'النشر', preferred_language: 'ar' } });
    const data = embedded(await (await call(`/c/${card.token}`)).res.text());
    expect(data).toMatchObject({ company_ar: 'نيمبوس للنشر', activity_ar: 'النشر', lang: 'ar' });
  });

  it('carries a link preview for WhatsApp and LinkedIn: title, description and an absolute image URL', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_en: 'Cedar & "Quill" FZE', company_name_ar: 'سيدار وكويل', issued_on: '2026-10-16' } });
    const body = await (await call(`/c/${card.token}`)).res.text();
    const meta = (prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)">`).exec(body)?.[1];
    expect(meta('og:title')).toBe('Cedar &amp; &quot;Quill&quot; FZE is officially licensed');
    expect(meta('og:description')).toBe('A new business at SPC Free Zone, Sharjah. Licensed 16 October 2026.');
    expect(meta('og:image')).toBe(`https://licensed.test/c/${card.token}/preview/${card.content_hash.slice(0, 10)}.jpg`);
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(meta('og:url')).toBe(`https://licensed.test/c/${card.token}`);
    expect(meta('twitter:card')).toBe('summary_large_image');
    // The tags come before the stylesheet and data, inside the first few kilobytes that preview fetchers read.
    expect(body.indexOf('og:image')).toBeLessThan(body.indexOf('<link rel="stylesheet"'));

    const ar = await (await call(`/c/${card.token}?lang=ar`)).res.text();
    expect(ar).toContain('<meta property="og:title" content="سيدار وكويل مرخّصة رسمياً">');
    expect(ar).toContain('16 أكتوبر 2026');
    expect(ar).toContain(`<meta property="og:url" content="https://licensed.test/c/${card.token}?lang=ar">`);
    expect(ar).toContain(`<meta property="og:image" content="https://licensed.test/c/${card.token}/preview/${card.content_hash.slice(0, 10)}-ar.jpg">`);
  });

  it('draws the preview picture: a 1200 x 630 JPEG with the company name, in either language', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_en: 'Al Noor Media FZ-LLC', company_name_ar: 'النور للإعلام' } });
    const h = 'a1b2c3d4e5'; // real content hashes are hex; the route draws the card's current details either way
    for (const file of [`${h}.jpg`, `${h}-ar.jpg`]) {
      const { res } = await call(`/c/${card.token}/preview/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('Cache-Control')).toContain('max-age=604800');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630]);
    }
    // An older address (the card changed since) still answers, with the current details.
    expect((await call(`/c/${card.token}/preview/0123456789.jpg`)).res.status).toBe(200);
  }, 30_000);

  it('refuses malformed preview addresses and unknown cards get no drawn picture', async () => {
    const card = await seedCard({ status: 'ready' });
    for (const path of [`/c/${card.token}/preview/x.jpg`, `/c/${card.token}/preview/0123456789.png`, '/c/short/preview/0123456789.jpg']) {
      expect((await call(path)).res.status, path).toBe(404);
    }
    // Expired and unknown cards fall back to the generic picture when the studio is built, else 404.
    const expired = await seedCard({ status: 'expired' });
    const res = (await call(`/c/${expired.token}/preview/0123456789.jpg`)).res;
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  it('keeps hyphenated names together and a spaced dash with the word before it', () => {
    expect(unbreakable('Al Noor Media FZ-LLC')).toBe('Al Noor Media FZ\u2060-\u2060LLC');
    expect(unbreakable('النور للإعلام ش.ذ.م.م - منطقة حرة')).toBe('النور للإعلام ش.ذ.م.م\u00a0- منطقة حرة');
  });

  it('opens in the language ?lang= asks for, and ignores anything else', async () => {
    const card = await seedCard({ status: 'ready', fields: { preferred_language: 'en' } });
    expect(embedded(await (await call(`/c/${card.token}?lang=ar`)).res.text())).toMatchObject({ lang: 'ar' });
    expect(embedded(await (await call(`/c/${card.token}?lang=xx`)).res.text())).toMatchObject({ lang: 'en' });
    const ar = await seedCard({ status: 'ready', fields: { preferred_language: 'ar' } });
    expect(embedded(await (await call(`/c/${ar.token}?lang=en`)).res.text())).toMatchObject({ lang: 'en' });
  });

  it('cannot be broken out of the embedded JSON', async () => {
    const evil = '</script><script>alert(1)</script><!--';
    const card = await seedCard({ status: 'ready', fields: { company_name_en: `Nimbus ${evil}` } });
    const body = await (await call(`/c/${card.token}`)).res.text();
    expect(body).not.toContain('<script>alert(1)');
    expect(embedded(body)['company_en']).toBe(`Nimbus ${evil}`);
  });

  it('sends a strict CSP and private, noindex headers', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await call(`/c/${card.token}`);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('uses a fresh nonce per request', async () => {
    const card = await seedCard({ status: 'ready' });
    const a = nonceFromCsp((await call(`/c/${card.token}`)).res.headers.get('Content-Security-Policy') ?? '');
    const b = nonceFromCsp((await call(`/c/${card.token}`)).res.headers.get('Content-Security-Policy') ?? '');
    expect(a).not.toBe(b);
  });

  it('loads Google Tag Manager only when switched on, with the nonce', async () => {
    const card = await seedCard({ status: 'ready' });
    const off = await (await call(`/c/${card.token}`)).res.text();
    expect(off).not.toContain('googletagmanager');
    await env.DB.prepare("UPDATE settings SET value = '1' WHERE key = 'gtm_enabled'").run();
    const gtmEnv = { ...env, GTM_CONTAINER: 'GTM-PZ8R4DN' };
    const res = await app.request(`/c/${card.token}`, undefined, gtmEnv);
    const body = await res.text();
    const nonce = nonceFromCsp(res.headers.get('Content-Security-Policy') ?? '');
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body).toContain('"GTM-PZ8R4DN"');
    expect(res.headers.get('Content-Security-Policy')).toContain('https://www.googletagmanager.com');
    await env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'gtm_enabled'").run();
  });

  it('answers 410 for an expired card, naming the company and pointing to renewal', async () => {
    const card = await seedCard({ status: 'expired' });
    const { res } = await call(`/c/${card.token}`);
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain('This licence has expired');
    expect(body).toContain(card.company_name_en);
    expect(body).toContain('https://portal.spcfz.ae/frontend/login/');
    expect(body).toContain('https://www.spcfz.ae/contact-us/');
  });

  it('shows expired as soon as the licence date has passed, before the nightly run, in both languages', async () => {
    const card = await seedCard({ status: 'ready' });
    env.db.raw.prepare("UPDATE cards SET licence_expires_on = '2026-10-02', expires_at = '2026-10-02T20:00:00.000Z', company_name_ar = 'نيمبوس' WHERE id = ?").run(card.id);
    const en = await call(`/c/${card.token}`);
    expect(en.res.status).toBe(410);
    const enBody = await en.res.text();
    expect(enBody).toContain(`Licence ${card.licence_number} expired on 2 October 2026.`);
    const ar = await (await call(`/c/${card.token}?lang=ar`)).res.text();
    expect(ar).toContain('انتهت صلاحية هذه الرخصة');
    expect(ar).toContain('نيمبوس');
    expect(ar).toContain('2 أكتوبر 2026');
  });

  it('marks a test card in the title and does not count its views', async () => {
    const card = await seedCard({ status: 'ready', is_test: true });
    const { res } = await call(`/c/${card.token}`);
    await flushBackground();
    const body = await res.text();
    expect(body).toContain('<title>[TEST] ');
    expect(embedded(body)['is_test']).toBe(true);
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('records a view, even while the server-side render is still pending', async () => {
    const card = await seedCard();
    await call(`/c/${card.token}?lang=ar`);
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'view', lang: 'ar', size: '', network: '', count: 1 }]);
  });
});

describe('removed server-render routes', () => {
  it('no longer serve status JSON or images', async () => {
    const card = await seedCard({ status: 'ready' });
    expect((await call(`/c/${card.token}/status`)).res.status).toBe(404);
    expect((await call(`/c/${card.token}/en-square.png`)).res.status).toBe(404);
  });
});

describe('POST /c/:token/m', () => {
  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  it('increments a share metric', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await call(`/c/${card.token}/m`, json({ kind: 'share', lang: 'en', size: 'square', network: 'linkedin' }));
    expect(res.status).toBe(204);
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'share', lang: 'en', size: 'square', network: 'linkedin', count: 1 }]);
    await call(`/c/${card.token}/m`, json({ kind: 'share', lang: 'en', size: 'square', network: 'linkedin' }));
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'share', lang: 'en', size: 'square', network: 'linkedin', count: 2 }]);
  });

  it('drops invalid dimensions but keeps a valid kind', async () => {
    const card = await seedCard({ status: 'ready' });
    await call(`/c/${card.token}/m`, json({ kind: 'caption', lang: 'xx', size: 'huge', network: 'Not Valid!' }));
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'caption', lang: '', size: '', network: '', count: 1 }]);
  });

  it('ignores junk without erroring', async () => {
    const card = await seedCard({ status: 'ready' });
    const cases: RequestInit[] = [
      json({ kind: 'bogus' }),
      json('not json at all'),
      json([1, 2, 3]),
      json({ kind: 'share', pad: 'x'.repeat(2000) }),
      { method: 'POST' },
    ];
    for (const init of cases) {
      const { res } = await call(`/c/${card.token}/m`, init);
      expect(res.status).toBe(204);
      await flushBackground();
    }
    expect((await call('/c/bad-token/m', json({ kind: 'share' }))).res.status).toBe(204);
    expect((await call(`/c/${randomToken()}/m`, json({ kind: 'share' }))).res.status).toBe(204);
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('does not count test cards', async () => {
    const card = await seedCard({ status: 'ready', is_test: true });
    const { res } = await call(`/c/${card.token}/m`, json({ kind: 'share', network: 'x' }));
    expect(res.status).toBe(204);
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });
});

describe('founder name in the studio data', () => {
  it('passes the founder name in both languages to the studio', async () => {
    const card = await seedCard({ status: 'ready', fields: { founder_name_en: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي' } });
    const body = await (await call(`/c/${card.token}`)).res.text();
    const m = /<script type="application\/json" id="card-data">([\s\S]*?)<\/script>/.exec(body);
    expect(JSON.parse(m?.[1] ?? '{}')).toMatchObject({ name_en: 'Mariam Fawzy', name_ar: 'مريم فوزي' });
  });
});

