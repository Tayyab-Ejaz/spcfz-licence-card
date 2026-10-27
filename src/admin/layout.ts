// Shared chrome for the staff admin: nav, brand colours, tables, forms. Server-rendered, no JavaScript.
import type { Context } from 'hono';
import type { AppEnv, CardStatus } from '../types.js';
import { html, raw } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { CSRF_FIELD, csrfToken } from './csrf.js';

/** `html` that returns RawHtml so fragments nest without double escaping. */
export function h(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  return raw(html(strings, ...values));
}

export const EMPTY = raw('');

export type NavKey = 'dashboard' | 'cards' | 'events' | 'test' | 'create' | 'import' | 'settings';

const NAV: ReadonlyArray<{ key: NavKey; href: string; label: string }> = [
  { key: 'dashboard', href: '/admin', label: 'Dashboard' },
  { key: 'cards', href: '/admin/cards', label: 'Cards' },
  { key: 'events', href: '/admin/events', label: 'Events' },
  { key: 'test', href: '/admin/test-flow', label: 'Test flow' },
  { key: 'create', href: '/admin/create', label: 'Create' },
  { key: 'import', href: '/admin/import', label: 'Import CSV' },
  { key: 'settings', href: '/admin/settings', label: 'Settings' },
];

const CSS = `
:root{--blue:#004dff;--blue2:#102ea2;--cyan:#00b2c7;--ink:#071329;--muted:#53617c;--border:#dfe7f4;--gold:#f0b429;--green:#19a567;--pink:#e84d88;--bg:#f4f7fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
a{color:var(--blue)}
header{background:var(--blue);color:#fff}
header .in{max-width:1100px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
header .brand{font-weight:800;color:#fff;text-decoration:none;margin-inline-end:8px}
header nav a{color:#dbe4ff;text-decoration:none;padding:6px 8px;border-radius:6px;font-weight:600}
header nav a.on,header nav a:hover{background:rgba(255,255,255,.14);color:#fff}
header .who{margin-inline-start:auto;color:#dbe4ff;font-size:13px}
header form.out{margin:0}
header form.out button{font:inherit;font-size:13px;font-weight:700;color:#fff;background:rgba(255,255,255,.14);border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
header form.out button:hover{background:rgba(255,255,255,.24)}
main{max-width:1100px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:0 0 14px}
h2{font-size:16px;margin:24px 0 10px}
.flash{background:#e7f7ee;border:1px solid #b9e6cb;color:#0f5a36;padding:10px 12px;border-radius:8px;margin-bottom:14px}
.error{background:#fdecec;border:1px solid #f5bcbc;color:#7a1a1a;padding:10px 12px;border-radius:8px;margin-bottom:14px}
.error ul{margin:6px 0 0;padding-inline-start:18px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 20px}
.stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:24px;color:var(--blue2)}
.stat span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
th{background:#f8faff;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:#eef2fa;color:var(--muted)}
.badge.ready{background:#e7f7ee;color:#0f5a36}
.badge.pending{background:#fff6dd;color:#7a5a00}
.badge.failed{background:#fdecec;color:#7a1a1a}
.badge.expired{background:#eceff5;color:#4a5568}
.badge.test{background:#fff1c7;color:#6b4e00}
form.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:0 0 14px}
form.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:3px}
input,select,textarea{font:inherit;padding:7px 9px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--ink);min-width:0}
textarea{width:100%;min-height:90px}
.form{display:grid;gap:12px;max-width:640px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px}
.form label{display:grid;gap:4px;font-weight:600}
.form label small{font-weight:400;color:var(--muted)}
.form .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.check,.form label.check{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600}
.btn{display:inline-block;background:var(--blue);color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--blue2)}
.btn.secondary{background:#fff;color:var(--blue2);border:1px solid var(--blue2)}
.btn.danger{background:#fff;color:#b42318;border:1px solid #b42318}
.btn.small{padding:5px 10px;font-size:13px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.actions form{display:inline}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:0}
dl.kv dt{color:var(--muted)}
dl.kv dd{margin:0;word-break:break-word}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.thumbs figure{margin:0;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px;text-align:center}
.thumbs img{max-width:100%;height:auto;display:block;margin:0 auto 4px;background:#eef2fa}
.thumbs figcaption{font-size:12px;color:var(--muted)}
pre{background:#0b1a3a;color:#e6ecff;padding:12px;border-radius:8px;overflow:auto;font-size:12px;max-height:480px}
.pager{display:flex;gap:10px;align-items:center;margin:12px 0;color:var(--muted)}
.muted{color:var(--muted)}
code{background:#eef2fa;padding:1px 5px;border-radius:4px;font-size:12px}
.outcome-create{color:#0f5a36;font-weight:700}
.outcome-update{color:#7a5a00;font-weight:700}
.outcome-unchanged{color:var(--muted)}
.outcome-rejected{color:#7a1a1a;font-weight:700}
.local{background:#fff4d6;color:#5c4300;border-bottom:1px solid #ecd9a0;padding:6px 16px;font-size:13px;text-align:center}
`;

export interface LayoutOptions {
  title: string;
  actor?: string | undefined;
  /** True when BASE_URL is localhost: a band under the header says the data is on this computer only. */
  local?: boolean | undefined;
  /** CSRF value for the Sign out form; the button shows only when set. */
  signOut?: string | undefined;
  active?: NavKey | undefined;
  /** Reload the page every this many seconds (the Test flow, while an email is sending). */
  refresh?: number | undefined;
  flash?: string | null | undefined;
  error?: string | string[] | null | undefined;
  body: RawHtml;
}

export function adminLayout(o: LayoutOptions): string {
  const errors = o.error === undefined || o.error === null ? [] : Array.isArray(o.error) ? o.error : [o.error];
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${o.title} · SPC licence cards</title>
${o.refresh ? h`<meta http-equiv="refresh" content="${String(o.refresh)}">` : EMPTY}
<style>${raw(CSS)}</style>
</head>
<body>
<header><div class="in">
<a class="brand" href="/admin">SPC licence cards</a>
<nav>${NAV.map((n) => h`<a href="${n.href}" class="${n.key === o.active ? 'on' : ''}">${n.label}</a>`)}</nav>
${o.actor ? h`<span class="who">${o.actor}</span>` : EMPTY}
${o.signOut ? h`<form class="out" method="post" action="/admin/logout">${csrfField(o.signOut)}<button type="submit">Sign out</button></form>` : EMPTY}
</div></header>
${o.local ? h`<div class="local">Local copy on this computer. Nothing here reaches licensed.spcfz.ae.</div>` : EMPTY}
<main>
<h1>${o.title}</h1>
${o.flash ? h`<div class="flash">${o.flash}</div>` : EMPTY}
${errors.length ? h`<div class="error">${errors.length === 1 ? errors[0] : h`<ul>${errors.map((e) => h`<li>${e}</li>`)}</ul>`}</div>` : EMPTY}
${o.body}
</main>
</body>
</html>`;
}

export type AdminStatus = 200 | 400 | 401 | 403 | 404 | 500 | 503;

export function adminHeaders(c: Context<AppEnv>, imgOrigin: string): void {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self' ${imgOrigin}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
}

function isLocalBase(base: string | undefined): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base ?? '').hostname);
  } catch {
    return false;
  }
}

export function respond(c: Context<AppEnv>, o: Omit<LayoutOptions, 'actor' | 'local' | 'signOut'>, status: AdminStatus = 200): Response | Promise<Response> {
  const actor = c.get('actor');
  return c.html(adminLayout({ ...o, actor, local: isLocalBase(c.env.BASE_URL), signOut: actor ? csrfToken(c) : undefined }), status);
}

// ------------------------------------------------------------------ fragments

export function csrfField(token: string): RawHtml {
  return h`<input type="hidden" name="${CSRF_FIELD}" value="${token}">`;
}

export function badge(status: CardStatus): RawHtml {
  return h`<span class="badge ${status}">${status}</span>`;
}

export function testBadge(isTest: boolean): RawHtml {
  return isTest ? h`<span class="badge test">test</span>` : h`<span class="muted">—</span>`;
}

const DT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO timestamp as "15 Oct 2026, 14:05" in Asia/Dubai; dashes for null. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DT.format(d);
}

export function table(headers: string[], rows: RawHtml[][], emptyText = 'Nothing here.'): RawHtml {
  if (!rows.length) return h`<p class="muted">${emptyText}</p>`;
  return h`<table><thead><tr>${headers.map((x) => h`<th>${x}</th>`)}</tr></thead><tbody>${rows.map(
    (r) => h`<tr>${r.map((cell) => h`<td>${cell}</td>`)}</tr>`,
  )}</tbody></table>`;
}

export function kv(pairs: Array<[string, RawHtml | string | number | null | undefined]>): RawHtml {
  return h`<dl class="kv">${pairs.map(
    ([k, v]) => h`<dt>${k}</dt><dd>${v === null || v === undefined || v === '' ? h`<span class="muted">—</span>` : v}</dd>`,
  )}</dl>`;
}

/** Previous/next links that keep the current filters. `query` must not contain `page`. */
export function pager(path: string, query: Record<string, string>, page: number, total: number, perPage: number): RawHtml {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const link = (p: number, label: string): RawHtml => {
    const qs = new URLSearchParams(query);
    qs.set('page', String(p));
    return h`<a href="${path}?${qs.toString()}">${label}</a>`;
  };
  return h`<div class="pager">
<span>${total} total · page ${page} of ${pages}</span>
${page > 1 ? link(page - 1, '← Previous') : EMPTY}
${page < pages ? link(page + 1, 'Next →') : EMPTY}
</div>`;
}

/** A one-button POST form for an action, with the CSRF field. */
export function actionForm(action: string, label: string, token: string, cls = 'btn small'): RawHtml {
  return h`<form method="post" action="${action}">${csrfField(token)}<button type="submit" class="${cls}">${label}</button></form>`;
}
