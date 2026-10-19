// The customer studio: the page shell for /c/<token> and the static files built by tools/build-studio.mjs.
// The studio itself is a client-side app (client/), built from the approved design; the server only hands
// it the licence data and serves its files.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { AppEnv, CardRow, Lang } from '../types.js';
import { formatFullDate } from '../util/time.js';
import { html, raw } from '../util/html.js';

/** public/studio, resolved from this file so it works from src/ (tests, tsx) and dist/ alike. */
export const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/studio');

export interface StudioManifest { js: string; css: string; og: string }
const FALLBACK: StudioManifest = { js: '/static/studio/app.js', css: '/static/studio/studio.css', og: '/static/studio/og.jpg' };

let cached: StudioManifest | null = null;
/** The hashed bundle names. Falls back to fixed names when the studio has not been built (unit tests). */
export function studioManifest(): StudioManifest {
  if (cached) return cached;
  const file = path.join(STUDIO_DIR, 'manifest.json');
  if (!existsSync(file)) return FALLBACK;
  const m = JSON.parse(readFileSync(file, 'utf8')) as Partial<StudioManifest>;
  cached = { js: m.js ?? FALLBACK.js, css: m.css ?? FALLBACK.css, og: m.og ?? FALLBACK.og };
  return cached;
}

/** What the client reads from <script id="card-data">. Only what the card shows. */
export interface StudioCardData {
  token: string;
  company_en: string;
  company_ar: string | null;
  licence_number: string;
  issued_on: string;
  activity_en: string | null;
  activity_ar: string | null;
  /** The founder's name from the ERP, pre-filled on the card. */
  name_en: string | null;
  name_ar: string | null;
  lang: 'en' | 'ar';
  is_test: boolean;
}

/** `lang` is the card language the studio opens with: ?lang= when given, else the customer's preference. */
export function cardData(card: CardRow, lang: Lang = card.preferred_language): StudioCardData {
  return {
    token: card.token,
    company_en: card.company_name_en,
    company_ar: card.company_name_ar,
    licence_number: card.licence_number,
    issued_on: card.issued_on,
    activity_en: card.activity_category,
    activity_ar: card.activity_category_ar,
    name_en: card.founder_name_en,
    name_ar: card.founder_name_ar,
    lang,
    is_test: card.is_test,
  };
}

/** JSON safe inside <script type="application/json">: no "</script>", no HTML comment openers, no U+2028/9. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface ShellInput {
  card: CardRow;
  /** Card language to open with; defaults to the customer's preference. */
  lang?: Lang;
  nonce: string;
  gtmContainer: string | null;
  /** The service's public address, for the absolute URLs link previews need. */
  baseUrl?: string;
  manifest?: StudioManifest;
}

/**
 * The version of the preview picture's design. Raise it whenever src/page/preview-image.ts draws differently:
 * Cloudflare and the apps cache each picture address for days, so a new design needs new addresses.
 */
export const PREVIEW_DESIGN = 2;

/** Where a card's preview picture lives: /c/<token>/preview/<first 10 of the content hash>-v<design>[-ar].jpg */
export function previewPath(card: Pick<CardRow, 'token' | 'content_hash'>, lang: Lang): string {
  return `/c/${card.token}/preview/${card.content_hash.slice(0, 10)}-v${PREVIEW_DESIGN}${lang === 'ar' ? '-ar' : ''}.jpg`;
}

/** The generic link-preview picture (design/og/licence-preview.jpg), as built into public/studio. */
export function genericPreviewFile(): string {
  return path.join(STUDIO_DIR, path.basename(studioManifest().og));
}

/**
 * Link preview (WhatsApp, LinkedIn, iMessage, Slack): the company's name in the title and, big, in the picture;
 * the issue date in the description. In the card's language.
 */
function previewTags(i: ShellInput, m: StudioManifest, lang: Lang): string {
  const c = i.card;
  const base = (i.baseUrl ?? '').replace(/\/+$/, '');
  const ar = lang === 'ar';
  const company = ar ? c.company_name_ar || c.company_name_en : c.company_name_en;
  const title = ar ? `${company} مرخّصة رسمياً` : `${company} is officially licensed`;
  const description = ar
    ? `شركة جديدة في المنطقة الحرة لمدينة الشارقة للنشر، تاريخ الإصدار ${formatFullDate(c.issued_on, 'ar')}.`
    : `A new business at SPC Free Zone, Sharjah. Licensed ${formatFullDate(c.issued_on, 'en')}.`;
  // The card's own preview (company name, big): a new address whenever the card's details change, so apps that
  // cache previews fetch the new one. src/page/routes.ts draws it; the generic image is its fallback.
  const image = `${base}${previewPath(c, lang)}`;
  const alt = ar ? 'مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر' : 'Officially licensed at SPC Free Zone';
  return html`<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SPC Free Zone">
<meta property="og:locale" content="${ar ? 'ar_AE' : 'en_GB'}">
<meta property="og:url" content="${base}/c/${c.token}${lang !== c.preferred_language ? `?lang=${lang}` : ''}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">`;
}

function gtmSnippet(id: string, nonce: string): string {
  return html`<script nonce="${nonce}">(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;var n=d.querySelector('[nonce]');if(n)j.setAttribute('nonce',n.nonce||n.getAttribute('nonce'));f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${raw(JSON.stringify(id))});</script>`;
}

export function renderStudioShell(i: ShellInput): string {
  const m = i.manifest ?? studioManifest();
  const title = `${i.card.company_name_en} is licensed · SPC Free Zone`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${i.card.is_test ? '[TEST] ' : ''}${title}</title>
${raw(previewTags(i, m, i.lang ?? i.card.preferred_language))}
<link rel="stylesheet" href="${m.css}">
${i.gtmContainer ? raw(gtmSnippet(i.gtmContainer, i.nonce)) : ''}
</head>
<body>
<div id="dc-root"></div>
<script type="application/json" id="card-data">${raw(jsonForScript(cardData(i.card, i.lang)))}</script>
<script src="${m.js}" defer></script>
</body>
</html>`;
}

export function studioCsp(nonce: string, gtm: boolean): string {
  const script = ["'self'", `'nonce-${nonce}'`];
  const connect = ["'self'"];
  // data: for uploaded photos and logos (read in the browser, never sent to us) and for the exported PNG.
  const img = ["'self'", 'data:', 'blob:'];
  if (gtm) {
    script.push('https://www.googletagmanager.com');
    connect.push('https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com');
    img.push('https://www.googletagmanager.com', 'https://*.google-analytics.com');
  }
  return [
    "default-src 'none'",
    `script-src ${script.join(' ')}`,
    "style-src 'self'",
    `img-src ${img.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "form-action 'none'",
    // 'self', not 'none': html-to-image sets a same-origin <base> while it inlines the fonts for the export.
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// ------------------------------------------------------------------ static files

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};
const SAFE_PATH = /^(?:a\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export const studioStaticRoutes = new Hono<AppEnv>();

studioStaticRoutes.get('/static/studio/*', async (c) => {
  const rel = c.req.path.slice('/static/studio/'.length);
  const ext = path.extname(rel).toLowerCase();
  if (!SAFE_PATH.test(rel) || rel.includes('..') || !(ext in TYPES) || rel === 'manifest.json') return c.text('Not found', 404);
  const file = path.join(STUDIO_DIR, rel);
  if (!file.startsWith(STUDIO_DIR + path.sep)) return c.text('Not found', 404);
  let body: Buffer;
  try {
    if (!statSync(file).isFile()) return c.text('Not found', 404);
    body = await readFile(file);
  } catch {
    return c.text('Not found', 404);
  }
  // Every file name carries a content hash (bundle, stylesheet) or is content-addressed (a/), so it never changes.
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
