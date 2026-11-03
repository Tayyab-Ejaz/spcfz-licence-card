// The alert SPC gets when a customer posts their card with "Post to LinkedIn" (3 November 2026), so SPC's page can
// like, comment on and repost it while it is new. English only: it goes to SPC staff (LINKEDIN_ALERT_TO), never to
// customers, so it has no unsubscribe link.
import type { CardRow, Env } from '../types.js';
import type { LinkedinPostRow } from '../db/linkedin.js';
import { html, raw } from '../util/html.js';

/** Who gets the alert when LINKEDIN_ALERT_TO is not set (SPC, 3 November 2026). */
export const DEFAULT_ALERT_TO = 'tayyab@spcfz.ae';

/** The addresses in LINKEDIN_ALERT_TO (comma separated), DEFAULT_ALERT_TO when it is unset, none for "off". */
export function alertRecipients(env: Pick<Env, 'LINKEDIN_ALERT_TO'>): string[] {
  const v = (env.LINKEDIN_ALERT_TO ?? DEFAULT_ALERT_TO).trim();
  if (v.toLowerCase() === 'off') return [];
  return [...new Set(v.split(/[\s,;]+/).map((s) => s.toLowerCase()).filter(Boolean))];
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

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
  const subject = `${card.is_test ? '[TEST] ' : ''}${company} posted their licence card on LinkedIn`;
  const lead = `${company} just posted their SPC licence card on LinkedIn.`;
  const ask = "Like, comment on or repost it from SPC's page while it is new: early reactions help LinkedIn show it to more people.";
  const details: Array<[string, string]> = [
    ['Company', company],
    ['Licence number', card.licence_number],
    ...(card.founder_name_en ? [['Founder', card.founder_name_en] as [string, string]] : []),
    ['Posted', `${WHEN.format(new Date(post.created_at))}, Dubai time`],
    ['Language', post.lang === 'ar' ? 'Arabic' : 'English'],
  ];
  const footer = `Sent by ${new URL(base).host} each time a customer uses Post to LinkedIn.`;

  const out = html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#071329">
${card.is_test ? raw('<tr><td style="padding:0 0 14px"><span style="display:inline-block;border:1px solid #004dff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:bold;color:#004dff">TEST CARD</span></td></tr>') : ''}
<tr><td style="padding:0 0 10px;font-size:20px;line-height:1.3;font-weight:bold">${lead}</td></tr>
<tr><td style="padding:0 0 22px">${ask}</td></tr>
<tr><td style="padding:0 0 26px"><a href="${postUrl}" style="display:inline-block;background:#004dff;border-radius:6px;padding:12px 22px;color:#ffffff;font-weight:bold;text-decoration:none">Open the post on LinkedIn</a></td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
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
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    '',
    `The card in the admin: ${adminUrl}`,
    '',
    footer,
  ].join('\n');
  return { subject, html: out, text };
}
