// The customer studio: the page shell for /c/<token> and the static files built by tools/build-studio.mjs.
// The studio itself is a client-side app (client/), built from the approved design; the server only hands
// it the licence data and serves its files.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { AppEnv, CardRow } from '../types.js';
import { html, raw } from '../util/html.js';

/** public/studio, resolved from this file so it works from src/ (tests, tsx) and dist/ alike. */
export const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/studio');

export interface StudioManifest { js: string; css: string }
const FALLBACK: StudioManifest = { js: '/static/studio/app.js', css: '/static/studio/studio.css' };

let cached: StudioManifest | null = null;
/** The hashed bundle names. Falls back to fixed names when the studio has not been built (unit tests). */
export function studioManifest(): StudioManifest {
  if (cached) return cached;
  const file = path.join(STUDIO_DIR, 'manifest.json');
  if (!existsSync(file)) return FALLBACK;
  const m = JSON.parse(readFileSync(file, 'utf8')) as Partial<StudioManifest>;
  cached = { js: m.js ?? FALLBACK.js, css: m.css ?? FALLBACK.css };
  return cached;
}

/** What the client reads from <script id="card-data">. Only what the card shows; no personal data. */
export interface StudioCardData {
  token: string;
  company_en: string;
  company_ar: string | null;
  licence_number: string;
  issued_on: string;
  activity_en: string | null;
  activity_ar: string | null;
  lang: 'en' | 'ar';
  is_test: boolean;
}

export function cardData(card: CardRow): StudioCardData {
  return {
    token: card.token,
    company_en: card.company_name_en,
    company_ar: card.company_name_ar,
    licence_number: card.licence_number,
    issued_on: card.issued_on,
    activity_en: card.activity_category,
    activity_ar: card.activity_category_ar,
    lang: card.preferred_language,
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
  nonce: string;
  gtmContainer: string | null;
  manifest?: StudioManifest;
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
<meta property="og:title" content="${title}">
<meta property="og:site_name" content="SPC Free Zone">
<link rel="stylesheet" href="${m.css}">
${i.gtmContainer ? raw(gtmSnippet(i.gtmContainer, i.nonce)) : ''}
</head>
<body>
<div id="dc-root"></div>
<script type="application/json" id="card-data">${raw(jsonForScript(cardData(i.card)))}</script>
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
