// Fonts embedded into the card HTML as base64 @font-face blocks. The renderer's Chromium is not
// guaranteed any Arabic system font, so nothing may rely on one (docs/ARCHITECTURE.md section 6).
// The two .woff2 files are read from templates/fonts at module load; they come from tools/fetch-fonts.sh
// and are licensed per templates/fonts/LICENSE.md. Each file is a variable font with a wght axis, so one
// @font-face per family covers 400 and 700.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToBase64 } from '../util/crypto.js';

/** templates/fonts, resolved from this file so it works from src/ (tsx) and dist/ alike. */
export const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/fonts');

export interface FontCss {
  css: string;
}

interface Face {
  family: string;
  file: string;
}

const FACES: readonly Face[] = [
  { family: 'Inter', file: 'inter.woff2' },
  { family: 'Noto Kufi Arabic', file: 'noto-kufi-arabic.woff2' },
];

function fontFace(f: Face): string {
  const data = readFileSync(path.join(FONT_DIR, f.file));
  if (data.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`fonts: ${f.file} is not a woff2 file`);
  return (
    `@font-face{font-family:'${f.family}';font-style:normal;font-weight:400 700;font-display:block;` +
    `src:url(data:font/woff2;base64,${bytesToBase64(data)}) format('woff2');}`
  );
}

let cached: FontCss | undefined;

/** Two @font-face blocks (Inter latin, Noto Kufi Arabic arabic), each covering weights 400 to 700. Read and encoded once per process. */
export function loadFonts(): FontCss {
  if (!cached) cached = { css: FACES.map(fontFace).join('\n') };
  return cached;
}
