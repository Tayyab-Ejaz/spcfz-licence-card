// The link-preview picture for one card (WhatsApp, LinkedIn, iMessage): the company's name, big, in the card's
// language, with the issue date and a small SPC logo. 1200 x 630 JPEG, drawn by sharp (libvips + Pango, so
// Arabic is shaped and laid out right to left). Fonts ship in assets/fonts (Inter, Noto Kufi Arabic; SIL OFL).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Lang } from '../types.js';
import { formatFullDate } from '../util/time.js';
import { STUDIO_DIR } from './studio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(HERE, '../../assets/fonts');
export const LOGO_FILE = path.join(STUDIO_DIR, 'a', 'a18673349b740aa2.png'); // the colour SPC Free Zone logo used on the card

const W = 1200;
const H = 630;
const INK = '#071329';
const BLUE = '#004dff';
const MUTED = '#53617c';

export interface Face { file: string; family: string; weight: string }
const FACES: Record<Lang, { name: Face; label: Face; small: Face }> = {
  en: {
    name: { file: 'Inter-ExtraBold.ttf', family: 'Inter', weight: 'Ultra-Bold' },
    label: { file: 'Inter-Bold.ttf', family: 'Inter', weight: 'Bold' },
    small: { file: 'Inter-Medium.ttf', family: 'Inter', weight: 'Medium' },
  },
  ar: {
    name: { file: 'NotoKufiArabic-ExtraBold.ttf', family: 'Noto Kufi Arabic,Inter', weight: 'Ultra-Bold' },
    label: { file: 'NotoKufiArabic-Bold.ttf', family: 'Noto Kufi Arabic,Inter', weight: 'Bold' },
    small: { file: 'NotoKufiArabic-Medium.ttf', family: 'Noto Kufi Arabic,Inter', weight: 'Medium' },
  },
};

export const escapeMarkup = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let fontsReady = false;
/**
 * Point fontconfig at our six fonts and nothing else, before the first text is drawn. Without a config it
 * complains, scans every font on the machine (a minute on a Mac) and may draw Inter text in a system font.
 */
export function useOurFonts(): void {
  if (fontsReady) return;
  const dir = path.join(os.tmpdir(), 'spcfz-licence-card-fontconfig');
  mkdirSync(path.join(dir, 'cache'), { recursive: true });
  const conf = path.join(dir, 'fonts.conf');
  const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  writeFileSync(conf, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${xml(FONT_DIR)}</dir>
  <cachedir>${xml(path.join(dir, 'cache'))}</cachedir>
</fontconfig>
`);
  process.env['FONTCONFIG_FILE'] = conf;
  fontsReady = true;
}

/**
 * Names keep their hyphens on one line ("FZ-LLC"), and a spaced dash stays with the word before it. Uses
 * WORD JOINER (U+2060), which renderers never draw, rather than the no-break hyphen U+2011, which Inter lacks.
 */
export function unbreakable(name: string): string {
  return name
    .replace(/(\S)-(?=\S)/g, '$1\u2060-\u2060')
    .replace(/ ([-–—]) /g, '\u00a0$1 ');
}

export interface TextImage { input: Buffer; width: number; height: number }

export async function textImage(o: { text: string; face: Face; size: number; color: string; width: number; tracking?: number; lineHeight?: number; align?: 'left' | 'centre' | 'right' }): Promise<TextImage> {
  const letter = o.tracking ? ` letter_spacing="${Math.round(o.tracking * o.size * 1024)}"` : '';
  const line = o.lineHeight ? ` line_height="${o.lineHeight}"` : '';
  const markup = `<span foreground="${o.color}"${letter}${line}>${escapeMarkup(o.text)}</span>`;
  const { data, info } = await sharp({
    text: {
      text: markup,
      font: `${o.face.family} ${o.face.weight} ${o.size}`,
      fontfile: path.join(FONT_DIR, o.face.file),
      width: o.width,
      align: o.align ?? 'centre',
      wrap: 'word',
      rgba: true,
      dpi: 72,
    },
  }).png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

/**
 * The name as big as it can be: the largest size, from 112 px down, at which it fits on at most three lines
 * inside a 1000 x 320 safe area.
 */
async function fitName(name: string, face: Face, lang: Lang): Promise<TextImage & { size: number }> {
  // Noto Kufi Arabic's natural line is much taller than Inter's, so it is tightened more.
  const lineHeight = lang === 'ar' ? 0.82 : 1.02;
  const text = unbreakable(name);
  const render = (size: number, t = text): Promise<TextImage> =>
    textImage({ text: t, face, size, color: INK, width: 1000, tracking: lang === 'ar' ? 0 : -0.03, lineHeight });
  // Lines are counted from the real metrics at this size: the height of one line and the step to the next.
  const sample = lang === 'ar' ? 'منطقة' : 'Hg';
  const metrics = async (size: number): Promise<{ first: number; step: number }> => {
    const one = (await render(size, sample)).height;
    const two = (await render(size, `${sample}\n${sample}`)).height;
    return { first: one, step: Math.max(1, two - one) };
  };
  for (const size of [112, 100, 90, 82, 74, 66, 58, 50, 44]) {
    const img = await render(size);
    const { first, step } = await metrics(size);
    const lines = Math.max(1, 1 + Math.round((img.height - first) / step));
    if (lines <= 3 && img.height <= 320) return { ...img, size };
  }
  const img = await render(40);
  return { ...img, size: 40 };
}

const BACKGROUND = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f4f7fc"/>
  <rect x="860" y="-330" width="560" height="560" rx="64" transform="rotate(45 1140 -50)" fill="#e2eafc"/>
  <rect x="-300" y="380" width="640" height="640" rx="72" transform="rotate(45 20 700)" fill="#e9effd"/>
</svg>`);

export interface PreviewInput {
  company: string;
  issuedOn: string; // YYYY-MM-DD
  lang: Lang;
}

/** The preview as a JPEG. */
export async function renderPreview(p: PreviewInput): Promise<Buffer> {
  useOurFonts();
  const f = FACES[p.lang];
  const ar = p.lang === 'ar';
  const label = await textImage({ text: ar ? 'مرخّصة رسمياً' : 'OFFICIALLY LICENSED', face: f.label, size: ar ? 30 : 26, color: BLUE, width: 1000, tracking: ar ? 0 : 0.16 });
  const name = await fitName(p.company, f.name, p.lang);
  const date = formatFullDate(p.issuedOn, p.lang);
  const when = await textImage({ text: ar ? `تاريخ الترخيص ${date} · الشارقة` : `Licensed ${date} · Sharjah`, face: f.small, size: ar ? 28 : 30, color: MUTED, width: 1000 });
  const logo = await sharp(readFileSync(LOGO_FILE)).resize({ height: 46 }).png().toBuffer({ resolveWithObject: true });

  // Stack label, name and date, centred in the space above the logo.
  const gapA = 30;
  const gapB = 30;
  const block = label.height + gapA + name.height + gapB + when.height;
  const top = Math.max(36, Math.round((H - 110 - block) / 2) + 10);
  const x = (w: number): number => Math.round((W - w) / 2);
  const diamond = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect x="4" y="4" width="14" height="14" rx="2" transform="rotate(45 11 11)" fill="#f0b429"/></svg>`);
  const labelX = x(label.width);
  const composites = [
    { input: diamond, left: ar ? labelX + label.width + 12 : labelX - 34, top: top + Math.round(label.height / 2) - 11 },
    { input: label.input, left: labelX, top },
    { input: name.input, left: x(name.width), top: top + label.height + gapA },
    { input: when.input, left: x(when.width), top: top + label.height + gapA + name.height + gapB },
    { input: logo.data, left: x(logo.info.width), top: H - 46 - 40 },
  ];
  return sharp(BACKGROUND).composite(composites).flatten({ background: '#f4f7fc' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

/** Small in-memory cache: a preview is fetched a few times when a link is shared, then rarely again. */
const cache = new Map<string, Buffer>();
const CACHE_MAX = 200;

export async function cachedPreview(key: string, p: PreviewInput): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const img = await renderPreview(p);
  cache.set(key, img);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return img;
}
