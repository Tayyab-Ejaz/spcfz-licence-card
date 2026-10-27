// The customer's card as a picture, for the welcome email: the studio's "Day One" style, square, with the issue
// date on the calendar, the company, the activity and the founder. Drawn by sharp from the design's measurements
// (design/source/studio/template.html, isDayone); the customer then makes their own version in the studio.
// Arabic is mirrored, in Noto Kufi Arabic. 1080 x 1080 JPEG.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { CardRow, Lang } from '../types.js';
import { formatFullDate } from '../util/time.js';
import type { Face, TextImage } from './preview-image.js';
import { LOGO_FILE, textImage, unbreakable, useOurFonts } from './preview-image.js';

const S = 1080;
const PAD_X = 88;
const PAD_Y = 80;
const C = {
  bg: '#eef3ff', soft: '#d6e1ff', line: '#adc3ff', gold: '#f0b429', cyan: '#00b2c7',
  ink: '#071329', blue: '#004dff', muted: '#53617c', ring: '#c3ccdd', white: '#ffffff',
};

const INTER = (weight: string, file: string): Face => ({ file, family: 'Inter', weight });
const KUFI = (weight: string, file: string): Face => ({ file, family: 'Noto Kufi Arabic,Inter', weight });
const FACE: Record<Lang, { heavy: Face; medium: Face; bold: Face }> = {
  en: { heavy: INTER('Ultra-Bold', 'Inter-ExtraBold.ttf'), bold: INTER('Bold', 'Inter-Bold.ttf'), medium: INTER('Medium', 'Inter-Medium.ttf') },
  ar: { heavy: KUFI('Ultra-Bold', 'NotoKufiArabic-ExtraBold.ttf'), bold: KUFI('Bold', 'NotoKufiArabic-Bold.ttf'), medium: KUFI('Medium', 'NotoKufiArabic-Medium.ttf') },
};
const NUMBERS: Face = INTER('Ultra-Bold', 'Inter-ExtraBold.ttf');

const MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const T = {
  en: { headline: 'Officially in business.', dayOne: 'Day one', licensedWith: 'LICENSED WITH', founder: 'Founder', licensed: 'Licensed' },
  ar: { headline: 'بدأنا العمل رسمياً.', dayOne: 'اليوم الأول', licensedWith: 'بترخيص من', founder: 'المؤسس', licensed: 'تاريخ الترخيص' },
};

export interface CardImageInput {
  company: string;
  activity: string | null;
  founder: string | null;
  issuedOn: string; // YYYY-MM-DD
  lang: Lang;
}

/** The studio's rule (client/card-data.js cardName): over 40 characters, keep the first and last word. */
export function cardName(full: string | null): string | null {
  const n = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!n) return null;
  if (n.length <= 40) return n;
  const w = n.split(' ');
  return w.length > 1 ? `${w[0]} ${w[w.length - 1]}`.slice(0, 40) : n.slice(0, 40);
}

function initials(name: string): string {
  const w = name.split(/\s+/).filter(Boolean);
  const pick = (s: string): string => Array.from(s)[0] ?? '';
  return ((pick(w[0] ?? '') + (w.length > 1 ? pick(w[w.length - 1] ?? '') : '')) || '•').toUpperCase();
}

const svg = (w: number, h: number, body: string): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

/** A rotated square (the design's diamonds), centred on cx, cy. */
const diamond = (cx: number, cy: number, size: number, rx: number, fill: string, stroke?: { color: string; width: number }): string =>
  `<rect x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="${rx}" transform="rotate(45 ${cx} ${cy})" ` +
  (stroke ? `fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}"/>` : `fill="${fill}"/>`);

/** The tear-off calendar (400 wide), upright; it is tilted -4 degrees when placed. Returns the PNG and its size. */
async function calendar(p: CardImageInput): Promise<{ input: Buffer; width: number; height: number; card: { x: number; y: number } }> {
  const ar = p.lang === 'ar';
  const [y, m, d] = p.issuedOn.split('-');
  const monthText = ar ? `${MONTHS_AR[Number(m) - 1]} ${y}` : `${MONTHS_EN[Number(m) - 1]} ${y}`;
  const day = String(Number(d));
  const W = 400;
  const HEAD = 108;
  const BODY = 380;
  const FOOT = 76;
  const H = HEAD + BODY + FOOT;
  const M = 60; // room around the card for the shadow and the rings
  const month = await textImage({ text: monthText, face: ar ? FACE.ar.heavy : NUMBERS, size: ar ? 28 : 30, color: C.white, width: W, tracking: ar ? 0 : 0.16 });
  const num = await textImage({ text: day, face: NUMBERS, size: day.length > 1 ? 177 : 260, color: C.ink, width: W, tracking: -0.06, lineHeight: 1 });
  const label = await textImage({ text: T[p.lang].dayOne, face: ar ? FACE.ar.heavy : FACE.en.heavy, size: ar ? 28 : 30, color: C.blue, width: W });
  const base = svg(W + 2 * M, H + 2 * M, `
    <defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="18"/><feOffset dy="26"/><feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="r"><rect x="${M}" y="${M}" width="${W}" height="${H}" rx="30"/></clipPath></defs>
    <g filter="url(#s)"><rect x="${M}" y="${M}" width="${W}" height="${H}" rx="30" fill="${C.white}"/></g>
    <g clip-path="url(#r)"><rect x="${M}" y="${M}" width="${W}" height="${HEAD}" fill="${C.ink}"/></g>
    ${diamond(M + W / 2, M + HEAD + BODY / 2, 250 - 10, 34, '', { color: C.gold, width: 10 })}
    <rect x="${M + 110}" y="${M - 16}" width="30" height="46" rx="15" fill="${C.ring}"/>
    <rect x="${M + W - 110 - 30}" y="${M - 16}" width="30" height="46" rx="15" fill="${C.ring}"/>`);
  const at = (img: TextImage, top: number): { input: Buffer; left: number; top: number } => ({ input: img.input, left: M + Math.round((W - img.width) / 2), top: Math.round(top) });
  const input = await sharp(base).composite([
    at(month, M + 46 + (HEAD - 46 - 26 - month.height) / 2 + 2),
    at(num, M + HEAD + (BODY - num.height) / 2),
    at(label, M + HEAD + BODY + (FOOT - 36 - label.height) / 2 + 4),
  ]).png().toBuffer();
  const tilted = await sharp(input).rotate(-4, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  return { input: tilted.data, width: tilted.info.width, height: tilted.info.height, card: { x: W + 2 * M, y: H + 2 * M } };
}

/** The headline, sized like the studio: shorter headlines get bigger type, always within the text column. */
async function fitText(o: { text: string; face: Face; sizes: number[]; color: string; width: number; maxHeight: number; align: 'left' | 'right'; lineHeight: number; tracking: number }): Promise<TextImage> {
  let last: TextImage | null = null;
  for (const size of o.sizes) {
    last = await textImage({ text: unbreakable(o.text), face: o.face, size, color: o.color, width: o.width, align: o.align, lineHeight: o.lineHeight, tracking: o.tracking });
    if (last.height <= o.maxHeight && last.width <= o.width) return last;
  }
  return last as TextImage;
}

/** The card picture as a JPEG. */
export async function renderCardImage(p: CardImageInput): Promise<Buffer> {
  useOurFonts();
  const ar = p.lang === 'ar';
  const f = FACE[p.lang];
  const align = ar ? 'right' : 'left';
  const founder = cardName(p.founder);

  // Footer (bottom 84 px of content): avatar + name/role, or "Licensed <date>"; logo opposite.
  const FOOT_H = 84;
  const footTop = S - PAD_Y - FOOT_H;
  const lineY = footTop - 30 - 2;
  const avatarX = ar ? S - PAD_X - 84 : PAD_X;
  const textX = ar ? S - PAD_X - 84 - 20 : PAD_X + 84 + 20;
  const nameImg = founder
    ? await textImage({ text: founder, face: f.heavy, size: ar ? 27 : 29, color: C.ink, width: 520, align })
    : await textImage({ text: T[p.lang].licensed, face: f.medium, size: 22, color: C.muted, width: 520, align });
  const subImg = founder
    ? await textImage({ text: T[p.lang].founder, face: f.medium, size: 22, color: C.muted, width: 520, align })
    : await textImage({ text: formatFullDate(p.issuedOn, p.lang), face: f.heavy, size: ar ? 27 : 29, color: C.ink, width: 520, align });
  const ini = await textImage({ text: initials(founder ?? p.company), face: founder ? f.heavy : NUMBERS, size: 32, color: C.white, width: 84, tracking: -0.02 });
  const withLabel = await textImage({ text: T[p.lang].licensedWith, face: f.bold, size: ar ? 16 : 14, color: C.muted, width: 300, tracking: ar ? 0 : 0.14 });
  const logo = await sharp(readFileSync(LOGO_FILE)).resize({ height: 60 }).png().toBuffer({ resolveWithObject: true });
  const logoX = ar ? PAD_X : S - PAD_X - logo.info.width;

  // Main row: the calendar on the start side, the text column beside it, both centred in the space above the line.
  const cal = await calendar(p);
  const rowTop = PAD_Y;
  const rowH = lineY - rowTop;
  const calLeft = ar ? S - PAD_X - 400 : PAD_X;
  const COL_W = S - 2 * PAD_X - 400 - 64;
  const colX = ar ? PAD_X : PAD_X + 400 + 64;
  const headline = await fitText({ text: T[p.lang].headline, face: f.heavy, sizes: ar ? [66, 60, 54] : [74, 68, 62], color: C.ink, width: COL_W, maxHeight: 220, align, lineHeight: ar ? 0.85 : 0.98, tracking: ar ? 0 : -0.045 });
  const coSizes = p.company.length <= 18 ? [44, 40, 36] : p.company.length <= 26 ? [40, 36, 32] : p.company.length <= 36 ? [34, 30, 28] : [30, 28, 26];
  const company = await fitText({ text: p.company, face: f.heavy, sizes: ar ? coSizes.map((s) => s - 4) : coSizes, color: C.blue, width: COL_W, maxHeight: 200, align, lineHeight: ar ? 0.9 : 1.08, tracking: ar ? 0 : -0.02 });
  const activity = p.activity ? await fitText({ text: p.activity, face: f.medium, sizes: [26, 24, 22], color: C.muted, width: COL_W, maxHeight: 110, align, lineHeight: ar ? 0.95 : 1.3, tracking: 0 }) : null;
  const colH = headline.height + 24 + company.height + (activity ? 10 + activity.height : 0);
  const colTop = rowTop + Math.round((rowH - colH) / 2);
  const xIn = (img: TextImage): number => (ar ? colX + COL_W - img.width : colX);

  const base = svg(S, S, `
    <rect width="${S}" height="${S}" fill="${C.bg}"/>
    ${diamond(ar ? S + 120 - 210 : -120 + 210, S + 140 - 210, 420, 48, C.soft)}
    ${diamond(ar ? 110 + 15 : S - 110 - 15, 96 + 15, 30, 5, C.gold)}
    ${diamond(ar ? 180 + 8 : S - 180 - 8, 150 + 8, 16, 3, C.cyan)}
    <rect x="${PAD_X}" y="${lineY}" width="${S - 2 * PAD_X}" height="2" fill="${C.line}"/>
    <circle cx="${avatarX + 42}" cy="${footTop + 42}" r="46" fill="${C.white}"/>
    <circle cx="${avatarX + 42}" cy="${footTop + 42}" r="42" fill="${C.blue}"/>`);

  const nameBlockH = nameImg.height + 3 + subImg.height;
  const nameTop = footTop + Math.round((FOOT_H - nameBlockH) / 2);
  const rightOf = (img: { width: number }): number => (ar ? textX - img.width : textX);
  const composites = [
    { input: cal.input, left: Math.round(calLeft + 200 - cal.width / 2), top: Math.round(rowTop + rowH / 2 - cal.height / 2) },
    { input: headline.input, left: xIn(headline), top: colTop },
    { input: company.input, left: xIn(company), top: colTop + headline.height + 24 },
    ...(activity ? [{ input: activity.input, left: xIn(activity), top: colTop + headline.height + 24 + company.height + 10 }] : []),
    { input: ini.input, left: avatarX + Math.round((84 - ini.width) / 2), top: footTop + Math.round((84 - ini.height) / 2) },
    { input: nameImg.input, left: rightOf(nameImg), top: nameTop },
    { input: subImg.input, left: rightOf(subImg), top: nameTop + nameImg.height + 3 },
    { input: withLabel.input, left: ar ? logoX : S - PAD_X - withLabel.width, top: footTop + 84 - 60 - 10 - withLabel.height },
    { input: logo.data, left: logoX, top: footTop + 84 - 60 },
  ];
  return sharp(base).composite(composites).flatten({ background: C.bg }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

const cache = new Map<string, Buffer>();
export async function cachedCardImage(key: string, p: CardImageInput): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) return hit;
  const img = await renderCardImage(p);
  cache.set(key, img);
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return img;
}

/** What the picture shows for a card, in a language: the Arabic names when there are any, else the English. */
export function cardImageInput(card: CardRow, lang: Lang): CardImageInput {
  const ar = lang === 'ar';
  return {
    company: (ar && card.company_name_ar) || card.company_name_en,
    activity: (ar ? card.activity_category_ar || card.activity_category : card.activity_category) || null,
    founder: (ar ? card.founder_name_ar || card.founder_name_en : card.founder_name_en) || null,
    issuedOn: card.issued_on,
    lang,
  };
}
