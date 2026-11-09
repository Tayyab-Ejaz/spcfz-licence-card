// Sending the monthly impact report (./impact.ts, ./email.ts). Rows in report_emails (migrations/0010_reports.sql),
// sent by the same 30-second worker as the other emails (src/server.ts), with the same retries.
//   - The daily run (src/server.ts dailyTask) on the 1st to 3rd of a month queues the month before for the addresses
//     in Admin → Settings (report_to; empty: DEFAULT_REPORT_TO; "off": nobody), once, to go at 09:00 Dubai time.
//   - Admin → Report → Send queues the month shown, to those addresses or to the signed-in admin.
import type { D1Database, Env } from '../types.js';
import { getSetting } from '../db/cards.js';
import { ulid } from '../util/crypto.js';
import { nowIso } from '../util/time.js';
import { parseAddressList } from '../mail/post-alert.js';
import { RETRY_MINUTES, nudgeOutbox } from '../mail/outbox.js';
import type { MailTransport } from '../mail/transport.js';
import { buildReport, dubaiMonth, previousMonth } from './impact.js';
import type { ImpactReport } from './impact.js';
import { renderReportEmail } from './email.js';

export interface ReportEmailRow {
  id: string;
  month: string;
  to_email: string;
  status: 'queued' | 'sent' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  provider_id: string | null;
  subject: string | null;
  actor: string | null;
  created_at: string;
  sent_at: string | null;
}

/** Who gets the report when Admin → Settings names nobody (SPC, 9 November 2026: tayyab@spcfz.ae gets everything). */
export const DEFAULT_REPORT_TO = 'tayyab@spcfz.ae';

/** The addresses in Admin → Settings (report_to); DEFAULT_REPORT_TO when it is empty; nobody for "off". */
export async function reportRecipients(db: D1Database): Promise<string[]> {
  const v = (await getSetting(db, 'report_to')).trim();
  if (v.toLowerCase() === 'off') return [];
  return parseAddressList(v || DEFAULT_REPORT_TO).list;
}

/** Queue `month` for each address, to go at `at` (default now); returns how many rows were queued. */
export async function queueReport(db: D1Database, o: { month: string; to: string[]; actor: string | null; at?: string; now?: string }): Promise<number> {
  const now = o.now ?? nowIso();
  for (const to of o.to) {
    await db.prepare(`INSERT INTO report_emails (id, month, to_email, status, attempts, next_attempt_at, actor, created_at)
      VALUES (?1, ?2, ?3, 'queued', 0, ?4, ?5, ?6)`).bind(ulid(), o.month, to, o.at ?? now, o.actor, now).run();
  }
  if (o.to.length) nudgeOutbox();
  return o.to.length;
}

export async function reportSends(db: D1Database, month: string): Promise<ReportEmailRow[]> {
  return (await db.prepare('SELECT * FROM report_emails WHERE month = ?1 ORDER BY created_at DESC LIMIT 50').bind(month).all<ReportEmailRow>()).results ?? [];
}

/** 09:00 on the 1st of the Dubai month that `now` falls in, as an ISO instant (05:00 UTC). */
function firstAtNine(now: Date): string {
  const [y, m] = dubaiMonth(now).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1, 5)).toISOString();
}

/**
 * The daily run's part: on the 1st to 3rd of a Dubai month, queue the month before for report_to, once (a later day
 * catches up when the server was down on the 1st). Returns the rows queued.
 */
export async function queueMonthlyReport(env: Env, now: Date = new Date()): Promise<number> {
  const day = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric' }).format(now));
  if (day > 3) return 0;
  const month = previousMonth(dubaiMonth(now));
  const done = await env.DB.prepare('SELECT 1 AS x FROM report_emails WHERE month = ?1 AND actor IS NULL LIMIT 1').bind(month).first<{ x: number }>();
  if (done) return 0;
  const to = await reportRecipients(env.DB);
  if (!to.length) return 0;
  const nine = firstAtNine(now);
  const at = nine > nowIso(now) ? nine : nowIso(now);
  const n = await queueReport(env.DB, { month, to, actor: null, at, now: nowIso(now) });
  console.log('monthly report queued', { month, recipients: n, at });
  return n;
}

export interface ReportSummary { sent: number; retried: number; failed: number }

/** Send the report emails that are due. Never throws: each row records its outcome. */
export async function processReports(env: Env, transport: MailTransport | null, now: Date = new Date()): Promise<ReportSummary> {
  const summary: ReportSummary = { sent: 0, retried: 0, failed: 0 };
  if (!transport) return summary;
  const due = (await env.DB.prepare("SELECT * FROM report_emails WHERE status = 'queued' AND next_attempt_at <= ?1 ORDER BY next_attempt_at LIMIT 10")
    .bind(nowIso(now)).all<ReportEmailRow>()).results ?? [];
  const reports = new Map<string, ImpactReport>();
  for (const row of due) {
    let subject: string | null = null;
    try {
      const report = reports.get(row.month) ?? await buildReport(env.DB, row.month);
      reports.set(row.month, report);
      const mail = renderReportEmail(report, env.BASE_URL);
      subject = mail.subject;
      const sent = await transport.send({ to: row.to_email, cc: null, subject: mail.subject, html: mail.html, text: mail.text });
      await env.DB.prepare("UPDATE report_emails SET status = 'sent', attempts = attempts + 1, subject = ?2, provider_id = ?3, sent_at = ?4, next_attempt_at = NULL, last_error = NULL WHERE id = ?1")
        .bind(row.id, mail.subject, sent.id, nowIso()).run();
      console.log('report sent', { month: row.month, mode: transport.mode });
      summary.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const wait = RETRY_MINUTES[row.attempts];
      const next = wait === undefined ? null : new Date(now.getTime() + wait * 60_000).toISOString();
      await env.DB.prepare(`UPDATE report_emails SET attempts = attempts + 1, last_error = ?2, next_attempt_at = ?3, subject = COALESCE(?4, subject),
        status = CASE WHEN ?3 IS NULL THEN 'failed' ELSE 'queued' END WHERE id = ?1`).bind(row.id, message.slice(0, 500), next, subject).run();
      console.warn('report failed', { month: row.month, attempt: row.attempts + 1, giving_up: next === null, message });
      if (next === null) summary.failed++;
      else summary.retried++;
    }
  }
  return summary;
}
