// HTML for the personal page. Everything goes through the `html` tag; nested fragments are RawHtml via `h`.
// No style attributes anywhere: the CSP allows only the nonced <style> block.
import type { CardRow, Env, Lang, Size } from '../types.js';
import { SIZE_NAMES, SIZES } from '../types.js';
import { html, raw, safeFilename } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { formatMonthYear } from '../util/time.js';
import { SHARE_LINK, imagePath, imageUrl, imageVersion, pageUrl } from '../storage.js';
import { CONTACT_URL, STRINGS, WHATSAPP_URL, fill } from './strings.js';

/** `html` that returns RawHtml so fragments nest without double escaping. */
function h(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  return raw(html(strings, ...values));
}

const GTM_ID_RE = /^GTM-[A-Z0-9]{4,12}$/;

/** The company name shown for a language: Arabic falls back to English (ARCHITECTURE D5). */
export function displayName(card: Pick<CardRow, 'company_name_en' | 'company_name_ar'>, lang: Lang): string {
  if (lang === 'ar' && card.company_name_ar && card.company_name_ar.trim()) return card.company_name_ar.trim();
  return card.company_name_en;
}

/** Caption template with `{company}` and `{link}` filled in. */
export function buildCaption(template: string, company: string): string {
  return fill(template, { company, link: SHARE_LINK });
}

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

export interface ReadyPageInput {
  env: Pick<Env, 'BASE_URL'>;
  card: CardRow;
  lang: Lang;
  size: Size;
  nonce: string;
  caption: string;
  gtmContainer: string | null;
}

export function renderReadyPage(i: ReadyPageInput): string {
  const s = STRINGS[i.lang];
  const { card, lang, size } = i;
  const company = displayName(card, lang);
  const base = `/c/${card.token}/`;
  const url = pageUrl(i.env, card.token);
  const ogImage = imageUrl(i.env, card, lang, 'landscape');
  const ogTitle = fill(s.ogTitle, { company });
  const ogDesc = fill(s.ogDescription, { company });
  const enc = encodeURIComponent;
  const whatsappText = `${i.caption}\n${url}`;

  const head = h`
<meta property="og:type" content="website">
<meta property="og:site_name" content="SPC Free Zone">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="${SIZES.landscape.width}">
<meta property="og:image:height" content="${SIZES.landscape.height}">
<meta property="og:locale" content="${lang === 'ar' ? 'ar_AE' : 'en_GB'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${ogImage}">`;

  const sizeButtons = SIZE_NAMES.map(
    (sz) => h`<button type="button" class="${sz === size ? 'on' : ''}" data-size="${sz}" data-file="${safeFilename(card.company_name_en, `${lang}-${sz}`)}.png" aria-pressed="${sz === size ? 'true' : 'false'}">${s.sizes[sz]}<small>${SIZES[sz].width}×${SIZES[sz].height}</small></button>`,
  );

  const body = h`
<div class="hero" data-base="${base}" data-token="${card.token}" data-lang="${lang}" data-size="${size}" data-v="${imageVersion(card)}" id="hero">
<h1>${s.headline}</h1>
<p class="lead">${fill(s.intro, { company })}</p>
<figure class="card">
${card.is_test ? h`<div class="ribbon" aria-label="${s.testRibbon}">${s.testRibbon}</div>` : raw('')}
<img id="card-img" src="${imagePath(card, lang, size)}" alt="${fill(s.imageAlt, { company })}" width="${SIZES[size].width}" height="${SIZES[size].height}">
</figure>
${card.is_test ? h`<p class="test-note">${s.testNote}</p>` : raw('')}
<div class="sizes" role="group" aria-label="${s.chooseSize}">${sizeButtons}</div>
<a id="download" class="btn btn-primary" href="${base}${lang}-${size}.png?download=1" download="${safeFilename(card.company_name_en, `${lang}-${size}`)}.png">${s.download}</a>
<h2>${s.shareHeading}</h2>
<div class="share">
<a href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}" target="_blank" rel="noopener" data-network="linkedin">LinkedIn</a>
<a href="https://twitter.com/intent/tweet?text=${enc(i.caption)}&amp;url=${enc(url)}" target="_blank" rel="noopener" data-network="x">X</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener" data-network="facebook">Facebook</a>
<a href="https://wa.me/?text=${enc(whatsappText)}" target="_blank" rel="noopener" data-network="whatsapp">WhatsApp</a>
</div>
<p class="hint">${s.shareHint}</p>
<p class="hint"><strong>Instagram:</strong> ${s.instagramHint}</p>
<h2>${s.captionHeading}</h2>
<textarea id="caption" readonly rows="4" aria-label="${s.captionHeading}">${i.caption}</textarea>
<button type="button" id="copy" class="btn btn-ghost" data-label="${s.copyCaption}" data-done="${s.copied}" data-fail="${s.copyFailed}">${s.copyCaption}</button>
<section class="details">
<dl>
<dt>${s.licenceNumber}</dt><dd dir="ltr">${card.licence_number}</dd>
${card.licence_type ? h`<dt>${s.licenceType}</dt><dd>${card.licence_type}</dd>` : raw('')}
${card.activity_category ? h`<dt>${s.activity}</dt><dd>${card.activity_category}</dd>` : raw('')}
<dt>${s.issuedOn}</dt><dd>${formatMonthYear(card.issued_on, lang)}</dd>
</dl>
</section>
</div>`;

  const script = h`<script nonce="${i.nonce}">${raw(READY_JS)}</script>`;

  return shell({
    lang,
    nonce: i.nonce,
    title: ogTitle,
    head,
    body,
    script,
    gtmContainer: i.gtmContainer,
    isTest: card.is_test,
    langToggleHref: `?lang=${s.otherLang}&size=${size}`,
  });
}

// Reads everything it needs from data- attributes; no user data is ever interpolated into this script.
const READY_JS = `(function(){
var hero=document.getElementById('hero');if(!hero)return;
var base=hero.getAttribute('data-base')||'';var lang=hero.getAttribute('data-lang')||'en';var v=hero.getAttribute('data-v')||'';
var img=document.getElementById('card-img');var dl=document.getElementById('download');
function beacon(kind,extra){try{var p={kind:kind,lang:lang,size:hero.getAttribute('data-size')};if(extra){for(var k in extra){p[k]=extra[k];}}
var body=JSON.stringify(p);if(navigator.sendBeacon){navigator.sendBeacon(base+'m',new Blob([body],{type:'application/json'}));}
else{fetch(base+'m',{method:'POST',body:body,headers:{'content-type':'application/json'},keepalive:true});}}catch(e){}}
var picks=Array.prototype.slice.call(document.querySelectorAll('.sizes [data-size]'));
picks.forEach(function(b){b.addEventListener('click',function(){var s=b.getAttribute('data-size');if(!s)return;
picks.forEach(function(x){var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on?'true':'false');});
if(img){img.src=base+lang+'-'+s+'.png?v='+v;}
if(dl){dl.href=base+lang+'-'+s+'.png?download=1';dl.setAttribute('download',b.getAttribute('data-file')||'');}
hero.setAttribute('data-size',s);
Array.prototype.forEach.call(document.querySelectorAll('a[data-lang]'),function(a){a.href='?lang='+a.getAttribute('data-lang')+'&size='+s;});
try{var u=new URL(location.href);u.searchParams.set('size',s);history.replaceState(null,'',u.toString());}catch(e){}});});
Array.prototype.forEach.call(document.querySelectorAll('a[data-network]'),function(a){a.addEventListener('click',function(){beacon('share',{network:a.getAttribute('data-network')});});});
var copy=document.getElementById('copy');var ta=document.getElementById('caption');
if(copy&&ta){copy.addEventListener('click',function(){
function done(ok){copy.textContent=copy.getAttribute(ok?'data-done':'data-fail');setTimeout(function(){copy.textContent=copy.getAttribute('data-label');},2000);}
function fallback(){try{ta.focus();ta.select();done(document.execCommand('copy'));}catch(e){done(false);}}
beacon('caption');
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ta.value).then(function(){done(true);},fallback);}else{fallback();}});}
})();`;

const PENDING_JS = `(function(){
var hero=document.getElementById('hero');if(!hero)return;var base=hero.getAttribute('data-base')||'';var n=0;
function tick(){n++;fetch(base+'status',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){
if(j&&j.status==='ready'){location.reload();}else{setTimeout(tick,n<40?3000:10000);}}).catch(function(){setTimeout(tick,10000);});}
setTimeout(tick,3000);})();`;

export interface PendingPageInput {
  card: CardRow;
  lang: Lang;
  nonce: string;
  failed: boolean;
  gtmContainer: string | null;
}

/** Shown for `pending` and `failed`: never an error code, just "preparing" (ARCHITECTURE section 7). */
export function renderPendingPage(i: PendingPageInput): string {
  const s = STRINGS[i.lang];
  const company = displayName(i.card, i.lang);
  const body = h`
<div class="state" id="hero" data-base="/c/${i.card.token}/" data-token="${i.card.token}" data-lang="${i.lang}">
<div class="spinner" aria-hidden="true"></div>
<h1>${s.preparingTitle}</h1>
<p class="lead">${company}</p>
<p>${s.preparingBody}</p>
${i.failed ? h`<p class="quiet">${s.takingLonger} <a href="${WHATSAPP_URL}" rel="noopener" target="_blank">${s.whatsappUs}</a></p>` : raw('')}
${i.card.is_test ? h`<p class="test-note">${s.testNote}</p>` : raw('')}
</div>`;
  return shell({
    lang: i.lang,
    nonce: i.nonce,
    title: `${s.preparingTitle} · ${s.siteName}`,
    body,
    script: h`<script nonce="${i.nonce}">${raw(PENDING_JS)}</script>`,
    gtmContainer: i.gtmContainer,
    isTest: i.card.is_test,
    langToggleHref: `?lang=${s.otherLang}`,
  });
}

export function renderExpiredPage(lang: Lang, nonce: string): string {
  const s = STRINGS[lang];
  const body = h`
<div class="state">
<h1>${s.expiredTitle}</h1>
<p>${s.expiredBody}</p>
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
