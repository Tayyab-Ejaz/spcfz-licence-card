// Staff admin: Access gate, CSRF, screens and mutations (ARCHITECTURE section 8). The Access verifier is injected
// so no JWT or network is involved; the stub either names a staff member or rejects.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow, CardStatus } from '../src/types';
import { LANGS, SIZE_NAMES } from '../src/types';
import { createAdminRoutes } from '../src/admin/routes';
import {
  findCardByLicence, getCardById, getEvent, getSetting, insertCard, insertEvent, listEvents, setCardStatus,
} from '../src/db/cards';
import { imageKey, putImage } from '../src/storage';
import { randomToken } from '../src/util/crypto';

const ACTOR = 'staff@spcfz.ae';
const staff = new Hono<AppEnv>().route('/admin', createAdminRoutes(async () => ({ email: ACTOR })));
const anonymous = new Hono<AppEnv>().route('/admin', createAdminRoutes(async () => null));
const CSRF = 'x'.repeat(32);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

let seq = 0;

interface SeedOptions {
  fields?: Partial<CanonicalFields>;
  is_test?: boolean;
  status?: CardStatus;
  template_version?: string;
}

async function seedCard(o: SeedOptions = {}): Promise<CardRow> {
  seq += 1;
  const created = await insertCard(env.DB, {
    token: randomToken(),
    is_test: o.is_test ?? false,
    fields: {
      licence_number: `SPC-2026-${String(seq).padStart(5, '0')}`,
      company_name_en: `Company ${seq} FZE`,
      company_name_ar: null,
      licence_type: 'Commercial',
      activity_category: 'Publishing',
      issued_on: '2026-10-01',
      preferred_language: 'en',
      ...o.fields,
    },
    content_hash: `hash-${seq}`,
    source: 'manual',
    template_version: o.template_version ?? 'placeholder-1',
    expires_at: o.is_test ? null : '2028-10-01T00:00:00.000Z',
  });
  if (o.status && o.status !== 'pending') await setCardStatus(env.DB, created.id, o.status);
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed: card not found after insert');
  return card;
}

async function putAllImages(token: string): Promise<void> {
  for (const lang of LANGS) for (const size of SIZE_NAMES) await putImage(env.BUCKET, token, lang, size, PNG);
}

/** GET as a signed-in staff member. Sends the CSRF session cookie unless `cookie` is null (first visit). */
async function get(path: string, o: { cookie?: string | null } = {}): Promise<{ res: Response; ctx: ExecutionContext }> {
  const ctx = createExecutionContext();
  const cookie = o.cookie === undefined ? `admin_csrf=${CSRF}` : o.cookie;
  const init: RequestInit | undefined = cookie === null ? undefined : { headers: { cookie } };
  const res = await staff.request(path, init, env, ctx);
  return { res, ctx };
}

interface PostOptions {
  /** null = send no cookie. Default: the matching CSRF cookie. */
  cookie?: string | null;
  /** null = omit the hidden field. Default: the matching value. */
  csrfField?: string | null;
  headers?: Record<string, string>;
}

async function post(path: string, fields: Record<string, string> = {}, o: PostOptions = {}): Promise<{ res: Response; ctx: ExecutionContext }> {
  const params = new URLSearchParams(fields);
  const csrfField = o.csrfField === undefined ? CSRF : o.csrfField;
  if (csrfField !== null) params.set('_csrf', csrfField);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', ...(o.headers ?? {}) };
  const cookie = o.cookie === undefined ? `admin_csrf=${CSRF}` : o.cookie;
  if (cookie !== null) headers['cookie'] = cookie;
  const ctx = createExecutionContext();
  const res = await staff.request(path, { method: 'POST', headers, body: params.toString() }, env, ctx);
  return { res, ctx };
}

async function adminEvents() {
  return (await listEvents(env.DB, { route: 'admin' })).rows;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM metrics'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM cards'),
  ]);
});

describe('access gate', () => {
  it('503 when Access is not configured and the verifier yields nothing', async () => {
    const ctx = createExecutionContext();
    const res = await anonymous.request('/admin', undefined, { ...env, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }, ctx);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not configured');
  });

  it('401 when Access is configured but the assertion is rejected', async () => {
    const ctx = createExecutionContext();
    const res = await anonymous.request('/admin/cards', undefined, env, ctx);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Sign in required');
  });

  it('serves the dashboard to a verified actor with admin headers and a CSRF cookie', async () => {
    const { res } = await get('/admin', { cookie: null });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Dashboard');
    expect(body).toContain(ACTOR);
    expect(body).toContain('Live cards by status');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('admin_csrf=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('shows failed cards and rejected events on the dashboard', async () => {
    const card = await seedCard({ status: 'failed' });
    await insertEvent(env.DB, { route: 'production', source_ip: '203.0.113.10', http_status: 400, outcome: 'rejected', errors: ['licence_number: required'] });
    const body = await (await get('/admin')).res.text();
    expect(body).toContain(card.company_name_en);
    expect(body).toContain('licence_number: required');
  });
});

describe('cards', () => {
  it('lists cards and filters by status', async () => {
    const ready = await seedCard({ status: 'ready' });
    const failed = await seedCard({ status: 'failed' });
    const all = await (await get('/admin/cards')).res.text();
    expect(all).toContain(ready.company_name_en);
    expect(all).toContain(failed.company_name_en);
    const onlyFailed = await (await get('/admin/cards?status=failed')).res.text();
    expect(onlyFailed).toContain(failed.company_name_en);
    expect(onlyFailed).not.toContain(ready.company_name_en);
    const search = await (await get(`/admin/cards?q=${ready.licence_number}`)).res.text();
    expect(search).toContain(ready.company_name_en);
    expect(search).not.toContain(failed.company_name_en);
  });

  it('filters test cards and sources', async () => {
    const live = await seedCard();
    const test = await seedCard({ is_test: true });
    const testOnly = await (await get('/admin/cards?is_test=1')).res.text();
    expect(testOnly).toContain(test.company_name_en);
    expect(testOnly).not.toContain(live.company_name_en);
    const webhook = await (await get('/admin/cards?source=webhook')).res.text();
    expect(webhook).toContain('No cards match');
  });

  it('shows the detail page with fields, image thumbnails and actions', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_ar: 'شركة تجريبية' } });
    const { res } = await get(`/admin/cards/${card.id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(card.licence_number);
    expect(body).toContain('شركة تجريبية');
    expect(body).toContain(`https://licensed.test/c/${card.token}/ar-story.png`);
    expect(body).toContain(`/admin/cards/${card.id}/regenerate`);
    expect(body).toContain(`/admin/cards/${card.id}/expire`);
    expect(body).toContain(`/admin/cards/${card.id}/delete`);
    expect(body).toContain(`name="_csrf" value="${CSRF}"`);
  });

  it('404s an unknown card', async () => {
    expect((await get('/admin/cards/nope')).res.status).toBe(404);
  });
});

describe('card mutations', () => {
  it('regenerate sets pending and writes an admin event with the actor', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await post(`/admin/cards/${card.id}/regenerate`);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/admin/cards/${card.id}?m=regenerated`);
    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('pending');
    const events = await adminEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: 'admin', outcome: 'regenerated', card_id: card.id, actor: ACTOR, http_status: 200 });
  });

  it('expire marks the card expired and deletes its images', async () => {
    const card = await seedCard({ status: 'ready' });
    await putAllImages(card.token);
    const { res } = await post(`/admin/cards/${card.id}/expire`);
    expect(res.status).toBe(303);
    expect((await getCardById(env.DB, card.id))?.status).toBe('expired');
    expect(await env.BUCKET.head(imageKey(card.token, 'en', 'square'))).toBeNull();
    expect(await env.BUCKET.head(imageKey(card.token, 'ar', 'story'))).toBeNull();
    expect((await adminEvents())[0]?.outcome).toBe('expired');
  });

  it('un-expire sets a fresh expiry, pending status and queues a render', async () => {
    const card = await seedCard({ status: 'expired' });
    const { res } = await post(`/admin/cards/${card.id}/unexpire`);
    expect(res.status).toBe(303);
    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('pending');
    expect(after?.expires_at).not.toBeNull();
    expect(new Date(after?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now() + 365 * 24 * 3600 * 1000);
  });

  it('delete shows a confirm page, then removes the row, counters and R2 objects', async () => {
    const card = await seedCard({ status: 'ready' });
    await putAllImages(card.token);
    const confirm = await get(`/admin/cards/${card.id}/delete`);
    expect(confirm.res.status).toBe(200);
    expect(await confirm.res.text()).toContain('Yes, delete this card');
    expect(await getCardById(env.DB, card.id)).not.toBeNull();

    const { res } = await post(`/admin/cards/${card.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/cards?m=deleted');
    expect(await getCardById(env.DB, card.id)).toBeNull();
    for (const lang of LANGS) {
      for (const size of SIZE_NAMES) expect(await env.BUCKET.head(imageKey(card.token, lang, size))).toBeNull();
    }
    const events = await adminEvents();
    expect(events[0]).toMatchObject({ outcome: 'deleted', card_id: card.id, actor: ACTOR });
  });

  it('404s mutations on unknown cards', async () => {
    expect((await post('/admin/cards/nope/regenerate')).res.status).toBe(404);
  });
});

describe('CSRF', () => {
  it('403 without the cookie', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await post(`/admin/cards/${card.id}/regenerate`, {}, { cookie: null });
    expect(res.status).toBe(403);
    expect((await getCardById(env.DB, card.id))?.status).toBe('ready');
    expect(await adminEvents()).toHaveLength(0);
  });

  it('403 without the hidden field or with a mismatched one', async () => {
    const card = await seedCard({ status: 'ready' });
    expect((await post(`/admin/cards/${card.id}/regenerate`, {}, { csrfField: null })).res.status).toBe(403);
    expect((await post(`/admin/cards/${card.id}/regenerate`, {}, { csrfField: 'y'.repeat(32) })).res.status).toBe(403);
    expect((await getCardById(env.DB, card.id))?.status).toBe('ready');
  });

  it('403 for a cross-site fetch even with matching tokens', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await post(`/admin/cards/${card.id}/regenerate`, {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(403);
    const ok = await post(`/admin/cards/${card.id}/regenerate`, {}, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect(ok.res.status).toBe(303);
  });
});

describe('settings', () => {
  it('renders the current values', async () => {
    const body = await (await get('/admin/settings')).res.text();
    expect(body).toContain('{company}');
    expect(body).toContain('name="retention_days" value="730"');
  });

  it('updates captions, the GTM switch and retention days, and audits it', async () => {
    const { res } = await post('/admin/settings', {
      caption_en: 'Hello {company}, see {link}',
      caption_ar: 'مرحباً {company} {link}',
      gtm_enabled: '1',
      retention_days: '365',
      test_retention_days: '14',
      raw_body_days: '3',
    });
    expect(res.status).toBe(303);
    expect(await getSetting(env.DB, 'caption_en')).toBe('Hello {company}, see {link}');
    expect(await getSetting(env.DB, 'caption_ar')).toBe('مرحباً {company} {link}');
    expect(await getSetting(env.DB, 'gtm_enabled')).toBe('1');
    expect(await getSetting(env.DB, 'retention_days')).toBe('365');
    expect(await getSetting(env.DB, 'test_retention_days')).toBe('14');
    expect(await getSetting(env.DB, 'raw_body_days')).toBe('3');
    expect((await adminEvents())[0]).toMatchObject({ outcome: 'settings', actor: ACTOR });

    // An unchecked checkbox is simply absent from the form body.
    await post('/admin/settings', { caption_en: 'Second {company} {link}' });
    expect(await getSetting(env.DB, 'gtm_enabled')).toBe('0');
    expect(await getSetting(env.DB, 'caption_en')).toBe('Second {company} {link}');
    expect(await getSetting(env.DB, 'retention_days')).toBe('365');
  });

  it('rejects negative or non-numeric days and empty captions without saving anything', async () => {
    const before = await getSetting(env.DB, 'retention_days');
    const { res } = await post('/admin/settings', { retention_days: '-5', caption_en: '' });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('retention_days');
    expect(body).toContain('caption_en');
    expect(await getSetting(env.DB, 'retention_days')).toBe(before);
    expect(await getSetting(env.DB, 'caption_en')).not.toBe('');
    expect((await post('/admin/settings', { raw_body_days: 'abc' })).res.status).toBe(400);
  });
});

describe('re-render', () => {
  it('counts first, then sets matching live cards to pending', async () => {
    const a = await seedCard({ status: 'ready', template_version: 'placeholder-1' });
    const b = await seedCard({ status: 'ready', template_version: 'placeholder-1' });
    const other = await seedCard({ status: 'ready', template_version: 'spc-2' });
    const test = await seedCard({ status: 'ready', is_test: true, template_version: 'placeholder-1' });
    const expired = await seedCard({ status: 'expired', template_version: 'placeholder-1' });

    const empty = await post('/admin/rerender', {});
    expect(empty.res.status).toBe(400);

    const dry = await post('/admin/rerender', { template_version: 'placeholder-1' });
    expect(dry.res.status).toBe(200);
    const dryBody = await dry.res.text();
    expect(dryBody).toContain('<strong>3</strong>');
    expect(dryBody).toContain('name="confirm" value="1"');
    expect((await getCardById(env.DB, a.id))?.status).toBe('ready');

    const apply = await post('/admin/rerender', { template_version: 'placeholder-1', confirm: '1' });
    expect(apply.res.status).toBe(200);
    expect(await apply.res.text()).toContain('2 cards set to pending');
    expect((await getCardById(env.DB, a.id))?.status).toBe('pending');
    expect((await getCardById(env.DB, b.id))?.status).toBe('pending');
    expect((await getCardById(env.DB, other.id))?.status).toBe('ready');
    expect((await getCardById(env.DB, test.id))?.status).toBe('ready');
    expect((await getCardById(env.DB, expired.id))?.status).toBe('expired');
    expect((await adminEvents())[0]?.outcome).toBe('rerender');
  });

  it('rejects malformed dates', async () => {
    const { res } = await post('/admin/rerender', { created_after: '15/10/2026' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('YYYY-MM-DD');
  });
});

describe('events', () => {
  it('lists, filters and shows an event with its raw body', async () => {
    const id = await insertEvent(env.DB, {
      route: 'test',
      source_ip: '203.0.113.10',
      http_status: 400,
      outcome: 'rejected',
      errors: ['company_name_en: required'],
      raw_body: '{"LicenseNo":"SPC-1"}',
      raw_body_expires_at: '2099-01-01T00:00:00.000Z',
    });
    await insertEvent(env.DB, { route: 'production', source_ip: '203.0.113.11', http_status: 200, outcome: 'created' });

    const list = await (await get('/admin/events?outcome=rejected')).res.text();
    expect(list).toContain('203.0.113.10');
    expect(list).not.toContain('203.0.113.11');

    const detail = await get(`/admin/events/${id}`);
    expect(detail.res.status).toBe(200);
    const body = await detail.res.text();
    expect(body).toContain('company_name_en: required');
    expect(body).toContain('<pre>');
    expect(body).toContain('&quot;LicenseNo&quot;');
    expect(body).toContain(`/admin/events/${id}/replay`);
  });

  it('replaying an event with a card but no raw body re-renders that card', async () => {
    const card = await seedCard({ status: 'failed' });
    const id = await insertEvent(env.DB, { route: 'production', source_ip: '203.0.113.10', http_status: 200, outcome: 'created', card_id: card.id });
    const { res } = await post(`/admin/events/${id}/replay`);
    expect(res.status).toBe(303);
    expect((await getCardById(env.DB, card.id))?.status).toBe('pending');
    expect((await adminEvents())[0]).toMatchObject({ outcome: 'replayed', card_id: card.id, actor: ACTOR });
  });

  it('refuses to replay an event with nothing to replay', async () => {
    const id = await insertEvent(env.DB, { route: 'production', source_ip: '203.0.113.10', http_status: 400, outcome: 'rejected' });
    const { res } = await post(`/admin/events/${id}/replay`);
    expect(res.status).toBe(400);
    expect(await adminEvents()).toHaveLength(0);
    expect((await getEvent(env.DB, id))?.outcome).toBe('rejected');
  });
});

// These screens call into src/intake (mapper, validate, upsert) and exercise its behaviour through the admin.
describe('create (needs the intake module)', () => {
  it('renders the form', async () => {
    const body = await (await get('/admin/create')).res.text();
    expect(body).toContain('name="licence_number"');
    expect(body).toContain('name="company_name_en"');
    expect(body).toContain('name="is_test"');
  });

  it('creates a card from the form and redirects to it', async () => {
    const { res } = await post('/admin/create', {
      licence_number: 'spc-2026-77777',
      company_name_en: 'Gamma Media FZE',
      company_name_ar: '',
      licence_type: '',
      activity_category: 'Media',
      issued_on: '2026-10-10',
      preferred_language: 'ar',
    });
    expect(res.status).toBe(303);
    const card = await findCardByLicence(env.DB, 'SPC-2026-77777', false);
    expect(card).not.toBeNull();
    expect(card?.source).toBe('manual');
    expect(card?.preferred_language).toBe('ar');
    expect(card?.status).toBe('pending');
    expect(res.headers.get('Location')).toBe(`/admin/cards/${card?.id}?m=created`);
    expect((await adminEvents())[0]).toMatchObject({ outcome: 'created', card_id: card?.id, actor: ACTOR });
  });

  it('shows validation errors inline and writes nothing', async () => {
    const { res } = await post('/admin/create', { licence_number: 'X', company_name_en: '' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('class="error"');
    expect(await findCardByLicence(env.DB, 'X', false)).toBeNull();
    expect(await adminEvents()).toHaveLength(0);
  });
});

describe('CSV import (needs the intake module)', () => {
  const csv = [
    'Licence_Number,company_name_en,company_name_ar,issued_on',
    'SPC-2026-90001,Alpha Books FZE,,2026-10-01',
    ',Missing Licence LLC,,2026-10-02',
    'SPC-2026-90003,Beta Press FZE,بيتا للطباعة,2026-10-03',
  ].join('\n');

  it('dry run reports would-be outcomes and writes nothing', async () => {
    const { res } = await post('/admin/import', { csv });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Dry run');
    expect(body).toContain('2 to create');
    expect(body).toContain('1 rejected');
    expect(body).toContain('name="confirm" value="1"');
    expect(await findCardByLicence(env.DB, 'SPC-2026-90001', false)).toBeNull();
    expect(await adminEvents()).toHaveLength(0);
  });

  it('confirm applies the rows and reports counts; a second run is unchanged', async () => {
    const { res } = await post('/admin/import', { csv, confirm: '1' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Import applied');
    const alpha = await findCardByLicence(env.DB, 'SPC-2026-90001', false);
    const beta = await findCardByLicence(env.DB, 'SPC-2026-90003', false);
    expect(alpha?.source).toBe('csv');
    expect(beta?.company_name_ar).toBe('بيتا للطباعة');
    expect((await adminEvents())[0]?.outcome).toBe('imported');

    const again = await post('/admin/import', { csv });
    expect(await again.res.text()).toContain('2 unchanged');
  });

  it('rejects an empty submission', async () => {
    expect((await post('/admin/import', { csv: '' })).res.status).toBe(400);
    expect((await post('/admin/import', { csv: 'licence_number,company_name_en' })).res.status).toBe(400);
  });
});

describe('execution context', () => {
  it('leaves nothing pending after a mutation', async () => {
    const card = await seedCard({ status: 'ready' });
    const { ctx } = await post(`/admin/cards/${card.id}/regenerate`);
    await waitOnExecutionContext(ctx);
  });
});
