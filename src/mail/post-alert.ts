// The alert SPC gets when a customer posts their card with "Post to LinkedIn" (3 November 2026), so SPC's team can
// like, comment on and repost it while it is new. Since 5 November 2026 it asks for that within the hour (early
// reactions are what LinkedIn shows more widely), with comments ready to paste, and who gets it is set in Admin →
// Settings (post_alert_to). English only: it goes to SPC staff, never to customers, so it has no unsubscribe link.
// The comments follow the language of the post; the Arabic ones are Claude's drafts (docs/ARABIC-STRINGS.md).
import type { CardRow, Env } from '../types.js';
import type { LinkedinPostRow } from '../db/linkedin.js';
import { html, raw } from '../util/html.js';

/** Who gets the alert when neither the setting nor LINKEDIN_ALERT_TO says (SPC, 3 November 2026). */
export const DEFAULT_ALERT_TO = 'tayyab@spcfz.ae';

const ADDRESS_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A comma (or space, or semicolon) separated list of addresses: the good ones lower-cased and once each, and the bad. */
export function parseAddressList(v: string): { list: string[]; bad: string[] } {
  const parts = v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const list = [...new Set(parts.filter((p) => ADDRESS_RE.test(p)).map((p) => p.toLowerCase()))];
  return { list, bad: parts.filter((p) => !ADDRESS_RE.test(p)) };
}

/**
 * Who gets the alert: the Admin → Settings list when it has one, else LINKEDIN_ALERT_TO, else DEFAULT_ALERT_TO;
 * nobody for "off" (in either place).
 */
export function alertRecipients(env: Pick<Env, 'LINKEDIN_ALERT_TO'>, setting = ''): string[] {
  const v = (setting.trim() ? setting : (env.LINKEDIN_ALERT_TO ?? DEFAULT_ALERT_TO)).trim();
  if (v.toLowerCase() === 'off') return [];
  return parseAddressList(v).list;
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** Comments to paste under the post, in the post's language. The founder's first name when there is one. */
export function suggestedComments(card: Pick<CardRow, 'company_name_en' | 'company_name_ar' | 'founder_name_en' | 'founder_name_ar'>, lang: string | null): string[] {
  if (lang === 'ar') {
    const co = card.company_name_ar || card.company_name_en;
    const who = (card.founder_name_ar || '').trim().split(/\s+/)[0] || '';
    return [
      `${who ? `مبروك ${who}! ` : 'مبروك! '}أهلاً بـ${co} في المنطقة الحرة لمدينة الشارقة للنشر، ونتمنى لكم كل التوفيق.`,
      `بالتوفيق لـ${co}! سعداء بانضمامكم إلى مجتمع المنطقة الحرة لمدينة الشارقة للنشر.`,
      `خطوة رائعة! نتطلع إلى رؤية ${co} تنمو وتزدهر معنا.`,
    ];
  }
  const co = card.company_name_en;
  const who = (card.founder_name_en || '').trim().split(/\s+/)[0] || '';
  return [
    `Congratulations${who ? `, ${who}` : ''}! Welcome to SPC Free Zone. We're proud to have ${co} with us.`,
    `Wishing ${co} every success. Welcome to the SPC Free Zone community!`,
    `Great to see ${co} launch with SPC Free Zone. Here's to a fantastic first year!`,
  ];
}

export interface PostAlert {
  subject: string;
  html: string;
  text: string;
}

export function renderPostAlert(i: { card: CardRow; post: LinkedinPostRow; baseUrl: string }): PostAlert {
  const { card, post } = i;
  const base = i.baseUrl.replace(/\/+$/, '');
  const postUrl = `https://www.linkedin.com/feed/update/${post.post_urn ?? ''}/`;
  const adminUrl = `${base}/admin/cards/${card.id}`;
  const company = card.company_name_en;
  const subject = `${card.is_test ? '[TEST] ' : ''}Like and comment now: ${company} just posted on LinkedIn`;
  const lead = `${company} just posted their SPC licence card on LinkedIn.`;
  const ask = 'The first hour matters most: likes and comments now are what make LinkedIn show the post to more people. '
    + "Please like it and leave a comment from your own profile, and from SPC's page if you manage it.";
  const processing = 'If LinkedIn says "Post not found", it is still preparing the picture: try again in a minute.';
  const comments = suggestedComments(card, post.lang);
  const commentsNote = post.lang === 'ar'
    ? 'They posted in Arabic, so these are in Arabic. Pick one, or write your own.'
    : 'Pick one, or write your own. It reads best when each person uses a different one.';
  const details: Array<[string, string]> = [
    ['Company', company],
    ['Licence number', card.licence_number],
    ...(card.founder_name_en ? [['Founder', card.founder_name_en] as [string, string]] : []),
    ['Posted', `${WHEN.format(new Date(post.created_at))}, Dubai time`],
    ['Language', post.lang === 'ar' ? 'Arabic' : 'English'],
  ];
  const footer = `Sent by ${new URL(base).host} each time a customer uses Post to LinkedIn. Who gets it: Admin → Settings.`;

  const out = html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#071329">
${card.is_test ? raw('<tr><td style="padding:0 0 14px"><span style="display:inline-block;border:1px solid #004dff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:bold;color:#004dff">TEST CARD</span></td></tr>') : ''}
<tr><td style="padding:0 0 10px;font-size:20px;line-height:1.3;font-weight:bold">${lead}</td></tr>
<tr><td style="padding:0 0 22px">${ask}</td></tr>
<tr><td style="padding:0 0 8px"><a href="${postUrl}" style="display:inline-block;background:#004dff;border-radius:6px;padding:12px 22px;color:#ffffff;font-weight:bold;text-decoration:none">Open the post on LinkedIn</a></td></tr>
<tr><td style="padding:0 0 26px;font-size:13px;color:#53617c">${processing}</td></tr>
<tr><td style="padding:0 0 6px;font-weight:bold">Comments ready to paste</td></tr>
<tr><td style="padding:0 0 10px;font-size:13px">${commentsNote}</td></tr>
${comments.map((t) => raw(html`<tr><td style="padding:0 0 8px"><div dir="${post.lang === 'ar' ? 'rtl' : 'ltr'}" style="border:1px solid #dfe7f4;border-radius:6px;padding:10px 12px;background:#f4f7fc;font-size:14px">${t}</div></td></tr>`))}
<tr><td style="padding:18px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${details.map(([k, v]) => raw(html`<tr><td style="padding:4px 18px 4px 0;color:#071329">${k}</td><td style="padding:4px 0;font-weight:bold;color:#071329">${v}</td></tr>`))}
</table></td></tr>
<tr><td style="padding:22px 0 0;font-size:14px"><a href="${adminUrl}" style="color:#004dff">See the card in the admin</a></td></tr>
<tr><td style="padding:26px 0 0;font-size:12px;color:#071329">${footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    ...(card.is_test ? ['TEST CARD', ''] : []),
    lead,
    '',
    ask,
    '',
    `Open the post: ${postUrl}`,
    processing,
    '',
    'Comments ready to paste:',
    commentsNote,
    ...comments.map((t) => `- ${t}`),
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    '',
    `The card in the admin: ${adminUrl}`,
    '',
    footer,
  ].join('\n');
  return { subject, html: out, text };
}
