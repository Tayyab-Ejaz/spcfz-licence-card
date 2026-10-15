// Personal page: states, headers, images, download, beacon (ARCHITECTURE section 7). Runs in the Workers pool
// against the isolated D1 and R2; BASE_URL is https://licensed.test (vitest.config.ts).
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow, CardStatus, Lang, Size } from '../src/types';
import { LANGS, SIZE_NAMES } from '../src/types';
import { pageRoutes } from '../src/page/routes';
import { getCardById, insertCard, metricsForCard, setCardStatus } from '../src/db/cards';
import { putImage } from '../src/storage';
import { randomToken } from '../src/util/crypto';

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

async function call(path: string, init?: RequestInit): Promise<{ res: Response; ctx: ExecutionContext }> {
  const ctx = createExecutionContext();
  const res = await app.request(path, init, env, ctx);
  return { res, ctx };
}

function nonceFromCsp(csp: string): string {
  const m = /script-src 'nonce-([^']+)'/.exec(csp);
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

  it('shows the preparing view with the poller while pending', async () => {
    const card = await seedCard();
    const { res } = await call(`/c/${card.token}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Preparing your card');
    expect(body).toContain(`data-base="/c/${card.token}/"`);
    expect(body).toContain("'status'");
    expect(body).not.toContain('wa.me/971502387267');
  });

  it('shows the preparing view plus the WhatsApp line when failed, never an error code', async () => {
    const card = await seedCard({ status: 'failed' });
    const { res } = await call(`/c/${card.token}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Preparing your card');
    expect(body).toContain('https://wa.me/971502387267');
    expect(body).not.toContain('failed');
  });

  it('renders the ready page with the company, OG tags and privacy headers', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res, ctx } = await call(`/c/${card.token}`);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Nimbus Publishing FZE');
    expect(body).toContain(`<meta property="og:image" content="https://licensed.test/c/${card.token}/en-landscape.png">`);
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain('Nimbus Publishing FZE is officially licensed at SPC Free Zone');
    expect(body).toContain('dir="ltr"');
    expect(body).toContain(`https://licensed.test/c/${card.token}`);
    expect(body).toContain('utm_source=licensed-card');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('issues a CSP whose nonce matches the inline script and style', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await call(`/c/${card.token}`);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('googletagmanager');
    const nonce = nonceFromCsp(csp);
    const body = await res.text();
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body).toContain(`<style nonce="${nonce}">`);
    expect(csp).toContain(`style-src 'nonce-${nonce}'`);
  });

  it('uses a fresh nonce per request', async () => {
    const card = await seedCard({ status: 'ready' });
    const a = await call(`/c/${card.token}`);
    const b = await call(`/c/${card.token}`);
    expect(nonceFromCsp(a.res.headers.get('Content-Security-Policy') ?? '')).not.toBe(
      nonceFromCsp(b.res.headers.get('Content-Security-Policy') ?? ''),
    );
  });

  it('?lang=ar renders RTL and falls back to the English name', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await call(`/c/${card.token}?lang=ar`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('dir="rtl"');
    expect(body).toContain('lang="ar"');
    expect(body).toContain('Nimbus Publishing FZE');
    expect(body).toContain(`https://licensed.test/c/${card.token}/ar-landscape.png`);
    expect(body).toContain(`src="/c/${card.token}/ar-square.png"`);
  });

  it('shows the Arabic name when the card has one', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_ar: 'نيمبوس للنشر' } });
    const { res } = await call(`/c/${card.token}?lang=ar`);
    const body = await res.text();
    expect(body).toContain('نيمبوس للنشر');
    expect(body).toContain('نيمبوس للنشر مرخّصة رسمياً');
  });

  it('defaults to preferred_language and ignores junk ?lang', async () => {
    const card = await seedCard({ status: 'ready', fields: { preferred_language: 'ar' } });
    const { res } = await call(`/c/${card.token}?lang=fr`);
    expect(await res.text()).toContain('dir="rtl"');
  });

  it('honours ?size and defaults to square', async () => {
    const card = await seedCard({ status: 'ready' });
    const dflt = await (await call(`/c/${card.token}`)).res.text();
    expect(dflt).toContain(`href="/c/${card.token}/en-square.png?download=1"`);
    const story = await (await call(`/c/${card.token}?size=story`)).res.text();
    expect(story).toContain(`href="/c/${card.token}/en-story.png?download=1"`);
    expect(story).toContain(`src="/c/${card.token}/en-story.png"`);
  });

  it('answers 410 for an expired card', async () => {
    const card = await seedCard({ status: 'expired' });
    const { res } = await call(`/c/${card.token}`);
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain('This card is no longer available');
    expect(body).toContain('https://www.spcfz.ae/contact-us/');
  });

  it('marks a test card with the ribbon and [TEST] in the title', async () => {
    const card = await seedCard({ status: 'ready', is_test: true });
    const { res, ctx } = await call(`/c/${card.token}`);
    await waitOnExecutionContext(ctx);
    const body = await res.text();
    expect(body).toContain('<title>[TEST] ');
    expect(body).toContain('class="ribbon"');
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('records a view metric for a live ready card', async () => {
    const card = await seedCard({ status: 'ready' });
    const { ctx } = await call(`/c/${card.token}?lang=ar`);
    await waitOnExecutionContext(ctx);
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'view', lang: 'ar', size: '', network: '', count: 1 }]);
  });

  it('does not count a view while pending', async () => {
    const card = await seedCard();
    const { ctx } = await call(`/c/${card.token}`);
    await waitOnExecutionContext(ctx);
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
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
    const { res, ctx } = await call(`/c/${card.token}/en-square.png`);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
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
    const { res, ctx } = await call(`/c/${card.token}/en-square.png?download=1`);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Nimbus-Co-Sharjah-FZE-en-square.png"');
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'download', lang: 'en', size: 'square', network: '', count: 1 }]);
  });

  it('does not count downloads of test cards', async () => {
    const card = await seedCard({ status: 'ready', is_test: true });
    await putImage(env.BUCKET, card.token, 'ar', 'story', PNG);
    const { res, ctx } = await call(`/c/${card.token}/ar-story.png?download=1`);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('serves every lang/size combination that exists', async () => {
    const card = await seedCard({ status: 'ready' });
    await putAllImages(card.token);
    for (const lang of LANGS as readonly Lang[]) {
      for (const size of SIZE_NAMES as readonly Size[]) {
        const { res, ctx } = await call(`/c/${card.token}/${lang}-${size}.png`);
        await waitOnExecutionContext(ctx);
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
    const { res, ctx } = await call(`/c/${card.token}/m`, json({ kind: 'share', lang: 'en', size: 'square', network: 'linkedin' }));
    expect(res.status).toBe(204);
    await waitOnExecutionContext(ctx);
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'share', lang: 'en', size: 'square', network: 'linkedin', count: 1 }]);
    const again = await call(`/c/${card.token}/m`, json({ kind: 'share', lang: 'en', size: 'square', network: 'linkedin' }));
    await waitOnExecutionContext(again.ctx);
    expect(await metricsForCard(env.DB, card.id)).toEqual([{ kind: 'share', lang: 'en', size: 'square', network: 'linkedin', count: 2 }]);
  });

  it('drops invalid dimensions but keeps a valid kind', async () => {
    const card = await seedCard({ status: 'ready' });
    const { ctx } = await call(`/c/${card.token}/m`, json({ kind: 'caption', lang: 'xx', size: 'huge', network: 'Not Valid!' }));
    await waitOnExecutionContext(ctx);
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
      const { res, ctx } = await call(`/c/${card.token}/m`, init);
      expect(res.status).toBe(204);
      await waitOnExecutionContext(ctx);
    }
    expect((await call('/c/bad-token/m', json({ kind: 'share' }))).res.status).toBe(204);
    expect((await call(`/c/${randomToken()}/m`, json({ kind: 'share' }))).res.status).toBe(204);
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('does not count test cards', async () => {
    const card = await seedCard({ status: 'ready', is_test: true });
    const { res, ctx } = await call(`/c/${card.token}/m`, json({ kind: 'share', network: 'x' }));
    expect(res.status).toBe(204);
    await waitOnExecutionContext(ctx);
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });
});
