// Stress-tests the card designs with awkward data so the layout never breaks on real licences.
//
//   npm run build
//   node tools/stress-cards.mjs <out dir> [--shots all|fail]
//
// For every dataset below × style × format × card language × "who is it about" × headline, it renders the
// card in headless Chrome and checks, on the card itself:
//   - text drawn outside the card;
//   - text clipped by a container that hides overflow;
//   - text overlapping other text;
//   - the calendar's day number spilling out of its diamond (Day One).
// Writes <out>/<case>.png for failing cases (or for all with --shots all) and prints a summary.
// Exit code 1 if anything fails.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { renderStudioShell, STUDIO_DIR } from '../dist/page/studio.js';

const [outDir, , shotsArg] = process.argv.slice(2);
if (!outDir) { console.error('usage: node tools/stress-cards.mjs <out dir> [--shots all|fail]'); process.exit(2); }
const SHOTS = shotsArg === 'all' ? 'all' : 'fail';
mkdirSync(outDir, { recursive: true });

const DATASETS = {
  // Longest plausible values everywhere, a two-digit day and the longest English month.
  max: {
    company_en: 'Brightpath International Learning, Training & Educational Consultancy Services FZ-LLC',
    company_ar: 'برايت باث الدولية للتعليم والتدريب والاستشارات التعليمية ش.ذ.م.م - منطقة حرة',
    activity_en: 'Publishing, printing and distribution of books, magazines and learning materials',
    activity_ar: 'نشر وطباعة وتوزيع الكتب والمجلات والمواد التعليمية والوسائط الرقمية والإلكترونية',
    name_en: 'Alexandra Konstantinopoulou-Whitmore', name_ar: 'عبدالرحمن بن عبدالعزيز المنصوري',
    licence_number: 'SPC-2026-1234567.01', issued_on: '2026-09-28',
  },
  // Everything optional missing, the shortest name, a one-digit day.
  min: {
    company_en: 'Ink FZE', company_ar: null, activity_en: null, activity_ar: null, name_en: null, name_ar: null,
    licence_number: 'S1', issued_on: '2026-05-01',
  },
  // Founder names around the length where the design's single line runs out.
  names16: {
    company_en: 'Al Noor Media FZ-LLC', company_ar: 'النور للإعلام ش.ذ.م.م - منطقة حرة', activity_en: 'Digital media production',
    activity_ar: 'إنتاج الوسائط الرقمية', name_en: 'Omar Al Mansoori', name_ar: 'عمر سالم المنصوري', licence_number: 'SPC-2026-00316', issued_on: '2026-03-08',
  },
  names24: {
    company_en: 'Falcon Ridge Trading FZE', company_ar: 'فالكون ريدج للتجارة م.م.ح', activity_en: 'General trading', activity_ar: 'التجارة العامة',
    name_en: 'Daniel Mercer-Fitzgerald', name_ar: 'عبدالله محمد الشامسي', licence_number: 'SPC-2026-00724', issued_on: '2026-11-30',
  },
  // Ordinary data, a two-digit day, December.
  typical: {
    company_en: 'Cedar & Quill Publishing FZE', company_ar: 'سيدار آند كويل للنشر م.م.ح',
    activity_en: 'Book publishing', activity_ar: 'نشر الكتب', name_en: 'Layla Haddad', name_ar: 'ليلى حداد',
    licence_number: 'SPC-2026-00042', issued_on: '2026-12-16',
  },
};

const TEMPLATES = ['dayone', 'daylight', 'pass'];
const FORMATS = ['square', 'portrait', 'landscape'];
const LANGS = ['en', 'ar'];
const FOCUS = ['both', 'company', 'personal'];
// Default headline, the longest preset, and a 32-character custom one (the design's maximum).
const HEADLINES = [
  { hIdx: 0 },
  { hIdx: 5 },
  { hIdx: 6, customHead: 'We are officially open for work!' },
];

function shellFor(ds) {
  const card = { token: 'StressTokenStressToken', company_name_en: ds.company_en, company_name_ar: ds.company_ar, licence_number: ds.licence_number,
    issued_on: ds.issued_on, activity_category: ds.activity_en, activity_category_ar: ds.activity_ar, founder_name_en: ds.name_en,
    founder_name_ar: ds.name_ar, preferred_language: 'en', is_test: false };
  const data = { token: card.token, company_en: ds.company_en, company_ar: ds.company_ar, licence_number: ds.licence_number, issued_on: ds.issued_on,
    activity_en: ds.activity_en, activity_ar: ds.activity_ar, name_en: ds.name_en, name_ar: ds.name_ar, lang: 'en', is_test: false, debug: true };
  return renderStudioShell({ card, nonce: 'x', gtmContainer: null })
    .replace(/(<script type="application\/json" id="card-data">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(data).replace(/</g, '\\u003c') + b);
}

let currentShell = '';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(currentShell); }
  if (u.pathname.startsWith('/static/studio/')) {
    let body = null;
    try { body = readFileSync(path.join(STUDIO_DIR, u.pathname.slice('/static/studio/'.length))); } catch {}
    if (body) { res.writeHead(200, { 'content-type': TYPES[path.extname(u.pathname)] || 'application/octet-stream' }); return res.end(body); }
  }
  res.writeHead(u.pathname === '/favicon.ico' ? 204 : 404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

/** Runs in the page: every text problem on the card, as short strings. */
function inspect() {
  const host = window.__dcHost;
  const card = host.logic.cardRef.current;
  const cr = card.getBoundingClientRect();
  const problems = [];
  const lines = []; // [el, rect]
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  const label = (el) => (el.textContent || '').trim().slice(0, 28);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
    const fs = parseFloat(cs.fontSize) * scale;
    // Deliberate truncation (ellipsis, line clamp) sits on the element or the one around the interpolation span.
    const tbox = [el, el.parentElement].find((x) => x && (getComputedStyle(x).textOverflow === 'ellipsis' || (getComputedStyle(x).webkitLineClamp || 'none') !== 'none'));
    const truncates = !!tbox;
    // An ellipsis hides text sideways; a line clamp hides whole lines. Arabic glyphs are taller than a 1.1 line
    // height, so the vertical test allows half a line before calling a line hidden.
    const tcs = tbox && getComputedStyle(tbox);
    const clamped = tcs && (tcs.webkitLineClamp || 'none') !== 'none';
    const lh = tcs ? parseFloat(tcs.lineHeight) || parseFloat(tcs.fontSize) * 1.2 : 0;
    if (tbox && (clamped ? tbox.scrollHeight > tbox.clientHeight + lh * 0.5 : tbox.scrollWidth > tbox.clientWidth + 1)) {
      problems.push(`truncated: "${label(el)}"`);
    }
    for (const box of range.getClientRects()) {
      if (box.width < 0.5 || box.height < 0.5) continue;
      // Line boxes include the font's full ascent and descent (very tall for Noto Kufi Arabic); the letters
      // sit in a band of about 0.7 em around the middle, which is what can collide or be clipped.
      const band = Math.min(box.height, 0.7 * fs);
      const mid = (box.top + box.bottom) / 2;
      const r = { left: box.left, right: box.right, top: mid - band / 2, bottom: mid + band / 2, width: box.width, height: band };
      lines.push([el, r, tbox]);
      const tol = 1;
      if (r.left < cr.left - tol || r.right > cr.right + tol || r.top < cr.top - tol || r.bottom > cr.bottom + tol) {
        problems.push(`outside card: "${label(el)}"`);
      }
      // clipped by an ancestor that hides overflow (deliberate ellipsis is reported as "truncated" above)
      if (truncates) continue;
      for (let a = el.parentElement; a && a !== card.parentElement; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflow === 'visible' && acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 1 || r.left < ar.left - 1 || r.bottom > ar.bottom + 1 || r.top < ar.top - 1) {
          problems.push(`clipped: "${label(el)}"`);
          break;
        }
      }
    }
  }
  // text overlapping other text (different elements, not nested)
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const [ea, a, ta] = lines[i], [eb, b, tb] = lines[j];
      // lines a clamp or ellipsis hides do not collide with anything
      const hidden = (r, t) => t && (r.bottom > t.getBoundingClientRect().bottom + 1 || r.right > t.getBoundingClientRect().right + 1);
      if (hidden(a, ta) || hidden(b, tb)) continue;
      if (ea === eb || ea.contains(eb) || eb.contains(ea)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && w * h > 0.15 * Math.min(a.width * a.height, b.width * b.height)) {
        problems.push(`overlap: "${label(ea)}" / "${label(eb)}"`);
      }
    }
  }
  // Day One: the day number must sit inside its rotated-square frame (|dx|+|dy| <= half diagonal, less the border).
  for (const el of card.querySelectorAll('span')) {
    const frame = el.previousElementSibling;
    if (!frame || !/rotate\(45deg\)/.test(frame.style.transform) || !/^\d{1,2}$/.test(el.textContent.trim())) continue;
    const fr = frame.getBoundingClientRect();
    const cx = fr.left + fr.width / 2, cy = fr.top + fr.height / 2;
    const half = fr.width / 2 - parseFloat(frame.style.borderWidth || '0') * (fr.width / frame.offsetWidth / Math.SQRT2) * 1.6;
    // glyph box from canvas metrics, scaled like the card
    const cs = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.letterSpacing = cs.letterSpacing;
    const m = ctx.measureText(el.textContent.trim());
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
    const gw = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * scale;
    const gh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * scale;
    // The design's own "8" uses up to ~112 % of this conservative estimate and is the reference.
    if (gw / 2 + gh / 2 > half * 1.15) problems.push(`day number ${el.textContent.trim()} spills out of the diamond (${Math.round((gw / 2 + gh / 2) / half * 100)}% of the space)`);
  }
  return [...new Set(problems)];
}

const browser = await puppeteer.launch({ headless: true, args: ['--font-render-hinting=none'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const failures = [];
let checked = 0;
for (const [dsName, ds] of Object.entries(DATASETS)) {
  currentShell = shellFor(ds);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  for (const tpl of TEMPLATES) for (const format of FORMATS) for (const lang of LANGS) for (const focus of FOCUS) for (const hd of HEADLINES) {
    if (dsName !== 'max' && hd.hIdx !== 0) continue; // headline variants only matter with long data
    const name = `${dsName}-${tpl}-${format}-${lang}-${focus}-h${hd.hIdx}`;
    await page.evaluate((st) => { window.__dcHost.logic.setState(st); }, { tpl, format, lang, focus, imgMode: 'initials', customHead: '', ...hd });
    // Let fitted text (the Launch Pass stub name) settle: wait until its size stops changing.
    await page.evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      let last = null;
      for (let i = 0; i < 40; i++) {
        await frame();
        const el = window.__dcHost.logic.cardRef.current.querySelector('[data-fit]');
        const now = el ? getComputedStyle(el).fontSize + getComputedStyle(el).webkitLineClamp : '';
        if (now === last) break;
        last = now;
      }
    });
    await page.evaluate(() => document.fonts.ready);
    const problems = await page.evaluate(inspect);
    checked++;
    if (problems.length) failures.push([name, problems]);
    if (SHOTS === 'all' || problems.length) {
      const el = await page.evaluateHandle(() => window.__dcHost.logic.cardRef.current);
      await el.screenshot({ path: path.join(outDir, `${name}.png`) });
    }
  }
}
await browser.close();
server.close();
for (const [name, problems] of failures) console.log(`FAIL ${name}\n     ${problems.join('\n     ')}`);
console.log(`\n${checked} cases checked, ${failures.length} with problems`);
process.exit(failures.length ? 1 : 0);
