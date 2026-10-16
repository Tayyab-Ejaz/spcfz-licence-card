// Pixel-compares the built studio against the approved design exports, state by state.
//
//   npm run build   (tsc + studio)
//   node tools/compare-design.mjs "<dir with the two Standalone.html exports>" <out dir>
//
// Serves the studio with the design's own sample data (Lumen & Ledger FZ-LLC, Mariam Fawzy, 8 Oct 2026,
// licence 4425153.01), opens the export and the build in the same headless Chrome at the same size,
// performs the same clicks in both, and diffs the screenshots. Writes <out>/<state>.{design,build,diff}.png
// and prints the share of differing pixels per state. Exit code 1 if any state differs by more than 0.1 %.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { renderStudioShell, STUDIO_DIR } from '../dist/page/studio.js';

const [designDir, outDir] = process.argv.slice(2);
if (!designDir || !outDir) { console.error('usage: node tools/compare-design.mjs <design dir> <out dir>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const SAMPLE = {
  token: 'SampleTokenSampleToken', company_en: 'Lumen & Ledger FZ-LLC', company_ar: 'لومن آند ليدجر ش.ذ.م.م - منطقة حرة',
  licence_number: '4425153.01', issued_on: '2026-10-08', activity_en: 'Financial advisory for small businesses',
  activity_ar: 'استشارات مالية للشركات الصغيرة', lang: 'en', is_test: false,
  // The design pre-fills these from the licence; production data carries none, so they exist only here.
  name_en: 'Mariam Fawzy', role_en: 'Founder', name_ar: 'مريم فوزي', role_ar: 'المؤسِّسة',
};
const card = { token: SAMPLE.token, company_name_en: SAMPLE.company_en, company_name_ar: SAMPLE.company_ar, licence_number: SAMPLE.licence_number,
  issued_on: SAMPLE.issued_on, activity_category: SAMPLE.activity_en, activity_category_ar: SAMPLE.activity_ar, preferred_language: 'en', is_test: false };
const shell = renderStudioShell({ card, nonce: 'x', gtmContainer: null })
  .replace(/(<script type="application\/json" id="card-data">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(SAMPLE).replace(/</g, '\\u003c') + b);

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(shell); }
  if (u.pathname.startsWith('/static/studio/')) {
    const f = path.join(STUDIO_DIR, u.pathname.slice('/static/studio/'.length));
    let body = null;
    try { body = readFileSync(f); } catch { console.log('missing static file:', u.pathname); }
    if (body) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); return res.end(body); }
  }
  if (req.method === 'POST') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });

async function open(url, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500));
  return { page, errors };
}

async function act(page, a) {
  await page.bringToFront(); // background tabs get no animation frames, and puppeteer's click waits for one
  if (a.text) {
    const el = await page.waitForSelector(`::-p-text(${a.text})`, { timeout: 5000 });
    await Promise.race([el.click(), new Promise((_, j) => setTimeout(() => j(new Error(`click on "${a.text}" timed out`)), 10000))]);
  } else if (a.aria) {
    const el = await page.waitForSelector(`[aria-label="${a.aria}"]`, { timeout: 5000 });
    await el.click();
  }
  await new Promise((r) => setTimeout(r, a.wait ?? 1200));
}

/**
 * Viewport screenshots only: a full-page capture resizes the window, which makes the design recompute and
 * animate the card size mid-capture. Captures the top of the page and, when it is taller, the bottom too,
 * stacked into one image.
 */
async function shot(page) {
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  const vh = page.viewport().height;
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const top = PNG.sync.read(await page.screenshot());
  if (docH <= vh + 1) return top;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await new Promise((r) => setTimeout(r, 700));
  const bottom = PNG.sync.read(await page.screenshot());
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 700));
  const out = new PNG({ width: top.width, height: top.height + bottom.height });
  PNG.bitblt(top, out, 0, 0, top.width, top.height, 0, 0);
  PNG.bitblt(bottom, out, 0, 0, bottom.width, bottom.height, 0, top.height);
  return out;
}

function diff(name, A, B) {
  const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
  const pad = (img) => { if (img.width === w && img.height === h) return img; const o = new PNG({ width: w, height: h }); o.data.fill(255); PNG.bitblt(img, o, 0, 0, img.width, img.height, 0, 0); return o; };
  const a = pad(A), b = pad(B), d = new PNG({ width: w, height: h });
  const n = pixelmatch(a.data, b.data, d.data, w, h, { threshold: 0.1 });
  writeFileSync(path.join(outDir, `${name}.design.png`), PNG.sync.write(a));
  writeFileSync(path.join(outDir, `${name}.build.png`), PNG.sync.write(b));
  if (n) writeFileSync(path.join(outDir, `${name}.diff.png`), PNG.sync.write(d));
  return { n, pct: (100 * n) / (w * h), size: `${A.width}x${A.height} vs ${B.width}x${B.height}` };
}

const PLANS = [
  {
    file: 'License Announcement Studio - Standalone.html', prefix: 'desktop', w: 1440, h: 900,
    steps: [
      ['start', null],
      ['daylight', { text: 'Daylight' }], ['daylight-portrait', { text: 'Portrait' }], ['daylight-landscape', { text: 'Landscape' }],
      ['pass-landscape', { text: 'Launch Pass' }], ['pass-portrait', { text: 'Portrait' }], ['pass-square', { text: 'Square' }],
      ['dayone-square', { text: 'Day One' }], ['dayone-portrait', { text: 'Portrait' }], ['dayone-landscape', { text: 'Landscape' }],
      ['dayone-landscape-ar', { text: 'العربية' }], ['dayone-portrait-ar', { text: 'Portrait' }], ['dayone-square-ar', { text: 'Square' }],
      ['daylight-square-ar', { text: 'Daylight' }], ['pass-square-ar', { text: 'Launch Pass' }], ['dayone-en', { text: 'English' }],
      ['step2-details', { text: 'Next: Details' }], ['step3-share', { text: 'Next: Share' }],
    ],
  },
  {
    file: 'License Announcement Studio - Standalone.html', prefix: 'tablet', w: 900, h: 1000,
    steps: [['start', null], ['step2', { text: 'Next: Details' }]],
  },
  {
    file: 'License Announcement Mobile - Standalone.html', prefix: 'mobile', w: 390, h: 844,
    steps: [
      ['start', null], ['portrait', { text: 'Portrait' }], ['landscape', { text: 'Landscape' }], ['square', { text: 'Square' }],
      ['sheet-headline', { text: 'Headline' }], ['sheet-headline-done', { text: 'Done' }],
      ['sheet-photo', { text: 'Photo' }], ['sheet-photo-done', { text: 'Done' }],
      ['sheet-details', { text: 'Details' }], ['sheet-details-done', { text: 'Done' }],
    ],
  },
];

let worst = 0;
const rows = [];
for (const plan of PLANS) {
  const D = await open('file://' + path.join(path.resolve(designDir), plan.file), plan.w, plan.h);
  const B = await open(base, plan.w, plan.h);
  for (const [name, action] of plan.steps) {
    try {
      if (action) { await act(D.page, action); await act(B.page, action); }
      const r = diff(`${plan.prefix}-${name}`, await shot(D.page), await shot(B.page));
      worst = Math.max(worst, r.pct);
      rows.push([`${plan.prefix}-${name}`, r.n, r.pct.toFixed(3) + ' %', r.size]);
    } catch (e) {
      rows.push([`${plan.prefix}-${name}`, 'ERROR', e.message.slice(0, 80), '']);
      worst = 100;
    }
  }
  if (B.errors.length) console.log(`${plan.prefix} build page errors:`, B.errors.slice(0, 5));
  await D.page.close(); await B.page.close();
}
for (const r of rows) console.log(r.map(String).join('\t'));
await browser.close();
server.close();
process.exit(worst > 0.1 ? 1 : 0);
