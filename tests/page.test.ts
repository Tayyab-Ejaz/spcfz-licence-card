// Personal page: states, headers, images, download, beacon (ARCHITECTURE section 7). Runs against a fresh
// SQLite database and image folder; BASE_URL is https://licensed.test (tests/env.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow, CardStatus, Lang, Size } from '../src/types.js';
import { LANGS, SIZE_NAMES } from '../src/types.js';
import { IMAGE_CACHE_CONTROL, pageRoutes } from '../src/page/routes.js';
import { getCardById, insertCard, metricsForCard, setCardStatus } from '../src/db/cards.js';
import { putImage } from '../src/storage.js';
import { randomToken } from '../src/util/crypto.js';
import { flushBackground } from '../src/util/background.js';
import { imageVersion } from '../src/storage.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();
const app = new Hono<AppEnv>().route('/', pageRoutes);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

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
      issued_on: '2026-10-01',
      preferred_language: 'en',
      ...o.fields,
    },
    content_hash: `hash-${seq}`,
    source: 'manual',
    template_version: 'placeholder-1',
    expires_at: o.expires_at ?? null,
  });
  if (o.status && o.status !== 'pending') await setCardStatus(env.DB, created.id, o.status);
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed: card not found after insert');
  return card;
}

async function putAllImages(token: string): Promise<void> {
  for (const lang of LANGS) for (const size of SIZE_NAMES) await putImage(env.BUCKET, token, lang, size, PNG);
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
    env.DB.prepare('DELETE FROM jobs'),
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
      issued_on: '2026-10-01', activity_en: 'Publishing', activity_ar: null, lang: 'en', is_test: false,
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

describe('GET /c/:token/status', () => {
  it('returns the status as JSON with no-store', async () => {
    const card = await seedCard();
    const { res } = await call(`/c/${card.token}/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'pending' });
    await setCardStatus(env.DB, card.id, 'ready');
    expect(await (await call(`/c/${card.token}/status`)).res.json()).toEqual({ status: 'ready' });
  });

  it('404s a bad or unknown token', async () => {
    expect((await call('/c/bad/status')).res.status).toBe(404);
    expect((await call(`/c/${randomToken()}/status`)).res.status).toBe(404);
  });
});

describe('GET /c/:token/:file', () => {
  it('serves the PNG from R2 with image headers and an ETag', async () => {
    const card = await seedCard({ status: 'ready' });
    await putImage(env.BUCKET, card.token, 'en', 'square', PNG);
    const { res } = await call(`/c/${card.token}/en-square.png`);
    await flushBackground();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Length')).toBe(String(PNG.byteLength));
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('answers 304 to a matching If-None-Match and ignores the version query', async () => {
    const card = await seedCard({ status: 'ready' });
    await putImage(env.BUCKET, card.token, 'en', 'square', PNG);
    const first = await call(`/c/${card.token}/en-square.png?v=${imageVersion(card)}`);
    expect(first.res.status).toBe(200);
    const etag = first.res.headers.get('ETag') ?? '';
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    const second = await call(`/c/${card.token}/en-square.png?v=stale`, { headers: { 'If-None-Match': etag } });
    expect(second.res.status).toBe(304);
    expect(second.res.headers.get('ETag')).toBe(etag);
    expect(second.res.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
  });

  it('404s when the object is missing, the name is not a card image, or the card is expired', async () => {
    const card = await seedCard({ status: 'ready' });
    expect((await call(`/c/${card.token}/ar-story.png`)).res.status).toBe(404);
    expect((await call(`/c/${card.token}/en-huge.png`)).res.status).toBe(404);
    expect((await call(`/c/${card.token}/en-square.jpg`)).res.status).toBe(404);
    expect((await call(`/c/${randomToken()}/en-square.png`)).res.status).toBe(404);
    await putImage(env.BUCKET, card.token, 'en', 'square', PNG);
    await setCardStatus(env.DB, card.id, 'expired');
    expect((await call(`/c/${card.token}/en-square.png`)).res.status).toBe(404);
  });

  it('?download=1 adds a sanitised attachment filename and records a download', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_en: 'Nimbus & Co. (Sharjah) FZE' } });
    await putImage(env.BUCKET, card.token, 'en', 'square', PNG);
    const { res } = await call(`/c/${card.token}/en-square.png?download=1`);
    await flushBackground();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Nimbus-Co-Sharjah-FZE-en-square.png"');
    // A download is counted on every click, so it must never come from a shared cache.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'download', lang: 'en', size: 'square', network: '', count: 1 }]);
  });

  it('does not count downloads of test cards', async () => {
    const card = await seedCard({ status: 'ready', is_test: true });
    await putImage(env.BUCKET, card.token, 'ar', 'story', PNG);
    const { res } = await call(`/c/${card.token}/ar-story.png?download=1`);
    await flushBackground();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('serves every lang/size combination that exists', async () => {
    const card = await seedCard({ status: 'ready' });
    await putAllImages(card.token);
    for (const lang of LANGS as readonly Lang[]) {
      for (const size of SIZE_NAMES as readonly Size[]) {
        const { res } = await call(`/c/${card.token}/${lang}-${size}.png`);
        await flushBackground();
        expect(res.status).toBe(200);
      }
    }
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
