// Pure template tests: no browser, no bindings. Fonts are stubbed except in the last block, which
// reads the real woff2 files from templates/fonts to prove the two variable @font-face blocks.
import { describe, expect, it } from 'vitest';
import type { CardRow, Lang, Size } from '../src/types.js';
import { LANGS, SIZES, SIZE_NAMES } from '../src/types.js';
import { AUTOFIT_FN, autofitScript } from '../src/render/autofit.js';
import type { FontCss } from '../src/render/fonts.js';
import { buildCardHtml, cardText, STORY_SAFE_ZONE, TEMPLATE_METRICS } from '../src/render/template.js';
import { escapeHtml } from '../src/util/html.js';
import { formatMonthYear } from '../src/util/time.js';

const fonts: FontCss = { css: '/* fonts stubbed */' };
const TEMPLATE_VERSION = 'placeholder-1';

const ARABIC_NAME = 'نيمبوس للنشر م.م.ح';
const ENGLISH_NAME = 'Nimbus Publishing FZE';

function makeCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: '01JA0000000000000000000000',
    token: 'AbCdEfGhIjKlMnOpQrStUv',
    licence_number: 'SPC-2026-01234',
    is_test: false,
    company_name_en: ENGLISH_NAME,
    company_name_ar: ARABIC_NAME,
    licence_type: 'Commercial',
    activity_category: 'Publishing',
    activity_category_ar: null,
    issued_on: '2026-10-15',
    preferred_language: 'en',
    content_hash: 'hash-1',
    status: 'pending',
    render_error: null,
    source: 'test',
    template_version: null,
    created_at: '2026-10-15T08:00:00.000Z',
    updated_at: '2026-10-15T08:00:00.000Z',
    rendered_at: null,
    expires_at: null,
    ...overrides,
  };
}

function render(card: CardRow, lang: Lang, size: Size): string {
  return buildCardHtml({ card, lang, size, fonts, templateVersion: TEMPLATE_VERSION });
}

describe('buildCardHtml', () => {
  for (const lang of LANGS) {
    for (const size of SIZE_NAMES) {
      it(`renders ${lang}-${size} with the right direction, pixel size and variables`, () => {
        const card = makeCard();
        const out = render(card, lang, size);
        const { width, height } = SIZES[size];
        const dir = lang === 'ar' ? 'rtl' : 'ltr';

        expect(out.startsWith('<!doctype html>')).toBe(true);
        expect(out).toContain(`<html lang="${lang}" dir="${dir}">`);
        expect(out).toContain(`width:${width}px;height:${height}px`);
        expect(out).toContain(`<meta name="template-version" content="${TEMPLATE_VERSION}">`);
        expect(out).toContain(lang === 'ar' ? ARABIC_NAME : ENGLISH_NAME);
        expect(out).toContain('<span dir="ltr">SPC-2026-01234</span>');
        expect(out).toContain(formatMonthYear('2026-10-15', lang));
        expect(out).toContain('Publishing');
        expect(out).toContain('spcfz.ae');
        expect(out).toContain('SPC Free Zone');
        expect(out).toContain('class="qr"');
        expect(out).toContain(fonts.css);
        if (lang === 'en') {
          expect(out).toContain('October 2026');
          expect(out).toContain('officially licensed at SPC Free Zone');
          expect(out).toContain("'Inter', sans-serif");
        } else {
          expect(out).toContain('مرخّصون رسمياً في المنطقة الحرة لمدينة الشارقة للنشر');
          expect(out).toContain("'Noto Kufi Arabic', 'Inter', sans-serif");
        }
      });
    }
  }

  it('uses the English name in the Arabic layout when no Arabic name exists (D5)', () => {
    for (const company_name_ar of [null, '', '   ']) {
      const out = render(makeCard({ company_name_ar }), 'ar', 'square');
      expect(out).toContain('<html lang="ar" dir="rtl">');
      expect(out).toContain(ENGLISH_NAME);
      expect(out).not.toContain(ARABIC_NAME);
    }
  });

  it('does not show the English name on the Arabic card when an Arabic name exists', () => {
    const out = render(makeCard(), 'ar', 'portrait');
    expect(out).toContain(ARABIC_NAME);
    expect(out).not.toContain(ENGLISH_NAME);
  });

  it('escapes HTML in every variable', () => {
    const evil = '<script>alert(1)</script> Evil & "Co" <img src=x onerror=alert(2)>';
    const card = makeCard({
      company_name_en: evil,
      company_name_ar: null,
      activity_category: '<b>Publishing</b>',
      licence_number: 'SPC-<2026>',
    });
    for (const lang of LANGS) {
      const out = render(card, lang, 'square');
      expect(out).not.toContain('<script>alert');
      expect(out).not.toContain('<img');
      expect(out).not.toContain('<b>Publishing</b>');
      expect(out).toContain(escapeHtml(evil));
      expect(out).toContain('&lt;b&gt;Publishing&lt;/b&gt;');
      expect(out).toContain('SPC-&lt;2026&gt;');
    }
  });

  it('omits the category block when the category is empty', () => {
    expect(render(makeCard({ activity_category: null }), 'en', 'square')).not.toContain('class="category');
    expect(render(makeCard({ activity_category: '  ' }), 'en', 'square')).not.toContain('class="category');
    expect(render(makeCard({ activity_category: 'Media' }), 'en', 'square')).toContain('class="category');
  });

  it('adds a TEST watermark for test cards only', () => {
    for (const lang of LANGS) {
      for (const size of SIZE_NAMES) {
        const real = render(makeCard({ is_test: false }), lang, size);
        const test = render(makeCard({ is_test: true }), lang, size);
        expect(real).not.toContain('test-watermark');
        expect(test).toContain('class="test-watermark"');
        expect(test).toContain('>TEST</span>');
        expect(test).toContain('rotate(-30deg)');
      }
    }
  });

  it('marks the company name for auto-fit and embeds the script', () => {
    const out = render(makeCard(), 'en', 'square');
    const m = TEMPLATE_METRICS.square;
    expect(out).toContain(`data-autofit data-max="${m.nameMax}" data-min="${m.nameMin}" data-lines="2"`);
    expect(out).toContain(autofitScript());
    expect(out).toContain('document.fonts.ready');
  });

  it('keeps the story out of the 250 px safe zones and reserves a QR square of at least 180 px on 1080-wide sizes', () => {
    expect(STORY_SAFE_ZONE).toBe(250);
    expect(TEMPLATE_METRICS.story.padTop).toBeGreaterThanOrEqual(250);
    expect(TEMPLATE_METRICS.story.padBottom).toBeGreaterThanOrEqual(250);
    for (const size of ['square', 'portrait', 'story'] as const) {
      expect(TEMPLATE_METRICS[size].qr).toBeGreaterThanOrEqual(180);
    }
    expect(TEMPLATE_METRICS.landscape.qr).toBeGreaterThan(0);
    expect(TEMPLATE_METRICS.landscape.qr).toBeLessThan(180);
    for (const size of SIZE_NAMES) {
      const m = TEMPLATE_METRICS[size];
      expect(m.nameMin).toBeLessThan(m.nameMax);
      expect(m.nameMax).toBeLessThanOrEqual(SIZES[size].width / 8);
    }
  });
});

describe('cardText', () => {
  it('picks the name, labels and date per language', () => {
    const en = cardText(makeCard(), 'en');
    expect(en.company).toBe(ENGLISH_NAME);
    expect(en.licence).toBe('SPC-2026-01234');
    expect(en.category).toBe('Publishing');
    expect(en.issued).toBe('October 2026');
    expect(en.headline).toContain('officially licensed');
    expect(en.website).toBe('spcfz.ae');

    const ar = cardText(makeCard(), 'ar');
    expect(ar.company).toBe(ARABIC_NAME);
    expect(ar.licence).toBe('SPC-2026-01234');
    expect(ar.issued).toBe(formatMonthYear('2026-10-15', 'ar'));
    expect(ar.issued).toContain('2026');
    expect(ar.headline).toContain('المنطقة الحرة');

    expect(cardText(makeCard({ company_name_ar: null }), 'ar').company).toBe(ENGLISH_NAME);
    expect(cardText(makeCard({ activity_category: null }), 'en').category).toBeNull();
    expect(cardText(makeCard({ activity_category: ' ' }), 'en').category).toBeNull();
  });
});

describe('autofit', () => {
  it('is a self-contained IIFE that targets [data-autofit]', () => {
    const script = autofitScript();
    expect(script.startsWith('(')).toBe(true);
    expect(script.endsWith(')();')).toBe(true);
    expect(script).toContain('data-autofit');
    expect(script).toContain('data-max');
    expect(script).toContain('data-min');
    expect(script).toContain('data-lines');
    expect(script).toContain('-webkit-line-clamp');
    expect(script).toContain('ellipsis');
    expect(script).toContain(AUTOFIT_FN.toString());
    expect(typeof AUTOFIT_FN).toBe('function');
  });
});

describe('fonts', () => {
  it('embeds one variable @font-face per family, covering weights 400 to 700, as base64 woff2', async () => {
    // Dynamic import keeps a missing font file from taking the template tests down with it.
    const { loadFonts } = await import('../src/render/fonts.js');
    const { css } = loadFonts();
    expect(css.match(/@font-face/g)?.length).toBe(2);
    expect(css).toContain("font-family:'Inter';font-style:normal;font-weight:400 700;");
    expect(css).toContain("font-family:'Noto Kufi Arabic';font-style:normal;font-weight:400 700;");
    expect(css.match(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\) format\('woff2'\)/g)?.length).toBe(2);
    // woff2 files start with "wOF2", which is "d09GMg" in base64.
    expect(css.match(/base64,d09GMg/g)?.length).toBe(2);
    expect(loadFonts()).toBe(loadFonts());
  });
});
