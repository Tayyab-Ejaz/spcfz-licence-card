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
// Mark the stub name so client/card-data.js can measure the laid-out element and shrink it until it fits.
ROBUSTNESS_PATCHES.push(
  ['<span style="font-size:{{ stubNameSq }}px;', '<span data-fit="stub" style="font-size:{{ stubNameSq }}px;'],
  ['<span style="font-size:{{ stubNameLs }}px;', '<span data-fit="stub" style="font-size:{{ stubNameLs }}px;'],
);
DATA_PATCHES.studio.push(...ROBUSTNESS_PATCHES);

// Desktop Share step (SPC, 17–18 October 2026). The design's version led with "Download, then post it on LinkedIn",
// put the phone-worded Share hint between the two buttons and had an Open LinkedIn button. Now: an intro that
// leads with Share, then Share and a full-width Download stacked with one gap; no hint text and no LinkedIn
// shortcut. The phone layout is untouched.
const DESKTOP_SHARE_ACTIONS = `<p style="font-size:14.5px;line-height:1.5;color:var(--spc-muted);text-wrap:pretty">{{ shareIntro }}</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <sc-if value="{{ canShare }}" hint-placeholder-val="{{ false }}">
              <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="lg" sc-camel-on-click="{{ shareCard }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-share-network" style="font-size:18px"></i><span>{{ shareLabel }}</span></x-import>
            </sc-if>
            <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="{{ dlVariant }}" size="lg" sc-camel-on-click="{{ download }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-download-simple" style="font-size:18px"></i><span>{{ downloadLabel }}</span></x-import>
          </div>`;
// Desktop, last step (SPC, 18 October 2026): a Done button that takes the customer back to the portal, in place
// of the "Step 3 of 3" label. Same tab, like the header's "Back to Customer Portal" link.
DATA_PATCHES.studio.push([
  '<sc-if value="{{ isStep2 }}"><span style="font-size:13px;font-weight:600;color:var(--spc-muted)">Step 3 of 3</span></sc-if>',
  '<sc-if value="{{ isStep2 }}"><x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="md" sc-camel-on-click="{{ goPortal }}" hint-size="120px,46px"><span>Done</span><i class="ph-bold ph-check" style="font-size:15px"></i></x-import></sc-if>',
]);
DATA_PATCHES.studio.push(
  [/<p style="font-size:14\.5px;line-height:1\.5;color:var\(--spc-muted\);text-wrap:pretty">Download your card, then post it on LinkedIn with the caption below\.<\/p>[\s\S]*?LinkedIn opens with your caption filled in[^<]*<\/p>\s*<\/div>/,
    DESKTOP_SHARE_ACTIONS],
);

// Both layouts (SPC, 17 October 2026): no LinkedIn "@SPC Free Zone" tagging tip under the caption.
for (const layout of ['studio', 'mobile']) {
  DATA_PATCHES[layout].push([/\s*<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:14px;background:var\(--blue-50\)">\s*<i class="ph-bold ph-at"[\s\S]*?<\/div>/, '']);
}
DATA_PATCHES.mobile.push(...ROBUSTNESS_PATCHES);

// Phone layout changes SPC asked for on 16 October 2026:
// - the share bar keeps only its main button: the "Download card" / "Open LinkedIn" links under Share, and the
//   "Open LinkedIn and attach it" link under Download (phones that cannot share files), are gone;
// - the six editing controls (Headline, Photo, Details, About, Language, Caption) show at once, as one toolbar
//   row with the icon above the label, instead of a sideways-scrolling row where only three and a half showed;
// - the card preview is sized from the space the page really leaves (client/card-data.js measures it into
//   state.chromeH), so the headline, card, style switcher, toolbar and Share button fit one screen.
DATA_PATCHES.mobile.push(
  [/\s*<div style="display:flex;justify-content:center;gap:4px">[\s\S]*?Open LinkedIn<i [^>]*><\/i><\/span>\s*<\/div>/, ''],
  [/\s*<div style="display:flex;justify-content:center">\s*<span sc-camel-on-click="\{\{ openLinkedIn \}\}"[\s\S]*?<\/span>\s*<\/div>/, ''],
  ['<div style="display:flex;gap:8px;overflow-x:auto;padding:4px 16px 14px;scrollbar-width:none">',
    '<div class="m-chips m-in" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;padding:2px 12px 10px">'],
  ['position:relative;flex-shrink:0;display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 15px;border-radius:999px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--spc-border);font-size:13.5px;',
    'position:relative;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;padding:6px 2px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--spc-border);font-size:11.5px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;'],
  ['<i class="ph-bold {{ c.icon }}" style="font-size:16px;color:var(--spc-blue)"></i>',
    '<i class="ph-bold {{ c.icon }}" style="font-size:20px;color:var(--spc-blue)"></i>'],
  ['<span style="position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--danger-500, #d92d20)"></span>',
    '<span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--danger-500, #d92d20)"></span>'],
  // Motion hooks (client/card-data.js and MOBILE_CSS): what fades in when the drawer closes, and the card frame.
  ['<div style="display:flex;flex-direction:column;gap:6px;padding:18px 16px 4px"', '<div class="m-in" style="display:flex;flex-direction:column;gap:6px;padding:18px 16px 4px"'],
  ['<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:4px;width:100%;box-sizing:border-box;background:var(--spc-soft)',
    '<div class="m-in" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:4px;width:100%;box-sizing:border-box;background:var(--spc-soft)'],
  ['<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%">',
    '<div class="m-in" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%">'],
  ['<div style="width:{{ dispW }}px;height:{{ dispH }}px;max-width:100%;overflow:hidden;position:relative;transition:width .25s var(--ease-standard),height .25s var(--ease-standard)">',
    '<div class="m-frame" style="width:{{ dispW }}px;height:{{ dispH }}px;max-width:100%;overflow:hidden;position:relative;transition:width .25s var(--ease-standard),height .25s var(--ease-standard)">'],
  // The card inside the frame rescales with it instead of jumping while the frame eases to its new size.
  ['transform:scale({{ scale }});transform-origin:0 0;overflow:hidden;font-family:var(--font-sans);-webkit-font-smoothing:antialiased;background:#fff">',
    'transform:scale({{ scale }});transform-origin:0 0;transition:transform .25s var(--ease-standard);overflow:hidden;font-family:var(--font-sans);-webkit-font-smoothing:antialiased;background:#fff">'],
  ['<div style="position:sticky;bottom:0;margin-top:auto;display:flex;flex-direction:column;gap:6px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--spc-border)">',
    '<div class="m-bar m-in" style="position:sticky;bottom:0;margin-top:auto;display:flex;flex-direction:column;gap:6px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--spc-border)">'],
);

// Logic patches: the same exactly-once rule, applied to design/source/<layout>/logic.js before it is wrapped.
const LOGIC_PATCHES = {
  studio: [],
  mobile: [
    ['const availH = sheet ? Math.max(90, vh - 56 - sheetH - 28) : Math.max(200, vh - 420);',
      'const availH = sheet ? Math.max(90, vh - 56 - sheetH - 28) : Math.max(180, vh - (s.chromeH || 440) - 8);'],
  ],
};

// Sample values that must not survive into the markup after patching (input placeholders excepted).
const LEFTOVERS = [/Lumen/, /4425153/, /\b\d{1,2} Oct(ober)? 2026\b/];

function applyPatches(name, html, patches = DATA_PATCHES[name]) {
  for (const [from, to] of patches) {
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
// Phone layout CSS: tighter toolbar type on 320–359 px handsets, a pressed state on the toolbar, and the drawer motion.
const MOBILE_CSS = [
  '@media (max-width:359px){.m-chips{gap:4px!important;padding-left:8px!important;padding-right:8px!important}',
  '.m-chips>span{font-size:10px!important;letter-spacing:-.01em}.m-chips>span>i{font-size:18px!important}}',
  '.m-chips>span{transition:transform .12s ease,background .12s ease}.m-chips>span:active{background:var(--blue-50)!important;transform:scale(.96)}',
  // The drawer slides up when it opens and down when it closes (card-data.js adds .m-closing and waits for it);
  // what the drawer hides rises back in when it closes.
  '@keyframes m-sheet-in{from{transform:translate(-50%,100%)}to{transform:translate(-50%,0)}}',
  '@keyframes m-sheet-out{from{transform:translate(-50%,0)}to{transform:translate(-50%,100%)}}',
  '@keyframes m-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
  '[data-screen-label="Sheet"]{animation:m-sheet-in .34s cubic-bezier(.2,.8,.2,1) both;transition:height .25s var(--ease-standard)}',
  '[data-screen-label="Sheet"].m-closing{animation:m-sheet-out .22s cubic-bezier(.4,0,1,1) both;pointer-events:none}',
  '.m-in{animation:m-rise .3s cubic-bezier(.2,.8,.2,1) both}',
  '@media (prefers-reduced-motion:reduce){[data-screen-label="Sheet"],[data-screen-label="Sheet"].m-closing,.m-in{animation:none!important}.m-frame,.m-frame>*{transition:none!important}}',
].join('');
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
  const logic = applyPatches(`${layout} logic`, readFileSync(path.join(SRC, layout, 'logic.js'), 'utf8'), LOGIC_PATCHES[layout]);
  if (!/class Component extends DCLogic/.test(logic)) throw new Error(`${layout}: logic.js does not define "class Component extends DCLogic"`);
  writeFileSync(path.join(GEN, `${layout}.logic.js`),
    `// GENERATED by tools/build-studio.mjs from design/source/${layout}/logic.js. Do not edit.\n` +
    `export default function makeLogic(DCLogic, React) {\n${logic}\n;return Component;\n}\n`);
}

const a = styles.studio.join('\n'), b = styles.mobile.join('\n');
if (a !== b) console.warn('note: studio and mobile <helmet> styles differ; using the studio set, which both layouts were checked against');
const hover = [...pseudoRules].map(([k, cls]) => { const [p, ...rest] = k.split('|'); const css = rest.join('|'); return `.${cls}:${p}{${importantify(css)}}`; }).join('\n');
const css = cleanCss(a) + '\n' + hover + '\n' + FULL_PAGE_CSS + '\n' + MOBILE_CSS + '\n';
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
