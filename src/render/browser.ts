// One Browser Rendering session per card: eight setContent + screenshot rounds on a single page
// (docs/ARCHITECTURE.md section 6). Budget is a few seconds per card; the browser is always closed.
import puppeteer from '@cloudflare/puppeteer';
import type { CardRow, Env } from '../types';
import { LANGS, SIZES, SIZE_NAMES } from '../types';
import { AUTOFIT_FN } from './autofit';
import type { RenderedImage } from './consumer';
import { loadFonts } from './fonts';
import { buildCardHtml } from './template';

// Runs in the page, so it is serialised: nothing from this module may be referenced inside.
// tsconfig has no DOM lib, hence the cast; it erases to `globalThis.document.fonts.ready`.
const FONTS_READY_FN = (): Promise<boolean> =>
  (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready.then(() => true);

export async function renderCardWithBrowser(card: CardRow, env: Env): Promise<RenderedImage[]> {
  const fonts = loadFonts();
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    const out: RenderedImage[] = [];
    for (const lang of LANGS) {
      for (const size of SIZE_NAMES) {
        const { width, height } = SIZES[size];
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.setContent(
          buildCardHtml({ card, lang, size, fonts, templateVersion: env.TEMPLATE_VERSION }),
          { waitUntil: 'load' },
        );
        await page.evaluate(FONTS_READY_FN);
        await page.evaluate(AUTOFIT_FN);
        const shot = await page.screenshot({ type: 'png' });
        out.push({ lang, size, png: new Uint8Array(shot) });
      }
    }
    return out;
  } finally {
    await browser.close().catch((err: unknown) => {
      console.warn('render: browser.close failed', { card_id: card.id, message: err instanceof Error ? err.message : String(err) });
    });
  }
}
