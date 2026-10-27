// Six fictional licences, shaped the way an ERP might send them, for testing the whole path before the
// real ERP is connected. Every one becomes a TEST card ([TEST] in the page title only; kept, never deleted).
// The first carries a licence expiry a year from today; the last expired in 2025, so its page shows "expired".
//
// Locally, through the real webhook (mapping, validation, events), against a running service:
//   node tools/erp-samples.mjs --http http://127.0.0.1:18790 <test secret>
// On the server, inside the container (the webhook is closed until the ERP's addresses are allowlisted, so
// this runs the same mapping, validation and upsert directly):
//   ssh root@13.206.34.102 "docker exec -i -w /app spcfz-licence-card node --input-type=module" < tools/erp-samples.mjs
//
// The names are invented. Re-running updates the same cards (same licence numbers) instead of adding more.
// The customer emails are at example.com, which no one receives: test cards only email the domains on
// MAIL_TEST_ALLOWLIST (spcfz.ae unless set; the local copy adds example.com and writes mail to files).

const today = new Date().toISOString().slice(0, 10);
const [y, m, d] = today.split('-');
const nextYear = `${Number(y) + 1}-${m}-${d}`;

export const SAMPLES = [
  {
    label: 'Typical licence, English, every field in both languages',
    payload: {
      licence_number: 'TEST-2026-0001',
      company_name_en: 'Cedar & Quill Publishing FZE',
      company_name_ar: 'سيدار آند كويل للنشر م.م.ح',
      licence_type: 'Standard',
      activity_category: 'Book publishing',
      activity_category_ar: 'نشر الكتب',
      founder_name_en: 'Layla Haddad',
      founder_name_ar: 'ليلى حداد',
      customer_email: 'layla.haddad@example.com',
      cc_email: 'account.manager@example.com',
      issued_on: today,
      licence_expiry_date: nextYear,
      preferred_language: 'en',
    },
  },
  {
    label: 'Arabic customer; founder and email sent as an owner object',
    payload: {
      licence_number: 'TEST-2026-0002',
      company_name: 'Al Noor Media FZ-LLC',
      company_name_ar: 'النور للإعلام ش.ذ.م.م - منطقة حرة',
      activities: [{ Description_EN: 'Digital media production', Description_AR: 'إنتاج الوسائط الرقمية' }],
      owner: { full_name: 'Omar Al Mansoori', name_ar: 'عمر المنصوري', email: 'omar.almansoori@example.com' },
      issue_date: today,
      language: 'Arabic',
    },
  },
  {
    label: 'English only: no Arabic names, long company name',
    payload: {
      licence_number: 'TEST-2026-0003',
      company_name_en: 'Brightpath Learning & Educational Consultancy FZE',
      activity_category: 'Educational consultancy',
      founder_name: 'Priya Raman',
      email: 'priya@example.com',
      issued_on: today,
    },
  },
  {
    label: 'ERP-style field names and a DD/MM/YYYY date',
    payload: {
      LicenseNo: 'TEST-2026-0004',
      CompanyName: 'Falcon Ridge Trading FZE',
      CompanyNameAr: 'فالكون ريدج للتجارة م.م.ح',
      Activities: [{ Description_EN: 'General trading', Description_AR: 'التجارة العامة' }],
      OwnerName: 'Daniel Mercer',
      EmailAddress: 'Daniel.Mercer@Example.com',
      IssueDate: `${d}/${m}/${y}`,
      Language: 'English',
    },
  },
  {
    label: 'Long legal founder name, shortened on the card; no email, so no welcome email',
    payload: {
      licence_number: 'TEST-2026-0005',
      company_name_en: 'Saffron Lane Events FZ-LLC',
      company_name_ar: 'سافرون لين للفعاليات ش.ذ.م.م - منطقة حرة',
      activity_category: 'Event management',
      activity_category_ar: 'إدارة الفعاليات',
      founder_name_en: 'Mohammed Abdullah Rashid Saeed Al Example',
      founder_name_ar: 'محمد عبدالله راشد سعيد المثال',
      issued_on: today,
      preferred_language: 'en',
    },
  },
  {
    label: 'Licence that has already expired: the page says so',
    payload: {
      licence_number: 'TEST-2024-0006',
      company_name_en: 'Old Harbour Print FZE',
      company_name_ar: 'أولد هاربر للطباعة م.م.ح',
      activity_category: 'Printing',
      founder_name_en: 'Sara Khan',
      customer_email: 'sara.khan@example.com',
      issued_on: '2024-10-01',
      expiry_date: '30/09/2025',
      preferred_language: 'en',
    },
  },
];

const args = process.argv.slice(2);
if (args[0] === '--http') {
  const [, base, secret] = args;
  if (!base || !secret) { console.error('usage: node tools/erp-samples.mjs --http <base url> <test secret>'); process.exit(2); }
  for (const s of SAMPLES) {
    const res = await fetch(`${base.replace(/\/+$/, '')}/v1/test/licence-issued`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-SPC-Webhook-Secret': secret },
      body: JSON.stringify(s.payload),
    });
    const body = await res.json().catch(() => ({}));
    console.log(`${res.status}  ${s.label}\n     ${body.page_url ?? JSON.stringify(body.errors ?? body)}`);
  }
} else {
  // Inside the container: the same mapping, validation and upsert as the webhook, minus the network checks.
  const { default: path } = await import('node:path');
  const APP = process.env.APP_DIR ?? '/app';
  const { SqliteDb } = await import(`${APP}/dist/platform/sqlite-db.js`);
  const { mapPayload } = await import(`${APP}/dist/intake/mapper.js`);
  const { validateCanonical } = await import(`${APP}/dist/intake/validate.js`);
  const { upsertFromCanonical } = await import(`${APP}/dist/intake/upsert.js`);
  const db = SqliteDb.open(path.join(process.env.DATA_DIR ?? '/data', 'licence-card.sqlite'));
  const env = { DB: db, BASE_URL: process.env.BASE_URL ?? 'https://licensed.spcfz.ae' };
  for (const s of SAMPLES) {
    const v = validateCanonical(mapPayload(s.payload, process.env.FIELD_MAP || '{}'));
    if (!v.ok) { console.log(`REJECTED  ${s.label}: ${v.errors.join('; ')}`); continue; }
    const r = await upsertFromCanonical(env, v.fields, { is_test: true, source: 'test' });
    console.log(`${r.outcome.padEnd(9)} ${s.label}\n          ${r.page_url}`);
  }
  db.close();
}
