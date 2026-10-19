// Intake module: router behaviour against the isolated D1, plus pure tests for the mapper and validator.
// Bindings (allowlist, secrets, BASE_URL) come from tests/env.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types.js';
import { intakeRoutes } from '../src/intake/routes.js';
import { mapPayload } from '../src/intake/mapper.js';
import { validateCanonical } from '../src/intake/validate.js';
import { checkSecret, extractSecret } from '../src/intake/auth.js';
import { countCards, findCardByLicence, getCardByToken, listEvents } from '../src/db/cards.js';
import { todayInDubai } from '../src/util/time.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();
const app = new Hono<AppEnv>().route('/', intakeRoutes);

const PROD = '/v1/licence-issued';
const TEST = '/v1/test/licence-issued';
const IP = '203.0.113.10';
const PROD_SECRET = 'test-production-secret-current';
const PROD_PREVIOUS = 'test-production-secret-previous';
const TEST_SECRET = 'test-test-secret-current';

interface AcceptedBody {
  status: 'accepted';
  card_id: string;
  page_url: string;
  ready: boolean;
}
interface RejectedBody {
  status: 'rejected';
  errors: string[];
}

interface PostOptions {
  ip?: string;
  /** undefined = the right secret for the route; null = send none. */
  secret?: string | null;
  bearer?: boolean;
  /** Send this exact text instead of JSON.stringify(payload). */
  raw?: string;
  headers?: Record<string, string>;
}

async function post(path: string, payload: unknown, o: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': o.ip ?? IP,
    ...(o.headers ?? {}),
  };
  const secret = o.secret === undefined ? (path === TEST ? TEST_SECRET : PROD_SECRET) : o.secret;
  if (secret !== null) {
    if (o.bearer) headers['Authorization'] = `Bearer ${secret}`;
    else headers['X-SPC-Webhook-Secret'] = secret;
  }
  const body = o.raw ?? JSON.stringify(payload);
  return app.request(path, { method: 'POST', headers, body }, env);
}

async function accepted(res: Response): Promise<AcceptedBody> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as AcceptedBody;
  expect(body.status).toBe('accepted');
  return body;
}

async function rejected(res: Response, status: number): Promise<RejectedBody> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as RejectedBody;
  expect(body.status).toBe('rejected');
  expect(Array.isArray(body.errors)).toBe(true);
  return body;
}

const TOKEN_RE = /^https:\/\/licensed\.test\/c\/([0-9A-Za-z]{22})$/;

function tokenOf(pageUrl: string): string {
  const m = TOKEN_RE.exec(pageUrl);
  expect(m).not.toBeNull();
  return m?.[1] ?? '';
}

const SAMPLE = {
  licence_number: 'SPC-2026-00001',
  company_name_en: 'Nimbus Publishing FZE',
  company_name_ar: 'نيمبوس للنشر م.م.ح',
  licence_type: 'Standard',
  activity_category: 'Publishing',
  issued_on: '2026-10-15',
  preferred_language: 'en',
};

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM cards'), env.DB.prepare('DELETE FROM events')]);
});

describe('intake routes: access checks', () => {
  it('rejects an IP that is not on the allowlist with 403 and logs the event', async () => {
    const res = await post(PROD, SAMPLE, { ip: '192.0.2.1' });
    const body = await rejected(res, 403);
    expect(body.errors).toEqual(['source address not allowed']);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const { rows, total } = await listEvents(env.DB, { route: 'production' });
    expect(total).toBe(1);
    expect(rows[0]?.outcome).toBe('rejected');
    expect(rows[0]?.http_status).toBe(403);
    expect(rows[0]?.source_ip).toBe('192.0.2.1');
    expect(rows[0]?.errors).toEqual(['source address not allowed']);
    expect(rows[0]?.card_id).toBeNull();
    expect(await countCards(env.DB)).toBe(0);
  });

  it('rejects a missing CF-Connecting-IP header with 403', async () => {
    const res = await app.request(
      PROD,
      { method: 'POST', headers: { 'X-SPC-Webhook-Secret': PROD_SECRET }, body: JSON.stringify(SAMPLE) },
      env,
    );
    await rejected(res, 403);
    const { rows } = await listEvents(env.DB, { route: 'production' });
    expect(rows[0]?.source_ip).toBe('unknown');
  });

  it('accepts an IP inside an allowlisted CIDR block', async () => {
    const res = await post(PROD, SAMPLE, { ip: '198.51.100.77' });
    await accepted(res);
  });

  it('rejects a wrong secret with 401', async () => {
    const res = await post(PROD, SAMPLE, { secret: 'nope' });
    const body = await rejected(res, 401);
    expect(body.errors).toEqual(['invalid secret']);
    const { rows } = await listEvents(env.DB, { route: 'production' });
    expect(rows[0]?.http_status).toBe(401);
  });

  it('rejects a missing secret with 401', async () => {
    const res = await post(PROD, SAMPLE, { secret: null });
    await rejected(res, 401);
  });

  it('rejects the test secret on the production route and the other way round', async () => {
    await rejected(await post(PROD, SAMPLE, { secret: TEST_SECRET }), 401);
    await rejected(await post(TEST, SAMPLE, { secret: PROD_SECRET }), 401);
  });

  it('accepts the previous production secret', async () => {
    const res = await post(PROD, SAMPLE, { secret: PROD_PREVIOUS });
    await accepted(res);
  });

  it('accepts the secret in an Authorization: Bearer header', async () => {
    const res = await post(PROD, SAMPLE, { bearer: true });
    await accepted(res);
  });

  it('answers 405 to other methods on both paths', async () => {
    for (const path of [PROD, TEST]) {
      const res = await app.request(path, { method: 'GET', headers: { 'CF-Connecting-IP': IP } }, env);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });
});

describe('intake routes: body checks', () => {
  it('rejects a body that is not JSON with 400', async () => {
    const res = await post(PROD, null, { raw: 'this is not json' });
    const body = await rejected(res, 400);
    expect(body.errors).toEqual(['body is not a JSON object']);
  });

  it('rejects a JSON array with 400', async () => {
    const res = await post(PROD, null, { raw: '[{"licence_number":"SPC-1"}]' });
    const body = await rejected(res, 400);
    expect(body.errors).toEqual(['body is not a JSON object']);
  });

  it('rejects an empty body with 400', async () => {
    const res = await post(PROD, null, { raw: '' });
    await rejected(res, 400);
  });

  it('rejects a 70 KB body with 413', async () => {
    const big = JSON.stringify({ ...SAMPLE, padding: 'x'.repeat(70 * 1024) });
    const res = await post(PROD, null, { raw: big });
    await rejected(res, 413);
    expect(await countCards(env.DB)).toBe(0);
    const { rows } = await listEvents(env.DB, { route: 'production' });
    expect(rows[0]?.http_status).toBe(413);
  });

  it('lists the missing licence number as a field error', async () => {
    const res = await post(PROD, { company_name_en: 'No Licence Co' });
    const body = await rejected(res, 400);
    expect(body.errors).toContain('licence_number: required');
    expect(await countCards(env.DB)).toBe(0);
  });

  it('collects every field error in one answer', async () => {
    const res = await post(PROD, { licence_number: 'AB', company_name_en: 'X', issued_on: 'someday', preferred_language: 'fr' });
    const body = await rejected(res, 400);
    expect(body.errors).toHaveLength(4);
    expect(body.errors.some((e) => e.startsWith('licence_number:'))).toBe(true);
    expect(body.errors.some((e) => e.startsWith('company_name_en:'))).toBe(true);
    expect(body.errors).toContain('issued_on: unrecognised date');
    expect(body.errors.some((e) => e.startsWith('preferred_language:'))).toBe(true);
  });
});

describe('intake routes: happy path and idempotency', () => {
  it('creates a card, returns a 22-char token URL and logs created', async () => {
    const res = await post(PROD, SAMPLE);
    const body = await accepted(res);
    expect(body.ready).toBe(true); // the studio builds the card in the browser; nothing to wait for
    expect(body.card_id).toMatch(/^[0-9A-Z]{26}$/);
    const token = tokenOf(body.page_url);
    expect(token).toHaveLength(22);

    const card = await getCardByToken(env.DB, token);
    expect(card).not.toBeNull();
    expect(card?.id).toBe(body.card_id);
    expect(card?.status).toBe('ready');
    expect(card?.is_test).toBe(false);
    expect(card?.source).toBe('webhook');
    expect(card?.licence_number).toBe('SPC-2026-00001');
    expect(card?.company_name_en).toBe('Nimbus Publishing FZE');
    expect(card?.company_name_ar).toBe(SAMPLE.company_name_ar);
    expect(card?.licence_type).toBe('Standard');
    expect(card?.activity_category).toBe('Publishing');
    expect(card?.issued_on).toBe('2026-10-15');
    expect(card?.preferred_language).toBe('en');
    expect(card?.template_version).toBeNull();
    expect(card?.licence_expires_on).toBeNull();
    expect(card?.expires_at).toBeNull(); // no licence expiry date: the card never expires
    expect(card?.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const { rows, total } = await listEvents(env.DB, { route: 'production' });
    expect(total).toBe(1);
    expect(rows[0]?.outcome).toBe('created');
    expect(rows[0]?.http_status).toBe(200);
    expect(rows[0]?.card_id).toBe(body.card_id);
    expect(rows[0]?.errors).toBeNull();
    expect(rows[0]?.raw_body).toBeNull();
  });

  it('answers unchanged for the same payload, same URL, still one card', async () => {
    const first = await accepted(await post(PROD, SAMPLE));
    const second = await accepted(await post(PROD, SAMPLE));
    expect(second.page_url).toBe(first.page_url);
    expect(second.card_id).toBe(first.card_id);
    expect(await countCards(env.DB)).toBe(1);

    const unchanged = await listEvents(env.DB, { route: 'production', outcome: 'unchanged' });
    expect(unchanged.total).toBe(1);
    expect(unchanged.rows[0]?.card_id).toBe(first.card_id);
    const created = await listEvents(env.DB, { route: 'production', outcome: 'created' });
    expect(created.total).toBe(1);
  });

  it('updates in place when the company name changes: same token, new hash, ready', async () => {
    const first = await accepted(await post(PROD, SAMPLE));
    const token = tokenOf(first.page_url);
    const before = await getCardByToken(env.DB, token);
    expect(before).not.toBeNull();

    const second = await accepted(await post(PROD, { ...SAMPLE, company_name_en: 'Nimbus Publishing and Media FZE' }));
    expect(second.page_url).toBe(first.page_url);
    expect(second.card_id).toBe(first.card_id);

    const after = await getCardByToken(env.DB, token);
    expect(after?.token).toBe(before?.token);
    expect(after?.company_name_en).toBe('Nimbus Publishing and Media FZE');
    expect(after?.content_hash).not.toBe(before?.content_hash);
    expect(after?.status).toBe('ready');
    expect(await countCards(env.DB)).toBe(1);

    const updated = await listEvents(env.DB, { route: 'production', outcome: 'updated' });
    expect(updated.total).toBe(1);
  });

  it('keeps test and production cards for the same licence number apart', async () => {
    const live = await accepted(await post(PROD, SAMPLE));
    const test = await accepted(await post(TEST, SAMPLE));
    expect(test.card_id).not.toBe(live.card_id);
    expect(test.page_url).not.toBe(live.page_url);
    expect(await countCards(env.DB)).toBe(2);

    const liveCard = await findCardByLicence(env.DB, 'SPC-2026-00001', false);
    const testCard = await findCardByLicence(env.DB, 'SPC-2026-00001', true);
    expect(liveCard?.is_test).toBe(false);
    expect(liveCard?.source).toBe('webhook');
    expect(testCard?.is_test).toBe(true);
    expect(testCard?.source).toBe('test');
  });

  it('expires the card with the licence: the end of its expiry day in Dubai, renewals bring it back', async () => {
    const first = await accepted(await post(PROD, { ...SAMPLE, expiry_date: '15/10/2027' }));
    let card = await findCardByLicence(env.DB, 'SPC-2026-00001', false);
    expect(card).toMatchObject({ licence_expires_on: '2027-10-15', expires_at: '2027-10-15T20:00:00.000Z', status: 'ready' });

    // The ERP sends the licence again with an expiry already in the past: the card is expired at once.
    await accepted(await post(PROD, { ...SAMPLE, licence_expiry: '2026-10-16' }));
    card = await findCardByLicence(env.DB, 'SPC-2026-00001', false);
    expect(card?.status).toBe('expired');

    // Renewal: a later expiry date, same card, same link, ready again.
    const renewed = await accepted(await post(PROD, { ...SAMPLE, valid_until: '2028-10-15' }));
    expect(renewed.page_url).toBe(first.page_url);
    card = await findCardByLicence(env.DB, 'SPC-2026-00001', false);
    expect(card).toMatchObject({ licence_expires_on: '2028-10-15', status: 'ready' });
  });

  it('refuses a licence expiry date before the issue date or that is not a date', async () => {
    await rejected(await post(PROD, { ...SAMPLE, expiry_date: '2026-10-01' }), 400);
    await rejected(await post(PROD, { ...SAMPLE, expiry_date: 'next year' }), 400);
  });

  it('keeps the hash of a licence sent without an expiry date the same as before the field existed', async () => {
    const a = await accepted(await post(PROD, SAMPLE));
    const before = await findCardByLicence(env.DB, 'SPC-2026-00001', false);
    const b = await accepted(await post(PROD, SAMPLE));
    expect(b.card_id).toBe(a.card_id);
    expect((await findCardByLicence(env.DB, 'SPC-2026-00001', false))?.content_hash).toBe(before?.content_hash);
    const { rows } = await listEvents(env.DB, { route: 'production' });
    expect(rows[0]?.outcome).toBe('unchanged');
    // The hash a card stored before the field existed is reproduced exactly.
    const { hashFields } = await import('../src/intake/upsert.js');
    expect(await hashFields({ ...before!, licence_expires_on: null })).toBe(before?.content_hash);
  });

  it('stores the raw body on the test route only', async () => {
    const text = JSON.stringify(SAMPLE);
    await accepted(await post(TEST, null, { raw: text }));
    await accepted(await post(PROD, null, { raw: text }));

    const test = await listEvents(env.DB, { route: 'test' });
    expect(test.total).toBe(1);
    expect(test.rows[0]?.raw_body).toBe(text);
    expect(test.rows[0]?.raw_body_expires_at).toBeNull(); // kept for good

    const prod = await listEvents(env.DB, { route: 'production' });
    expect(prod.total).toBe(1);
    expect(prod.rows[0]?.raw_body).toBeNull();
    expect(prod.rows[0]?.raw_body_expires_at).toBeNull();
  });

  it('keeps the raw body for a rejected payload on the test route', async () => {
    const text = JSON.stringify({ CompanyName: 'No Licence Number Co' });
    await rejected(await post(TEST, null, { raw: text }), 400);
    const { rows } = await listEvents(env.DB, { route: 'test' });
    expect(rows[0]?.outcome).toBe('rejected');
    expect(rows[0]?.raw_body).toBe(text);
  });
});

describe('intake routes: normalisation', () => {
  it('maps common ERP aliases with an empty FIELD_MAP', async () => {
    const res = await post(PROD, {
      LicenseNo: 'spc-2026-00042',
      CompanyName: 'Alias Co FZE',
      Activities: [{ Description_EN: 'Book Publishing', Code: '5811' }],
      OwnerEmail: 'someone@example.com',
    });
    const body = await accepted(res);
    const card = await getCardByToken(env.DB, tokenOf(body.page_url));
    expect(card?.licence_number).toBe('SPC-2026-00042');
    expect(card?.company_name_en).toBe('Alias Co FZE');
    expect(card?.activity_category).toBe('Book Publishing');
  });

  it('uppercases and trims the licence number and collapses internal whitespace', async () => {
    await accepted(await post(PROD, { licence_number: '  spc   2026\t00077 ', company_name_en: 'Spaced Out FZE' }));
    const card = await findCardByLicence(env.DB, 'SPC 2026 00077', false);
    expect(card).not.toBeNull();
  });

  it('strips HTML from the company name', async () => {
    const body = await accepted(await post(PROD, { licence_number: 'SPC-2026-00088', company_name_en: '<b>Nimbus</b> Publishing <i>FZE</i>' }));
    const card = await getCardByToken(env.DB, tokenOf(body.page_url));
    expect(card?.company_name_en).toBe('Nimbus Publishing FZE');
  });

  it('defaults issued_on to today in Asia/Dubai', async () => {
    const body = await accepted(await post(PROD, { licence_number: 'SPC-2026-00099', company_name_en: 'Dated Co FZE' }));
    const card = await getCardByToken(env.DB, tokenOf(body.page_url));
    expect(card?.issued_on).toBe(todayInDubai());
  });

  it("reads preferred_language 'Arabic' as ar", async () => {
    const body = await accepted(await post(PROD, { licence_number: 'SPC-2026-00100', company_name_en: 'Lang Co FZE', preferred_language: 'Arabic' }));
    const card = await getCardByToken(env.DB, tokenOf(body.page_url));
    expect(card?.preferred_language).toBe('ar');
  });

  it('turns empty optional fields into null', async () => {
    const body = await accepted(await post(PROD, {
      licence_number: 'SPC-2026-00101', company_name_en: 'Minimal Co FZE', company_name_ar: '', licence_type: '  ', activity_category: null,
    }));
    const card = await getCardByToken(env.DB, tokenOf(body.page_url));
    expect(card?.company_name_ar).toBeNull();
    expect(card?.licence_type).toBeNull();
    expect(card?.activity_category).toBeNull();
  });
});

describe('mapPayload', () => {
  it('applies FIELD_MAP with dotted paths before the aliases', () => {
    const out = mapPayload(
      { data: { lic: { no: 'A-1' }, company: { en: 'Dotted Co' } }, license_number: 'IGNORED' },
      '{"data.lic.no":"licence_number","data.company.en":"company_name_en"}',
    );
    expect(out).toEqual({ licence_number: 'A-1', company_name_en: 'Dotted Co' });
  });

  it('indexes arrays in dotted paths', () => {
    const out = mapPayload({ items: [{ name: 'Printing' }] }, '{"items.0.name":"activity_category"}');
    expect(out).toEqual({ activity_category: 'Printing' });
  });

  it('treats invalid FIELD_MAP JSON as an empty map and falls back to aliases', () => {
    const out = mapPayload({ license_number: 'B-2', company_name: 'Alias Co' }, 'not json');
    expect(out).toEqual({ licence_number: 'B-2', company_name_en: 'Alias Co' });
  });

  it('matches aliases ignoring case, spaces, underscores and dashes', () => {
    const out = mapPayload({ 'License Number': 'C-3', 'company-name-english': 'Cased Co', LANG: 'ar' }, '{}');
    expect(out).toEqual({ licence_number: 'C-3', company_name_en: 'Cased Co', preferred_language: 'ar' });
  });

  it('drops everything that is not canonical, including contact details', () => {
    const out = mapPayload(
      { licence_number: 'D-4', company_name_en: 'Dropped Co', owner_email: 'x@example.com', phone: '+971500000000', nested: { a: 1 } },
      '{}',
    );
    expect(Object.keys(out).sort()).toEqual(['company_name_en', 'licence_number']);
  });

  it('unwraps activity lists and objects', () => {
    expect(mapPayload({ activities: [{ Description_EN: 'Book Publishing' }] }, '{}')).toEqual({ activity_category: 'Book Publishing' });
    expect(mapPayload({ activity: { name_en: 'Media' } }, '{}')).toEqual({ activity_category: 'Media' });
    expect(mapPayload({ activities: ['Printing', 'Design'] }, '{}')).toEqual({ activity_category: 'Printing' });
    expect(mapPayload({ activities: [] }, '{}')).toEqual({});
    expect(mapPayload({ activity: { code: '1234' } }, '{}')).toEqual({});
  });

  it('lets a later source fill a key whose earlier source was blank', () => {
    const out = mapPayload({ licence_type: '', type: 'Standard' }, '{}');
    expect(out).toEqual({ licence_type: 'Standard' });
  });

  it('returns an empty object for non-object payloads', () => {
    expect(mapPayload(null, '{}')).toEqual({});
    expect(mapPayload([SAMPLE], '{}')).toEqual({});
    expect(mapPayload('string', '{}')).toEqual({});
  });
});

describe('validateCanonical', () => {
  it('collects every error instead of stopping at the first', () => {
    const r = validateCanonical({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('licence_number: required');
      expect(r.errors).toContain('company_name_en: required');
    }
  });

  it('normalises the licence number and accepts numbers', () => {
    const r = validateCanonical({ licence_number: 123456, company_name_en: 'Numeric Co' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.licence_number).toBe('123456');

    const s = validateCanonical({ licence_number: '  spc-01  x ', company_name_en: 'Co' });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.fields.licence_number).toBe('SPC-01 X');
  });

  it('enforces the length limits', () => {
    const r = validateCanonical({
      licence_number: 'AB',
      company_name_en: 'X',
      company_name_ar: 'ع'.repeat(121),
      licence_type: 'T'.repeat(61),
      activity_category: 'A'.repeat(81),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(5);
      expect(r.errors).toContain('licence_number: must be 3 to 40 characters');
      expect(r.errors).toContain('company_name_en: must be 2 to 120 characters');
      expect(r.errors).toContain('company_name_ar: must be at most 120 characters');
      expect(r.errors).toContain('licence_type: must be at most 60 characters');
      expect(r.errors).toContain('activity_category: must be at most 80 characters');
    }
  });

  it('rejects non-text values', () => {
    const r = validateCanonical({ licence_number: { a: 1 }, company_name_en: ['x'], licence_type: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('licence_number: must be text');
      expect(r.errors).toContain('company_name_en: must be text');
      expect(r.errors).toContain('licence_type: must be text');
    }
  });

  it('defaults issued_on to the supplied today and parses other formats', () => {
    const r = validateCanonical({ licence_number: 'ABC', company_name_en: 'Co' }, { today: '2026-01-02' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.issued_on).toBe('2026-01-02');

    const s = validateCanonical({ licence_number: 'ABC', company_name_en: 'Co', issued_on: '15/10/2026' });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.fields.issued_on).toBe('2026-10-15');

    const t = validateCanonical({ licence_number: 'ABC', company_name_en: 'Co', issued_on: 'someday' });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.errors).toEqual(['issued_on: unrecognised date']);
  });

  it('normalises the language and rejects unknown ones', () => {
    for (const [input, expected] of [['en', 'en'], ['EN-us', 'en'], ['English', 'en'], ['ar', 'ar'], ['ar-AE', 'ar'], ['Arabic', 'ar']] as const) {
      const r = validateCanonical({ licence_number: 'ABC', company_name_en: 'Co', preferred_language: input });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.preferred_language).toBe(expected);
    }
    const d = validateCanonical({ licence_number: 'ABC', company_name_en: 'Co' });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.fields.preferred_language).toBe('en');
    const bad = validateCanonical({ licence_number: 'ABC', company_name_en: 'Co', preferred_language: 'fr' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toEqual(['preferred_language: must be en or ar']);
  });

  it('strips HTML and turns blank optionals into null', () => {
    const r = validateCanonical({
      licence_number: 'ABC', company_name_en: '<b>Tagged</b> Co', company_name_ar: '<p></p>', licence_type: '', activity_category: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.company_name_en).toBe('Tagged Co');
      expect(r.fields.company_name_ar).toBeNull();
      expect(r.fields.licence_type).toBeNull();
      expect(r.fields.activity_category).toBeNull();
    }
  });
});

describe('auth helpers', () => {
  it('reads the secret from either header', () => {
    expect(extractSecret(new Headers({ 'X-SPC-Webhook-Secret': ' abc ' }))).toBe('abc');
    expect(extractSecret(new Headers({ Authorization: 'Bearer xyz' }))).toBe('xyz');
    expect(extractSecret(new Headers({ Authorization: 'bearer   xyz  ' }))).toBe('xyz');
    expect(extractSecret(new Headers({ Authorization: 'Basic xyz' }))).toBeNull();
    expect(extractSecret(new Headers())).toBeNull();
  });

  it('accepts nothing when no secret is configured and skips an empty previous', async () => {
    expect(await checkSecret('x', undefined, undefined)).toBe(false);
    expect(await checkSecret('x', '', '')).toBe(false);
    expect(await checkSecret('', 'x', undefined)).toBe(false);
    expect(await checkSecret(null, 'x', 'y')).toBe(false);
    expect(await checkSecret('x', 'x', '')).toBe(true);
    expect(await checkSecret('y', 'x', 'y')).toBe(true);
    expect(await checkSecret('z', 'x', 'y')).toBe(false);
  });
});

describe('founder name', () => {
  it('maps founder or owner names, from plain fields or person objects, with an Arabic sibling', () => {
    expect(mapPayload({ founder_name: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي' }, '{}')).toMatchObject({ founder_name_en: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي' });
    expect(mapPayload({ OwnerName: 'Omar Haddad' }, '{}')).toMatchObject({ founder_name_en: 'Omar Haddad' });
    expect(mapPayload({ owner: { full_name: 'Omar Haddad', name_ar: 'عمر حداد', email: 'o@x.ae' } }, '{}'))
      .toEqual({ founder_name_en: 'Omar Haddad', founder_name_ar: 'عمر حداد' });
    expect(mapPayload({ shareholders: [{ name: 'Lina Saeed' }, { name: 'Other' }] }, '{}')).toEqual({ founder_name_en: 'Lina Saeed' });
  });

  it('never stores contact details that came with the person', () => {
    const out = mapPayload({ owner: { name: 'Omar Haddad', email: 'o@x.ae', phone: '+971' } }, '{}');
    expect(JSON.stringify(out)).not.toContain('o@x.ae');
    expect(JSON.stringify(out)).not.toContain('+971');
  });

  it('accepts long legal names rather than rejecting the licence', () => {
    const long = 'Mohammed bin Abdullah bin Rashid Al Example Al Somebody';
    const v = validateCanonical({ licence_number: 'SPC-1', company_name_en: 'Nimbus FZE', founder_name_en: long });
    expect(v.ok && v.fields.founder_name_en).toBe(long);
    const bogus = validateCanonical({ licence_number: 'SPC-1', company_name_en: 'Nimbus FZE', founder_name_en: 'x'.repeat(121) });
    expect(bogus.ok).toBe(false);
  });

  it('stores the founder through the webhook and counts a change as an update', async () => {
    const first = await accepted(await post(PROD, { ...SAMPLE, founder_name: 'Mariam Fawzy' }));
    const card = await getCardByToken(env.DB, tokenOf(first.page_url));
    expect(card?.founder_name_en).toBe('Mariam Fawzy');
    expect(card?.founder_name_ar).toBeNull();
    const second = await accepted(await post(PROD, { ...SAMPLE, founder_name: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي' }));
    expect(second.card_id).toBe(first.card_id);
    const after = await getCardByToken(env.DB, tokenOf(first.page_url));
    expect(after?.founder_name_ar).toBe('مريم فوزي');
    expect(after?.content_hash).not.toBe(card?.content_hash);
  });
});

