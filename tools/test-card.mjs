// Creates ONE test card on a running service and renders it in this process, then prints its page URL.
// Test cards carry a TEST ribbon and watermark and are deleted automatically after 30 days.
//
// It runs inside the container, fed on stdin, so nothing is installed on the host:
//   ssh root@13.206.34.102 "docker exec -i -w /app spcfz-licence-card node --input-type=module" < tools/test-card.mjs
// The service's own render worker only wakes for jobs it queues itself, so this script renders the card directly.
const DATA_DIR = process.env.DATA_DIR ?? '/data';
const APP = process.env.APP_DIR ?? '/app';
const { default: path } = await import('node:path');
const { SqliteDb } = await import(`${APP}/dist/platform/sqlite-db.js`);
const { FsBucket } = await import(`${APP}/dist/platform/fs-bucket.js`);
const { upsertFromCanonical } = await import(`${APP}/dist/intake/upsert.js`);
const { handleRenderBatch } = await import(`${APP}/dist/render/consumer.js`);
const { getCardById } = await import(`${APP}/dist/db/cards.js`);

const db = SqliteDb.open(path.join(DATA_DIR, 'licence-card.sqlite'));
const env = {
  DB: db,
  BUCKET: new FsBucket(path.join(DATA_DIR, 'images')),
  RENDER_QUEUE: { send: async () => undefined, sendBatch: async () => undefined },
  DATA_DIR,
  PORT: 0,
  TRUST_PROXY: 'off',
  BASE_URL: process.env.BASE_URL ?? 'https://licensed.spcfz.ae',
  ERP_IP_ALLOWLIST: '',
  FIELD_MAP: '{}',
  GTM_CONTAINER: '',
  TEMPLATE_VERSION: process.env.TEMPLATE_VERSION ?? 'placeholder-1',
  CHROME_PATH: process.env.CHROME_PATH,
};

const fields = {
  licence_number: process.env.TEST_LICENCE ?? 'TEST-PREVIEW-0001',
  company_name_en: 'Preview Publishing FZE',
  company_name_ar: 'معاينة للنشر م.م.ح',
  licence_type: 'Standard',
  activity_category: 'Book Publishing',
  activity_category_ar: 'نشر الكتب',
  issued_on: new Date().toISOString().slice(0, 10),
  preferred_language: 'en',
};

const { card, outcome, page_url } = await upsertFromCanonical(env, fields, { is_test: true, source: 'manual' });
console.log('card', outcome, card.id);

let failed = null;
const msg = {
  id: 'test-card', timestamp: new Date(), attempts: 1, body: { card_id: card.id, content_hash: card.content_hash },
  ack() {}, retry() { failed = 'render asked for a retry; see the container log'; },
};
await handleRenderBatch({ queue: 'render', messages: [msg], ackAll() {}, retryAll() {} }, env);
const after = await getCardById(db, card.id);
console.log('status', after?.status, failed ?? '');
console.log('page', page_url);
console.log('arabic', `${page_url}?lang=ar`);
db.close();
