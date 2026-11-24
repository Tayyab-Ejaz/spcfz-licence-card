// Admin, the welcome WhatsApp message (19 November 2026): the card page's section, the preview of the message as the
// customer sees it, and the settings lines. The routes are in ./routes.ts.
import type { CardRow, Env } from '../types.js';
import type { WhatsappRow, WhatsappSuppressionRow } from '../db/whatsapp.js';
import { TEMPLATE_TEXT, welcomeWhatsapp } from '../whatsapp/message.js';
import { formatPhone } from '../whatsapp/phone.js';
import type { RawHtml } from '../util/html.js';
import { EMPTY, actionForm, fmtDateTime, h, table } from './layout.js';

export type WhatsappMode = 'gallabox' | 'file' | 'off';

export function whatsappMode(env: Env): WhatsappMode {
  return env.WHATSAPP_TRANSPORT ?? (env.GALLABOX_API_KEY ? 'gallabox' : 'off');
}

/** The flash messages after Send / Stop / Allow (./routes.ts FLASH). */
export const WHATSAPP_FLASH: Record<string, string> = {
  whatsapped: 'WhatsApp message queued; it goes out within a minute.',
  'wa-none': 'This card has no mobile number. Add one with Create (same licence number) or the next ERP update.',
  'wa-expired': 'This card has expired, so no WhatsApp message was sent.',
  'wa-test': 'Test card: the number is not in Settings → WhatsApp test numbers, so the message was skipped.',
  'wa-stopped': 'WhatsApp messages to this number are stopped, so nothing was sent.',
  'wa-stop': 'No more WhatsApp messages go to this number from the licence card.',
  'wa-allow': 'WhatsApp messages to this number are allowed again.',
};

const DELIVERY_LABEL: Record<string, string> = {
  sent: 'sent to WhatsApp', delivered: 'delivered', read: 'read', failed: 'not delivered', error: 'not delivered',
  deleted: 'deleted', received: 'received', unknown: 'unknown',
};

function statusBadge(m: WhatsappRow): RawHtml {
  const cls = m.status === 'sent' ? 'ready' : m.status === 'failed' ? 'failed' : m.status === 'queued' ? 'pending' : 'expired';
  return h`<span class="badge ${cls}">${m.status}</span>`;
}

function deliveryCell(m: WhatsappRow): RawHtml {
  if (m.status !== 'sent') return EMPTY;
  if (!m.delivery) return h`<span class="muted">${m.provider_id?.startsWith('file:') ? 'written to a file (local copy)' : m.check_at ? 'checking…' : 'accepted by Gallabox'}</span>`;
  const bad = m.delivery === 'failed' || m.delivery === 'error';
  return h`<span class="badge ${bad ? 'failed' : m.delivery === 'read' || m.delivery === 'delivered' ? 'ready' : 'pending'}">${DELIVERY_LABEL[m.delivery] ?? m.delivery}</span>${m.delivery_at ? h`<br><span class="muted">${fmtDateTime(m.delivery_at)}</span>` : EMPTY}`;
}

export function whatsappTable(rows: WhatsappRow[], emptyText = 'No WhatsApp message yet.'): RawHtml {
  return table(
    ['Queued', 'To', 'Status', 'Sent', 'WhatsApp says', 'Note'],
    rows.map((m) => [
      h`${fmtDateTime(m.created_at)}${m.status === 'queued' && m.next_attempt_at && m.next_attempt_at > m.created_at ? h`<br><span class="muted">goes at ${fmtDateTime(m.next_attempt_at)}</span>` : EMPTY}`,
      h`<span dir="ltr">${formatPhone(m.to_phone)}</span>${m.template ? h`<br><span class="muted">${m.template}</span>` : EMPTY}`,
      statusBadge(m),
      h`${m.sent_at ? fmtDateTime(m.sent_at) : ''}`,
      deliveryCell(m),
      h`<span class="muted">${m.last_error ?? (m.attempts > 1 ? `${m.attempts} attempts` : '')}</span>`,
    ]),
    emptyText,
  );
}

/** The card page's "Welcome WhatsApp message" section. */
export function whatsappSection(o: { card: CardRow; rows: WhatsappRow[]; stop: WhatsappSuppressionRow | null; token: string; mode: WhatsappMode }): RawHtml {
  const { card, rows, stop, token } = o;
  const welcome = rows.filter((m) => m.kind === 'welcome');
  const already = welcome.some((m) => m.status === 'sent' || m.status === 'queued');
  return h`<h2>Welcome WhatsApp message</h2>
${o.mode === 'off' ? h`<p class="muted">WhatsApp is off on this server (no Gallabox key yet): messages are queued here and sent once it is on.</p>` : o.mode === 'file' ? h`<p class="muted">Local copy: messages are written to DATA_DIR/whatsapp-outbox, not sent.</p>` : EMPTY}
${stop ? h`<div class="error">WhatsApp messages to <span dir="ltr">${formatPhone(stop.phone)}</span> were stopped on ${fmtDateTime(stop.created_at)}${stop.actor ? ` by ${stop.actor}` : ''}. Nothing more goes to this number.</div>` : EMPTY}
${whatsappTable(welcome)}
<div class="actions">
${card.customer_phone
    ? h`${actionForm(`/admin/cards/${card.id}/whatsapp`, already ? 'Send it again' : 'Send WhatsApp message', token, 'btn small')}
${stop ? actionForm(`/admin/cards/${card.id}/whatsapp-allow`, 'Allow WhatsApp again', token, 'btn small secondary') : actionForm(`/admin/cards/${card.id}/whatsapp-stop`, 'Stop WhatsApp to this number', token, 'btn small secondary')}`
    : h`<span class="muted">No mobile number on this card.</span>`}
<a class="btn small secondary" href="/admin/cards/${card.id}/whatsapp-preview" target="_blank" rel="noopener">Preview</a>
</div>`;
}

const PREVIEW_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#d1d7db;font-family:-apple-system,'Segoe UI',Helvetica,Arial,'Noto Kufi Arabic',sans-serif;color:#111b21}
.note{max-width:420px;margin:18px auto 0;font-size:12.5px;line-height:1.5;color:#3b4a54;background:#fff;border-radius:10px;padding:10px 14px}
.note b{color:#111b21}
.phone{max-width:420px;margin:12px auto 24px;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.18)}
.bar{background:#008069;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px}
.bar img{width:34px;height:34px;border-radius:50%;background:#fff;object-fit:contain;padding:3px}
.bar small{display:block;font-weight:400;font-size:12px;opacity:.85}
.chat{background:#efeae2;padding:18px 14px 26px;min-height:420px}
.bubble{background:#fff;border-radius:8px;max-width:330px;box-shadow:0 1px .5px rgba(11,20,26,.13);overflow:hidden}
.bubble .pic{display:block;width:100%;height:auto;background:#e9edef;padding:3px 3px 0;border-radius:8px}
.bubble .pic img{display:block;width:100%;height:auto;border-radius:6px}
.text{padding:7px 9px 2px;font-size:14.2px;line-height:1.42;white-space:pre-wrap;overflow-wrap:anywhere}
.foot{padding:2px 9px 0;font-size:12.6px;color:#667781}
.time{padding:0 9px 6px;font-size:11px;color:#667781;text-align:end}
.btn{display:block;border-top:1px solid #e9edef;text-align:center;padding:10px 8px;color:#027eb5;font-size:14.2px;text-decoration:none;font-weight:500}
.btn:before{content:'↗ '}
`;

/** A WhatsApp-style picture of the message, from the approved wording copied into TEMPLATE_TEXT. */
export function whatsappPreviewPage(env: Env, card: CardRow): string {
  const m = welcomeWhatsapp(card, { baseUrl: env.BASE_URL, template: env.WHATSAPP_TEMPLATE_EN, header: env.WHATSAPP_HEADER === 'none' ? 'none' : 'image' });
  const t = TEMPLATE_TEXT;
  const base = env.BASE_URL.replace(/\/+$/, '');
  const dubai = new Date(Date.now() + 4 * 3600_000).toISOString().slice(11, 16);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>WhatsApp preview · ${h`${card.company_name_en}`}</title><style>${PREVIEW_CSS}</style></head><body>
${h`<div class="note"><b>Preview.</b> WhatsApp sends the template approved in Gallabox (<b>${m.template}</b>); these are its words as copied on 24 November 2026. To ${card.customer_phone ? formatPhone(card.customer_phone) : 'no number on this card'}. Every customer gets this English message.</div>`}
<div class="phone"><div class="bar"><img src="${base}/apple-touch-icon.png" alt=""><div>SPC Free Zone<small>Business account</small></div></div>
<div class="chat"><div class="bubble">
${m.imageUrl ? h`<div class="pic"><img src="${m.imageUrl}" alt="The customer's card picture"></div>` : ''}
${h`<div class="text">${m.text}</div><div class="time">${dubai}</div><a class="btn" href="${m.studioUrl}" target="_blank" rel="noopener">${t.button}</a>`}
</div></div></div>
</body></html>`;
}
