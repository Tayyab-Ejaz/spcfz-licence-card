// The monthly impact report as an email (./impact.ts), for SPC's management: SPC's banner, the headline figures with
// the change on the month before, the LinkedIn posts with links, and the totals since launch. Plain tables and
// inline styles, like the post alert, so it reads the same in Outlook. Internal, English only, no unsubscribe link.
import { html, raw } from '../util/html.js';
import { EMAIL_HEADER } from '../mail/assets.js';
import { HEADLINES, change, details } from './impact.js';
import type { ImpactReport } from './impact.js';

const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' });

export interface ReportEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderReportEmail(r: ImpactReport, baseUrl: string): ReportEmail {
  const base = baseUrl.replace(/\/+$/, '');
  const subject = `Licence cards: ${r.label} report`;
  const intro = `What the licence cards did in ${r.label}, with the change on ${r.previousLabel}. Test cards are not included.`;
  const adminUrl = `${base}/admin/report?month=${r.month}`;
  const banner = `${base}/static/email/${EMAIL_HEADER}`;
  const rows = HEADLINES.map(([k, label, note]) => {
    const cur = Number(r.current[k]);
    return { label, note, value: String(cur), change: change(cur, Number(r.previous[k])) };
  });
  const s = r.sinceLaunch;
  const since = `Since launch: ${s.cards} licence cards, ${s.sharedCards} customers shared theirs, ${s.posts} posts on LinkedIn.`;
  const footer = `Sent on the 1st of each month to the addresses in Admin → Settings, by ${new URL(base).host}.`;

  const out = html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#071329">
<tr><td style="padding:0 0 24px"><img src="${banner}" width="600" alt="SPC Free Zone" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:8px"></td></tr>
<tr><td style="padding:0 0 6px;font-size:22px;line-height:1.3;font-weight:bold">Licence cards: ${r.label}</td></tr>
<tr><td style="padding:0 0 20px">${intro}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
${rows.map((x) => raw(html`<tr>
<td style="padding:12px 12px 12px 0;border-top:1px solid #dfe7f4"><div style="font-weight:bold">${x.label}</div><div style="font-size:12.5px;color:#53617c">${x.note}</div></td>
<td align="right" style="padding:12px 0;border-top:1px solid #dfe7f4;font-size:24px;font-weight:bold;color:#004dff;white-space:nowrap">${x.value}</td>
<td align="right" style="padding:12px 0 12px 12px;border-top:1px solid #dfe7f4;font-size:12.5px;color:#53617c;white-space:nowrap;width:84px">${x.change}</td>
</tr>`))}
</table></td></tr>
<tr><td style="padding:26px 0 8px;font-weight:bold">Posts on LinkedIn</td></tr>
${r.posts.length
    ? r.posts.map((p) => raw(html`<tr><td style="padding:0 0 6px;font-size:14px">${DAY.format(new Date(p.created_at))} · ${p.company_name_en} · <a href="https://www.linkedin.com/feed/update/${p.post_urn ?? ''}/" style="color:#004dff">Open the post</a></td></tr>`))
    : raw(html`<tr><td style="padding:0 0 6px;font-size:14px;color:#53617c">None in ${r.label}.</td></tr>`)}
<tr><td style="padding:22px 0 8px;font-weight:bold">In more detail</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${details(r.current).map(([k, v]) => raw(html`<tr><td style="padding:3px 16px 3px 0;color:#53617c;vertical-align:top">${k}</td><td style="padding:3px 0">${v}</td></tr>`))}
</table></td></tr>
<tr><td style="padding:22px 0 0;font-size:14px">${since}</td></tr>
<tr><td style="padding:24px 0 0"><a href="${adminUrl}" style="display:inline-block;background:#004dff;border-radius:6px;padding:11px 20px;color:#ffffff;font-weight:bold;text-decoration:none">Open the report in the admin</a></td></tr>
<tr><td style="padding:26px 0 0;font-size:12px;color:#53617c">${footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    `Licence cards: ${r.label}`,
    '',
    intro,
    '',
    ...rows.map((x) => `${x.label}: ${x.value}${x.change ? ` (${x.change})` : ''}`),
    '',
    'Posts on LinkedIn:',
    ...(r.posts.length ? r.posts.map((p) => `- ${DAY.format(new Date(p.created_at))}, ${p.company_name_en}: https://www.linkedin.com/feed/update/${p.post_urn ?? ''}/`) : [`None in ${r.label}.`]),
    '',
    'In more detail:',
    ...details(r.current).map(([k, v]) => `${k}: ${v}`),
    '',
    since,
    '',
    `The report in the admin: ${adminUrl}`,
    '',
    footer,
  ].join('\n');
  return { subject, html: out, text };
}
