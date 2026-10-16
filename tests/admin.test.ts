// Staff admin: Access gate, CSRF, screens and mutations (ARCHITECTURE section 8). The Access verifier is injected
// so no JWT or network is involved; the stub either names a staff member or rejects.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields, CardRow, CardStatus } from '../src/types.js';
import { createAdminRoutes } from '../src/admin/routes.js';
import {
  findCardByLicence, getCardById, getEvent, getSetting, insertCard, insertEvent, listEvents, setCardStatus,
} from '../src/db/cards.js';
import { randomToken } from '../src/util/crypto.js';
import { flushBackground } from '../src/util/background.js';
import { createTestEnv } from './env.js';

const env = createTestEnv();
const ACTOR = 'staff@spcfz.ae';
const staff = new Hono<AppEnv>().route('/admin', createAdminRoutes(async () => ({ email: ACTOR })));
const anonymous = new Hono<AppEnv>().route('/admin', createAdminRoutes(async () => null));
const CSRF = 'x'.repeat(32);

let seq = 0;

interface SeedOptions {
  fields?: Partial<CanonicalFields>;
  is_test?: boolean;
  status?: CardStatus;
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
      activity_category_ar: null,
      founder_name_en: null,
      founder_name_ar: null,
      issued_on: '2026-10-01',
      preferred_language: 'en',
      ...o.fields,
    },
    content_hash: `hash-${seq}`,
    source: 'manual',
    expires_at: o.is_test ? null : '2028-10-01T00:00:00.000Z',
  });
  if (o.status && o.status !== 'ready') await setCardStatus(env.DB, created.id, o.status);
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed: card not found after insert');
  return card;
}

/** GET as a signed-in staff member. Sends the CSRF session cookie unless `cookie` is null (first visit). */
async function get(path: string, o: { cookie?: string | null } = {}): Promise<{ res: Response }> {
  const cookie = o.cookie === undefined ? `admin_csrf=${CSRF}` : o.cookie;
  const init: RequestInit | undefined = cookie === null ? undefined : { headers: { cookie } };
  const res = await staff.request(path, init, env);
  return { res };
}

interface PostOptions {
  /** null = send no cookie. Default: the matching CSRF cookie. */
  cookie?: string | null;
  /** null = omit the hidden field. Default: the matching value. */
  csrfField?: string | null;
  headers?: Record<string, string>;
}

async function post(path: string, fields: Record<string, string> = {}, o: PostOptions = {}): Promise<{ res: Response }> {
  const params = new URLSearchParams(fields);
  const csrfField = o.csrfField === undefined ? CSRF : o.csrfField;
  if (csrfField !== null) params.set('_csrf', csrfField);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', ...(o.headers ?? {}) };
  const cookie = o.cookie === undefined ? `admin_csrf=${CSRF}` : o.cookie;
  if (cookie !== null) headers['cookie'] = cookie;
  const res = await staff.request(path, { method: 'POST', headers, body: params.toString() }, env);
  return { res };
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
    const res = await anonymous.request('/admin', undefined, { ...env, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not configured');
  });

  it('401 when Access is configured but the assertion is rejected', async () => {
    const res = await anonymous.request('/admin/cards', undefined, env);
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

  it('shows rejected events on the dashboard', async () => {
    await insertEvent(env.DB, { route: 'production', source_ip: '203.0.113.10', http_status: 400, outcome: 'rejected', errors: ['licence_number: required'] });
    const body = await (await get('/admin')).res.text();
    expect(body).toContain('licence_number: required');
    expect(body).not.toContain('Recent failed cards');
  });
});

describe('cards', () => {
  it('lists cards and filters by status', async () => {
    const ready = await seedCard({ status: 'ready' });
    const failed = await seedCard({ status: 'failed' }); // a status that exists only on rows from the server-render era
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

  it('shows the detail page with fields, the founder and actions, and no render controls', async () => {
    const card = await seedCard({ status: 'ready', fields: { company_name_ar: 'شركة تجريبية', founder_name_en: 'Mariam Fawzy', founder_name_ar: 'مريم فوزي' } });
    const { res } = await get(`/admin/cards/${card.id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(card.licence_number);
    expect(body).toContain('شركة تجريبية');
    expect(body).toContain('Mariam Fawzy');
    expect(body).toContain('مريم فوزي');
    expect(body).toContain(`https://licensed.test/c/${card.token}`);
    expect(body).not.toContain('/regenerate');
    expect(body).not.toContain('.png');
    expect(body).toContain(`/admin/cards/${card.id}/expire`);
    expect(body).toContain(`/admin/cards/${card.id}/delete`);
    expect(body).toContain(`name="_csrf" value="${CSRF}"`);
  });

  it('404s an unknown card', async () => {
    expect((await get('/admin/cards/nope')).res.status).toBe(404);
  });
});

describe('card mutations', () => {
  it("expire marks the card expired, clears the founder's name and audits with the actor", async () => {
    const card = await seedCard({ status: 'ready', fields: { founder_name_en: 'Mariam Fawzy' } });
    const { res } = await post(`/admin/cards/${card.id}/expire`);
    expect(res.status).toBe(303);
    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('expired');
    expect(after?.founder_name_en).toBeNull();
    const events = await adminEvents();
    expect(events[0]).toMatchObject({ route: 'admin', outcome: 'expired', card_id: card.id, actor: ACTOR, http_status: 200 });
  });

  it('un-expire sets a fresh expiry and makes the card ready again', async () => {
    const card = await seedCard({ status: 'expired' });
    const { res } = await post(`/admin/cards/${card.id}/unexpire`);
    expect(res.status).toBe(303);
    const after = await getCardById(env.DB, card.id);
    expect(after?.status).toBe('ready');
    expect((await adminEvents())[0]?.outcome).toBe('unexpired');
    expect(after?.expires_at).not.toBeNull();
    expect(new Date(after?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now() + 365 * 24 * 3600 * 1000);
  });

  it('delete shows a confirm page, then removes the row and counters', async () => {
    const card = await seedCard({ status: 'ready' });
    const confirm = await get(`/admin/cards/${card.id}/delete`);
    expect(confirm.res.status).toBe(200);
    expect(await confirm.res.text()).toContain('Yes, delete this card');
    expect(await getCardById(env.DB, card.id)).not.toBeNull();

    const { res } = await post(`/admin/cards/${card.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/cards?m=deleted');
    expect(await getCardById(env.DB, card.id)).toBeNull();
    const events = await adminEvents();
    expect(events[0]).toMatchObject({ outcome: 'deleted', card_id: card.id, actor: ACTOR });
  });

  it('404s mutations on unknown cards', async () => {
    expect((await post('/admin/cards/nope/expire')).res.status).toBe(404);
    expect((await post('/admin/cards/nope/regenerate')).res.status).toBe(404); // the route is gone
  });
});

describe('CSRF', () => {
  it('403 without the cookie', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await post(`/admin/cards/${card.id}/expire`, {}, { cookie: null });
    expect(res.status).toBe(403);
    expect((await getCardById(env.DB, card.id))?.status).toBe('ready');
    expect(await adminEvents()).toHaveLength(0);
  });

  it('403 without the hidden field or with a mismatched one', async () => {
    const card = await seedCard({ status: 'ready' });
    expect((await post(`/admin/cards/${card.id}/expire`, {}, { csrfField: null })).res.status).toBe(403);
    expect((await post(`/admin/cards/${card.id}/expire`, {}, { csrfField: 'y'.repeat(32) })).res.status).toBe(403);
    expect((await getCardById(env.DB, card.id))?.status).toBe('ready');
  });

  it('403 for a cross-site fetch even with matching tokens', async () => {
    const card = await seedCard({ status: 'ready' });
    const { res } = await post(`/admin/cards/${card.id}/expire`, {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(403);
    const ok = await post(`/admin/cards/${card.id}/expire`, {}, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect(ok.res.status).toBe(303);
  });
});

describe('settings', () => {
  it('renders the current values, without the old caption settings', async () => {
    const body = await (await get('/admin/settings')).res.text();
    expect(body).toContain('name="retention_days" value="730"');
    expect(body).not.toContain('caption_en');
  });

  it('updates the GTM switch and retention days, and audits it', async () => {
    const { res } = await post('/admin/settings', { gtm_enabled: '1', retention_days: '365', test_retention_days: '14', raw_body_days: '3' });
    expect(res.status).toBe(303);
    expect(await getSetting(env.DB, 'gtm_enabled')).toBe('1');
    expect(await getSetting(env.DB, 'retention_days')).toBe('365');
    expect(await getSetting(env.DB, 'test_retention_days')).toBe('14');
    expect(await getSetting(env.DB, 'raw_body_days')).toBe('3');
    expect((await adminEvents())[0]).toMatchObject({ outcome: 'settings', actor: ACTOR });

    // An unchecked checkbox is simply absent from the form body.
    await post('/admin/settings', { retention_days: '365' });
    expect(await getSetting(env.DB, 'gtm_enabled')).toBe('0');
    expect(await getSetting(env.DB, 'retention_days')).toBe('365');
  });

  it('rejects negative or non-numeric days without saving anything', async () => {
    const before = await getSetting(env.DB, 'retention_days');
    const { res } = await post('/admin/settings', { retention_days: '-5' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('retention_days');
    expect(await getSetting(env.DB, 'retention_days')).toBe(before);
    expect((await post('/admin/settings', { raw_body_days: 'abc' })).res.status).toBe(400);
  });
});

describe('re-render screen', () => {
  it('is gone, with its navigation entry', async () => {
    expect((await get('/admin/rerender')).res.status).toBe(404);
    expect(await (await get('/admin')).res.text()).not.toContain('/admin/rerender');
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
    expect(card?.status).toBe('ready');
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

describe('background work', () => {
  it('leaves nothing pending after a mutation', async () => {
    const card = await seedCard({ status: 'ready' });
    await post(`/admin/cards/${card.id}/expire`);
    await flushBackground();
    expect((await getCardById(env.DB, card.id))?.status).toBe('expired');
  });
});
