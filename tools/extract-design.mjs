// Unpacks a Claude Design "Standalone" export into design/source/<name>/, so the build never reads the
// 8 MB bundle and a new export is a re-run of this script.
//
//   node tools/extract-design.mjs "<path>/License Announcement Studio - Standalone.html" studio
//   node tools/extract-design.mjs "<path>/License Announcement Mobile - Standalone.html" mobile
//
// Writes:
//   design/source/<name>/template.html   the DC template; asset UUIDs replaced by asset:<file> tokens
//   design/source/<name>/logic.js        the template's logic class, verbatim
//   design/source/<name>/props.json      the template's editable props (reference only)
//   design/source/assets/<hash>.<ext>    images and woff2 fonts, de-duplicated by content across exports
// Skipped on purpose: React, ReactDOM, the dc-runtime, the design-system bundle, html-to-image (the client
// ships its own copies) and the woff/ttf/svg duplicates of fonts (woff2 is enough for every target browser).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const [input, name] = process.argv.slice(2);
if (!input || !/^[a-z][a-z0-9-]*$/.test(name ?? '')) {
  console.error('usage: node tools/extract-design.mjs <standalone.html> <name>');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'design', 'source', name);
const assetDir = path.join(root, 'design', 'source', 'assets');
mkdirSync(outDir, { recursive: true });
mkdirSync(assetDir, { recursive: true });

const html = readFileSync(input, 'utf8');
const block = (type) => {
  const m = html.match(new RegExp(`<script type="${type.replace('/', '\\/')}">([\\s\\S]*?)</script>`));
  return m ? m[1] : null;
};
const manifest = JSON.parse(block('__bundler/manifest') ?? 'null');
let template = JSON.parse(block('__bundler/template') ?? 'null');
if (!manifest || typeof template !== 'string') throw new Error('not a standalone bundle: manifest or template missing');

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf',
  'application/javascript': 'js', 'text/javascript': 'js',
};
const KEEP = new Set(['png', 'jpg', 'webp', 'woff2']);

let kept = 0;
let dropped = 0;
for (const [uuid, entry] of Object.entries(manifest)) {
  let bytes = Buffer.from(entry.data, 'base64');
  if (entry.compressed) bytes = gunzipSync(bytes);
  const ext = EXT[entry.mime] ?? 'bin';
  if (!template.includes(uuid)) { dropped++; continue; }           // runtime scripts, unused sample photo
  if (!KEEP.has(ext)) {                                             // script src, font fallbacks
    template = template.split(uuid).join('asset:dropped');
    dropped++;
    continue;
  }
  const file = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
  const dest = path.join(assetDir, file);
  if (!existsSync(dest)) writeFileSync(dest, bytes);
  template = template.split(uuid).join(`asset:${file}`);
  kept++;
}

const logic = template.match(/<script type="text\/x-dc"([^>]*)>([\s\S]*?)<\/script>/);
if (!logic) throw new Error('no text/x-dc logic script in the template');
const props = (logic[1].match(/data-props="([^"]*)"/) ?? [])[1] ?? '{}';
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
writeFileSync(path.join(outDir, 'logic.js'), logic[2].replace(/^\n/, ''));
writeFileSync(path.join(outDir, 'props.json'), JSON.stringify(JSON.parse(unescape(props)), null, 2) + '\n');
writeFileSync(path.join(outDir, 'template.html'), template.replace(logic[0], ''));
console.log(`${name}: template ${template.length} chars, ${kept} assets kept, ${dropped} skipped -> ${path.relative(root, outDir)}`);
