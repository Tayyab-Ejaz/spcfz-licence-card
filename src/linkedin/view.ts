// The pages of "Post to LinkedIn": review (the post exactly as it will appear, caption editable), posted, and
// the problem page. Server-rendered, English and Arabic, one nonced <style> and <script>; no style attributes.
import type { Lang } from '../types.js';
import { html, raw } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { MAX_COMMENTARY } from './client.js';
import { LOGO_URL } from '../page/strings.js';

function h(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  return raw(html(strings, ...values));
}

// LinkedIn's mark (Simple Icons, CC0), as LinkedIn's brand guidelines allow on a "post to LinkedIn" control.
const IN_MARK = h`<svg class="in" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>`;

export const LI_STRINGS = {
  en: {
    dir: 'ltr',
    pill: 'Post to LinkedIn',
    stepSignIn: 'Sign in',
    stepReview: 'Review',
    stepPosted: 'Posted',
    reviewTitle: 'Review your post',
    reviewLead: 'This is how it will appear on your LinkedIn. Edit the text if you like, then post.',
    audience: 'Anyone on or off LinkedIn',
    captionLabel: 'Post text',
    linksNote: '@SPC Free Zone and the hashtags become links on LinkedIn.',
    imageAlt: '{company} is officially licensed with SPC Free Zone',
    postNow: 'Post now',
    posting: 'Posting…',
    backToCard: 'Back to my card',
    fine: 'Nothing is posted until you press Post now, and it is posted once. SPC Free Zone does not keep access to your LinkedIn account.',
    tooLong: 'LinkedIn allows up to 3,000 characters. Please shorten the text.',
    postedTitle: 'Your announcement is live',
    postedLead: '{company} is now on your LinkedIn feed.',
    viewPost: 'View your post on LinkedIn',
    postedTip: 'Tip: tag your co-founders and team in a comment, so it reaches their networks too.',
    problemTitle: 'Your post was not published',
    tryAgain: 'Try again',
    signInAgain: 'Sign in to LinkedIn again',
    expiredTitle: 'This post has timed out',
    expiredBody: 'For your security, a post waits 15 minutes. Start again from your card; it takes a moment.',
    openCard: 'Open my card',
    portal: 'Go to the customer portal',
    cancelledTitle: 'Nothing was posted',
    cancelledBody: 'You did not connect LinkedIn, so nothing was shared. You can still download your card and post it yourself.',
    errAuth: 'Your LinkedIn sign-in has expired. Sign in again to post.',
    errDenied: 'LinkedIn did not allow this post from your account. Download your card and post it from LinkedIn instead.',
    errRate: 'LinkedIn is busy right now. Wait a minute and try again.',
    errRejected: 'LinkedIn did not accept the post. Shorten or change the text, then try again.',
    errUpstream: 'We could not reach LinkedIn. Try again in a moment.',
    errImage: 'Your card picture could not be prepared. Go back to your card and try again.',
    title: 'Post to LinkedIn · SPC Free Zone',
  },
  ar: {
    dir: 'rtl',
    pill: 'النشر على لينكدإن',
    stepSignIn: 'تسجيل الدخول',
    stepReview: 'المراجعة',
    stepPosted: 'تم النشر',
    reviewTitle: 'راجع منشورك',
    reviewLead: 'هكذا سيظهر منشورك على لينكدإن. عدّل النص إن أردت، ثم انشره.',
    audience: 'أي شخص على لينكدإن أو خارجه',
    captionLabel: 'نص المنشور',
    linksNote: 'يصبح ‎@SPC Free Zone‎ والوسوم روابط على لينكدإن.',
    imageAlt: '{company} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر',
    postNow: 'انشر الآن',
    posting: 'جارٍ النشر…',
    backToCard: 'العودة إلى بطاقتي',
    fine: 'لا يُنشر شيء قبل أن تضغط «انشر الآن»، ويُنشر مرة واحدة فقط. لا تحتفظ المنطقة الحرة بأي صلاحية على حسابك في لينكدإن.',
    tooLong: 'يسمح لينكدإن بـ 3,000 حرف كحد أقصى. يرجى اختصار النص.',
    postedTitle: 'إعلانك منشور الآن',
    postedLead: '{company} الآن على صفحتك في لينكدإن.',
    viewPost: 'شاهد منشورك على لينكدإن',
    postedTip: 'نصيحة: أشِر إلى شركائك وفريقك في تعليق، ليصل المنشور إلى شبكاتهم أيضاً.',
    problemTitle: 'لم يُنشر منشورك',
    tryAgain: 'حاول مرة أخرى',
    signInAgain: 'سجّل الدخول إلى لينكدإن مجدداً',
    expiredTitle: 'انتهت مهلة هذا المنشور',
    expiredBody: 'حفاظاً على أمانك، ينتظر المنشور 15 دقيقة فقط. ابدأ من جديد من بطاقتك؛ لن يستغرق ذلك سوى لحظة.',
    openCard: 'افتح بطاقتي',
    portal: 'انتقل إلى بوابة العملاء',
    cancelledTitle: 'لم يُنشر شيء',
    cancelledBody: 'لم تربط حساب لينكدإن، لذلك لم يُشارك شيء. لا يزال بإمكانك تنزيل بطاقتك ونشرها بنفسك.',
    errAuth: 'انتهت صلاحية تسجيل دخولك إلى لينكدإن. سجّل الدخول مجدداً للنشر.',
    errDenied: 'لم يسمح لينكدإن بهذا المنشور من حسابك. نزّل بطاقتك وانشرها من لينكدإن مباشرة.',
    errRate: 'لينكدإن مشغول حالياً. انتظر دقيقة ثم حاول مرة أخرى.',
    errRejected: 'لم يقبل لينكدإن المنشور. اختصر النص أو غيّره، ثم حاول مرة أخرى.',
    errUpstream: 'تعذّر الوصول إلى لينكدإن. حاول مرة أخرى بعد قليل.',
    errImage: 'تعذّر تجهيز صورة بطاقتك. عد إلى بطاقتك وحاول مرة أخرى.',
    title: 'النشر على لينكدإن · المنطقة الحرة لمدينة الشارقة للنشر',
  },
} as const;

export type LiStrings = (typeof LI_STRINGS)[Lang];

const CSS = `
:root{--blue:#004dff;--blue2:#003fd1;--ink:#071329;--muted:#53617c;--line:#dfe7f4;--soft:#eef3ff;--bg:#f4f7fc;--li:#0a66c2;--ok:#0f9d58;--warn:#b42318}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 500px at 50% -180px,#dfe8ff 0,rgba(223,232,255,0) 70%),var(--bg);color:var(--ink);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Kufi Arabic","Noto Sans Arabic",Tahoma,Arial,sans-serif;-webkit-font-smoothing:antialiased}
[dir=rtl] body,[dir=rtl] textarea{font-family:"Noto Kufi Arabic","Noto Sans Arabic",Tahoma,Inter,-apple-system,sans-serif}
a{color:var(--blue)}
.top{max-width:640px;margin:0 auto;padding:18px 16px 6px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.top img{height:40px;width:auto;display:block}
.pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px 6px 9px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:13px;font-weight:700;color:var(--li);white-space:nowrap}
.in{width:16px;height:16px;flex:none}
main{max-width:640px;margin:0 auto;padding:10px 16px 40px}
.steps{display:flex;align-items:center;gap:8px;margin:10px 0 18px;font-size:12.5px;font-weight:600;color:var(--muted);list-style:none;padding:0}
.steps li{display:flex;align-items:center;gap:6px}
.steps li+li::before{content:"";width:22px;height:1.5px;background:var(--line);margin-inline-end:2px}
.steps b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#fff;border:1.5px solid var(--line);font-size:11px;color:var(--muted)}
.steps .done b{background:var(--blue);border-color:var(--blue);color:#fff}
.steps .now{color:var(--ink)}
.steps .now b{border-color:var(--blue);color:var(--blue)}
h1{font-size:clamp(24px,6vw,32px);line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}
[dir=rtl] h1{letter-spacing:0;line-height:1.35}
.lead{margin:0 0 20px;color:var(--muted)}
.post{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgba(7,19,41,.04),0 18px 40px -18px rgba(7,19,41,.18);overflow:hidden}
.who{display:flex;align-items:center;gap:12px;padding:16px 16px 6px}
.avatar{width:48px;height:48px;border-radius:50%;flex:none;object-fit:cover;background:var(--soft);display:grid;place-items:center;font-weight:800;color:var(--blue);font-size:17px}
.who b{display:block;font-size:15px;line-height:1.25}
.who .aud{display:flex;align-items:center;gap:5px;font-size:12.5px;color:var(--muted)}
.globe{width:13px;height:13px}
label.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
textarea{display:block;width:100%;min-height:150px;border:0;padding:8px 16px 4px;font:inherit;font-size:15px;line-height:1.55;color:var(--ink);background:transparent;resize:none;outline:none}
.compose{position:relative;margin:0 8px;border-radius:12px;transition:box-shadow .15s}
.compose:focus-within{box-shadow:0 0 0 2px var(--blue)}
.meta{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 16px 12px;font-size:12px;color:var(--muted)}
.count{font-variant-numeric:tabular-nums;white-space:nowrap}
.count.over{color:var(--warn);font-weight:700}
.media{display:block;width:100%;height:auto;background:var(--soft);border-top:1px solid var(--line)}
.bar{display:flex;gap:10px;padding:14px 16px;border-top:1px solid var(--line);background:#fbfcff}
.btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:50px;padding:0 20px;border-radius:12px;font:inherit;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer;border:0;transition:background .15s,transform .1s,box-shadow .15s;-webkit-tap-highlight-color:transparent}
.btn:active{transform:translateY(1px)}
.primary{flex:1;background:var(--blue);color:#fff;box-shadow:0 6px 16px -6px rgba(0,77,255,.6)}
.primary:hover{background:var(--blue2)}
.primary[disabled]{opacity:.7;cursor:progress}
.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
.ghost:hover{border-color:#bfcbe3}
.spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;animation:spin .8s linear infinite;display:none}
.busy .spin{display:block}
@keyframes spin{to{transform:rotate(360deg)}}
.alert{display:flex;gap:10px;align-items:flex-start;margin:0 0 16px;padding:12px 14px;border-radius:12px;background:#fef3f2;border:1px solid #fecdca;color:#7a271a;font-size:14px}
.alert svg{width:18px;height:18px;flex:none;margin-top:2px}
.fine{margin:16px 4px 0;font-size:12.5px;color:var(--muted);display:flex;gap:8px;align-items:flex-start}
.fine svg{width:15px;height:15px;flex:none;margin-top:2px;color:var(--ok)}
.state{background:#fff;border:1px solid var(--line);border-radius:18px;padding:32px 22px 26px;text-align:center;box-shadow:0 18px 40px -18px rgba(7,19,41,.18)}
.state .lead{margin:0 auto 22px;max-width:420px}
.state .stack{display:flex;flex-direction:column;gap:10px;max-width:360px;margin:0 auto}
.state .btn{width:100%}
.tick{width:72px;height:72px;margin:0 auto 18px;border-radius:50%;background:#e8f7ef;display:grid;place-items:center}
.tick svg{width:38px;height:38px}
.tick path{stroke:var(--ok);stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;animation:draw .5s .15s ease-out forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.mark{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:var(--soft);display:grid;place-items:center;color:var(--blue)}
.mark svg{width:30px;height:30px}
.thumb{display:block;width:min(260px,70%);height:auto;margin:0 auto 22px;border-radius:12px;border:1px solid var(--line);box-shadow:0 12px 28px -14px rgba(7,19,41,.35);transform:rotate(-2deg)}
.tip{margin:20px auto 0;max-width:420px;font-size:13px;color:var(--muted)}
footer{max-width:640px;margin:0 auto;padding:0 16px 28px;font-size:12px;color:var(--muted);text-align:center}
footer a{color:var(--muted)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.tick path{stroke-dashoffset:0}}
@media (max-width:420px){.bar{flex-direction:column-reverse}.bar .btn{width:100%}}
`;

const SHIELD = h`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3z"/></svg>`;
const WARN = h`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
const GLOBE = h`<svg class="globe" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.3a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zM16.4 14a16.5 16.5 0 0 0 0-4h3.3a8.2 8.2 0 0 1 0 4h-3.3z"/></svg>`;

interface Page {
  lang: Lang;
  nonce: string;
  body: RawHtml;
  script?: string;
}

function page(p: Page): string {
  const s = LI_STRINGS[p.lang];
  return html`<!doctype html>
<html lang="${p.lang}" dir="${s.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#f4f7fc">
<title>${s.title}</title>
<style nonce="${p.nonce}">${raw(CSS)}</style>
</head>
<body>
<header class="top"><a href="https://www.spcfz.ae/"><img src="${LOGO_URL}" alt="SPC Free Zone" width="98" height="40"></a><span class="pill">${IN_MARK}${s.pill}</span></header>
<main>
${p.body}
</main>
<footer>SPC Free Zone · <a href="https://www.spcfz.ae/">spcfz.ae</a></footer>
${p.script ? h`<script nonce="${p.nonce}">${raw(p.script)}</script>` : ''}
</body>
</html>`;
}

function steps(s: LiStrings, at: 1 | 2 | 3): RawHtml {
  const item = (n: 1 | 2 | 3, label: string): RawHtml =>
    h`<li class="${n < at || at === 3 ? 'done' : n === at ? 'now' : ''}"><b>${n < at || at === 3 ? '✓' : String(n)}</b>${label}</li>`;
  return h`<ol class="steps" aria-label="Progress">${item(1, s.stepSignIn)}${item(2, s.stepReview)}${item(3, s.stepPosted)}</ol>`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'in';
}

export interface ReviewInput {
  lang: Lang;
  nonce: string;
  name: string;
  picture: string | null;
  company: string;
  caption: string;
  formKey: string;
  imageUrl: string;
  cardUrl: string;
  error?: string | null;
  /** The error means signing in again (the token expired or was refused). */
  signInAgain?: boolean;
}

// Counts characters the way LinkedIn does (UTF-16 code units, as maxlength does), grows the box with its text,
// and turns Post now into "Posting…" on the first press so a double tap cannot post twice.
const REVIEW_JS = `(function(){var t=document.getElementById('caption'),c=document.getElementById('count'),f=document.getElementById('post'),b=document.getElementById('go'),max=${MAX_COMMENTARY};
function grow(){t.style.height='auto';t.style.height=Math.max(150,t.scrollHeight+4)+'px'}
function count(){var n=t.value.length;c.textContent=n.toLocaleString()+' / '+max.toLocaleString();c.classList.toggle('over',n>max);b.disabled=n>max}
t.addEventListener('input',function(){grow();count()});grow();count();
f.addEventListener('submit',function(e){if(f.dataset.sent){e.preventDefault();return}f.dataset.sent='1';b.classList.add('busy');b.disabled=true;b.querySelector('span').textContent=b.dataset.busy})})();`;

export function renderReviewPage(i: ReviewInput): string {
  const s = LI_STRINGS[i.lang];
  const alt = s.imageAlt.replace('{company}', i.company);
  const avatar = i.picture
    ? h`<img class="avatar" src="${i.picture}" alt="" width="48" height="48" referrerpolicy="no-referrer">`
    : h`<span class="avatar" aria-hidden="true">${initials(i.name)}</span>`;
  const body = h`
${steps(s, 2)}
<h1>${s.reviewTitle}</h1>
<p class="lead">${s.reviewLead}</p>
${i.error ? h`<div class="alert" role="alert">${WARN}<div>${i.error}${i.signInAgain ? h` <a href="/linkedin/again">${s.signInAgain}</a>` : ''}</div></div>` : ''}
<form class="post" id="post" method="post" action="/linkedin/publish">
<div class="who">${avatar}<div><b>${i.name}</b><span class="aud">${GLOBE}${s.audience}</span></div></div>
<div class="compose"><label class="sr" for="caption">${s.captionLabel}</label><textarea id="caption" name="caption" dir="auto" maxlength="${MAX_COMMENTARY}" spellcheck="true">${i.caption}</textarea></div>
<div class="meta"><span>${s.linksNote}</span><span class="count" id="count" dir="ltr" aria-live="polite"></span></div>
<img class="media" src="${i.imageUrl}" alt="${alt}">
<input type="hidden" name="k" value="${i.formKey}">
<div class="bar"><a class="btn ghost" href="${i.cardUrl}">${s.backToCard}</a><button class="btn primary" id="go" type="submit" data-busy="${s.posting}">${IN_MARK}<span>${s.postNow}</span><i class="spin" aria-hidden="true"></i></button></div>
</form>
<p class="fine">${SHIELD}<span>${s.fine}</span></p>`;
  return page({ lang: i.lang, nonce: i.nonce, body, script: REVIEW_JS });
}

export interface PostedInput {
  lang: Lang;
  nonce: string;
  company: string;
  postUrl: string;
  imageUrl: string | null;
  cardUrl: string;
}

export function renderPostedPage(i: PostedInput): string {
  const s = LI_STRINGS[i.lang];
  const body = h`
${steps(s, 3)}
<div class="state">
<div class="tick" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M11 21l6 6 12-13"/></svg></div>
<h1>${s.postedTitle}</h1>
<p class="lead">${s.postedLead.replace('{company}', i.company)}</p>
${i.imageUrl ? h`<img class="thumb" src="${i.imageUrl}" alt="">` : ''}
<div class="stack">
<a class="btn primary" href="${i.postUrl}" target="_blank" rel="noopener">${IN_MARK}<span>${s.viewPost}</span></a>
<a class="btn ghost" href="${i.cardUrl}">${s.backToCard}</a>
</div>
<p class="tip">${s.postedTip}</p>
</div>`;
  return page({ lang: i.lang, nonce: i.nonce, body });
}

export interface ProblemInput {
  lang: Lang;
  nonce: string;
  title: string;
  message: string;
  primary: { href: string; label: string } | null;
  secondary?: { href: string; label: string } | null;
}

export function renderProblemPage(i: ProblemInput): string {
  const body = h`
<div class="state">
<div class="mark" aria-hidden="true">${IN_MARK}</div>
<h1>${i.title}</h1>
<p class="lead">${i.message}</p>
<div class="stack">
${i.primary ? h`<a class="btn primary" href="${i.primary.href}">${i.primary.label}</a>` : ''}
${i.secondary ? h`<a class="btn ghost" href="${i.secondary.href}">${i.secondary.label}</a>` : ''}
</div>
</div>`;
  return page({ lang: i.lang, nonce: i.nonce, body });
}

/** Images the LinkedIn pages load: ours, and the member's photo from LinkedIn's media host. */
export function linkedinCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "img-src 'self' https://media.licdn.com",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
