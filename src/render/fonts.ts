// Fonts embedded into the card HTML as base64 @font-face blocks. Browser Rendering's Chromium has no
// Arabic system fonts, so nothing may rely on a system font (docs/ARCHITECTURE.md section 6).
// The .woff2 imports are raw bytes via wrangler's `[[rules]] type = "Data"` (see src/assets.d.ts);
// the files come from tools/fetch-fonts.sh and are licensed per templates/fonts/LICENSE.md.
// Each file is a variable font with a wght axis, so one @font-face per family covers 400 and 700.
import inter from '../../templates/fonts/inter.woff2';
import kufi from '../../templates/fonts/noto-kufi-arabic.woff2';
import { bytesToBase64 } from '../util/crypto';

export interface FontCss {
  css: string;
}

interface Face {
  family: string;
  data: ArrayBuffer;
}

const FACES: readonly Face[] = [
  { family: 'Inter', data: inter },
  { family: 'Noto Kufi Arabic', data: kufi },
];

function fontFace(f: Face): string {
  return (
    `@font-face{font-family:'${f.family}';font-style:normal;font-weight:400 700;font-display:block;` +
    `src:url(data:font/woff2;base64,${bytesToBase64(f.data)}) format('woff2');}`
  );
}

let cached: FontCss | undefined;

/** Two @font-face blocks (Inter latin, Noto Kufi Arabic arabic), each covering weights 400 to 700. Base64 is computed once per isolate. */
export function loadFonts(): FontCss {
  if (!cached) cached = { css: FACES.map(fontFace).join('\n') };
  return cached;
}
