// One headless Chromium session per card: eight setContent + screenshot rounds on a single page
// (docs/ARCHITECTURE.md section 6). Budget is a few seconds per card; the browser is always closed.
//
// Chromium comes from puppeteer's own download (developer machines) or from the `CHROME_PATH` executable
// (the container's Debian chromium). `--no-sandbox` is needed as a non-root user in a container without
// user namespaces; `--disable-dev-shm-usage` because /dev/shm is tiny in Docker.
import puppeteer from 'puppeteer';
import type { Browser, LaunchOptions } from 'puppeteer';
import type { CardRow, Env } from '../types.js';
import { LANGS, SIZES, SIZE_NAMES } from '../types.js';
import { AUTOFIT_FN } from './autofit.js';
import type { RenderedImage } from './consumer.js';
import { loadFonts } from './fonts.js';
import { buildCardHtml } from './template.js';

// Runs in the page, so it is serialised: nothing from this module may be referenced inside.
// tsconfig has no DOM lib, hence the cast; it erases to `globalThis.document.fonts.ready`.
const FONTS_READY_FN = (): Promise<boolean> =>
  (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready.then(() => true);

export const CHROMIUM_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--hide-scrollbars',
  '--font-render-hinting=none',
];

/** Per-card budget for the whole browser session. */
export const RENDER_TIMEOUT_MS = 60_000;

export function launchOptions(env: Pick<Env, 'CHROME_PATH'>): LaunchOptions {
  const opts: LaunchOptions = {
    headless: true,
    args: [...CHROMIUM_ARGS],
    timeout: 30_000,
    protocolTimeout: RENDER_TIMEOUT_MS,
  };
  const exe = (env.CHROME_PATH ?? process.env['CHROME_PATH'] ?? '').trim();
  if (exe) opts.executablePath = exe;
  return opts;
}

export async function renderCardWithBrowser(card: CardRow, env: Env): Promise<RenderedImage[]> {
  const fonts = loadFonts();
  const browser: Browser = await puppeteer.launch(launchOptions(env));
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
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
