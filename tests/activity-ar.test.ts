// The optional Arabic activity name (migration 0003): mapping, validation, hashing, the card and the page.
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, CanonicalFields } from '../src/types.js';
import { intakeRoutes } from '../src/intake/routes.js';
import { mapPayload } from '../src/intake/mapper.js';
import { validateCanonical } from '../src/intake/validate.js';
import { hashFields } from '../src/intake/upsert.js';
import { findCardByLicence } from '../src/db/cards.js';
import { createTestEnv } from './env.js';

const AR = 'نشر الكتب';
const EN = 'Book Publishing';

describe('mapPayload: activity_category_ar', () => {
  it('reads the Arabic sibling from the same activity object', () => {
    const out = mapPayload({ Activities: [{ Description_EN: EN, Description_AR: AR }] }, '{}');
    expect(out['activity_category']).toBe(EN);
    expect(out['activity_category_ar']).toBe(AR);
  });

  it('reads name_en / name_ar pairs', () => {
    const out = mapPayload({ activity: { name_en: EN, name_ar: AR } }, '{}');
    expect(out['activity_category']).toBe(EN);
    expect(out['activity_category_ar']).toBe(AR);
  });

  it('takes an explicit Arabic field over the sibling', () => {
    const out = mapPayload({ activity: { name_en: EN, name_ar: 'غير مستخدم' }, activity_ar: AR }, '{}');
    expect(out['activity_category_ar']).toBe(AR);
  });

  it('never falls back to an English name for the Arabic field', () => {
    expect(mapPayload({ activities: [{ name: EN, description: 'x' }] }, '{}')).not.toHaveProperty('activity_category_ar');
    expect(mapPayload({ activity: EN }, '{}')).not.toHaveProperty('activity_category_ar');
  });

  it('follows the activity source chosen through FIELD_MAP', () => {
    const payload = { data: { acts: [{ title: EN, title_ar: AR }] } };
    const out = mapPayload(payload, JSON.stringify({ 'data.acts': 'activity_category' }));
    expect(out['activity_category']).toBe(EN);
    expect(out['activity_category_ar']).toBe(AR);
  });
});

describe('validateCanonical: activity_category_ar', () => {
  const base = { licence_number: 'SPC-1', company_name_en: 'Nimbus FZE' };
  it('is optional and blank becomes null', () => {
    const r = validateCanonical({ ...base, activity_category_ar: '   ' });
    expect(r.ok && r.fields.activity_category_ar).toBeNull();
  });
  it('is limited to 80 characters', () => {
    const r = validateCanonical({ ...base, activity_category_ar: 'ن'.repeat(81) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('activity_category_ar');
  });
  it('strips HTML', () => {
    const r = validateCanonical({ ...base, activity_category_ar: `<b>${AR}</b>` });
    expect(r.ok && r.fields.activity_category_ar).toBe(AR);
  });
});

describe('hashFields', () => {
  it('changes when only the Arabic activity changes', async () => {
    const f: CanonicalFields = {
      licence_number: 'SPC-1', company_name_en: 'Nimbus FZE', company_name_ar: null, licence_type: null,
      activity_category: EN, activity_category_ar: null, founder_name_en: null, founder_name_ar: null, issued_on: '2026-10-16', preferred_language: 'en', licence_expires_on: null,
    };
    expect(await hashFields(f)).not.toBe(await hashFields({ ...f, activity_category_ar: AR }));
  });
});

describe('intake end to end', () => {
  const env = createTestEnv();
  const app = new Hono<AppEnv>().route('/', intakeRoutes);
  const post = (payload: unknown) =>
    app.request('/v1/licence-issued', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10', 'X-SPC-Webhook-Secret': 'test-production-secret-current' },
      body: JSON.stringify(payload),
    }, env);

  it('stores the Arabic activity and treats a change to it as an update', async () => {
    const first = await post({ licence_number: 'SPC-2026-07777', company_name: 'Nimbus FZE', activities: [{ Description_EN: EN }] });
    expect(first.status).toBe(200);
    const before = await findCardByLicence(env.DB, 'SPC-2026-07777', false);
    expect(before?.activity_category_ar).toBeNull();

    const second = await post({ licence_number: 'SPC-2026-07777', company_name: 'Nimbus FZE', activities: [{ Description_EN: EN, Description_AR: AR }] });
    expect(second.status).toBe(200);
    const after = await findCardByLicence(env.DB, 'SPC-2026-07777', false);
    expect(after?.activity_category_ar).toBe(AR);
    expect(after?.token).toBe(before?.token);
    expect(after?.content_hash).not.toBe(before?.content_hash);
  });
});

describe('mapPayload: plain activity names carry no Arabic', () => {
  it('a list of strings gives the English name only', () => {
    expect(mapPayload({ activities: ['Printing', 'Design'] }, '{}')).toEqual({ activity_category: 'Printing' });
  });
});
