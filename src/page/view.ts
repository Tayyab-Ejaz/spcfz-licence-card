// HTML for the expired and not-found pages (the card page itself is the studio, src/page/studio.ts).
// Everything goes through the `html` tag; nested fragments are RawHtml via `h`.
// No style attributes anywhere: the CSP allows only the nonced <style> block.
import type { Lang } from '../types.js';
import { html, raw } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { CONTACT_URL, PORTAL_URL, STRINGS } from './strings.js';
import { formatFullDate } from '../util/time.js';

/** `html` that returns RawHtml so fragments nest without double escaping. */
function h(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  return raw(html(strings, ...values));
}

const GTM_ID_RE = /^GTM-[A-Z0-9]{4,12}$/;

const CSS = `
:root{--blue:#004dff;--blue2:#102ea2;--cyan:#00b2c7;--ink:#071329;--muted:#53617c;--border:#dfe7f4;--gold:#f0b429;--bg:#f4f7fc}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Kufi Arabic","Noto Sans Arabic",Tahoma,Arial,sans-serif}
a{color:var(--blue)}
.top{background:#fff;border-bottom:1px solid var(--border)}
.top .in{max-width:720px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-weight:800;color:var(--blue2);text-decoration:none;font-size:16px;letter-spacing:-.01em}
.brand b{color:var(--cyan);font-weight:800}
.lang{font-size:14px;font-weight:600;text-decoration:none;border:1px solid var(--border);border-radius:999px;padding:6px 12px;color:var(--blue2);background:#fff;white-space:nowrap}
main{max-width:720px;margin:0 auto;padding:20px 16px 36px}
h1{font-size:clamp(22px,5.5vw,30px);line-height:1.2;margin:6px 0 6px;color:var(--blue2)}
.lead{margin:0 0 18px;color:var(--muted)}
.card{position:relative;background:#fff;border:1px solid var(--border);border-radius:14px;padding:12px;display:flex;justify-content:center;box-shadow:0 8px 24px rgba(7,19,41,.06);overflow:hidden}
.card img{display:block;max-width:100%;max-height:72vh;height:auto;width:auto;border-radius:8px;background:#eef2fa}
.ribbon{position:absolute;top:18px;inset-inline-start:0;background:var(--gold);color:var(--ink);font-weight:800;font-size:12px;letter-spacing:.12em;padding:5px 14px;border-start-end-radius:6px;border-end-end-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.15);z-index:1}
.test-note{margin:10px 0 0;color:#8a6500;font-size:14px}
.sizes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0 12px}
.sizes button{appearance:none;border:1px solid var(--border);background:#fff;border-radius:10px;padding:10px 4px;font:inherit;font-size:13px;color:var(--ink);cursor:pointer;line-height:1.25}
.sizes button small{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.sizes button.on{border-color:var(--blue);box-shadow:inset 0 0 0 1px var(--blue);color:var(--blue2)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:12px 18px;font-weight:700;text-decoration:none;font-size:15px;border:0;cursor:pointer;font-family:inherit}
.btn-primary{background:var(--blue);color:#fff;width:100%}
.btn-primary:hover{background:var(--blue2)}
.btn-ghost{background:#fff;border:1px solid var(--blue);color:var(--blue2);margin-top:8px}
h2{font-size:17px;margin:26px 0 10px}
.share{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
@media (min-width:480px){.share{grid-template-columns:repeat(4,1fr)}}
.share a,.share span{display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:#fff;border-radius:10px;padding:11px 8px;text-decoration:none;color:var(--ink);font-weight:600;font-size:14px}
.share span{color:var(--muted);font-weight:500}
.hint{color:var(--muted);font-size:14px;margin:8px 0 0}
textarea{width:100%;min-height:120px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;color:var(--ink);background:#fff;resize:vertical}
.details{background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:24px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14px}
dt{color:var(--muted)}
dd{margin:0;font-weight:600}
footer{color:var(--muted);font-size:13px;text-align:center;padding:0 16px 32px}
footer a{color:var(--muted)}
.state{background:#fff;border:1px solid var(--border);border-radius:14px;padding:32px 20px;text-align:center}
.state h1{margin-top:0}
.spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--blue);border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.quiet{color:var(--muted);font-size:14px;margin-top:18px}
`;

interface ShellOptions {
  lang: Lang;
  nonce: string;
  title: string;
  head?: RawHtml;
  body: RawHtml;
  script?: RawHtml;
  gtmContainer: string | null;
  isTest: boolean;
  langToggleHref: string;
}

function gtmSnippet(id: string, nonce: string): RawHtml {
  if (!GTM_ID_RE.test(id)) return raw('');
  // Standard GTM loader with the nonce copied onto the script it injects. The container id is validated above.
  const js =
    `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
    `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;` +
    `j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;j.setAttribute('nonce',${JSON.stringify(nonce)});` +
    `f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(id)});`;
  return h`<script nonce="${nonce}">${raw(js)}</script>`;
}

function shell(o: ShellOptions): string {
  const s = STRINGS[o.lang];
  const title = o.isTest ? `[TEST] ${o.title}` : o.title;
  return html`<!doctype html>
<html lang="${o.lang}" dir="${s.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#004dff">
${o.head ?? raw('')}
<style nonce="${o.nonce}">${raw(CSS)}</style>
${o.gtmContainer ? gtmSnippet(o.gtmContainer, o.nonce) : raw('')}
</head>
<body>
<header class="top"><div class="in">
<a class="brand" href="https://www.spcfz.ae/">SPC <b>Free Zone</b></a>
<a class="lang" href="${o.langToggleHref}" lang="${s.otherLang}" hreflang="${s.otherLang}" aria-label="${s.switchLanguage}" data-lang="${s.otherLang}">${s.otherLangLabel}</a>
</div></header>
<main id="app">
${o.body}
</main>
<footer>${s.footerLine} · <a href="https://www.spcfz.ae/">spcfz.ae</a></footer>
${o.script ?? raw('')}
</body>
</html>`;
}

export interface ExpiredDetails {
  company: string;
  licence: string;
  /** YYYY-MM-DD, the licence's last valid day; null when the card was expired by hand. */
  expiredOn: string | null;
}

export function renderExpiredPage(lang: Lang, nonce: string, card?: ExpiredDetails): string {
  const s = STRINGS[lang];
  const when = card?.expiredOn
    ? s.expiredOn.replace('{licence}', card.licence).replace('{date}', formatFullDate(card.expiredOn, lang))
    : null;
  const body = h`
<div class="state">
<h1>${s.expiredTitle}</h1>
${card ? h`<p><strong>${card.company}</strong></p>` : raw('')}
${when ? h`<p>${when}</p>` : raw('')}
<p>${s.expiredBody}</p>
<p><a class="btn btn-primary" href="${PORTAL_URL}">${s.renewCta}</a></p>
<p><a class="btn btn-ghost" href="${CONTACT_URL}">${s.contactUs}</a></p>
</div>`;
  return shell({
    lang,
    nonce,
    title: `${s.expiredTitle} · ${s.siteName}`,
    body,
    gtmContainer: null,
    isTest: false,
    langToggleHref: `?lang=${s.otherLang}`,
  });
}

export function renderNotFoundPage(lang: Lang, nonce: string): string {
  const s = STRINGS[lang];
  const body = h`
<div class="state">
<h1>${s.notFoundTitle}</h1>
<p>${s.notFoundBody}</p>
<p><a class="btn btn-ghost" href="${CONTACT_URL}">${s.contactUs}</a></p>
</div>`;
  return shell({
    lang,
    nonce,
    title: `${s.notFoundTitle} · ${s.siteName}`,
    body,
    gtmContainer: null,
    isTest: false,
    langToggleHref: `?lang=${s.otherLang}`,
  });
}

/** "layla.haddad@example.com" -> "la•••@example.com": enough to recognise, not to read off a forwarded link. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

export interface UnsubscribeView {
  email: string | null;
  done: boolean;
  cardUrl: string;
  /** Where the form posts (this page's own address). */
  action: string;
}

export function renderUnsubscribePage(lang: Lang, nonce: string, v: UnsubscribeView): string {
  const s = STRINGS[lang];
  const shown = v.email ? maskEmail(v.email) : '';
  const body = !v.email
    ? h`
<div class="state">
<h1>${s.unsubDoneTitle}</h1>
<p>${s.unsubNoEmail}</p>
<p><a class="btn btn-ghost" href="${v.cardUrl}">${s.openCard}</a></p>
</div>`
    : v.done
      ? h`
<div class="state">
<h1>${s.unsubDoneTitle}</h1>
<p>${s.unsubDoneBody.replace('{email}', shown)}</p>
<p><a class="btn btn-ghost" href="${v.cardUrl}">${s.openCard}</a></p>
</div>`
      : h`
<div class="state">
<h1>${s.unsubTitle}</h1>
<p>${s.unsubBody.replace('{email}', shown)}</p>
<form method="post" action="${v.action}"><button class="btn btn-primary" type="submit">${s.unsubButton}</button></form>
<p><a class="btn btn-ghost" href="${v.cardUrl}">${s.openCard}</a></p>
</div>`;
  return shell({
    lang,
    nonce,
    title: `${v.done ? s.unsubDoneTitle : s.unsubTitle} · ${s.siteName}`,
    body,
    gtmContainer: null,
    isTest: false,
    langToggleHref: `?lang=${s.otherLang}`,
  });
}

