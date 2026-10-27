// Admin, Test flow (27 October 2026): try the whole path before the ERP is connected. Staff send a licence the
// way the ERP will (same mapping, validation, card and welcome email as the webhook, src/intake/accept.ts), as a
// TEST card, then follow one run: what the ERP gets back, which fields were used, the card, the email, LinkedIn,
// and the ERP's follow-ups (the same licence again, a renewal, an expiry). Server-rendered, no JavaScript.
import { renderSVG } from 'uqr';
import type { CardRow, D1Database, Env, EventRow } from '../types.js';
import type { EmailRow } from '../db/emails.js';
import type { LinkedinPostRow } from '../db/linkedin.js';
import { fieldReport } from '../intake/mapper.js';
import { testRecipientAllowed } from '../mail/outbox.js';
import { cardImagePath, previewPath } from '../page/studio.js';
import { pageUrl } from '../storage.js';
import { raw } from '../util/html.js';
import type { RawHtml } from '../util/html.js';
import { addDays, formatFullDate, isPast, todayInDubai } from '../util/time.js';
import { EMPTY, csrfField, fmtDateTime, h, kv, table } from './layout.js';

export const EXPECTS = ['created', 'updated', 'unchanged', 'rejected'] as const;
export type Expect = (typeof EXPECTS)[number];

/** Only test-flow runs are test-route events written by a signed-in person; the ERP's test calls have no actor. */
export async function recentRuns(db: D1Database, limit = 12): Promise<Array<EventRow & { company: string | null }>> {
  const rows = (await db.prepare(
    `SELECT e.*, c.company_name_en AS company FROM events e LEFT JOIN cards c ON c.id = e.card_id
     WHERE e.route = 'test' AND e.actor IS NOT NULL ORDER BY e.received_at DESC LIMIT ?1`,
  ).bind(limit).all<EventRow & { company: string | null; errors: string | null }>()).results ?? [];
  return rows.map((r) => ({ ...r, errors: typeof r.errors === 'string' ? (JSON.parse(r.errors) as string[]) : null }));
}

// ------------------------------------------------------------------ scenarios

interface ScenarioInput { licence: string; email: string; today: string; nextYear: string }

export interface Scenario {
  id: string;
  label: string;
  note: string;
  expect: Expect;
  build: (i: ScenarioInput) => Record<string, unknown>;
}

const dmy = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

// English first (SPC, 27 October 2026). The names are invented.
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'typical',
    label: 'Typical licence',
    note: 'Every field, our own field names, English customer, a year to run.',
    expect: 'created',
    build: (i) => ({
      licence_number: i.licence,
      company_name_en: 'Bluefin Publishing FZE',
      company_name_ar: 'بلوفين للنشر م.م.ح',
      licence_type: 'Standard',
      activity_category: 'Book publishing',
      activity_category_ar: 'نشر الكتب',
      founder_name_en: 'Sara Ahmed',
      founder_name_ar: 'سارة أحمد',
      issued_on: i.today,
      expiry_date: i.nextYear,
      preferred_language: 'en',
      customer_email: i.email,
    }),
  },
  {
    id: 'erp-style',
    label: 'ERP-style field names',
    note: 'Capitalised names, DD/MM/YYYY dates, an activity list, and two fields we do not use.',
    expect: 'created',
    build: (i) => ({
      LicenseNo: i.licence,
      CompanyName: 'Harbour Light Trading FZE',
      CompanyNameAr: 'هاربر لايت للتجارة م.م.ح',
      Activities: [{ Description_EN: 'General trading', Description_AR: 'التجارة العامة' }],
      OwnerName: 'Daniel Mercer',
      EmailAddress: i.email,
      IssueDate: dmy(i.today),
      ExpiryDate: dmy(i.nextYear),
      Language: 'English',
      Branch: 'Sharjah',
      MobileNumber: '+971 50 000 0000',
    }),
  },
  {
    id: 'owner-object',
    label: 'Founder in an owner object',
    note: 'The founder\'s names and email inside an "owner" object.',
    expect: 'created',
    build: (i) => ({
      licence_number: i.licence,
      company_name: 'Cedarline Media FZ-LLC',
      activity: 'Digital media production',
      owner: { full_name: 'Omar Haddad', name_ar: 'عمر حداد', email: i.email },
      issue_date: i.today,
      licence_expiry: i.nextYear,
    }),
  },
  {
    id: 'arabic',
    label: 'Arabic-speaking customer',
    note: 'Preferred language Arabic: the email and the card open in Arabic.',
    expect: 'created',
    build: (i) => ({
      licence_number: i.licence,
      company_name_en: 'Al Waha Design FZ-LLC',
      company_name_ar: 'الواحة للتصميم ش.ذ.م.م - منطقة حرة',
      activity_category: 'Interior design',
      activity_category_ar: 'التصميم الداخلي',
      founder_name_en: 'Mariam Fawzy',
      founder_name_ar: 'مريم فوزي',
      issued_on: i.today,
      expiry_date: i.nextYear,
      preferred_language: 'ar',
      customer_email: i.email,
    }),
  },
  {
    id: 'no-email',
    label: 'No email address',
    note: 'The card is made; no welcome email goes out.',
    expect: 'created',
    build: (i) => ({
      licence_number: i.licence,
      company_name_en: 'Quiet Harbour Consulting FZE',
      activity_category: 'Management consultancy',
      founder_name_en: 'Priya Raman',
      issued_on: i.today,
      expiry_date: i.nextYear,
    }),
  },
  {
    id: 'missing',
    label: 'Missing company name',
    note: 'The ERP forgets a required field: the request is rejected with the reason.',
    expect: 'rejected',
    build: (i) => ({ licence_number: i.licence, founder_name_en: 'Sara Ahmed', customer_email: i.email }),
  },
];

/** A licence number no earlier run used: TEST-FLOW-<yymmdd>-<4 digits>. */
export function freshLicence(now = new Date()): string {
  const d = todayInDubai(now).replace(/-/g, '').slice(2);
  const n = crypto.getRandomValues(new Uint16Array(1))[0] ?? 0;
  return `TEST-FLOW-${d}-${String(n % 10000).padStart(4, '0')}`;
}

/** Who the test email goes to: the signed-in person when test cards may email them, else an allowed placeholder. */
export function defaultRecipient(env: Pick<Env, 'MAIL_TEST_ALLOWLIST'>, actor: string | null | undefined): string {
  if (actor && testRecipientAllowed(env, actor)) return actor;
  const first = (env.MAIL_TEST_ALLOWLIST ?? 'spcfz.ae').split(/[\s,]+/).map((s) => s.trim()).find(Boolean) ?? 'spcfz.ae';
  return first.includes('@') ? first : `test@${first.replace(/^@/, '')}`;
}

export function scenarioPayload(s: Scenario, licence: string, email: string, now = new Date()): string {
  const today = todayInDubai(now);
  const nextYear = addDays(`${today}T00:00:00.000Z`, 365).slice(0, 10);
  return JSON.stringify(s.build({ licence, email, today, nextYear }), null, 2);
}

// ------------------------------------------------------------------ follow-ups

export const FOLLOW_UPS = [
  { kind: 'same', label: 'Send the same licence again', expect: 'unchanged', what: 'Same link back, nothing changes, no second email.' },
  { kind: 'renewal', label: 'Send a renewal', expect: 'updated', what: 'Expiry a year later: same link, the card stays live, no second email.' },
  { kind: 'correction', label: 'Send a correction', expect: 'updated', what: 'A changed activity: the card updates behind the same link.' },
  { kind: 'expire', label: 'Send it as expired', expect: 'updated', what: 'Expired yesterday (issued a year before): the card page now says the licence has expired. A renewal brings it back.' },
] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number]['kind'];

/** The card's current details in our own field names, changed the way the follow-up says. */
export function followUpPayload(kind: FollowUp, card: CardRow, rawBody: string | null, now = new Date()): string {
  if (kind === 'same' && rawBody) return rawBody;
  const today = todayInDubai(now);
  const p: Record<string, unknown> = {
    licence_number: card.licence_number,
    company_name_en: card.company_name_en,
    company_name_ar: card.company_name_ar,
    licence_type: card.licence_type,
    activity_category: card.activity_category,
    activity_category_ar: card.activity_category_ar,
    founder_name_en: card.founder_name_en,
    founder_name_ar: card.founder_name_ar,
    issued_on: card.issued_on,
    expiry_date: card.licence_expires_on,
    preferred_language: card.preferred_language,
    customer_email: card.customer_email,
    cc_email: card.cc_email,
  };
  if (kind === 'renewal') {
    const from = card.licence_expires_on && card.licence_expires_on > today ? card.licence_expires_on : today;
    p['expiry_date'] = addDays(`${from}T00:00:00.000Z`, 365).slice(0, 10);
  } else if (kind === 'correction') {
    p['activity_category'] = card.activity_category?.endsWith(' (corrected)') ? card.activity_category.slice(0, -12) : `${card.activity_category ?? 'General trading'} (corrected)`;
  } else if (kind === 'expire') {
    // A licence that lapsed yesterday; the ERP refuses an expiry before the issue date, so a licence issued
    // after that is moved back a year, as a real lapsed licence would be.
    const yesterday = addDays(`${today}T00:00:00.000Z`, -1).slice(0, 10);
    p['expiry_date'] = yesterday;
    if (card.issued_on > yesterday) p['issued_on'] = addDays(`${yesterday}T00:00:00.000Z`, -365).slice(0, 10);
  }
  for (const k of Object.keys(p)) if (p[k] === null || p[k] === undefined) delete p[k];
  return JSON.stringify(p, null, 2);
}

// ------------------------------------------------------------------ pages

export const TEST_FLOW_CSS = `
.tf-intro{max-width:760px;color:var(--muted);margin:0 0 16px}
.tf-status{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}
.tf-pill{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:5px 12px;font-size:13px}
.tf-pill b{font-weight:700}
.tf-dot{width:8px;height:8px;border-radius:50%;background:#9aa7c0}
.tf-dot.on{background:var(--green)}.tf-dot.half{background:var(--gold)}
.tf-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:18px;align-items:start}
@media (max-width:860px){.tf-grid{grid-template-columns:1fr}}
.tf-scen{display:grid;gap:8px}
.tf-scen a{display:block;background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink)}
.tf-scen a:hover{border-color:#b9c8ea}
.tf-scen a.on{border-color:var(--blue);box-shadow:inset 0 0 0 1px var(--blue)}
.tf-scen b{display:block;font-size:14px}
.tf-scen span{display:block;color:var(--muted);font-size:12.5px}
.tf-json{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;min-height:340px;line-height:1.45}
.tf-steps{display:grid;gap:14px}
.tf-step{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.tf-step>.tf-h{display:flex;align-items:center;gap:10px;margin:0 0 10px;background:none;color:var(--ink)}
.tf-step>.tf-h h2{margin:0;font-size:16px}
.tf-step>.tf-h .tf-n{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;background:#eef2fa;color:var(--muted);flex:none}
.tf-step.ok>header .tf-n{background:#e7f7ee;color:#0f5a36}
.tf-step.bad>header .tf-n{background:#fdecec;color:#7a1a1a}
.tf-step.wait>header .tf-n{background:#fff6dd;color:#7a5a00}
.tf-step>.tf-h .tf-state{margin-inline-start:auto;font-size:13px;font-weight:700}
.tf-step.ok .tf-state{color:#0f5a36}.tf-step.bad .tf-state{color:#7a1a1a}.tf-step.wait .tf-state{color:#7a5a00}.tf-step.off .tf-state{color:var(--muted)}
.tf-step p{margin:6px 0}
.tf-two{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start}
@media (max-width:700px){.tf-two{grid-template-columns:1fr}}
.tf-qr{text-align:center;font-size:12px;color:var(--muted)}
.tf-qr svg{width:150px;height:150px;display:block;margin:0 auto 4px;border:1px solid var(--border);border-radius:8px}
.tf-pics{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
.tf-pics figure{margin:0;font-size:12px;color:var(--muted)}
.tf-pics img{display:block;height:150px;width:auto;border:1px solid var(--border);border-radius:8px;background:#eef2fa;margin-bottom:4px}
.tf-expect{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;margin:0 0 14px;font-weight:600}
.tf-expect.ok{background:#e7f7ee;border:1px solid #b9e6cb;color:#0f5a36}
.tf-expect.bad{background:#fdecec;border:1px solid #f5bcbc;color:#7a1a1a}
.tf-fields td:first-child{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.tf-warn{background:#fff6dd;border:1px solid #f1dc9c;color:#5c4300;border-radius:8px;padding:8px 12px;margin:10px 0 0;font-size:13px}
.tf-next{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.tf-next form{background:#f8faff;border:1px solid var(--border);border-radius:10px;padding:12px;display:grid;gap:6px;align-content:start}
.tf-next form .btn{justify-self:start}
.tf-next small{color:var(--muted)}
.tf-check{margin:0;padding-inline-start:18px}
.tf-check li{margin:4px 0}
`;

export interface StatusLine { mail: 'smtp' | 'file' | 'off'; linkedin: 'on' | 'pretend' | 'off'; erpConnected: boolean }

export function statusPills(s: StatusLine): RawHtml {
  const mail = s.mail === 'smtp'
    ? h`<span class="tf-pill"><i class="tf-dot on"></i>Email: <b>sending</b></span>`
    : s.mail === 'file'
      ? h`<span class="tf-pill"><i class="tf-dot half"></i>Email: <b>written to files</b> (local copy)</span>`
      : h`<span class="tf-pill"><i class="tf-dot"></i>Email: <b>off</b>, queued and previewable, not sent</span>`;
  const li = s.linkedin === 'on'
    ? h`<span class="tf-pill"><i class="tf-dot on"></i>Post to LinkedIn: <b>on</b></span>`
    : s.linkedin === 'pretend'
      ? h`<span class="tf-pill"><i class="tf-dot half"></i>Post to LinkedIn: <b>pretend</b> (local copy)</span>`
      : h`<span class="tf-pill"><i class="tf-dot"></i>Post to LinkedIn: <b>off</b> until the LinkedIn app is set up</span>`;
  const erp = s.erpConnected
    ? h`<span class="tf-pill"><i class="tf-dot on"></i>ERP: <b>allowlisted</b></span>`
    : h`<span class="tf-pill"><i class="tf-dot"></i>ERP: <b>not connected yet</b></span>`;
  return h`<div class="tf-status">${mail}${li}${erp}</div>`;
}

export interface FormPageInput {
  token: string;
  scenario: Scenario;
  payload: string;
  status: StatusLine;
  recipient: string;
  recipientAllowed: boolean;
  runs: Array<EventRow & { company: string | null }>;
}

export function formBody(i: FormPageInput): RawHtml {
  return h`<style>${raw(TEST_FLOW_CSS)}</style>
<p class="tf-intro">Send a licence exactly as the ERP will. It goes through the same checks, field mapping, card and welcome
email as the real webhook, and becomes a TEST card ([TEST] in its page title, left out of the counters, kept). Then follow the
run step by step, and try what the ERP does next.</p>
${statusPills(i.status)}
<div class="tf-grid">
<form class="form" method="post" action="/admin/test-flow">${csrfField(i.token)}
<input type="hidden" name="expect" value="${i.scenario.expect}">
<label>ERP payload <small>JSON, as the ERP would send it. Edit anything; field names are matched the same way as the webhook's.</small>
<textarea class="tf-json" name="payload" spellcheck="false">${i.payload}</textarea></label>
<label class="check"><input type="checkbox" name="send_email" value="1" checked> Send the welcome email
<small>(to ${i.recipient}${i.recipientAllowed ? '' : '; not on MAIL_TEST_ALLOWLIST, so it will be skipped'})</small></label>
<div class="actions"><button class="btn" type="submit">Send as the ERP</button>
<a class="btn secondary" href="/admin/test-flow?scenario=${i.scenario.id}">New licence number</a></div>
</form>
<div>
<h2 style="margin-top:0">Scenarios</h2>
<div class="tf-scen">${SCENARIOS.map((s) => h`<a class="${s.id === i.scenario.id ? 'on' : ''}" href="/admin/test-flow?scenario=${s.id}"><b>${s.label}</b><span>${s.note}</span></a>`)}</div>
</div>
</div>
<h2>Recent test runs</h2>
${table(['When', 'Company', 'Result', 'By', ''], i.runs.map((r) => [
  h`${fmtDateTime(r.received_at)}`,
  h`${r.company ?? '—'}`,
  h`<span class="outcome-${r.outcome === 'created' ? 'create' : r.outcome === 'updated' ? 'update' : r.outcome}">${r.outcome}</span>`,
  h`<span class="muted">${r.actor ?? ''}</span>`,
  h`<a href="/admin/test-flow/runs/${r.id}">Open run</a>`,
]), 'No test runs yet.')}`;
}

function step(n: number, title: string, state: 'ok' | 'bad' | 'wait' | 'off', stateText: string, body: RawHtml): RawHtml {
  return h`<section class="tf-step ${state}"><div class="tf-h"><span class="tf-n">${state === 'ok' ? '✓' : state === 'bad' ? '✕' : String(n)}</span><h2>${title}</h2><span class="tf-state">${stateText}</span></div>${body}</section>`;
}

function qr(url: string): RawHtml {
  return raw(renderSVG(url, { border: 2 }));
}

export interface RunPageInput {
  env: Env;
  token: string;
  ev: EventRow;
  card: CardRow | null;
  emails: EmailRow[];
  posts: LinkedinPostRow[];
  timeline: EventRow[];
  expect: Expect | null;
  status: StatusLine;
}

export function runBody(i: RunPageInput): RawHtml {
  const { ev, card } = i;
  const accepted = ev.http_status === 200 && card !== null;
  const base = i.env.BASE_URL.replace(/\/+$/, '');
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(base);
  const response = accepted && card
    ? { status: 'accepted', card_id: card.id, page_url: pageUrl(i.env, card.token), ready: card.status === 'ready' }
    : { status: 'rejected', errors: ev.errors ?? [] };
  let payload: unknown = null;
  try { payload = ev.raw_body ? JSON.parse(ev.raw_body) : null; } catch { payload = null; }
  const report = fieldReport(payload, i.env.FIELD_MAP);

  const expectLine = i.expect
    ? (i.expect === ev.outcome
      ? h`<div class="tf-expect ok">✓ Expected “${i.expect}” and got “${ev.outcome}”.</div>`
      : h`<div class="tf-expect bad">✕ Expected “${i.expect}” but got “${ev.outcome}”.</div>`)
    : EMPTY;

  // 1. The request
  const s1 = step(1, 'The ERP\'s request', accepted ? 'ok' : 'bad', accepted ? `Accepted: ${ev.outcome} (HTTP 200)` : `Rejected (HTTP ${ev.http_status})`, h`
${accepted ? EMPTY : h`<div class="error">${(ev.errors ?? []).length ? h`<ul>${(ev.errors ?? []).map((e) => h`<li>${e}</li>`)}</ul>` : 'Rejected.'}</div>`}
<p class="muted">What the ERP gets back:</p>
<pre>${JSON.stringify(response, null, 2)}</pre>
<p class="muted">How its fields were read:</p>
${table(['ERP field', 'Used as'], report.used.map(([f, k]) => [h`${f}`, h`${k}`]), 'No recognised fields.')}
${report.unused.length ? h`<div class="tf-warn">Not used by the card: <b>${report.unused.join(', ')}</b>. Fine for extra data; if one of these should be used, add it to FIELD_MAP.</div>` : EMPTY}
<details><summary class="muted">The payload as sent</summary><pre>${ev.raw_body ?? ''}</pre></details>`);

  if (!card) {
    return h`<style>${raw(TEST_FLOW_CSS)}</style>${expectLine}${statusPills(i.status)}<div class="tf-steps">${s1}</div>
<div class="actions"><a class="btn" href="/admin/test-flow">Start another test</a><a class="btn secondary" href="/admin/events/${ev.id}">Event in the log</a></div>`;
  }

  const expired = card.status === 'expired' || isPast(card.expires_at);
  const studioEn = `${base}/c/${card.token}?lang=en`;
  const studioAr = `${base}/c/${card.token}?lang=ar`;

  // 2. The card
  const s2 = step(2, 'The card', expired ? 'bad' : 'ok', expired ? 'Expired: the page says so' : 'Ready', h`
<div class="tf-two"><div>
${kv([
  ['Company', card.company_name_en],
  ['Company (Arabic)', card.company_name_ar ?? h`<span class="muted">not sent: the Arabic card uses the English name</span>`],
  ['Licence number', card.licence_number],
  ['Founder', card.founder_name_en ?? h`<span class="muted">not sent: the card shows the company only</span>`],
  ['Activity', card.activity_category ?? h`<span class="muted">not sent</span>`],
  ['Issued', formatFullDate(card.issued_on, 'en')],
  ['Licence expires', card.licence_expires_on ? formatFullDate(card.licence_expires_on, 'en') : h`<span class="muted">not sent: the card never expires</span>`],
  ['Language', card.preferred_language === 'ar' ? 'Arabic' : 'English'],
])}
<div class="actions"><a class="btn" href="${studioEn}" target="_blank" rel="noopener">Open the card</a>
<a class="btn secondary" href="${studioAr}" target="_blank" rel="noopener">Arabic version</a>
<a class="btn secondary" href="/admin/cards/${card.id}">Card in the admin</a></div>
</div>
<div class="tf-qr">${qr(studioEn)}Scan to open on a phone${local ? h`<br><b>Local copy:</b> a phone cannot reach localhost` : EMPTY}</div></div>
<div class="tf-pics">
<figure><img src="${cardImagePath(card, 'en')}" alt="The card picture in the email">The picture in the email</figure>
<figure><img src="${previewPath(card, 'en')}" alt="The link preview picture">The link preview (WhatsApp, LinkedIn)</figure>
</div>`);

  // 3. The welcome email
  const latest = i.emails[0] ?? null;
  const mailState: ['ok' | 'bad' | 'wait' | 'off', string] = !card.customer_email
    ? ['off', 'No email address: none sent']
    : !latest ? ['off', 'Not queued (the box was unticked)']
      : latest.status === 'sent' ? ['ok', `Sent ${fmtDateTime(latest.sent_at)}`]
        : latest.status === 'queued' ? ['wait', i.status.mail === 'off' ? 'Queued: email is off on this server' : 'Queued: sending…']
          : latest.status === 'skipped' ? ['off', latest.last_error?.startsWith('unsubscribed') ? 'Unsubscribed: not sent' : 'Skipped']
            : ['bad', 'Failed'];
  const s3 = step(3, 'The welcome email', mailState[0], mailState[1], h`
${card.customer_email ? h`<p>To <b>${card.customer_email}</b>${card.cc_email ? h`, copy to <b>${card.cc_email}</b>` : EMPTY}, in ${card.preferred_language === 'ar' ? 'Arabic' : 'English'}.</p>` : h`<p class="muted">Add customer_email to the payload to test the email.</p>`}
${latest?.last_error ? h`<div class="tf-warn">${latest.last_error}</div>` : EMPTY}
${latest && latest.status === 'sent' && i.status.mail === 'file' ? h`<p class="muted">Local copy: the email is a file in DATA_DIR/mail-outbox.</p>` : EMPTY}
<div class="actions"><a class="btn secondary" href="/admin/cards/${card.id}/email-preview?lang=en" target="_blank" rel="noopener">Preview the email</a>
<a class="btn secondary" href="/admin/cards/${card.id}/email-preview?lang=ar" target="_blank" rel="noopener">Arabic email</a>
${card.customer_email ? h`<form method="post" action="/admin/cards/${card.id}/email">${csrfField(i.token)}<input type="hidden" name="back" value="/admin/test-flow/runs/${ev.id}"><button class="btn secondary" type="submit">Send it again</button></form>` : EMPTY}</div>`);

  // 4. LinkedIn
  const posted = i.posts.find((p) => p.status === 'posted') ?? null;
  const liState: ['ok' | 'bad' | 'wait' | 'off', string] = i.status.linkedin === 'off'
    ? ['off', 'Off on this server']
    : posted ? ['ok', 'Posted'] : i.posts.length ? ['bad', 'Last try failed'] : ['wait', 'Not tried yet'];
  const s4 = step(4, 'Post to LinkedIn', liState[0], liState[1], h`
${i.status.linkedin === 'off'
    ? h`<p class="muted">The buttons are hidden until LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are set (docs/RUNBOOK.md).</p>`
    : h`<p>From the card: choose a photo or “Use initials”, go to Share, press <b>Post to LinkedIn</b>. From the email: its button below.</p>
<div class="actions"><a class="btn secondary" href="${base}/c/${card.token}/linkedin?lang=en&amp;via=email" target="_blank" rel="noopener">The email's “Post on LinkedIn”</a></div>`}
${i.posts.length ? table(['When', 'Result', ''], i.posts.map((p) => [
    h`${fmtDateTime(p.created_at)}`,
    h`${p.status}`,
    p.post_urn ? h`<a href="https://www.linkedin.com/feed/update/${p.post_urn}/" target="_blank" rel="noopener">View the post</a>` : h`<span class="muted">${p.error ?? ''}</span>`,
  ])) : EMPTY}`);

  // 5. What the ERP does next
  const s5 = step(5, 'What the ERP does next', 'off', 'Try each one', h`
<div class="tf-next">${FOLLOW_UPS.map((f) => h`<form method="post" action="/admin/test-flow/runs/${ev.id}/next">${csrfField(i.token)}<input type="hidden" name="kind" value="${f.kind}"><b>${f.label}</b><small>${f.what}</small><button class="btn small" type="submit">Send</button></form>`)}</div>`);

  // 6. By hand
  const s6 = step(6, 'Check by hand', 'off', 'On a phone and a computer', h`
<ul class="tf-check">
<li>Open the email on your phone and on a computer; try both buttons.</li>
<li>On the card: switch styles and sizes, add a photo, edit the caption, then Share (phone) and Download (computer).</li>
<li>Paste the card's link into WhatsApp: the preview shows the company's name.</li>
<li>Switch to Arabic and check the card, the caption and the email.</li>
</ul>`);

  const timeline = table(['When', 'Route', 'Result', 'By'], i.timeline.map((e) => [
    h`${fmtDateTime(e.received_at)}`,
    h`${e.route}`,
    h`<a href="/admin/events/${e.id}">${e.outcome}</a>${e.id === ev.id ? h` <span class="muted">(this run)</span>` : EMPTY}`,
    h`<span class="muted">${e.actor ?? 'ERP'}</span>`,
  ]), 'Nothing yet.');

  return h`<style>${raw(TEST_FLOW_CSS)}</style>
${expectLine}
${statusPills(i.status)}
<div class="tf-steps">${s1}${s2}${s3}${s4}${s5}${s6}</div>
<h2>Everything that happened to this card</h2>
${timeline}
<div class="actions"><a class="btn" href="/admin/test-flow">Start another test</a></div>`;
}
