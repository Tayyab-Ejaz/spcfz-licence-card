// The customer's journey, end to end, in the three browser engines (Playwright: WebKit for iPhone, iPad and Safari,
// Chromium for Android, Chrome and Edge, Gecko for Firefox), against a card link on the local copy or on live.
//
//   node tools/journey-test.mjs <cardUrl> <outDir> [device ...] [--light]
//
// Per device: opens the card, walks every option (styles, formats, headline preset and custom, a full-size photo,
// details and the wording check, who it is about there and back, caption, Arabic and back), makes the image as Share,
// Download and Post to LinkedIn make it, and checks every image (right size for its format, not blank, the photo in
// it). It also counts the shortest paths ("download, no changes" and "add a photo, then post to LinkedIn"), which is
// how the simple journey (SPC, 17 November 2026) is compared with the one before it. Works on both journeys: it
// detects which one the page has. Writes <outDir>/<device>.json and screenshots; prints PASS / FAIL lines.
//
// Stops at LinkedIn's sign-in page and never signs in. Against live, use TEST cards only: they record no views,
// beacons or LinkedIn steps. Playwright's request interception strips file uploads in WebKit, so the LinkedIn
// request is only watched, never intercepted. Needs the Playwright browsers: npx playwright install webkit firefox.
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const android = (model, mobile = true) => `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 ${mobile ? 'Mobile ' : ''}Safari/537.36`;
export const DEVICES = {
  'iphone-se': { engine: webkit, w: 375, h: 667, dpr: 2, touch: true, ua: IOS, share: true },
  'iphone-16': { engine: webkit, w: 393, h: 852, dpr: 3, touch: true, ua: IOS, share: true },
  'iphone-16-max': { engine: webkit, w: 430, h: 932, dpr: 3, touch: true, ua: IOS, share: true },
  'android-small': { engine: chromium, w: 360, h: 780, dpr: 3, touch: true, mobile: true, ua: android('SM-A156E'), share: true },
  'pixel-7': { engine: chromium, w: 412, h: 915, dpr: 2.625, touch: true, mobile: true, ua: android('Pixel 7'), share: true },
  'firefox-android': { engine: firefox, w: 393, h: 851, dpr: 1, touch: true, ua: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', share: false },
  'ipad-mini': { engine: webkit, w: 744, h: 1133, dpr: 2, touch: true, ua: IPAD, share: true },
  'ipad-air': { engine: webkit, w: 820, h: 1180, dpr: 2, touch: true, ua: IPAD, share: true },
  'android-tablet': { engine: chromium, w: 800, h: 1280, dpr: 2, touch: true, mobile: true, ua: android('SM-X710', false), share: true },
  'mac-safari': { engine: webkit, w: 1440, h: 900, dpr: 2, share: true },
  'chrome-1280': { engine: chromium, w: 1280, h: 720, dpr: 1, share: false },
  'chrome-1920': { engine: chromium, w: 1920, h: 1080, dpr: 1, share: false },
  'edge-1366': { engine: chromium, w: 1366, h: 768, dpr: 1, share: false, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' },
  'firefox-1440': { engine: firefox, w: 1440, h: 900, dpr: 1, share: false },
};

const args = process.argv.slice(2);
const LIGHT = args.includes('--light');
const [url, out, ...rest] = args.filter((a) => !a.startsWith('--'));
if (!url || !out) { console.error('usage: node tools/journey-test.mjs <cardUrl> <outDir> [device ...] [--light]'); process.exit(2); }
const keys = rest.length ? rest : Object.keys(DEVICES);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A phone-sized photo (12 MP, 3024 x 4032 like an iPhone's): large dark and light squares, so it still shows once the
// card shrinks it, plus fine grain so the file is photo-sized (a few MB).
const PHOTO = path.join(os.tmpdir(), 'spcfz-journey-photo.jpg');
{
  const W = 3024, Hh = 4032, raw = Buffer.alloc(W * Hh * 3);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const dark = ((Math.floor(x / 378) + Math.floor(y / 378)) & 1) === 0;
      const g = (Math.random() * 40) | 0, i = (y * W + x) * 3;
      raw[i] = dark ? 20 + g : 200 + (g >> 1); raw[i + 1] = dark ? 28 + g : 170 + (g >> 1); raw[i + 2] = dark ? 48 + g : 120 + (g >> 1);
    }
  }
  await sharp(raw, { raw: { width: W, height: Hh, channels: 3 } }).jpeg({ quality: 92 }).toFile(PHOTO);
}

let failures = 0;
for (const key of keys) {
  const dev = DEVICES[key];
  if (!dev) { console.error(`unknown device ${key}`); continue; }
  const r = await runDevice(key, dev);
  failures += r.results.filter((x) => !x.pass).length;
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);

async function newPage(b, dev, share) {
  const opts = { viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, hasTouch: !!dev.touch, acceptDownloads: true };
  if (dev.engine === chromium) opts.isMobile = !!dev.mobile;
  if (dev.ua) opts.userAgent = dev.ua;
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.addInitScript((share) => {
    try { localStorage.clear(); } catch (e) { /* private mode */ }
    if (share) {
      // The phone's share sheet: keep the file the studio hands over (on an iPhone, "Save Image" saves exactly this).
      navigator.canShare = () => true;
      navigator.share = async (d) => {
        const f = d.files[0]; const buf = new Uint8Array(await f.arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        window.__shared = { name: f.name, type: f.type, b64: btoa(s) };
      };
    } else {
      try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) { /* read-only */ }
      try { navigator.share = undefined; navigator.canShare = undefined; } catch (e) { /* read-only */ }
    }
  }, share);
  return { ctx, p };
}

function helpers(p) {
  const tap = (t, within) => p.evaluate(([t, within]) => {
    const root = within ? document.querySelector(within) : document; if (!root) return false;
    const vis = (x) => { const r = x.getBoundingClientRect(); return r.width && r.height && getComputedStyle(x).visibility !== 'hidden'; };
    const els = [...root.querySelectorAll('*')].filter((x) => vis(x) && (x.textContent || '').trim() === t);
    els.sort((a, c) => a.querySelectorAll('*').length - c.querySelectorAll('*').length);
    if (!els[0]) return false; els[0].click(); return true;
  }, [t, within]);
  const tapRe = (src, within) => p.evaluate(([src, within]) => {
    const re = new RegExp(src); const root = within ? document.querySelector(within) : document; if (!root) return null;
    const els = [...root.querySelectorAll('button, span, div, a, label')].filter((x) => { const r = x.getBoundingClientRect(); return r.width && r.height && re.test((x.textContent || '').trim()); });
    els.sort((a, c) => a.querySelectorAll('*').length - c.querySelectorAll('*').length);
    if (!els[0]) return null; els[0].click(); return els[0].textContent.trim().slice(0, 40);
  }, [src, within]);
  const visible = (t) => p.evaluate((t) => [...document.querySelectorAll('*')].some((x) => {
    const r = x.getBoundingClientRect();
    return r.width && r.height && r.bottom > 0 && r.top < innerHeight && getComputedStyle(x).visibility !== 'hidden' && (x.textContent || '').trim() === t;
  }), t);
  const bodyText = () => p.evaluate(() => document.body.innerText);
  const exists = (t) => p.evaluate((t) => [...document.querySelectorAll('*')].some((x) => { const r = x.getBoundingClientRect(); return r.width && r.height && (x.textContent || '').trim() === t; }), t);
  // The card itself: the element the studio turns into the image (div[data-lang][dir]), not the hidden copy it draws from.
  const card = () => p.evaluate(() => {
    const n = [...document.querySelectorAll('div[data-lang][dir]')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left > -1000; })
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { w: r.width, h: r.height, text: n.innerText, ratio: r.width / r.height, lang: n.getAttribute('data-lang'), dir: n.getAttribute('dir') };
  });
  const photoSlot = () => p.evaluate(() => {
    const c = [...document.querySelectorAll('div[data-lang][dir]')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left > -1000; })
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!c) return null;
    const node = [...c.querySelectorAll('*')].filter((el) => /url\("?data:image\/(jpeg|png)/.test(getComputedStyle(el).backgroundImage) && el.getBoundingClientRect().width > 10)
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!node) return null;
    const cr = c.getBoundingClientRect(), r = node.getBoundingClientRect();
    return { x: (r.left - cr.left) / cr.width, y: (r.top - cr.top) / cr.height, w: r.width / cr.width, h: r.height / cr.height };
  });
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const sheetOpen = () => p.evaluate(() => !!document.querySelector('[data-screen-label="Sheet"]'));
  const closeSheet = async () => { for (let i = 0; i < 3 && (await sheetOpen()); i++) { await tap('Done', '[data-screen-label="Sheet"]'); await sleep(500); } };
  const getShared = async () => {
    for (let i = 0; i < 160; i++) {
      const s = await p.evaluate(() => window.__shared || null);
      if (s) { await p.evaluate(() => { window.__shared = null; }); return s; }
      await sleep(250);
    }
    return null;
  };
  // The review request comes once, a moment after the first download or share (and its toast); close it with Not now.
  const closeReview = async () => {
    for (let i = 0; i < 28; i++) {
      if (/How was getting your license/.test(await bodyText())) { await tap('Not now'); await sleep(400); return true; }
      await sleep(250);
    }
    return false;
  };
  return { tap, tapRe, visible, exists, bodyText, card, photoSlot, overflow, sheetOpen, closeSheet, getShared, closeReview };
}

async function runDevice(key, dev) {
  const share = dev.share;
  const tag = key;
  const R = [];
  const ok = (name, cond, info = '') => { R.push({ name, pass: !!cond, info: String(info).slice(0, 300) }); console.log(`${cond ? 'PASS' : 'FAIL'} ${key}: ${name}${info ? ` (${String(info).slice(0, 140)})` : ''}`); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} (stopped: ${String(e.message || e).split('\n')[0].slice(0, 120)})`, false); } };
  const b = await dev.engine.launch();
  const { ctx, p } = await newPage(b, dev, share);
  const H = helpers(p);
  const errs = [];
  p.on('pageerror', (e) => errs.push(`pageerror: ${String(e).slice(0, 200)}`));
  p.on('console', (m) => {
    const where = (m.location() && m.location().url) || p.url();
    if (m.type() === 'error' && !/Refused to apply a stylesheet/.test(m.text()) && !/linkedin|licdn/.test(where) && !/linkedin|licdn/.test(p.url())) errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const dialogs = []; p.on('dialog', async (d) => { dialogs.push(d.type()); await d.accept().catch(() => {}); });
  const host = new URL(url).host;
  const failedReq = [];
  p.on('requestfailed', (r) => { if (new URL(r.url()).host === host && !/linkedin|licdn/.test(p.url())) failedReq.push(`${r.url().slice(0, 120)} ${r.failure()?.errorText || ''}`); });
  p.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).host === host) failedReq.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  let liPost = null, liUrl = null;
  p.on('request', (r) => { if (/^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization|\/linkedin\/fake-signin\?/.test(r.url()) && !liUrl) liUrl = r.url(); });
  p.on('response', async (r) => {
    if (r.request().method() === 'POST' && /\/c\/[^/]+\/linkedin$/.test(r.url())) {
      liPost = { status: r.status() };
      try { const j = await r.json(); liPost.error = j.error; liUrl = liUrl || j.go || null; } catch (e) { /* the page left */ }
    }
  });
  const shot = (n) => p.screenshot({ path: path.join(out, `${tag}-${n}.png`) }).catch(() => {});
  const exports = [];
  const exportImage = async (label, layout, expectPhoto = true) => {
    const slot = await H.photoSlot();
    let file = null;
    if (layout === 'phone' && share) {
      await H.tap('Share');
      if (await H.visible('Continue with initials')) await H.tap('Continue with initials');
      const s = await H.getShared();
      ok(`${label}: Share hands over the image`, !!s, s ? `${s.name} ${s.type}` : 'nothing shared');
      if (s) { file = path.join(out, `${tag}-${label}.${s.type === 'image/jpeg' ? 'jpg' : 'png'}`); writeFileSync(file, Buffer.from(s.b64, 'base64')); }
    } else {
      const label2 = '^(Download|Download card|تنزيل البطاقة)$';
      const dlP = p.waitForEvent('download', { timeout: 90000 });
      await H.tapRe(label2);
      await sleep(400);
      if (await H.visible('Continue with initials')) await H.tap('Continue with initials');
      const dl = await dlP;
      file = path.join(out, `${tag}-${label}.png`); await dl.saveAs(file);
      ok(`${label}: Download saves the image`, true, dl.suggestedFilename());
    }
    if (file) exports.push({ label, file, slot: expectPhoto ? slot : null, expectPhoto });
  };

  // ------------------------------------------------------------------ open
  const t0 = Date.now();
  const resp = await p.goto(url, { waitUntil: 'networkidle' });
  await sleep(900);
  const layout = await p.evaluate(() => (matchMedia('(max-width: 759px)').matches ? 'phone' : 'desktop'));
  const simple = layout === 'phone' ? await H.visible('Customise') : /Customise card/.test(await H.bodyText());
  const journey = simple ? 'simple' : 'before';
  ok(`opens (${layout} layout, ${journey} journey, ${Date.now() - t0} ms)`, resp.status() === 200, resp.status());
  ok('page heading', /is officially licensed!/.test(await H.bodyText()));
  ok('no sideways scroll', (await H.overflow()) <= 1, `${await H.overflow()}px`);
  await step('card preview', async () => { const c = await H.card(); ok('card preview shows', c && c.w > 150, c ? `${Math.round(c.w)}x${Math.round(c.h)}` : 'none'); });
  await shot('01-open');

  // How many things to tap on the first screen (below the header): buttons, links, chips, tabs.
  const firstScreen = await p.evaluate(() => {
    const header = document.querySelector('header'); const hb = header ? header.getBoundingClientRect().bottom : 0;
    const clickable = [...document.querySelectorAll('button, a, [role="button"], span, div')].filter((el) => {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.top < hb || r.top > innerHeight) return false;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
      return cs.cursor === 'pointer' || el.tagName === 'BUTTON' || el.tagName === 'A';
    });
    // Count the outermost clickable boxes only (a button's icon and label are one control).
    const outer = clickable.filter((el) => !clickable.some((o) => o !== el && o.contains(el)));
    return outer.map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30));
  });
  ok(`first screen: ${firstScreen.length} controls`, true, firstScreen.join(' | '));

  if (layout === 'phone') {
    if (simple) {
      await step('simple first screen', async () => {
        ok('first screen: Add photo and Customise', (await H.visible('Add photo')) && (await H.visible('Customise')));
        ok('first screen: the style switcher, but no toolbar or size switch', /Standard · 1 of 3/.test(await H.bodyText()) && !(await H.visible('Headline')) && !(await H.visible('Square')));
        await p.evaluate(() => document.querySelectorAll('.m-dot')[1]?.click()); await sleep(600);
        ok('first screen: the style switcher changes the template', /Launch Pass ·/.test(await H.bodyText()));
        await p.evaluate(() => document.querySelectorAll('.m-dot')[0]?.click()); await sleep(500);
        const c = await H.card(); ok('starts on the finished card (Standard, initials)', c && !(await H.photoSlot()) && /Open for business!/.test(c.text));
      });
      await step('simple add photo', async () => {
        const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), H.tap('Add photo')]);
        await fc.setFiles(PHOTO); await sleep(1500);
        ok('Add photo puts the photo on the card', !!(await H.photoSlot()));
        ok('the button now says Adjust photo', await H.visible('Adjust photo'));
        await H.tap('Adjust photo'); await sleep(700);
        ok('Adjust photo opens the photo drawer', (await H.sheetOpen()) && /Reset position|Replace/.test(await H.bodyText()));
        await H.closeSheet();
        await shot('02-simple-photo');
      });
      await step('customise', async () => {
        await H.tap('Customise'); await sleep(700);
        ok('Customise shows the toolbar, style and size', (await H.visible('Headline')) && (await H.visible('Square')));
      });
    }
    await step('styles', async () => {
      for (const [i, name] of [[1, 'Launch Pass'], [2, 'Day One'], [0, 'Standard']]) {
        await p.evaluate((i) => document.querySelectorAll('.m-dot')[i]?.click(), i); await sleep(600);
        ok(`style ${name}`, new RegExp(`${name} ·`).test(await H.bodyText()));
      }
    });
    await step('formats', async () => {
      for (const [f, want] of [['Square', 1], ['Landscape', 1200 / 627], ['Portrait', 0.8]]) {
        await H.tap(f); await sleep(700); const c = await H.card();
        ok(`format ${f}`, c && Math.abs(c.ratio - want) < 0.06, c ? c.ratio.toFixed(2) : 'no card');
      }
    });
    if (!LIGHT) await step('headline', async () => {
      await H.tap('Headline'); await sleep(700);
      await H.tap("It's official!", '[data-screen-label="Sheet"]'); await sleep(500);
      ok('headline preset on the card', /It's official!/.test((await H.card()).text));
      const opened = await H.tap('Write custom headline', '[data-screen-label="Sheet"]'); await sleep(400);
      await p.evaluate(() => document.querySelector('[data-screen-label="Sheet"] input[placeholder="Write a short headline"]')?.focus());
      await p.keyboard.type('Now open in Sharjah'); await sleep(400);
      await H.tap('Done', '[data-screen-label="Sheet"]'); await sleep(700);
      ok('custom headline on the card', opened && /Now open in Sharjah/.test((await H.card()).text));
    });
    await step('photo', async () => {
      await H.tap('Photo'); await sleep(700);
      if (!(await H.photoSlot())) {
        const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), H.tap('Upload a photo', '[data-screen-label="Sheet"]')]);
        await fc.setFiles(PHOTO); await sleep(1500);
      }
      await p.evaluate(() => { const z = document.querySelector('[aria-label="Zoom in"]'); if (z) z.click(); }); await sleep(400);
      await H.closeSheet();
      ok('photo on the card', !!(await H.photoSlot()));
      await shot('04-photo');
    });
    if (!LIGHT) await step('details', async () => {
      await H.tap('Details'); await sleep(700);
      const inputs = () => p.evaluate(() => [...document.querySelectorAll('[data-screen-label="Sheet"] input')].filter((x) => x.type !== 'file' && x.type !== 'range').map((x) => x.value));
      const select = (i) => p.evaluate((i) => { const el = [...document.querySelectorAll('[data-screen-label="Sheet"] input')].filter((x) => x.type !== 'file' && x.type !== 'range')[i]; el.focus(); el.select(); }, i);
      const fields = await inputs();
      const roleIdx = Math.max(0, fields.findIndex((v) => /^founder$/i.test(v)));
      await select(roleIdx); await p.keyboard.type('Managing Director'); await sleep(400);
      ok('role change on the card', /Managing Director/.test((await H.card()).text));
      const actIdx = fields.length - 1; const actOld = fields[actIdx];
      await select(actIdx); await p.keyboard.type('The best publishing house'); await sleep(400);
      await H.tap('Done', '[data-screen-label="Sheet"]'); await sleep(600);
      ok('wording check stops "best"', /can't appear next to the SPC logo/.test(await H.bodyText()));
      if (!(await H.sheetOpen())) { await H.tap('Details'); await sleep(600); }
      await select(actIdx); await p.keyboard.type(actOld); await sleep(300);
      await H.closeSheet();
      ok('details drawer closes once fixed', !(await H.sheetOpen()));
    });
    if (!LIGHT) await step('about', async () => {
      await H.tap('About'); await sleep(700); await H.tap('The company', '[data-screen-label="Sheet"]'); await sleep(500);
      ok('"The company" hides the person', !/Managing Director/.test((await H.card()).text));
      await H.tap('You and your company', '[data-screen-label="Sheet"]'); await sleep(400); await H.closeSheet();
      ok('"You and your company" brings them back', /Managing Director/.test((await H.card()).text));
      ok('the photo comes back after "The company" and back', !!(await H.photoSlot()));
      if (!(await H.photoSlot())) { await H.tap('Photo'); await sleep(700); await H.tap('Your photo', '[data-screen-label="Sheet"]'); await sleep(500); await H.closeSheet(); }
    });
    if (!LIGHT) await step('caption', async () => {
      await H.tap('Caption'); await sleep(700);
      const text = await p.evaluate(() => document.querySelector('[data-screen-label="Sheet"] textarea')?.value || '');
      const tabs = await H.visible('Professional');
      ok(simple ? 'caption: one caption, no tone tabs' : 'caption: tone tabs', simple ? !tabs && text.length > 40 : tabs, text.slice(0, 50));
      await H.closeSheet();
    });
    await step('export EN', async () => { await exportImage('en-portrait', layout); ok('review request shown after the first share', await H.closeReview()); });
    if (!LIGHT) await step('arabic', async () => {
      await H.tap('English'); await sleep(600); await H.tap('العربية', '[data-screen-label="Sheet"]'); await sleep(400); await H.closeSheet(); await sleep(400);
      const ca = await H.card(); ok('Arabic card', ca && ca.lang === 'ar' && ca.dir === 'rtl', ca ? `${ca.lang} ${ca.dir}` : '');
      ok('no sideways scroll in Arabic', (await H.overflow()) <= 1);
      await exportImage('ar-portrait', layout);
      await H.tap('العربية'); await sleep(600); await H.tap('English', '[data-screen-label="Sheet"]'); await sleep(300); await H.closeSheet(); await sleep(400);
      const ce = await H.card(); ok('back to English', ce && ce.lang === 'en');
    });
    await step('square export', async () => { await H.tap('Square'); await sleep(800); await exportImage('square', layout); await H.tap('Portrait'); await sleep(600); });
    if (LIGHT) await step('landscape export', async () => { await H.tap('Landscape'); await sleep(800); await exportImage('landscape', layout); await H.tap('Portrait'); await sleep(600); });
    await step('linkedin', async () => { await H.tap('LinkedIn'); for (let i = 0; i < 120 && !liUrl && !liPost; i++) await sleep(250); for (let i = 0; i < 40 && !liUrl; i++) await sleep(250); });
  } else {
    if (simple) {
      await step('simple share screen', async () => {
        ok('opens on Share the Joy!', /Share the Joy!/.test(await H.bodyText()));
        ok('no step bar on the first screen', !(await H.visible('Details')) && !(await H.visible('Choose a template')));
        ok('Template, Add your photo, Post to LinkedIn and Download there', (await H.exists('Template')) && (await H.exists('Add your photo')) && ((await H.exists('Download card')) || (await H.exists('Download'))));
        ok('one caption, no tone tabs', !(await H.visible('Professional')));
        const c = await H.card(); ok('starts on the finished card (Standard, initials)', c && !(await H.photoSlot()) && /Open for business!/.test(c.text));
        // The template switch on this screen (18 November 2026): Standard, Launch Pass, Day One.
        const tpl = async () => { const t = (await H.card()).text; return /launch pass/i.test(t) ? 'Launch Pass' : /day one/i.test(t) ? 'Day One' : 'Standard'; };
        const seen = [];
        for (const name of ['Launch Pass', 'Day One', 'Standard']) { await H.tap(name); await sleep(600); seen.push(await tpl()); }
        ok('the Template switch changes the card', seen.join(' > ') === 'Launch Pass > Day One > Standard', seen.join(' > '));
      });
      await step('one-click download', async () => {
        await exportImage('first-click', layout, false);
        ok('no "Add your photo?" question', true);
        ok('review request after it', await H.closeReview());
      });
      await step('add photo on the share screen', async () => {
        const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), H.tapRe('^Add photo$')]);
        await fc.setFiles(PHOTO); await sleep(1500);
        ok('the photo is on the card', !!(await H.photoSlot()));
        ok('the row says so', await H.exists('Your photo is on the card'));
        await H.tapRe('^Adjust$'); await sleep(900);
        ok('Adjust opens the crop view', /Drag the frame to choose/.test(await H.bodyText()));
        await shot('02-simple-adjust');
        await H.tap('Style'); await sleep(800);
        ok('the step bar takes it to Style', /Choose a template/.test(await H.bodyText()));
        await H.tapRe('^Back$'); await sleep(800);
        ok('Back from Style returns to Share', /Share the Joy!/.test(await H.bodyText()));
        await H.tap('Customise card'); await sleep(800);
        ok('Customise card opens Style', /Choose a template/.test(await H.bodyText()));
      });
    }
    await step('style step', async () => {
      for (const name of ['Launch Pass', 'Day One', 'Standard']) { await H.tap(name); await sleep(600); }
      for (const [f, want] of [['Square', 1], ['Landscape', 1200 / 627], ['Portrait', 0.8]]) {
        const hit = await H.tap(f); await sleep(700); const c = await H.card();
        ok(`format ${f}`, hit && c && Math.abs(c.ratio - want) < 0.06, c ? c.ratio.toFixed(2) : 'no card');
      }
      await H.tapRe('^Next: Details$'); await sleep(800);
      ok('to Details', /Who is it about\?/.test(await H.bodyText()));
    });
    await step('who', async () => { await H.tap('You and your company'); await sleep(400); await H.tapRe('^Next: Photo$'); await sleep(800); ok('to Photo', /Upload a photo|Your photo|Replace/.test(await H.bodyText())); });
    await step('photo', async () => {
      if (!(await H.photoSlot())) {
        const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), H.tap('Upload a photo')]);
        await fc.setFiles(PHOTO); await sleep(1500);
      }
      await p.evaluate(() => { const z = document.querySelector('[aria-label="Zoom in"]'); if (z) z.click(); }); await sleep(400);
      ok('photo on the card', !!(await H.photoSlot()));
      await H.tapRe('^Next: Your details$'); await sleep(800);
    });
    if (!LIGHT) await step('details', async () => {
      const fields = await p.evaluate(() => [...document.querySelectorAll('input')].filter((x) => x.type === 'text' || !x.type).map((x) => x.value));
      const roleIdx = fields.findIndex((v) => /^founder$/i.test(v));
      await p.evaluate((i) => { const el = [...document.querySelectorAll('input')].filter((x) => x.type === 'text' || !x.type)[i]; el.focus(); el.select(); }, roleIdx >= 0 ? roleIdx : 1);
      await p.keyboard.type('Managing Director'); await sleep(400);
      ok('role change on the card', /Managing Director/.test((await H.card()).text));
    });
    await step('to headline', async () => { await H.tapRe('^Next: Headline$'); await sleep(800); ok('to Headline', /Pick a headline/.test(await H.bodyText())); });
    if (!LIGHT) await step('headline', async () => {
      await H.tap("It's official!"); await sleep(500);
      ok('preset headline on the card', /It's official!/.test((await H.card()).text));
      // A chosen headline closes its part to a summary; its Change opens it again.
      await p.evaluate(() => { const els = [...document.querySelectorAll('*')].filter((x) => x.textContent.trim() === 'Change' && x.children.length === 0 && x.getBoundingClientRect().width); els[els.length - 1]?.click(); }); await sleep(500);
      await H.tapRe('^Write (custom headline|your own)$'); await sleep(400);
      await p.evaluate(() => document.querySelector('input[placeholder="Write a short headline"]')?.focus());
      await p.keyboard.type('Now open in Sharjah'); await sleep(400);
      ok('custom headline on the card', /Now open in Sharjah/.test((await H.card()).text));
    });
    await step('to share', async () => {
      for (let i = 0; i < 6 && !/Share the Joy!/.test(await H.bodyText()); i++) { await H.tapRe('^Next'); await sleep(700); }
      ok('to Share', /Share the Joy!/.test(await H.bodyText()));
      await shot('05-share-step');
    });
    if (!LIGHT) await step('caption', async () => {
      const tabs = await H.visible('Professional');
      const text = await p.evaluate(() => document.querySelector('textarea')?.value || '');
      ok(simple ? 'caption: one caption, no tone tabs' : 'caption: tone tabs', simple ? !tabs && text.length > 40 : tabs, text.slice(0, 50));
    });
    await step('export EN', async () => { await exportImage('en-portrait', layout); const asked = await H.closeReview(); if (!simple) ok('review request shown after the first download', asked); });
    if (!LIGHT) await step('arabic', async () => {
      if (simple) await H.tap('Customise card'); else await H.tap('Style');
      await sleep(800); await H.tap('العربية'); await sleep(900);
      const cd = await H.card(); ok('Arabic card', cd && cd.lang === 'ar' && cd.dir === 'rtl');
      ok('no sideways scroll in Arabic', (await H.overflow()) <= 1);
      await H.tap('Share'); await sleep(900);
      for (let i = 0; i < 6 && !/Download/.test(await H.bodyText()); i++) { await H.tapRe('^Next'); await sleep(700); }
      await exportImage('ar-portrait', layout);
      await H.closeReview();
    });
    await step('linkedin', async () => {
      const hit = await H.tapRe('^Post to LinkedIn$');
      if (!hit) ok('Post to LinkedIn button found', false);
      for (let i = 0; i < 120 && !liUrl && !liPost; i++) await sleep(250);
      for (let i = 0; i < 40 && !liUrl; i++) await sleep(250);
    });
  }

  // ------------------------------------------------------------------ LinkedIn
  if (liPost && liPost.status === 200) {
    const res = await ctx.request.get(new URL('/linkedin/image', url).href).catch(() => null);
    if (res && res.ok()) {
      const f = path.join(out, `${tag}-linkedin.${/png/.test(res.headers()['content-type'] || '') ? 'png' : 'jpg'}`);
      writeFileSync(f, await res.body());
      exports.push({ label: 'linkedin', file: f, slot: null, expectPhoto: true });
    }
    ok('LinkedIn: the service holds the card image for the review page', res && res.ok());
  }
  let li = {};
  try { const u = new URL(liUrl, url); li = { host: u.host, path: u.pathname, redirect: u.searchParams.get('redirect_uri'), scope: u.searchParams.get('scope'), state: !!u.searchParams.get('state') }; } catch (e) { /* none */ }
  // LinkedIn's sign-in, or on the local copy the pretend one (src/linkedin/fake.ts), which asks for no scope.
  const pretend = li.path === '/linkedin/fake-signin';
  ok('Post to LinkedIn: the service takes the image', liPost && liPost.status === 200, JSON.stringify(liPost));
  ok(`Post to LinkedIn: on to ${pretend ? 'the pretend' : "LinkedIn's"} sign-in`, (pretend || (li.path === '/oauth/v2/authorization' && /w_member_social/.test(li.scope || ''))) && /linkedin\/callback$/.test(li.redirect || '') && li.state, JSON.stringify(li));
  ok('no "leave this page?" prompt on the way to LinkedIn', !dialogs.includes('beforeunload'), dialogs.join(','));
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  ok('no failed requests', failedReq.length === 0, failedReq.slice(0, 3).join(' | '));
  await b.close();

  // ------------------------------------------------------------------ images
  for (const e of exports) {
    const img = sharp(e.file); const meta = await img.metadata();
    const fmt = { '2160x2700': 'portrait', '2160x2160': 'square', '2400x1254': 'landscape' }[`${meta.width}x${meta.height}`];
    const st = await img.stats(); const detail = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    let photo = 'not checked';
    let good = !!fmt && detail > 15;
    if (e.slot) {
      const s = e.slot;
      const box = { left: Math.round((s.x + s.w * 0.2) * meta.width), top: Math.round((s.y + s.h * 0.2) * meta.height), width: Math.round(s.w * 0.6 * meta.width), height: Math.round(s.h * 0.6 * meta.height) };
      const { data, info } = await sharp(e.file).extract(box).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let sum = 0, sq = 0, dark = 0; const n = info.width * info.height;
      for (let i = 0; i < data.length; i += 3) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; sum += v; sq += v * v; if (v < 60) dark++; }
      const m = sum / n, sd = Math.sqrt(sq / n - m * m);
      const present = sd > 35 && dark / n > 0.05;
      photo = present ? 'present' : `MISSING (spread ${sd.toFixed(0)}, dark ${(100 * dark / n).toFixed(0)}%)`;
      good = good && present;
    }
    ok(`image ${e.label}: ${fmt || `odd size ${meta.width}x${meta.height}`}, photo ${photo}`, good);
  }

  // ------------------------------------------------------------------ shortest paths
  const paths = {};
  for (const name of ['download, no changes', 'add a photo, then post to LinkedIn']) {
    try { paths[name] = await shortestPath(dev, name); } catch (e) { paths[name] = { error: String(e.message || e).slice(0, 120) }; }
    const p2 = paths[name];
    ok(`path "${name}": ${p2.clicks ?? '?'} taps/clicks${p2.file ? ' + choosing the photo' : ''}`, p2.done, (p2.steps || []).join(' → ') || p2.error);
  }
  const report = { device: key, layout, journey, firstScreen, paths, results: R, exports: exports.map((e) => ({ label: e.label, file: e.file })) };
  writeFileSync(path.join(out, `${tag}.json`), JSON.stringify(report, null, 1));
  return report;
}

/**
 * The fewest taps a customer needs, on a fresh page, following what the page offers: the first visible control on
 * the way (Next, Share, Download, LinkedIn, Add photo), counting each tap and any question on the way ("Add your
 * photo?" answered with Continue with initials). Done when the image is saved or shared, or LinkedIn is on its way.
 */
async function shortestPath(dev, name) {
  const b = await dev.engine.launch();
  const { p } = await newPage(b, dev, dev.share);
  const H = helpers(p);
  const steps = []; let liGo = false, file = false;
  p.on('response', (r) => { if (r.request().method() === 'POST' && /\/c\/[^/]+\/linkedin$/.test(r.url()) && r.status() === 200) liGo = true; });
  p.on('request', (r) => { if (/linkedin\.com\/oauth|\/linkedin\/fake-signin\?/.test(r.url())) liGo = true; });
  try {
    await p.goto(url, { waitUntil: 'networkidle' }); await sleep(900);
    const phone = await p.evaluate(() => matchMedia('(max-width: 759px)').matches);
    // A control below what its scrolling panel (or the window) shows needs a scroll first: count it as a step.
    const reach = async (label) => {
      const hidden = await p.evaluate((t) => {
        const el = [...document.querySelectorAll('*')].filter((x) => (x.textContent || '').trim() === t && x.getBoundingClientRect().width).sort((a, c) => a.querySelectorAll('*').length - c.querySelectorAll('*').length)[0];
        if (!el) return false;
        const box = el.closest('button') || el; const r = box.getBoundingClientRect();
        let bottom = innerHeight;
        const pane = box.closest('[data-step-panel]');
        if (pane) bottom = Math.min(bottom, pane.getBoundingClientRect().bottom - (pane.hasAttribute('data-more') ? 40 : 0));
        if (r.bottom <= bottom + 1 && r.top >= 0) return false;
        box.scrollIntoView({ block: 'center' });
        return true;
      }, label);
      if (hidden) { steps.push(`(scroll to ${label})`); await sleep(500); }
    };
    const press = async (label, re = false) => { if (!re) await reach(label); const hit = re ? await H.tapRe(label) : await H.tap(label); if (hit) steps.push(re ? String(hit) : label); await sleep(800); return !!hit; };
    const answer = async () => { if (await H.visible('Continue with initials')) await press('Continue with initials'); };
    const savedOrShared = async () => {
      for (let i = 0; i < 120; i++) { if (await p.evaluate(() => !!window.__shared)) return true; if (file) return true; await sleep(250); }
      return false;
    };
    p.on('download', () => { file = true; });
    if (name === 'download, no changes') {
      if (phone) {
        if (dev.share) await press('Share'); else if (!(await press('Download'))) await press('Download card');
        await answer();
      } else {
        const dl = async () => ((await H.exists('Download card')) ? 'Download card' : (await H.exists('Download')) ? 'Download' : null);
        for (let i = 0; i < 8 && !(await dl()); i++) if (!(await press('^Next', true))) break;
        await press(await dl()); await answer();
      }
      const done = await savedOrShared();
      await b.close();
      return { done, clicks: steps.length, steps };
    }
    // add a photo, then post to LinkedIn
    let chose = false;
    const choose = async (labels) => {
      for (const l of labels) {
        if (!(await H.exists(l))) continue;
        await reach(l);
        const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 8000 }), press(l)]);
        await fc.setFiles(PHOTO); await sleep(1500); chose = true; return true;
      }
      return false;
    };
    if (phone) {
      if (!(await choose(['Add photo']))) { await press('Photo'); await choose(['Upload a photo']); await H.closeSheet(); if (!(await H.sheetOpen())) steps.push('Done'); }
      await press('LinkedIn');
    } else {
      if (!(await choose(['Add photo']))) {
        for (let i = 0; i < 4 && !(await H.visible('Upload a photo')); i++) if (!(await press('^Next', true))) break;
        await choose(['Upload a photo']);
        for (let i = 0; i < 6 && !(await H.visible('Post to LinkedIn')); i++) if (!(await press('^Next', true))) break;
      }
      await press('Post to LinkedIn');
    }
    for (let i = 0; i < 80 && !liGo; i++) await sleep(250);
    await b.close();
    return { done: liGo && chose, clicks: steps.length, steps, file: chose };
  } catch (e) {
    await b.close();
    throw e;
  }
}
