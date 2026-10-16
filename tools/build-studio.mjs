// Builds the customer studio (the personal page) from the design exports in design/source/.
//
//   node tools/build-studio.mjs
//
// 1. Reads design/source/{studio,mobile}/template.html and applies DATA_PATCHES, which turn the design's
//    sample values (company, date, licence number, activity, portal link) into bindings. Every patch must
//    match exactly once, so a new export that moved them fails the build instead of shipping sample data.
// 2. Parses each template the way the design runtime does (encodeCase, then the HTML parser) and emits a
//    compact AST (client/generated/<name>.ast.json) that client/dc.js renders with React. No template code
//    is evaluated at runtime; every binding in these templates is a plain path lookup.
// 3. Wraps each logic class (design/source/<name>/logic.js, verbatim) as an ES module factory.
// 4. Writes public/studio/: the stylesheet (the template's <helmet> styles, hover rules, page CSS), the
//    referenced assets, the esbuild bundle of client/main.js, and manifest.json naming the hashed files.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseFragment } from 'parse5';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'design', 'source');
const GEN = path.join(ROOT, 'client', 'generated');
const OUT = path.join(ROOT, 'public', 'studio');
const ASSET_URL = '/static/studio/a/';
const LAYOUTS = ['studio', 'mobile'];

// ------------------------------------------------------------------ data patches

const SEP = '<span style="width:1px;height:14px;background:var(--spc-border)"></span>';
const DATA_PATCHES = {
  studio: [
    ['<span>Lumen &amp; Ledger FZ-LLC is licensed.</span>', '<span>{{ hdrTitle }}</span>'],
    ['<strong style="font-weight:600;color:var(--spc-ink)">8 October 2026</strong>', '<strong style="font-weight:600;color:var(--spc-ink)">{{ hdrDate }}</strong>'],
    [/<span>Activity <strong style="font-weight:600;color:var\(--spc-ink\)">Financial advisory for small businesses<\/strong><\/span>(\s*)<span style="width:1px;height:14px;background:var\(--spc-border\)"><\/span>/,
      `<sc-if value="{{ hasHdrActivity }}"><span>Activity <strong style="font-weight:600;color:var(--spc-ink)">{{ hdrActivity }}</strong></span>$1${SEP}</sc-if>`],
    ['<strong style="font-weight:600;color:var(--spc-ink)">4425153.01</strong>', '<strong style="font-weight:600;color:var(--spc-ink)">{{ licenceNo }}</strong>'],
    ['<a href="#" ', '<a href="{{ portalUrl }}" '],
  ],
  mobile: [
    ['<span>Lumen &amp; Ledger FZ-LLC is licensed.</span>', '<span>{{ hdrTitle }}</span>'],
    ['Issued 8 Oct 2026 · License no. 4425153.01', 'Issued {{ hdrDateShort }} · License no. {{ licenceNo }}'],
    ['<a href="#" ', '<a href="{{ portalUrl }}" '],
  ],
};
// Robustness patches for real data, applied to both layouts (docs/ARCHITECTURE.md section 7). Each binds a
// value that client/card-data.js sets to the design's own value for the design's sample data, so the
// sample still renders pixel-identically, and adapts it for data the design did not show.
const ROBUSTNESS_PATCHES = [
  // Day One: the day number was sized for one digit ("8"); two digits must stay inside the diamond.
  ['font-size:260px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}',
    'font-size:{{ calDaySize }}px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}'],
  ['font-size:160px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}',
    'font-size:{{ calDaySizeLs }}px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}'],
  // Launch Pass stub: one line with an ellipsis cuts long founder names; let them wrap to two lines.
  [/opacity:\{\{ nameOpacity \}\};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\{\{ nameText \}\}<\/span>(\s*)<sc-if value="\{\{ hasRole \}\}"><span style="font-size:20px/,
    'opacity:{{ nameOpacity }};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;{{ stubNameXtra }}">{{ nameText }}</span>$1<sc-if value="{{ hasRole }}"><span style="font-size:20px'],
  [/opacity:\{\{ nameOpacity \}\};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\{\{ nameText \}\}<\/span>(\s*)<sc-if value="\{\{ hasRole \}\}"><span style="font-size:15px/,
    'opacity:{{ nameOpacity }};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;{{ stubNameXtra }}">{{ nameText }}</span>$1<sc-if value="{{ hasRole }}"><span style="font-size:15px'],
];
// Test cards: a TEST watermark that is part of the card, so the preview and every export show it alike.
const CARD_ROOT = '<div ref="{{ cardRef }}" dir="{{ dir }}" data-lang="{{ lang }}" style="position:relative;width:{{ nativeW }}px;height:{{ cardH }}px;transform:scale({{ scale }});transform-origin:0 0;overflow:hidden;font-family:var(--font-sans);-webkit-font-smoothing:antialiased;background:#fff">';
ROBUSTNESS_PATCHES.push([CARD_ROOT, CARD_ROOT +
  '<sc-if value="{{ isTestCard }}"><div aria-hidden="true" style="position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;transform:rotate(-24deg);color:rgba(7,19,41,.16);font-family:var(--font-sans)">' +
  '<span style="font-size:{{ wmBig }}px;font-weight:800;letter-spacing:.08em;line-height:1">TEST</span>' +
  '<span style="font-size:{{ wmSmall }}px;font-weight:700;letter-spacing:.12em;margin-top:{{ wmGap }}px">TEST CARD · NOT A REAL LICENCE</span></div></sc-if>']);

// Mark the stub name so client/card-data.js can measure the laid-out element and shrink it until it fits.
ROBUSTNESS_PATCHES.push(
  ['<span style="font-size:{{ stubNameSq }}px;', '<span data-fit="stub" style="font-size:{{ stubNameSq }}px;'],
  ['<span style="font-size:{{ stubNameLs }}px;', '<span data-fit="stub" style="font-size:{{ stubNameLs }}px;'],
);
DATA_PATCHES.studio.push(...ROBUSTNESS_PATCHES);
DATA_PATCHES.mobile.push(...ROBUSTNESS_PATCHES);

// Sample values that must not survive into the markup after patching (input placeholders excepted).
const LEFTOVERS = [/Lumen/, /4425153/, /\b\d{1,2} Oct(ober)? 2026\b/];

function applyPatches(name, html) {
  for (const [from, to] of DATA_PATCHES[name]) {
    const re = typeof from === 'string' ? new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(from.source, 'g');
    const n = (html.match(re) || []).length;
    if (n !== 1) throw new Error(`${name}: patch ${String(from).slice(0, 60)}… matched ${n} times, expected 1`);
    html = html.replace(re, to);
  }
  return html;
}

// ------------------------------------------------------------------ runtime-equivalent parsing

const CAMEL_ATTR = 'sc-camel-';
const RAW_WRAP = { select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody', thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr', td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption' };
const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const EVENT_MAP = {
  onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp',
  onkeypress: 'onKeyPress', onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave',
  onfocus: 'onFocus', onblur: 'onBlur', ondoubleclick: 'onDoubleClick', oncontextmenu: 'onContextMenu', onmousemove: 'onMouseMove',
  onmouseover: 'onMouseOver', onmouseout: 'onMouseOut', onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointermove: 'onPointerMove',
  onpointerenter: 'onPointerEnter', onpointerleave: 'onPointerLeave', onpointercancel: 'onPointerCancel', onpointerover: 'onPointerOver',
  onpointerout: 'onPointerOut', ongotpointercapture: 'onGotPointerCapture', onlostpointercapture: 'onLostPointerCapture', ontouchstart: 'onTouchStart',
  ontouchend: 'onTouchEnd', ontouchmove: 'onTouchMove', ontouchcancel: 'onTouchCancel', ondragstart: 'onDragStart', ondragend: 'onDragEnd',
  ondragenter: 'onDragEnter', ondragleave: 'onDragLeave', ondragover: 'onDragOver', onanimationstart: 'onAnimationStart',
  onanimationend: 'onAnimationEnd', onanimationiteration: 'onAnimationIteration', ontransitionend: 'onTransitionEnd',
};
const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function encodeCase(html) {
  html = html.replace(new RegExp('<(x-import|dc-import)(' + ATTRS + ')/>', 'gi'), (_, t, a) => '<' + t + a + '></' + t + '>');
  html = html.replace(/<helmet(\s|>)/gi, '<sc-helmet$1').replace(/<\/helmet\s*>/gi, '</sc-helmet>');
  html = html.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g, (_, sp, n, eq) => sp + CAMEL_ATTR + n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + eq);
  for (const [real, alias] of Object.entries(RAW_WRAP)) html = html.replace(new RegExp('(</?)' + real + '(?=[\\s>])', 'gi'), '$1' + alias);
  return html;
}

/** Attribute value -> spec: string (static), {b: path} (whole binding) or {p: parts} (mixed, odd = path). */
function spec(raw) {
  const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (whole) return { b: whole[1].trim() };
  if (raw.includes('{{')) return { p: raw.split(/\{\{([\s\S]+?)\}\}/g).map((s, i) => (i & 1 ? s.trim() : s)) };
  return raw;
}

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function importantify(css) {
  css = stripComments(css);
  const decls = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { decls.push(css.slice(start, i)); start = i + 1; }
  }
  decls.push(css.slice(start));
  return decls.map((d) => d.trim()).filter(Boolean).map((d) => (/!important\s*$/i.test(d) ? d : d + ' !important')).join(';');
}

const pseudoRules = new Map(); // "pseudo|css" -> class
function pseudoClass(pseudo, css) {
  const k = pseudo + '|' + css;
  if (!pseudoRules.has(k)) pseudoRules.set(k, 'scp' + pseudoRules.size.toString(36));
  return pseudoRules.get(k);
}

function collectProps(attrs, kind) {
  const props = []; const pseudo = [];
  for (const { name, value } of attrs) {
    if (name === 'sc-name' || name === 'data-dc-tpl') continue;
    let key = name;
    if (key.startsWith(CAMEL_ATTR)) key = kebabToCamel(key.slice(CAMEL_ATTR.length));
    if (key === 'hint-size') continue;
    if (key.startsWith('style-')) { pseudo.push(pseudoClass(key.slice(6), value)); continue; }
    if (kind !== 'dom') {
      if (key.includes('-') && !(kind === 'x-import' && (key.startsWith('aria-') || key.startsWith('data-')))) key = kebabToCamel(key);
    } else if (key === 'class') key = 'className';
    else if (key === 'for') key = 'htmlFor';
    else if (key.startsWith('on')) key = EVENT_MAP[key] || 'on' + key[2].toUpperCase() + key.slice(3);
    props.push([key, spec(value)]);
  }
  return { props, pseudo };
}

const attrOf = (node, n) => (node.attrs || []).find((a) => a.name === n)?.value;
const styles = { studio: [], mobile: [] };

function walk(node, layout) {
  if (node.nodeName === '#text') {
    const v = node.value;
    if (v.includes('{{')) return ['T', v.split(/\{\{([\s\S]+?)\}\}/g).map((s, i) => (i & 1 ? s.trim() : s))];
    if (!v.trim() && !v.includes(' ')) return null;
    return ['t', v];
  }
  if (!node.tagName) return null;
  const tag = node.tagName.toLowerCase();
  const kids = () => (node.childNodes || []).map((c) => walk(c, layout)).filter(Boolean);
  if (tag === 'sc-helmet') {
    for (const c of node.childNodes || []) if (c.tagName === 'style') styles[layout].push((c.childNodes || []).map((t) => t.value || '').join(''));
    return null;
  }
  if (tag === 'sc-for') return ['for', spec(attrOf(node, 'list') || ''), attrOf(node, 'as') || 'item', kids()];
  if (tag === 'sc-if') return ['if', spec(attrOf(node, 'value') || ''), kids()];
  if (tag === 'x-import') {
    const full = attrOf(node, 'component-from-global-scope') || '';
    const comp = full.split('.').pop();
    const style = attrOf(node, 'style');
    const rest = (node.attrs || []).filter((a) => !['component-from-global-scope', 'component', 'name', 'from', 'style'].includes(a.name));
    const { props } = collectProps(rest, 'x-import');
    return ['x', comp, style != null ? spec(style) : null, props, kids()];
  }
  if (tag === 'script' || tag === 'style') throw new Error(`${layout}: unexpected <${tag}> outside <helmet>`);
  const { props, pseudo } = collectProps(node.attrs || [], 'dom');
  return ['e', RAW_UNWRAP[tag] || tag, props, kids(), pseudo.length ? pseudo.join(' ') : null];
}

function compileTemplate(layout) {
  let html = readFileSync(path.join(SRC, layout, 'template.html'), 'utf8');
  html = applyPatches(layout, html);
  const open = /<x-dc(?:\s[^>]*)?>/.exec(html);
  const close = html.lastIndexOf('</x-dc>');
  if (!open || close < 0) throw new Error(`${layout}: no <x-dc> block`);
  let inner = html.slice(open.index + open[0].length, close);
  inner = inner.replace(/asset:([a-f0-9]{16}\.[a-z0-9]+)/g, (_, f) => ASSET_URL + f);
  const markupOnly = inner.replace(/<helmet>[\s\S]*?<\/helmet>/i, '');
  for (const re of LEFTOVERS) if (re.test(markupOnly)) throw new Error(`${layout}: sample value ${re} still in markup after patching`);
  const frag = parseFragment(encodeCase(inner));
  return frag.childNodes.map((c) => walk(c, layout)).filter(Boolean);
}

// ------------------------------------------------------------------ css

const FULL_PAGE_CSS = 'html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}';
function cleanCss(css) {
  css = css.replace(/,\s*url\(["']?asset:dropped[^)]*\)\s*format\(["'][^"']*["']\)/g, '');
  css = css.replace(/url\(["']?asset:dropped[^)]*\)\s*format\(["'][^"']*["']\)\s*,\s*/g, '');
  if (css.includes('asset:dropped')) throw new Error('a dropped asset is still referenced by the CSS');
  return css.replace(/asset:([a-f0-9]{16}\.[a-z0-9]+)/g, (_, f) => ASSET_URL + f);
}

// ------------------------------------------------------------------ main

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'a'), { recursive: true });
mkdirSync(GEN, { recursive: true });

const used = new Set();
for (const layout of LAYOUTS) {
  const ast = compileTemplate(layout);
  const json = JSON.stringify(ast);
  for (const m of json.matchAll(/\/static\/studio\/a\/([a-f0-9]{16}\.[a-z0-9]+)/g)) used.add(m[1]);
  writeFileSync(path.join(GEN, `${layout}.ast.json`), json);
  const logic = readFileSync(path.join(SRC, layout, 'logic.js'), 'utf8');
  if (!/class Component extends DCLogic/.test(logic)) throw new Error(`${layout}: logic.js does not define "class Component extends DCLogic"`);
  writeFileSync(path.join(GEN, `${layout}.logic.js`),
    `// GENERATED by tools/build-studio.mjs from design/source/${layout}/logic.js. Do not edit.\n` +
    `export default function makeLogic(DCLogic, React) {\n${logic}\n;return Component;\n}\n`);
}

const a = styles.studio.join('\n'), b = styles.mobile.join('\n');
if (a !== b) console.warn('note: studio and mobile <helmet> styles differ; using the studio set, which both layouts were checked against');
const hover = [...pseudoRules].map(([k, cls]) => { const [p, ...rest] = k.split('|'); const css = rest.join('|'); return `.${cls}:${p}{${importantify(css)}}`; }).join('\n');
const css = cleanCss(a) + '\n' + hover + '\n' + FULL_PAGE_CSS + '\n';
for (const m of css.matchAll(/\/static\/studio\/a\/([a-f0-9]{16}\.[a-z0-9]+)/g)) used.add(m[1]);
const cssName = `studio-${hash(css)}.css`;
writeFileSync(path.join(OUT, cssName), css);
for (const f of used) copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, 'a', f));

const result = await build({
  entryPoints: [path.join(ROOT, 'client', 'main.js')],
  bundle: true, minify: true, format: 'iife', target: ['es2020'], write: false, legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.json': 'json' }, logLevel: 'warning',
});
const js = result.outputFiles[0].contents;
const jsName = `app-${hash(js)}.js`;
writeFileSync(path.join(OUT, jsName), js);
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ js: `/static/studio/${jsName}`, css: `/static/studio/${cssName}` }, null, 2) + '\n');
console.log(`studio built: ${jsName} (${Math.round(js.length / 1024)} KB), ${cssName} (${Math.round(css.length / 1024)} KB), ${used.size} assets, ${pseudoRules.size} hover rules`);
