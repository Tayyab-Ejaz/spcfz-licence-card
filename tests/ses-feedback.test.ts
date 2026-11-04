// Amazon SES bounce and complaint feedback through SNS (src/mail/ses-feedback.ts): only messages signed for SPC's
// topic count; permanent bounces and complaints suppress the address, and the card's next email is not sent.
import { generateKeyPairSync, createSign } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CardRow } from '../src/types.js';
import { getCardById, insertCard, setCardStatus } from '../src/db/cards.js';
import { emailsForCard, insertEmail, suppression } from '../src/db/emails.js';
import { DEFAULT_FEEDBACK_TOPIC, FEEDBACK_PATH, createSesFeedbackRoutes, stringToSign } from '../src/mail/ses-feedback.js';
import type { SnsMessage } from '../src/mail/ses-feedback.js';
import { queueWelcome } from '../src/mail/outbox.js';
import { randomToken } from '../src/util/crypto.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-test.pem';
const SUBSCRIBE_URL = 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc';

let fetched: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (url === CERT_URL) return new Response(PUBLIC_PEM);
  if (url === SUBSCRIBE_URL) return new Response('<ConfirmSubscriptionResponse/>');
  return new Response('no', { status: 404 });
}) as typeof fetch;

const app = new Hono<AppEnv>();
app.route('/', createSesFeedbackRoutes({ fetch: fakeFetch }));

function signed(m: Omit<SnsMessage, 'Signature' | 'SignatureVersion' | 'SigningCertURL'> & Partial<SnsMessage>, version: '1' | '2' = '1'): SnsMessage {
  const full = { SignatureVersion: version, SigningCertURL: CERT_URL, Signature: '', ...m } as SnsMessage;
  const text = stringToSign(full);
  if (!text) throw new Error('unsigned type');
  full.Signature = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256').update(text, 'utf8').sign(privateKey, 'base64');
  return full;
}

function notification(message: unknown, version: '1' | '2' = '1'): SnsMessage {
  return signed({
    Type: 'Notification', MessageId: randomToken(), TopicArn: DEFAULT_FEEDBACK_TOPIC,
    Message: JSON.stringify(message), Timestamp: '2026-11-04T09:00:00.000Z',
  }, version);
}

const post = (body: unknown) => app.request(FEEDBACK_PATH, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'text/plain; charset=UTF-8' } }, env);

let seq = 0;
async function cardEmailed(email: string): Promise<CardRow> {
  seq += 1;
  const created = await insertCard(env.DB, {
    token: randomToken(),
    is_test: false,
    fields: {
      licence_number: `SPC-FB-${seq}`, company_name_en: 'Harbour Books FZE', company_name_ar: null, licence_type: null,
      activity_category: 'Publishing', activity_category_ar: null, founder_name_en: null, founder_name_ar: null,
      issued_on: '2026-11-01', preferred_language: 'en', licence_expires_on: null, customer_email: email, cc_email: null,
    },
    content_hash: `feedback${seq}`,
    source: 'manual',
    expires_at: null,
  });
  await setCardStatus(env.DB, created.id, 'ready');
  await insertEmail(env.DB, { card_id: created.id, kind: 'welcome', to_email: email, cc_email: null, lang: 'en', status: 'sent', actor: null, now: '2026-11-01T08:00:00.000Z' });
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed');
  return card;
}

beforeEach(() => { fetched = []; });

describe('SES feedback through SNS', () => {
  it('confirms the subscription only from a signed message for SPC\'s topic', async () => {
    const res = await post(signed({
      Type: 'SubscriptionConfirmation', MessageId: 'm1', TopicArn: DEFAULT_FEEDBACK_TOPIC, Message: 'Confirm',
      Timestamp: '2026-11-04T09:00:00.000Z', Token: 'abc', SubscribeURL: SUBSCRIBE_URL,
    }));
    expect(res.status).toBe(200);
    expect(fetched).toEqual([CERT_URL, SUBSCRIBE_URL]);
  });

  it('suppresses a permanently bounced address and links it to the card; the next welcome email is not sent', async () => {
    const card = await cardEmailed('gone@harbour.example');
    const res = await post(notification({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'Gone@Harbour.example' }] },
      mail: { destination: ['gone@harbour.example'] },
    }, '2'));
    expect(res.status).toBe(200);
    expect(await suppression(env.DB, 'gone@harbour.example')).toMatchObject({ source: 'bounce', card_id: card.id });
    expect(await queueWelcome(env, card, { actor: null, force: true })).toBe('unsubscribed');
    const [row] = await emailsForCard(env.DB, card.id);
    expect(row).toMatchObject({ status: 'skipped' });
    expect(row?.last_error).toMatch(/^bounced: /);
  });

  it('suppresses a complaint, and ignores transient bounces and the alarm messages on the same topic', async () => {
    await post(notification({ notificationType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'Reader <angry@harbour.example>' }] } }));
    expect(await suppression(env.DB, 'angry@harbour.example')).toMatchObject({ source: 'complaint' });
    expect((await post(notification({ notificationType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'full@harbour.example' }] } }))).status).toBe(200);
    expect(await suppression(env.DB, 'full@harbour.example')).toBeNull();
    expect((await post(notification({ AlarmName: 'ses-bounce-rate-2pct', NewStateValue: 'ALARM' }))).status).toBe(200);
  });

  it('refuses a forged signature, another topic and a certificate off AWS, changing nothing', async () => {
    const forged = notification({ notificationType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'victim@harbour.example' }] } });
    forged.Message = forged.Message.replace('victim', 'other');
    expect((await post(forged)).status).toBe(403);
    expect((await post({ ...notification({}), TopicArn: 'arn:aws:sns:ap-south-1:111122223333:someone-else' })).status).toBe(403);
    fetched = [];
    const offAws = signed({ Type: 'Notification', MessageId: 'x', TopicArn: DEFAULT_FEEDBACK_TOPIC, Message: '{}', Timestamp: '2026-11-04T09:00:00.000Z', SigningCertURL: 'https://evil.example/cert.pem' });
    expect((await post(offAws)).status).toBe(403);
    expect(fetched).toEqual([]);
    expect((await post('not json')).status).toBe(400);
    expect(await suppression(env.DB, 'victim@harbour.example')).toBeNull();
    expect(await suppression(env.DB, 'other@harbour.example')).toBeNull();
  });

  it('answers Not found when switched off', async () => {
    const off = createTestEnv({ SES_FEEDBACK_TOPIC: 'off' });
    expect((await app.request(FEEDBACK_PATH, { method: 'POST', body: JSON.stringify(notification({})) }, off)).status).toBe(404);
  });
});
