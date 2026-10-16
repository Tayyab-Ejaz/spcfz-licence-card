// Personal page: the page itself, status JSON, image delivery from the bucket and the counter beacon (ARCHITECTURE section 7).
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv, Lang, MetricKind, Size } from '../types.js';
import { isLang, isSize } from '../types.js';
import { bumpMetric, getCardByToken, getSettings } from '../db/cards.js';
import type { MetricKey } from '../db/cards.js';
import { imageKey } from '../storage.js';
import { background } from '../util/background.js';
import { TOKEN_RE, bytesToBase64 } from '../util/crypto.js';
import { safeFilename } from '../util/html.js';
import { todayInDubai } from '../util/time.js';
import {
  buildCaption, displayName, renderExpiredPage, renderNotFoundPage, renderPendingPage, renderReadyPage,
} from './view.js';

const IMAGE_FILE_RE = /^(en|ar)-(square|portrait|story|landscape)\.png$/;
const GTM_ID_RE = /^GTM-[A-Z0-9]{4,12}$/;
const BEACON_LIMIT = 1024;

/** Image URLs are versioned (src/storage.ts), so a copy may live at the edge and in browsers for a year. */
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const DEFAULT_CAPTION_EN =
  "We're officially licensed at SPC Free Zone! {company} is now a licensed business in Sharjah. #SPCFreeZone #Sharjah #BusinessSetup {link}";

function makeNonce(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

function buildCsp(nonce: string, gtm: boolean): string {
  const script = [`'nonce-${nonce}'`];
  const connect = ["'self'"];
  const img = ["'self'", 'data:'];
  if (gtm) {
    script.push('https://www.googletagmanager.com');
    connect.push('https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com');
    img.push('https://www.googletagmanager.com', 'https://*.google-analytics.com');
  }
  return [
    "default-src 'none'",
    `img-src ${img.join(' ')}`,
    `style-src 'nonce-${nonce}'`,
    `script-src ${script.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function pageHeaders(c: Context<AppEnv>, nonce: string, gtm: boolean): void {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Content-Security-Policy', buildCsp(nonce, gtm));
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
}

/** Counters must never break the page: fire and forget, swallow everything. */
function safeMetric(c: Context<AppEnv>, m: MetricKey): void {
  background(
    bumpMetric(c.env.DB, m, todayInDubai()).catch((err: unknown) => {
      console.warn('metric failed', { kind: m.kind, message: err instanceof Error ? err.message : String(err) });
    }),
    'metric',
  );
}

function isMetricKind(v: unknown): v is MetricKind {
  return v === 'view' || v === 'download' || v === 'share' || v === 'caption';
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export const pageRoutes = new Hono<AppEnv>();

// ------------------------------------------------------------------ the page

pageRoutes.get('/c/:token', async (c) => {
  const token = c.req.param('token');
  const langQ = c.req.query('lang');
  const nonce = makeNonce();
  c.set('nonce', nonce);

  if (!TOKEN_RE.test(token)) {
    pageHeaders(c, nonce, false);
    return c.html(renderNotFoundPage(isLang(langQ) ? langQ : 'en', nonce), 404);
  }

  const card = await getCardByToken(c.env.DB, token);
  if (!card) {
    pageHeaders(c, nonce, false);
    return c.html(renderNotFoundPage(isLang(langQ) ? langQ : 'en', nonce), 404);
  }

  const lang: Lang = isLang(langQ) ? langQ : card.preferred_language;

  if (card.status === 'expired') {
    pageHeaders(c, nonce, false);
    return c.html(renderExpiredPage(lang, nonce), 410);
  }

  const settings = await getSettings(c.env.DB);
  const container = (c.env.GTM_CONTAINER ?? '').trim();
  const gtmContainer = settings['gtm_enabled'] === '1' && GTM_ID_RE.test(container) ? container : null;
  pageHeaders(c, nonce, gtmContainer !== null);

  if (card.status === 'pending' || card.status === 'failed') {
    return c.html(renderPendingPage({ card, lang, nonce, failed: card.status === 'failed', gtmContainer }), 200);
  }

  const sizeQ = c.req.query('size');
  const size: Size = isSize(sizeQ) ? sizeQ : 'square';
  const template =
    (lang === 'ar' ? settings['caption_ar'] : undefined) || settings['caption_en'] || DEFAULT_CAPTION_EN;
  const caption = buildCaption(template, displayName(card, lang));

  if (!card.is_test) safeMetric(c, { card_id: card.id, kind: 'view', lang });

  return c.html(renderReadyPage({ env: c.env, card, lang, size, nonce, caption, gtmContainer }), 200);
});

// ------------------------------------------------------------------ status

pageRoutes.get('/c/:token/status', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const token = c.req.param('token');
  if (!TOKEN_RE.test(token)) return c.json({ error: 'not_found' }, 404);
  const card = await getCardByToken(c.env.DB, token);
  if (!card) return c.json({ error: 'not_found' }, 404);
  return c.json({ status: card.status }, 200);
});

// ------------------------------------------------------------------ images

pageRoutes.get('/c/:token/:file', async (c) => {
  const token = c.req.param('token');
  const file = c.req.param('file');
  const m = IMAGE_FILE_RE.exec(file);
  const lang = m?.[1];
  const size = m?.[2];
  if (!TOKEN_RE.test(token) || !isLang(lang) || !isSize(size)) return c.text('Not found', 404);

  const card = await getCardByToken(c.env.DB, token);
  if (!card || card.status === 'expired') return c.text('Not found', 404);

  const download = c.req.query('download') === '1';

  const obj = await c.env.BUCKET.get(imageKey(token, lang, size));
  if (!obj) return c.text('Not found', 404);

  // Plain image URLs are versioned (`?v=`, src/storage.ts) and cacheable for a year. The download variant
  // counts a download on every click, so it must never be answered from a shared cache.
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Content-Length': String(obj.size),
    'Cache-Control': download ? 'private, no-store' : IMAGE_CACHE_CONTROL,
    ETag: obj.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  });

  if (download) {
    const filename = `${safeFilename(card.company_name_en, `${lang}-${size}`)}.png`;
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    if (!card.is_test) safeMetric(c, { card_id: card.id, kind: 'download', lang, size });
  } else if (c.req.header('If-None-Match') === obj.httpEtag) {
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { status: 200, headers });
});

// ------------------------------------------------------------------ beacon

pageRoutes.post('/c/:token/m', async (c) => {
  const token = c.req.param('token');
  if (!TOKEN_RE.test(token)) return noContent();

  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > BEACON_LIMIT) return noContent();

  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return noContent();
  }
  if (text.length > BEACON_LIMIT) return noContent();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return noContent();
  }
  if (!data || typeof data !== 'object') return noContent();
  const d = data as Record<string, unknown>;

  const kind = d['kind'];
  if (!isMetricKind(kind)) return noContent();
  const langV = d['lang'];
  const sizeV = d['size'];
  const networkV = d['network'];
  const lang = isLang(langV) ? langV : null;
  const size = isSize(sizeV) ? sizeV : null;
  const network = typeof networkV === 'string' && /^[a-z]{1,20}$/.test(networkV) ? networkV : null;

  const card = await getCardByToken(c.env.DB, token);
  if (!card || card.is_test) return noContent(); // test cards are excluded from counters (ARCHITECTURE C3)

  safeMetric(c, { card_id: card.id, kind, lang, size, network });
  return noContent();
});
