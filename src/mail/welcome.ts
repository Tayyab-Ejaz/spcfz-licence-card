// The welcome email: "<Company> is officially licensed", the customer's own card (the Day One picture), a button
// to make it theirs in the studio and, when LinkedIn is set up, one to post it on LinkedIn straight away.
// Built for real inboxes: tables and inline styles, a hidden preheader, Outlook (VML) buttons, a dark-mode
// palette for clients that honour it, right-to-left Arabic, alt text on every image and a plain-text part.
import type { CardRow, Lang } from '../types.js';
import { html, raw } from '../util/html.js';
import { formatFullDate } from '../util/time.js';
import { CONTACT_URL } from '../page/strings.js';
import { cardImagePath } from '../page/studio.js';

export interface WelcomeEmail {
  subject: string;
  html: string;
  text: string;
}

export interface WelcomeInput {
  card: CardRow;
  lang: Lang;
  baseUrl: string;
  linkedin: boolean;
}

/** Exported for docs/ARABIC-STRINGS.md. */
export const COPY = {
  en: {
    subject: (co: string) => `${co} is officially licensed. Your announcement card is ready`,
    preheader: 'Make it yours in a minute, then post it on LinkedIn.',
    eyebrow: 'OFFICIALLY LICENSED',
    hello: (first: string | null) => (first ? `Congratulations, ${first}.` : 'Congratulations!'),
    lead: (co: string) => `${co} is now licensed at SPC Free Zone. To help you share the news, we've made you an announcement card.`,
    cardAlt: (co: string) => `Your announcement card for ${co}`,
    make: 'Make it yours',
    linkedin: 'Post on LinkedIn',
    small: 'Takes about a minute. The link is yours to keep, so you can come back any time.',
    stepsTitle: 'Three quick steps',
    steps: [
      ['Pick a style', 'Day One, Launch Pass or Daylight, in square, portrait or landscape.'],
      ['Make it personal', 'Add your photo or logo and choose a headline.'],
      ['Share it', 'Post straight to LinkedIn, or share it on WhatsApp and anywhere else.'],
    ] as Array<[string, string]>,
    details: 'Your licence',
    company: 'Company', licence: 'Licence no.', issued: 'Issued', valid: 'Valid until',
    other: 'Prefer Arabic?', otherLink: 'Open your card in Arabic',
    address: 'SPC Free Zone · Sharjah Publishing City · Sharjah, UAE',
    why: (co: string) => `You're receiving this email because SPC Free Zone issued a business licence to ${co}.`,
    help: 'Questions? Contact us',
  },
  ar: {
    subject: (co: string) => `${co} مرخّصة رسمياً. بطاقة الإعلان جاهزة`,
    preheader: 'اجعلها بطابعك خلال دقيقة، ثم انشرها على لينكدإن.',
    eyebrow: 'مرخّصة رسمياً',
    hello: (first: string | null) => (first ? `تهانينا، ${first}.` : 'تهانينا!'),
    lead: (co: string) => `أصبحت ${co} مرخّصة في المنطقة الحرة لمدينة الشارقة للنشر. ولمساعدتك على مشاركة الخبر، جهّزنا لك بطاقة إعلان.`,
    cardAlt: (co: string) => `بطاقة الإعلان الخاصة بـ ${co}`,
    make: 'خصّص بطاقتك',
    linkedin: 'انشرها على لينكدإن',
    small: 'يستغرق الأمر دقيقة تقريباً. الرابط خاص بك، ويمكنك العودة إليه في أي وقت.',
    stepsTitle: 'ثلاث خطوات سريعة',
    steps: [
      ['اختر التصميم', 'ثلاثة تصاميم وثلاثة مقاسات: مربع أو عمودي أو أفقي.'],
      ['أضف لمستك', 'أضف صورتك أو شعار شركتك واختر العنوان.'],
      ['شاركها', 'انشرها مباشرة على لينكدإن، أو شاركها عبر واتساب وغيره.'],
    ] as Array<[string, string]>,
    details: 'رخصتك',
    company: 'الشركة', licence: 'رقم الرخصة', issued: 'تاريخ الإصدار', valid: 'صالحة حتى',
    other: 'تفضّل الإنجليزية؟', otherLink: 'افتح بطاقتك بالإنجليزية',
    address: 'المنطقة الحرة لمدينة الشارقة للنشر · الشارقة، الإمارات العربية المتحدة',
    why: (co: string) => `وصلتك هذه الرسالة لأن المنطقة الحرة لمدينة الشارقة للنشر أصدرت رخصة تجارية لشركة ${co}.`,
    help: 'لديك سؤال؟ تواصل معنا',
  },
} as const;

const firstName = (full: string | null): string | null => {
  const w = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return w[0] ?? null;
};

/** A button that survives Outlook (VML roundrect) and every other client (a padded link). */
function button(o: { href: string; label: string; bg: string; fg: string; border: string; width: number; cls: string }): string {
  return html`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${o.href}" style="height:52px;v-text-anchor:middle;width:${o.width}px;" arcsize="50%" strokecolor="${o.border}" fillcolor="${o.bg}"><w:anchorlock/><center style="color:${o.fg};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${o.label}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a class="${o.cls}" href="${o.href}" target="_blank" style="display:inline-block;background:${o.bg};color:${o.fg};border:1.5px solid ${o.border};border-radius:999px;padding:15px 30px;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;mso-hide:all;">${o.label}</a><!--<![endif]-->`;
}

export function renderWelcome(i: WelcomeInput): WelcomeEmail {
  const c = i.card;
  const ar = i.lang === 'ar';
  const t = COPY[i.lang];
  const base = i.baseUrl.replace(/\/+$/, '');
  const company = (ar && c.company_name_ar) || c.company_name_en;
  const founder = (ar ? c.founder_name_ar || c.founder_name_en : c.founder_name_en) || null;
  const first = firstName(founder);
  const dir = ar ? 'rtl' : 'ltr';
  const align = ar ? 'right' : 'left';
  const font = ar ? "'Noto Kufi Arabic',Tahoma,Arial,sans-serif" : "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const langQ = ar ? 'ar' : 'en';
  const studio = `${base}/c/${c.token}?lang=${langQ}&via=email`;
  const otherStudio = `${base}/c/${c.token}?lang=${ar ? 'en' : 'ar'}&via=email`;
  const linkedinUrl = `${base}/c/${c.token}/linkedin?lang=${langQ}&via=email`;
  const cardImg = `${base}${cardImagePath(c, i.lang)}`;
  const logo = `${base}/static/studio/a/a18673349b740aa2.png`;
  const issued = formatFullDate(c.issued_on, i.lang);
  const valid = c.licence_expires_on ? formatFullDate(c.licence_expires_on, i.lang) : null;

  const detailRow = (label: string, value: string, mono = false): string => html`<tr>
<td class="muted" style="padding:9px 0;border-top:1px solid #e3e9f6;color:#53617c;font-size:14px;line-height:20px;text-align:${align};width:42%;">${label}</td>
<td class="text" style="padding:9px 0;border-top:1px solid #e3e9f6;color:#071329;font-size:14px;line-height:20px;font-weight:600;text-align:${align};${mono ? 'font-variant-numeric:tabular-nums;' : ''}" dir="auto">${value}</td>
</tr>`;

  const step = (n: number, title: string, body: string): string => html`<td class="stack" valign="top" width="33%" style="padding:0 8px;text-align:${align};">
<div style="width:32px;height:32px;line-height:32px;border-radius:10px;background:#eef3ff;color:#004dff;font-weight:800;font-size:15px;text-align:center;${ar ? 'margin-left:auto;' : ''}" class="chip">${String(n)}</div>
<p class="text" style="margin:12px 0 4px;color:#071329;font-size:15px;line-height:20px;font-weight:700;">${title}</p>
<p class="muted" style="margin:0;color:#53617c;font-size:13px;line-height:19px;">${body}</p>
</td>`;

  const out = html`<!doctype html>
<html lang="${langQ}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${t.subject(company)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Noto+Kufi+Arabic:wght@500;700;800&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block}
a{text-decoration:none}
@media (max-width:620px){
  .wrap{width:100%!important}
  .pad{padding-left:22px!important;padding-right:22px!important}
  .stack{display:block!important;width:100%!important;padding:0 0 18px!important}
  .h1{font-size:28px!important;line-height:34px!important}
  .btn-cell{display:block!important;width:100%!important;padding:0 0 10px!important}
}
@media (prefers-color-scheme:dark){
  .page,.outer{background:#0b1220!important}
  .card{background:#121b2e!important}
  .text,.h1{color:#e8edf7!important}
  .muted{color:#9aa7c0!important}
  .chip{background:#1b2a4d!important;color:#8fb0ff!important}
  .eyebrow{background:#16244a!important;color:#8fb0ff!important}
  .panel{background:#16213a!important}
  .btn-secondary{background:#121b2e!important;color:#8fb0ff!important;border-color:#3b5bb0!important}
  .logo{background:#ffffff!important;padding:8px 12px!important;border-radius:10px!important}
}
[data-ogsc] .card{background:#121b2e!important}
[data-ogsc] .text,[data-ogsc] .h1{color:#e8edf7!important}
[data-ogsc] .muted{color:#9aa7c0!important}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#eef3ff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${t.preheader}${raw('&#8199;&#65279;&#847;'.repeat(40))}</div>
<table role="presentation" class="outer" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ff;">
<tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;font-family:${font};" dir="${dir}">

<tr><td class="pad" style="padding:0 8px 18px;text-align:${align};">
<a href="https://www.spcfz.ae/" target="_blank"><img class="logo" src="${logo}" width="150" alt="SPC Free Zone" style="width:150px;height:auto;${ar ? 'margin-left:auto;' : ''}"></a>
</td></tr>

<tr><td class="card" style="background:#ffffff;border-radius:24px;box-shadow:0 18px 40px -28px rgba(7,19,41,.35);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td class="pad" style="padding:36px 40px 8px;text-align:${align};">
<span class="eyebrow" style="display:inline-block;background:#eef3ff;color:#004dff;font-size:12px;line-height:16px;font-weight:700;letter-spacing:${ar ? '0' : '.14em'};padding:7px 12px;border-radius:999px;">${t.eyebrow}</span>
<h1 class="h1" style="margin:16px 0 10px;color:#071329;font-size:32px;line-height:38px;font-weight:800;letter-spacing:${ar ? '0' : '-.02em'};">${t.hello(first)}</h1>
<p class="muted" style="margin:0;color:#53617c;font-size:16px;line-height:25px;">${t.lead(company)}</p>
</td></tr>

<tr><td class="pad" style="padding:24px 40px 8px;">
<a href="${studio}" target="_blank" style="display:block;border-radius:18px;overflow:hidden;">
<img src="${cardImg}" width="520" alt="${t.cardAlt(company)}" style="width:100%;max-width:520px;height:auto;border-radius:18px;background:#eef3ff;">
</a>
</td></tr>

<tr><td class="pad" style="padding:22px 40px 6px;text-align:center;">
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
<td class="btn-cell" style="padding:0 6px;">${raw(button({ href: studio, label: t.make, bg: '#004dff', fg: '#ffffff', border: '#004dff', width: 220, cls: 'btn-primary' }))}</td>
${i.linkedin ? raw(html`<td class="btn-cell" style="padding:0 6px;">${raw(button({ href: linkedinUrl, label: t.linkedin, bg: '#ffffff', fg: '#0a66c2', border: '#0a66c2', width: 220, cls: 'btn-secondary' }))}</td>`) : ''}
</tr></table>
<p class="muted" style="margin:14px 0 0;color:#53617c;font-size:13px;line-height:19px;">${t.small}</p>
</td></tr>

<tr><td class="pad" style="padding:30px 32px 6px;">
<p class="text" style="margin:0 8px 16px;color:#071329;font-size:13px;line-height:18px;font-weight:700;letter-spacing:${ar ? '0' : '.08em'};text-transform:uppercase;text-align:${align};">${t.stepsTitle}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${raw(t.steps.map(([title, body], n) => step(n + 1, title, body)).join(''))}
</tr></table>
</td></tr>

<tr><td class="pad" style="padding:22px 40px 36px;">
<table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fd;border-radius:16px;">
<tr><td style="padding:16px 20px 10px;">
<p class="text" style="margin:0 0 6px;color:#071329;font-size:13px;line-height:18px;font-weight:700;letter-spacing:${ar ? '0' : '.08em'};text-transform:uppercase;text-align:${align};">${t.details}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${raw(detailRow(t.company, company))}
${raw(detailRow(t.licence, c.licence_number, true))}
${raw(detailRow(t.issued, issued))}
${valid ? raw(detailRow(t.valid, valid)) : ''}
</table>
</td></tr></table>
</td></tr>
</table>
</td></tr>

<tr><td class="pad" style="padding:22px 16px 0;text-align:center;">
<p class="muted" style="margin:0 0 8px;color:#53617c;font-size:14px;line-height:20px;">${t.other} <a href="${otherStudio}" target="_blank" style="color:#004dff;font-weight:700;">${t.otherLink}</a></p>
<p class="muted" style="margin:0 0 6px;color:#7c879d;font-size:12px;line-height:18px;">${t.why(company)}</p>
<p class="muted" style="margin:0 0 6px;color:#7c879d;font-size:12px;line-height:18px;">${t.address}</p>
<p style="margin:0;font-size:12px;line-height:18px;"><a href="${CONTACT_URL}" target="_blank" style="color:#004dff;font-weight:600;">${t.help}</a></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const lines = [
    t.hello(first),
    '',
    t.lead(company),
    '',
    `${t.make}: ${studio}`,
    ...(i.linkedin ? [`${t.linkedin}: ${linkedinUrl}`] : []),
    '',
    `${t.company}: ${company}`,
    `${t.licence}: ${c.licence_number}`,
    `${t.issued}: ${issued}`,
    ...(valid ? [`${t.valid}: ${valid}`] : []),
    '',
    `${t.other} ${otherStudio}`,
    '',
    t.why(company),
    t.address,
    `${t.help}: ${CONTACT_URL}`,
  ];
  return { subject: t.subject(company), html: out, text: lines.join('\n') };
}
