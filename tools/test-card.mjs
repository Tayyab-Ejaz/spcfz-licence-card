// Creates (or refreshes) ONE test card on a running service and prints its page URL. Test cards are
// marked TEST, they look exactly like live cards, and they are kept (nothing is deleted automatically).
//
// It runs inside the container, fed on stdin, so nothing is installed on the host:
//   ssh root@13.206.34.102 "docker exec -i -w /app spcfz-licence-card node --input-type=module" < tools/test-card.mjs
const DATA_DIR = process.env.DATA_DIR ?? '/data';
const APP = process.env.APP_DIR ?? '/app';
const { default: path } = await import('node:path');
const { SqliteDb } = await import(`${APP}/dist/platform/sqlite-db.js`);
const { upsertFromCanonical } = await import(`${APP}/dist/intake/upsert.js`);

const db = SqliteDb.open(path.join(DATA_DIR, 'licence-card.sqlite'));
const env = { DB: db, BASE_URL: process.env.BASE_URL ?? 'https://licensed.spcfz.ae' };

const fields = {
  licence_number: process.env.TEST_LICENCE ?? 'TEST-PREVIEW-0001',
  company_name_en: 'Preview Publishing FZE',
  company_name_ar: 'معاينة للنشر م.م.ح',
  licence_type: 'Standard',
  activity_category: 'Book Publishing',
  activity_category_ar: 'نشر الكتب',
  founder_name_en: 'Mariam Fawzy',
  founder_name_ar: 'مريم فوزي',
  issued_on: new Date().toISOString().slice(0, 10),
  preferred_language: process.env.TEST_LANG === 'ar' ? 'ar' : 'en',
};

const { card, outcome, page_url } = await upsertFromCanonical(env, fields, { is_test: true, source: 'manual' });
console.log('card', outcome, card.id);
console.log('page', page_url);
db.close();
