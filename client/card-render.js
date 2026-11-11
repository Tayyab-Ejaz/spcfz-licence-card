// Turning the card into an image (Share and Download), light enough for mid-range phones.
//
// The design's renderCard asked html-to-image to embed every @font-face on the page (142 faces, 6.6 MB of
// base64 in a 7.6 MB SVG) and to re-download each font with a cache-busting query on every render. It ran in
// the background after the page opened and after edits; on a OnePlus with Chrome the tab ran out of memory,
// Chrome reloaded it, and the customer saw a white page (19 October 2026).
//
// Here only the faces the card's own text needs are embedded: the families in each text element's font stack,
// at its weight and style, whose unicode-range covers that element's characters. Each font file is fetched once
// from the browser cache and kept as a data URL; the resulting CSS is reused while the card's text is unchanged.

const dataUrls = new Map(); // font URL -> Promise<data URL>
let lastCss = { key: '', css: Promise.resolve('') };

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase();

function parseWeight(v) {
  const parts = String(v || '400').trim().split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
  const lo = Number.isFinite(parts[0]) ? parts[0] : 400;
  const hi = Number.isFinite(parts[1]) ? parts[1] : lo;
  return [lo, hi];
}

function parseRange(v) {
  if (!v || !v.trim()) return null;
  return v.split(',').map((part) => {
    const s = part.trim().replace(/^u\+/i, '');
    if (s.includes('-')) {
      const [a, b] = s.split('-');
      return [parseInt(a, 16), parseInt(b, 16)];
    }
    if (s.includes('?')) return [parseInt(s.replace(/\?/g, '0'), 16), parseInt(s.replace(/\?/g, 'F'), 16)];
    const n = parseInt(s, 16);
    return [n, n];
  }).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

function fontFaceRules() {
  const out = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules || [])) {
      if (r.type !== 5) continue; // CSSRule.FONT_FACE_RULE
      const src = r.style.getPropertyValue('src');
      const m = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/i.exec(src) || /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(src);
      if (!m) continue;
      out.push({
        family: unquote(r.style.getPropertyValue('font-family')),
        weight: parseWeight(r.style.getPropertyValue('font-weight')),
        style: (r.style.getPropertyValue('font-style') || 'normal').trim(),
        range: parseRange(r.style.getPropertyValue('unicode-range')),
        rangeText: r.style.getPropertyValue('unicode-range'),
        url: new URL(m[1], sheet.href || location.href).href,
        format: /\.woff2/i.test(m[1]) ? 'woff2' : '',
      });
    }
  }
  return out;
}

/** What the card's text asks for: one entry per family stack, weight and style, with the characters set in it. */
function textNeeds(node) {
  const needs = new Map();
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent || '';
    if (!text.trim() || !t.parentElement) continue;
    const cs = getComputedStyle(t.parentElement);
    const families = cs.fontFamily.split(',').map(unquote).filter(Boolean);
    const key = `${families.join('|')}/${cs.fontWeight}/${cs.fontStyle}`;
    const n = needs.get(key) || { families, weight: Number(cs.fontWeight) || 400, style: cs.fontStyle || 'normal', chars: new Set() };
    for (const ch of text) n.chars.add(ch.codePointAt(0));
    needs.set(key, n);
  }
  return [...needs.values()];
}

function covers(range, chars) {
  if (!range) return true;
  for (const cp of chars) if (range.some(([a, b]) => cp >= a && cp <= b)) return true;
  return false;
}

/** The faces this card needs: per text style, the closest weight of each family in its stack that covers its text. */
export function pickFaces(node, faces = fontFaceRules()) {
  const picked = new Set();
  for (const need of textNeeds(node)) {
    for (const fam of need.families) {
      const candidates = faces.filter((f) => f.family === fam && f.style === (need.style === 'oblique' ? 'italic' : need.style) && covers(f.range, need.chars));
      if (!candidates.length) continue;
      const dist = (f) => (need.weight < f.weight[0] ? f.weight[0] - need.weight : need.weight > f.weight[1] ? need.weight - f.weight[1] : 0);
      const best = Math.min(...candidates.map(dist));
      for (const f of candidates) if (dist(f) === best) picked.add(f);
    }
  }
  return [...picked];
}

function toDataUrl(url) {
  if (!dataUrls.has(url)) {
    dataUrls.set(url, fetch(url, { cache: 'force-cache' })
      .then((r) => { if (!r.ok) throw new Error(`font ${r.status}`); return r.blob(); })
      .then((blob) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      }))
      .catch((err) => { dataUrls.delete(url); throw err; }));
  }
  return dataUrls.get(url);
}

/** @font-face CSS for exactly the faces the card uses, with the font files inlined. */
export function cardFontCSS(node) {
  const faces = pickFaces(node);
  const key = faces.map((f) => `${f.url}#${f.rangeText}`).sort().join(',');
  if (key !== lastCss.key) {
    lastCss = {
      key,
      css: Promise.all(faces.map(async (f) => {
        const data = await toDataUrl(f.url);
        const w = f.weight[0] === f.weight[1] ? `${f.weight[0]}` : `${f.weight[0]} ${f.weight[1]}`;
        return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${w};${f.rangeText ? `unicode-range:${f.rangeText};` : ''}src:url(${data})${f.format ? ` format("${f.format}")` : ''};}`;
      })).then((rules) => rules.join('\n')),
    };
    lastCss.css.catch(() => { lastCss = { key: '', css: Promise.resolve('') }; });
  }
  return lastCss.css;
}

/**
 * Safari's engine (every browser on iPhone and iPad, and Safari on a Mac) draws two things wrongly when the card
 * becomes an image (SPC, 9 November 2026, an iPhone 16 Pro Max; reproduced in WebKit 18):
 *   - a ring made of box-shadows (0 0 0 Npx) around a rounded, clipped box comes out as a squared-off bracket
 *     (the avatar rings, the white edge round the Standard diamonds);
 *   - a soft (blurred) shadow on a tilted box comes out as a hard grey slab (the Day One calendar).
 * So on those browsers the image is made from a hidden copy of the card where each ring is drawn as a border
 * (and an outline for a second ring), which looks the same, and soft shadows on tilted boxes are left out.
 * Chrome and Android draw the card as it is.
 */
export function needsSafeCopy(ua = navigator.userAgent, platform = navigator.platform, touch = navigator.maxTouchPoints) {
  const iOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
  const safari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg|android/i.test(ua);
  return iOS || safari;
}

/** One box-shadow list as parts. */
function parseShadows(value) {
  return value.split(/,(?![^(]*\))/).map((part) => {
    const color = (part.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i) || ['transparent'])[0];
    const n = (part.replace(/rgba?\([^)]*\)/g, '').match(/-?\d+(\.\d+)?px/g) || []).map(parseFloat);
    return { color, x: n[0] || 0, y: n[1] || 0, blur: n[2] || 0, spread: n[3] || 0, inset: /\binset\b/.test(part) };
  });
}

/** The hidden copy described above; the caller removes `holder` when the image is made. */
function safeCopy(card) {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none;';
  const copy = card.cloneNode(true);
  copy.style.transform = 'none';
  holder.appendChild(copy);
  document.body.appendChild(holder);
  const from = [card, ...card.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    if (!cs.boxShadow || cs.boxShadow === 'none') return;
    const shadows = parseShadows(cs.boxShadow);
    const rings = shadows.filter((s) => !s.inset && !s.x && !s.y && !s.blur && s.spread > 0).sort((a, b) => a.spread - b.spread);
    const d = to[i];
    const margins = ['Top', 'Right', 'Bottom', 'Left'].map((k) => cs[`margin${k}`]);
    const ringable = rings.length > 0 && rings.length <= 2 && parseFloat(cs.borderTopWidth) === 0
      && margins.every((m) => /^-?\d+(\.\d+)?px$/.test(m));
    if (ringable) {
      const [inner, outer] = rings;
      const s = inner.spread;
      const grow = (v) => (/%/.test(v) ? v : `${parseFloat(v) + s}px`);
      d.style.boxSizing = 'border-box';
      d.style.width = `${el.offsetWidth + 2 * s}px`;
      d.style.height = `${el.offsetHeight + 2 * s}px`;
      d.style.margin = margins.map((m) => `${parseFloat(m) - s}px`).join(' ');
      d.style.border = `${s}px solid ${inner.color}`;
      d.style.borderRadius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(grow).join(' ');
      d.style.backgroundClip = 'padding-box';
      if (outer) { d.style.outline = `${outer.spread - s}px solid ${outer.color}`; d.style.outlineOffset = '0px'; }
    }
    let tilted = false;
    for (let n = el; n && n !== card.parentElement; n = n.parentElement) {
      if (n !== card && getComputedStyle(n).transform !== 'none') { tilted = true; break; }
    }
    const keep = shadows.filter((sh) => !(ringable && rings.includes(sh)) && !(tilted && sh.blur > 0));
    d.style.boxShadow = keep.length
      ? keep.map((sh) => `${sh.inset ? 'inset ' : ''}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${sh.color}`).join(', ')
      : 'none';
  });
  return { copy, holder };
}

/** How often, at least and at most, drawSettled draws the card before it keeps a drawing (milliseconds). */
export const SETTLE = { stepMs: 100, minMs: 400, maxMs: 4000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the card could not be drawn'));
    img.src = src;
  });
}

/**
 * Safari's engine decodes a photo inside the card's SVG only once that SVG is drawn, and in the background, so the
 * first drawing has an empty photo frame (SPC, 11 November 2026: on an iPhone the photo was on screen but not in
 * the downloaded or shared card; any photo larger than a thumbnail, reproduced in WebKit 18). Drawing the same SVG
 * again a moment later has it. A fresh SVG starts the decoding over, which is why drawing the card twice did not
 * help. The embedded fonts arrive late the same way. So the SVG is made once and drawn at full size until two
 * drawings agree (compared on a small copy), and the last drawing is kept.
 */
async function drawSettled(lib, target, opts) {
  const ratio = opts.pixelRatio || 1;
  const img = await loadImage(await lib.toSvg(target, opts));
  const canvas = document.createElement('canvas');
  canvas.width = opts.width * ratio;
  canvas.height = opts.height * ratio;
  const ctx = canvas.getContext('2d');
  const probe = document.createElement('canvas');
  probe.width = Math.ceil(opts.width / 8);
  probe.height = Math.ceil(opts.height / 8);
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    pctx.clearRect(0, 0, probe.width, probe.height);
    pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    return pctx.getImageData(0, 0, probe.width, probe.height).data;
  };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const start = Date.now();
  let last = draw();
  while (Date.now() - start < SETTLE.maxMs) {
    await sleep(SETTLE.stepMs);
    const now = draw();
    if (same(now, last) && Date.now() - start >= SETTLE.minMs) break;
    last = now;
  }
  return canvas;
}

/**
 * The card as an image: a PNG data URL for Download, a JPEG Blob for Share (photos travel as JPEG; it is also
 * a third of the size). Falls back to no embedded fonts rather than failing.
 */
export async function renderCardImage(node, lib, { width, height, asBlob }) {
  const base = { width, height, pixelRatio: 2, cacheBust: false, style: { transform: 'none' } };
  const safe = needsSafeCopy() ? safeCopy(node) : null;
  const target = safe ? safe.copy : node;
  const draw = (opts) => (safe ? drawSettled(lib, target, opts) : lib.toCanvas(target, opts));
  let canvas;
  try {
    canvas = await draw({ ...base, fontEmbedCSS: await cardFontCSS(node) });
  } catch {
    canvas = await draw({ ...base, skipFonts: true });
  } finally {
    if (safe) safe.holder.remove();
  }
  if (!asBlob) return canvas.toDataURL('image/png');
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the image'))), 'image/jpeg', 0.92);
  });
}
