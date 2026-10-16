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

  it('answers 410 for an expired card', async () => {
    const card = await seedCard({ status: 'expired' });
    const { res } = await call(`/c/${card.token}`);
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain('This card is no longer available');
    expect(body).toContain('https://www.spcfz.ae/contact-us/');
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

