// Amazon SES bounce and complaint feedback (4 November 2026, for SES's sending review). SES reports each bounce and
// complaint for spcfz.ae and more@spcfz.ae to the SNS topic ses-bounces-complaints, which emails SPC and also POSTs
// here once this address is subscribed (docs/RUNBOOK.md). A permanent bounce or a complaint adds the address to
// email_suppressions (source bounce or complaint): the service never emails it again and the admin card says why.
// Only messages signed by Amazon SNS for the expected topic are accepted; anything else gets 403 and changes nothing.
import { createVerify } from 'node:crypto';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../types.js';
import { cardIdForAddress, suppress } from '../db/emails.js';
import { nowIso } from '../util/time.js';

/** SPC's topic (account 275472740409, Mumbai). SES_FEEDBACK_TOPIC replaces it; off turns this address off. */
export const DEFAULT_FEEDBACK_TOPIC = 'arn:aws:sns:ap-south-1:275472740409:ses-bounces-complaints';
export const FEEDBACK_PATH = '/aws/ses-feedback';

/** SNS messages are at most 256 KB. */
const MAX_BODY = 256 * 1024;
/** Where SNS keeps its signing certificates and subscription links. */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

export function feedbackTopic(env: Pick<Env, 'SES_FEEDBACK_TOPIC'>): string | null {
  const v = (env.SES_FEEDBACK_TOPIC ?? DEFAULT_FEEDBACK_TOPIC).trim();
  return v.toLowerCase() === 'off' ? null : v;
}

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

/** An https URL on an SNS host (and, for a certificate, ending in .pem); null otherwise. */
function snsUrl(raw: unknown, pem = false): URL | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || !SNS_HOST.test(u.hostname)) return null;
  return pem && !u.pathname.endsWith('.pem') ? null : u;
}

/** The text SNS signs (AWS docs, "Verifying the signatures of Amazon SNS messages"); null for an unknown type. */
export function stringToSign(m: Partial<SnsMessage>): string | null {
  const keys = m.Type === 'Notification'
    ? ['Message', 'MessageId', ...(m.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : m.Type === 'SubscriptionConfirmation' || m.Type === 'UnsubscribeConfirmation'
      ? ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
      : null;
  if (!keys) return null;
  let out = '';
  for (const k of keys) {
    const v = (m as Record<string, unknown>)[k];
    if (typeof v !== 'string') return null;
    out += `${k}\n${v}\n`;
  }
  return out;
}

/** "Name <a@b.c>" or "a@b.c" as a@b.c, lower-cased; null when it is not one address. */
function addressOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const inner = /<([^<>]+)>/.exec(raw)?.[1] ?? raw;
  const s = inner.trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(s) ? s : null;
}

/**
 * Records one SES notification (the SNS message's Message). Permanent bounces and complaints suppress their
 * recipients; transient bounces, deliveries and CloudWatch alarm messages on the same topic change nothing.
 * Returns how many addresses were recorded.
 */
export async function recordFeedback(env: Env, message: string, now: string = nowIso()): Promise<number> {
  let n: Record<string, unknown>;
  try {
    n = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return 0;
  }
  const type = n['notificationType'] ?? n['eventType'];
  const bounce = n['bounce'] as { bounceType?: unknown; bouncedRecipients?: unknown } | undefined;
  const complaint = n['complaint'] as { complainedRecipients?: unknown } | undefined;
  let source: 'bounce' | 'complaint';
  let recipients: unknown;
  if (type === 'Bounce' && bounce?.bounceType === 'Permanent') {
    source = 'bounce';
    recipients = bounce.bouncedRecipients;
  } else if (type === 'Complaint') {
    source = 'complaint';
    recipients = complaint?.complainedRecipients;
  } else {
    console.log('ses feedback', { step: 'ignored', type: typeof type === 'string' ? type : 'other' });
    return 0;
  }
  let count = 0;
  for (const r of Array.isArray(recipients) ? recipients.slice(0, 50) : []) {
    const email = addressOf((r as { emailAddress?: unknown } | null)?.emailAddress);
    if (!email) continue;
    await suppress(env.DB, { email, card_id: await cardIdForAddress(env.DB, email), source, created_at: now });
    count++;
  }
  console.log('ses feedback', { step: source, recipients: count });
  return count;
}

export interface FeedbackOptions {
  /** For tests: stands in for fetching SNS certificates and subscription links. */
  fetch?: typeof fetch;
}

export function createSesFeedbackRoutes(o: FeedbackOptions = {}): Hono<AppEnv> {
  const doFetch = o.fetch ?? fetch;
  const certs = new Map<string, string>();

  async function certificate(url: URL): Promise<string> {
    const hit = certs.get(url.href);
    if (hit) return hit;
    const res = await doFetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`certificate: ${res.status}`);
    const pem = await res.text();
    if (!pem.includes('-----BEGIN')) throw new Error('certificate: not PEM');
    if (certs.size >= 20) certs.clear();
    certs.set(url.href, pem);
    return pem;
  }

  async function signedBySns(m: SnsMessage): Promise<boolean> {
    const text = stringToSign(m);
    const url = snsUrl(m.SigningCertURL, true);
    const algorithm = m.SignatureVersion === '1' ? 'RSA-SHA1' : m.SignatureVersion === '2' ? 'RSA-SHA256' : null;
    if (!text || !url || !algorithm || typeof m.Signature !== 'string') return false;
    try {
      return createVerify(algorithm).update(text, 'utf8').verify(await certificate(url), m.Signature, 'base64');
    } catch (err) {
      console.warn('ses feedback', { step: 'certificate', message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  const app = new Hono<AppEnv>();

  app.post(FEEDBACK_PATH, async (c) => {
    const topic = feedbackTopic(c.env);
    if (!topic) return c.text('Not found', 404);
    if (Number(c.req.header('Content-Length') ?? '0') > MAX_BODY) return c.text('Too large', 413);
    const body = await c.req.text();
    if (body.length > MAX_BODY) return c.text('Too large', 413);
    let m: SnsMessage;
    try {
      m = JSON.parse(body) as SnsMessage;
    } catch {
      return c.text('Bad request', 400);
    }
    if (!m || typeof m !== 'object' || Array.isArray(m) || m.TopicArn !== topic) return c.text('Forbidden', 403);
    if (!(await signedBySns(m))) {
      console.warn('ses feedback', { step: 'signature', type: typeof m.Type === 'string' ? m.Type : 'other' });
      return c.text('Forbidden', 403);
    }
    if (m.Type === 'SubscriptionConfirmation') {
      const url = snsUrl(m.SubscribeURL);
      if (!url) return c.text('Forbidden', 403);
      const res = await doFetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      console.log('ses feedback', { step: 'subscribed', status: res.status });
      return res.ok ? c.text('Subscribed') : c.text('Could not confirm', 502);
    }
    if (m.Type !== 'Notification') return c.text('OK');
    return c.text(`OK ${await recordFeedback(c.env, m.Message)}`);
  });

  return app;
}
