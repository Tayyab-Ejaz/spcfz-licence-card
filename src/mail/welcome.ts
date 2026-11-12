// The welcome email: "You’re Officially a Business Owner." (SPC's copy), the customer's own card (shown as a
// draft), and two buttons, "Share on LinkedIn" and "Download My Announcement", both into the studio, where they make
// it theirs and post or download it (SPC, 12 November 2026). No LinkedIn shortcut here: it would post the card
// un-personalised.
// Built for real inboxes: tables and inline styles, a hidden preheader, Outlook (VML) buttons, a dark-mode
// palette for clients that honour it, right-to-left Arabic, alt text on every image and a plain-text part.
import type { CardRow, Lang } from '../types.js';
import { html, raw } from '../util/html.js';
import { todayInDubai } from '../util/time.js';
import { cardImagePath } from '../page/studio.js';
import { CONTACT_EMAIL, EMAIL_HEADER, FOOTER_LOGO, PHONE, SOCIAL } from './assets.js';

export interface WelcomeEmail {
  subject: string;
  html: string;
  text: string;
  /** The footer's Unsubscribe, also sent as the List-Unsubscribe header (src/mail/transport.ts). */
  unsubscribeUrl: string;
}

export interface WelcomeInput {
  card: CardRow;
  lang: Lang;
  baseUrl: string;
}

/**
 * The words. English is SPC's copy of 12 November 2026 ("LI Milestone Email (1).docx": "You’re Officially a Business
 * Owner." / "Spread the Joy!"), verbatim, including "download it directly by clicking the link below" although both
 * buttons open the studio (SPC's choice). The subject stays "Your Business Is Official. Let the World Know!" (not in
 * that copy; SPC, 10 November 2026). The pills under the card are gone (SPC, 12 November 2026). The card window's
 * bar ("Your announcement card · Draft", "Customise →") and the footer are not in that copy and stay. The Arabic is
 * Claude's draft for review. Exported for docs/ARABIC-STRINGS.md.
 */
export const COPY = {
  en: {
    subject: 'Your Business Is Official. Let the World Know!',
    preheader: 'You’re Officially a Business Owner. Spread the Joy!',
    h1: 'You’re Officially a Business Owner.',
    sub: 'Spread the Joy!',
    hello: (first: string | null) => (first ? `Hi ${first},` : 'Hello,'),
    intro: [
      'Your dream is officially a reality. Congratulations on starting your business!',
      'Your first customer, partner, or investor is already out there on your social media feeds, waiting for a reason to reach out. Let them know that you’re now open for business!',
      'We’ve built a personalised announcement card to help you break the news.',
    ],
    cardAlt: (co: string) => `Business license announcement for ${co}`,
    draftBar: 'Your announcement card',
    draft: 'Draft',
    customise: 'Customise →',
    shareLine: 'Share the card with your network on LinkedIn or download it directly by clicking the link below.',
    shareLinkedIn: 'Share on LinkedIn',
    download: 'Download My Announcement',
    closing: 'We’re thrilled to have you in the SPC Free Zone family. Here’s to many more wins to come!',
    regards: 'Best Regards,',
    team: 'SPC Free Zone',
    tollFree: 'Toll Free Number',
    emailLabel: 'Email',
    copyright: (year: string) => `© ${year} Sharjah Publishing City (SPC) Free Zone`,
    location: 'Sharjah, United Arab Emirates.',
    unsubscribe: 'Unsubscribe',
  },
  ar: {
    subject: 'أعمالك أصبحت رسمية. شارك الخبر مع العالم!',
    preheader: 'رسمياً، أصبح لديك عملك الخاص. شارك الفرحة!',
    h1: 'رسمياً، أصبح لديك عملك الخاص.',
    sub: 'شارك الفرحة!',
    hello: (first: string | null) => (first ? `مرحباً ${first}،` : 'مرحباً،'),
    intro: [
      'أصبح حلمك حقيقة رسمياً. تهانينا على بدء عملك الخاص!',
      'عميلك أو شريكك أو مستثمرك الأول موجود بالفعل بين متابعيك على وسائل التواصل الاجتماعي، ينتظر سبباً للتواصل معك. أخبرهم أن أبوابك أصبحت مفتوحة للأعمال!',
      'صمّمنا لك بطاقة إعلان مخصصة لتساعدك على مشاركة الخبر.',
    ],
    cardAlt: (co: string) => `إعلان الرخصة التجارية لشركة ${co}`,
    draftBar: 'بطاقة إعلانك',
    draft: 'مسودة',
    customise: 'خصّصها ←',
    shareLine: 'شارك البطاقة مع شبكة معارفك على لينكدإن أو نزّلها مباشرة بالنقر على الرابط أدناه.',
    shareLinkedIn: 'شارك على لينكدإن',
    download: 'نزّل إعلاني',
    closing: 'يسعدنا انضمامك إلى عائلة المنطقة الحرة لمدينة الشارقة للنشر. نتمنى لك المزيد من النجاحات!',
    regards: 'مع أطيب التحيات،',
    team: 'المنطقة الحرة لمدينة الشارقة للنشر',
    tollFree: 'الرقم المجاني',
    emailLabel: 'البريد الإلكتروني',
    copyright: (year: string) => `© ${year} المنطقة الحرة لمدينة الشارقة للنشر`,
    location: 'الشارقة، الإمارات العربية المتحدة.',
    unsubscribe: 'إلغاء الاشتراك',
  },
} as const;

const firstName = (full: string | null): string | null => {
  const w = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return w[0] ?? null;
};

/** A button that survives Outlook (VML roundrect) and every other client (a padded link). */
function button(o: { href: string; label: string; bg: string; fg: string; border: string; width: number; cls: string }): string {
  return html`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${o.href}" style="height:48px;v-text-anchor:middle;width:${o.width}px;" arcsize="17%" strokecolor="${o.border}" fillcolor="${o.bg}"><w:anchorlock/><center style="color:${o.fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${o.label}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a class="${o.cls}" href="${o.href}" target="_blank" style="display:inline-block;background:${o.bg};color:${o.fg};border:1.5px solid ${o.border};border-radius:8px;padding:13px 24px;font-size:15px;line-height:20px;font-weight:700;text-decoration:none;mso-hide:all;">${o.label}</a><!--<![endif]-->`;
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
  const unsubscribeUrl = `${base}/c/${c.token}/unsubscribe?lang=${langQ}`;
  const cardImg = `${base}${cardImagePath(c, i.lang)}`;
  const header = `${base}/static/email/${EMAIL_HEADER}`;
  const year = todayInDubai().slice(0, 4);
  const logo = `${base}/static/email/${FOOTER_LOGO}`;
  const social = SOCIAL.map((n, k) => html`<a href="${n.href}" target="_blank" style="display:inline-block;${k ? (ar ? 'margin-right:8px;' : 'margin-left:8px;') : ''}"><img class="ft-icon" src="${base}/static/email/${n.icon}" width="38" height="38" alt="${n.name}" style="display:inline-block;width:38px;height:38px;"></a>`).join('');
  // The card sits in a small editor window (a bar with "Draft" and "Customise"), so it reads as a draft to make their
  // own before posting rather than a finished picture (SPC, 27 October 2026; the pills under it went 12 November).
  const out = html`<!doctype html>
<html lang="${langQ}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${t.subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Noto+Kufi+Arabic:wght@500;700;800&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block}
a{text-decoration:none}
@media (max-width:620px){
  .wrap{width:100%!important}
  .pad{padding-left:20px!important;padding-right:20px!important}
  .h1{font-size:24px!important;line-height:31px!important}
  .btn-table{width:100%!important}
  .btn-cell{display:block!important;width:100%!important;padding:0 0 10px!important}
  .btn-cell a{display:block!important;text-align:center!important}
  .stack-m{display:block!important;width:100%!important;text-align:${align}!important;padding-left:0!important;padding-right:0!important}
  .ft-gap{padding-top:12px!important}
  .ft-sep{display:none!important}
  .ft-pair{display:block!important}
  .bar-title{display:none!important}
  .ft-logo{width:128px!important}
  .ft-icon{width:32px!important;height:32px!important}
}
@media (prefers-color-scheme:dark){
  .page,.outer,.wrap{background:#0b1220!important}
  .text,.h1{color:#e8edf7!important}
  .muted{color:#9aa7c0!important}
  .accent{color:#8fb0ff!important}
  .rule{border-color:#22304d!important}
  .shot{border-color:#22304d!important}
  .studio{border-color:#22304d!important}
  .studio-bar{background:#111a2c!important;border-color:#22304d!important}
  .btn-secondary{background:#0b1220!important;color:#8fb0ff!important;border-color:#3b5bb0!important}
  .foot{background:#000000!important}
}
[data-ogsc] .text,[data-ogsc] .h1{color:#e8edf7!important}
[data-ogsc] .muted{color:#9aa7c0!important}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${t.preheader}${raw('&#8199;&#65279;&#847;'.repeat(40))}</div>
<table role="presentation" class="outer" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:0;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;font-family:${font};" dir="${dir}">

<tr><td style="padding:0;background:#0158fd;">
<a href="https://www.spcfz.ae/" target="_blank" style="display:block;"><img src="${header}" width="600" alt="SPC Free Zone · Where more is possible" style="width:100%;max-width:600px;height:auto;background:#0158fd;color:#ffffff;font-size:18px;font-weight:700;"></a>
</td></tr>

<tr><td class="pad" style="padding:34px 32px 0;text-align:${align};">
<h1 class="h1" style="margin:0 0 8px;color:#071329;font-size:26px;line-height:33px;font-weight:800;letter-spacing:${ar ? '0' : '-.01em'};">${t.h1}</h1>
<p class="accent" style="margin:0 0 28px;color:#004dff;font-size:16px;line-height:24px;font-weight:600;">${t.sub}</p>
<p class="text" style="margin:0 0 16px;color:#1f2a44;font-size:16px;line-height:26px;">${t.hello(first)}</p>
${raw(t.intro.map((line, k) => html`<p class="text" style="margin:${k === t.intro.length - 1 ? '0' : '0 0 16px'};color:#1f2a44;font-size:16px;line-height:26px;">${line}</p>`).join('\n'))}
</td></tr>

<tr><td class="pad" style="padding:26px 32px 0;">
<table role="presentation" class="studio" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dfe5f1;border-radius:14px;border-collapse:separate;">
<tr><td class="studio-bar" style="background:#f5f7fc;border-bottom:1px solid #e6ebf5;border-radius:14px 14px 0 0;padding:10px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="bar-dots" width="46" style="font-size:0;line-height:0;white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#d3dae6;"></span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#d3dae6;margin:0 5px;"></span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#d3dae6;"></span></td>
<td class="muted" style="color:#53617c;font-size:12px;line-height:16px;font-weight:600;text-align:center;"><span class="bar-title">${t.draftBar} · </span><span style="display:inline-block;background:#fff4d6;color:#8a5a00;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;">${t.draft}</span></td>
<td width="96" style="text-align:${ar ? 'left' : 'right'};white-space:nowrap;"><a class="accent" href="${studio}" target="_blank" style="color:#004dff;font-size:12px;line-height:16px;font-weight:700;text-decoration:none;">${t.customise}</a></td>
</tr></table>
</td></tr>
<tr><td style="padding:16px;">
<a href="${studio}" target="_blank" style="display:block;"><img class="shot" src="${cardImg}" width="502" alt="${t.cardAlt(company)}" style="width:100%;max-width:502px;height:auto;border-radius:8px;border:1px solid #edf1f8;background:#eef3ff;"></a>
</td></tr>
</table>
</td></tr>

<tr><td class="pad" style="padding:28px 32px 0;text-align:${align};">
<p class="text" style="margin:0 0 20px;color:#1f2a44;font-size:16px;line-height:26px;">${t.shareLine}</p>
<table role="presentation" class="btn-table" cellpadding="0" cellspacing="0" align="${align}"><tr>
<td class="btn-cell" style="padding:0;${ar ? 'padding-left:10px;' : 'padding-right:10px;'}">${raw(button({ href: studio, label: t.shareLinkedIn, bg: '#004dff', fg: '#ffffff', border: '#004dff', width: ar ? 190 : 200, cls: 'btn-primary' }))}</td>
<td class="btn-cell" style="padding:0;">${raw(button({ href: studio, label: t.download, bg: '#ffffff', fg: '#004dff', border: '#004dff', width: ar ? 150 : 270, cls: 'btn-secondary' }))}</td>
</tr></table>
</td></tr>

<tr><td class="pad" style="padding:30px 32px 0;text-align:${align};">
<p class="text" style="margin:0;color:#1f2a44;font-size:16px;line-height:26px;">${t.closing}</p>
<p class="text" style="margin:28px 0 0;color:#1f2a44;font-size:16px;line-height:26px;">${t.regards}<br><strong class="text" style="color:#071329;">${t.team}</strong></p>
</td></tr>

<tr><td style="height:40px;line-height:40px;font-size:0;">&nbsp;</td></tr>

<tr><td class="pad foot" style="padding:26px 32px 24px;background:#000000;text-align:${align};">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle" style="text-align:${align};"><a href="https://www.spcfz.ae/" target="_blank"><img class="ft-logo" src="${logo}" width="160" alt="SPC Free Zone" style="width:160px;height:auto;${ar ? 'margin-left:auto;' : ''}"></a></td>
<td valign="middle" style="text-align:${ar ? 'left' : 'right'};white-space:nowrap;">${raw(social)}</td>
</tr></table>

<p style="margin:22px 0 0;color:#ffffff;font-size:14px;line-height:22px;"><span class="ft-pair" style="white-space:nowrap;"><span style="color:#8b919c;">${t.tollFree}</span>&nbsp; <a href="${PHONE.href}" dir="ltr" style="color:#ffffff;font-weight:600;text-decoration:none;">${PHONE.label}</a></span><span class="ft-sep" style="color:#3f434b;">&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;</span><span class="ft-pair" style="white-space:nowrap;"><span style="color:#8b919c;">${t.emailLabel}</span>&nbsp; <a href="mailto:${CONTACT_EMAIL}" style="color:#ffffff;font-weight:600;text-decoration:none;">${CONTACT_EMAIL}</a></span></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 0 16px;"><div style="height:1px;line-height:1px;font-size:0;background:#202329;">&nbsp;</div></td></tr></table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="stack-m" valign="middle" style="text-align:${align};">
<p style="margin:0;color:#aab0ba;font-size:12px;line-height:18px;">${t.copyright(year)}<br>${t.location}</p>
</td>
<td class="stack-m ft-gap" valign="middle" style="text-align:${ar ? 'left' : 'right'};white-space:nowrap;${ar ? 'padding-right:16px;' : 'padding-left:16px;'}">
<a href="${unsubscribeUrl}" target="_blank" style="display:inline-block;border:1px solid #33373e;border-radius:6px;padding:5px 12px;background:#000000;color:#c9ced6;font-size:12px;line-height:16px;font-weight:600;text-decoration:none;">${t.unsubscribe}</a>
</td>
</tr></table>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const lines = [
    t.h1,
    t.sub,
    '',
    t.hello(first),
    '',
    ...t.intro.flatMap((line) => [line, '']),
    t.shareLine,
    '',
    `${t.shareLinkedIn}: ${studio}`,
    `${t.download}: ${studio}`,
    '',
    t.closing,
    '',
    t.regards,
    t.team,
    '',
    `${t.tollFree}: ${PHONE.label}`,
    `${t.emailLabel}: ${CONTACT_EMAIL}`,
    t.copyright(year),
    t.location,
    '',
    SOCIAL.map((n) => `${n.name}: ${n.href}`).join('\n'),
    '',
    `${t.unsubscribe}: ${unsubscribeUrl}`,
  ];
  return { subject: t.subject, html: out, text: lines.join('\n'), unsubscribeUrl };
}
