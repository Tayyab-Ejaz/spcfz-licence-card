// Personal page: the studio shell and the counter beacon (ARCHITECTURE section 7).
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv, Lang, MetricKind } from '../types.js';
import { isLang, isSize } from '../types.js';
import { bumpMetric, getCardByToken, getSettings } from '../db/cards.js';
import type { MetricKey } from '../db/cards.js';
import { background } from '../util/background.js';
import { TOKEN_RE, bytesToBase64 } from '../util/crypto.js';
import { isPast, todayInDubai } from '../util/time.js';
import { renderExpiredPage, renderNotFoundPage } from './view.js';
import { renderStudioShell, studioCsp } from './studio.js';

const GTM_ID_RE = /^GTM-[A-Z0-9]{4,12}$/;
const BEACON_LIMIT = 1024;


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

function pageHeaders(c: Context<AppEnv>, nonce: string, gtm: boolean, studio = false): void {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Content-Security-Policy', studio ? studioCsp(nonce, gtm) : buildCsp(nonce, gtm));
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

  // Expired when its licence has (from the moment the date passes, before the nightly run marks it), or by hand.
  if (card.status === 'expired' || isPast(card.expires_at)) {
    pageHeaders(c, nonce, false);
    const company = lang === 'ar' ? card.company_name_ar || card.company_name_en : card.company_name_en;
    return c.html(renderExpiredPage(lang, nonce, { company, licence: card.licence_number, expiredOn: card.licence_expires_on }), 410);
  }

  const settings = await getSettings(c.env.DB);
  const container = (c.env.GTM_CONTAINER ?? '').trim();
  const gtmContainer = settings['gtm_enabled'] === '1' && GTM_ID_RE.test(container) ? container : null;
  pageHeaders(c, nonce, gtmContainer !== null, true);

  // The studio builds the card in the browser, so it never waits for the server-side render.
  if (!card.is_test) safeMetric(c, { card_id: card.id, kind: 'view', lang });
  return c.html(renderStudioShell({ card, lang, nonce, gtmContainer, baseUrl: c.env.BASE_URL }), 200);
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
