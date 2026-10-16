// The placeholder card template (docs/ARCHITECTURE.md section 6, templates/placeholder/README.md).
// One function builds the full HTML document for a (card, lang, size); the browser renders it at
// exactly SIZES[size] and screenshots it. Every variable goes through the escaping `html` tag.
// The approved design from docs/DESIGN-HANDOFF.md replaces the layout here under a new TEMPLATE_VERSION.
import type { CardRow, Lang, Size } from '../types.js';
import { SIZES } from '../types.js';
import { html, raw } from '../util/html.js';
import { formatMonthYear } from '../util/time.js';
import { autofitScript } from './autofit.js';
import type { FontCss } from './fonts.js';

export interface TemplateInput {
  card: CardRow;
  lang: Lang;
  size: Size;
  fonts: FontCss;
  templateVersion: string;
}

export interface CardTextOut {
  company: string;
  licence: string;
  category: string | null;
  issued: string;
  headline: string;
  tagline: string;
  website: string;
}

/** Fixed strings per language. The Arabic ones are drafts awaiting a native reader (ARCHITECTURE section 12). */
const STRINGS: Readonly<Record<Lang, { headline: string; tagline: string; licenceLabel: string; issuedLabel: string }>> = {
  en: {
    headline: "We're officially licensed at SPC Free Zone",
    tagline: 'Sharjah Publishing City Free Zone',
    licenceLabel: 'Licence No.',
    issuedLabel: 'Issued',
  },
  ar: {
    headline: 'مرخّصون رسمياً في المنطقة الحرة لمدينة الشارقة للنشر',
    tagline: 'المنطقة الحرة لمدينة الشارقة للنشر',
    licenceLabel: 'رقم الرخصة',
    issuedLabel: 'تاريخ الإصدار',
  },
};

/** Instagram and WhatsApp overlay their controls on the top and bottom 250 px of a story (DESIGN-HANDOFF). */
export const STORY_SAFE_ZONE = 250;

export interface TemplateMetrics {
  padX: number;
  padTop: number;
  padBottom: number;
  wordmark: number;
  tagline: number;
  headline: number;
  nameMax: number;
  nameMin: number;
  category: number;
  label: number;
  value: number;
  site: number;
  qr: number;
  accentW: number;
  gap: number;
  watermark: number;
}

/** Pixel metrics per size. Exposed so tests can assert the contract (safe zone, QR square). */
export const TEMPLATE_METRICS: Readonly<Record<Size, TemplateMetrics>> = {
  square: {
    padX: 72, padTop: 72, padBottom: 72, wordmark: 30, tagline: 18, headline: 40, nameMax: 92, nameMin: 48,
    category: 24, label: 18, value: 32, site: 26, qr: 200, accentW: 96, gap: 28, watermark: 320,
  },
  portrait: {
    padX: 72, padTop: 88, padBottom: 88, wordmark: 30, tagline: 18, headline: 42, nameMax: 100, nameMin: 52,
    category: 24, label: 18, value: 32, site: 26, qr: 200, accentW: 96, gap: 32, watermark: 320,
  },
  story: {
    padX: 72, padTop: STORY_SAFE_ZONE + 40, padBottom: STORY_SAFE_ZONE + 40, wordmark: 32, tagline: 20, headline: 46,
    nameMax: 108, nameMin: 56, category: 26, label: 20, value: 34, site: 28, qr: 220, accentW: 108, gap: 36, watermark: 320,
  },
  landscape: {
    padX: 56, padTop: 44, padBottom: 44, wordmark: 22, tagline: 14, headline: 28, nameMax: 62, nameMin: 36,
    category: 18, label: 14, value: 24, site: 20, qr: 124, accentW: 72, gap: 18, watermark: 260,
  },
};

/** The text a card shows in one language. Decision D5: no Arabic name means the English name inside the Arabic layout. */
export function cardText(card: CardRow, lang: Lang): CardTextOut {
  const arabicName = (card.company_name_ar ?? '').trim();
  const company = lang === 'ar' && arabicName ? arabicName : card.company_name_en.trim();
  const category = (card.activity_category ?? '').trim();
  const s = STRINGS[lang];
  return {
    company,
    licence: card.licence_number,
    category: category || null,
    issued: formatMonthYear(card.issued_on, lang),
    headline: s.headline,
    tagline: s.tagline,
    website: 'spcfz.ae',
  };
}

function buildCss(width: number, height: number, m: TemplateMetrics, lang: Lang): string {
  const family = lang === 'ar' ? "'Noto Kufi Arabic', 'Inter', sans-serif" : "'Inter', sans-serif";
  const nameLineHeight = lang === 'ar' ? 1.4 : 1.1;
  const headlineLineHeight = lang === 'ar' ? 1.65 : 1.25;
  const glow = Math.round(width * 0.8);
  return `
:root{--blue:#004dff;--blue-2:#102ea2;--cyan:#00b2c7;--ink:#071329;--muted:#53617c;--border:#dfe7f4;--gold:#f0b429}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#102ea2}
body{font-family:${family};color:#fff;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.card{position:relative;width:${width}px;height:${height}px;padding:${m.padTop}px ${m.padX}px ${m.padBottom}px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,#102ea2 0%,#004dff 100%);overflow:hidden}
.glow{position:absolute;border-radius:50%;pointer-events:none}
.glow-a{width:${glow}px;height:${glow}px;top:${-Math.round(glow * 0.45)}px;inset-inline-end:${-Math.round(glow * 0.35)}px;background:radial-gradient(closest-side,rgba(0,178,199,.42),rgba(0,178,199,0))}
.glow-b{width:${glow}px;height:${glow}px;bottom:${-Math.round(glow * 0.5)}px;inset-inline-start:${-Math.round(glow * 0.3)}px;background:radial-gradient(closest-side,rgba(255,255,255,.12),rgba(255,255,255,0))}
.top,.middle,.bottom{position:relative;z-index:1}
.latin{font-family:'Inter',sans-serif;direction:ltr;unicode-bidi:isolate}
.wordmark{display:flex;align-items:center;gap:.5em;font-family:'Inter',sans-serif;font-weight:700;font-size:${m.wordmark}px;line-height:1;letter-spacing:.16em;text-transform:uppercase;direction:ltr;width:max-content}
.wordmark::before{content:'';display:inline-block;width:.75em;height:.75em;border-radius:3px;background:var(--cyan)}
.tagline{margin-top:.55em;font-size:${m.tagline}px;line-height:1.4;opacity:.82}
.accent{width:${m.accentW}px;height:6px;border-radius:3px;background:var(--gold);margin-bottom:${m.gap}px}
.headline{margin:0 0 ${Math.round(m.gap * 0.6)}px;font-weight:400;font-size:${m.headline}px;line-height:${headlineLineHeight};opacity:.95;text-wrap:balance}
.company{margin:0;font-weight:700;font-size:${m.nameMax}px;line-height:${nameLineHeight};display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:break-word;word-break:break-word}
[lang="en"] .company{letter-spacing:-.015em}
.caps{text-transform:uppercase;letter-spacing:.14em}
[lang="ar"] .caps{letter-spacing:0}
.category{margin-top:${Math.round(m.gap * 0.8)}px;font-size:${m.category}px;font-weight:700;line-height:1.4;color:var(--cyan)}
.bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:${m.gap}px}
.meta{margin:0;min-width:0;display:flex;flex-direction:column;gap:${Math.round(m.gap * 0.6)}px}
.meta-item dt{margin:0 0 .3em;font-size:${m.label}px;font-weight:700;line-height:1.3;color:var(--cyan)}
.meta-item dd{margin:0;font-size:${m.value}px;font-weight:700;line-height:1.25}
.site{margin-top:${Math.round(m.gap * 0.3)}px;font-size:${m.site}px;font-weight:700;line-height:1.2;color:var(--gold)}
.qr{flex:none;width:${m.qr}px;height:${m.qr}px;border:2px solid rgba(255,255,255,.35);border-radius:${Math.round(m.qr * 0.08)}px;background:rgba(255,255,255,.06)}
`;
}

/** Only emitted for test cards (ARCHITECTURE C3): a diagonal semi-transparent TEST across the image plus a gold corner tag. */
function watermarkCss(m: TemplateMetrics): string {
  return `
.test-watermark{position:absolute;inset:0;z-index:2;overflow:hidden;pointer-events:none}
.test-word{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-30deg);font-weight:700;font-size:${m.watermark}px;line-height:1;letter-spacing:.2em;white-space:nowrap;color:rgba(255,255,255,.14);-webkit-text-stroke:3px rgba(255,255,255,.3)}
.test-tag{position:absolute;top:${m.padTop}px;right:${m.padX}px;padding:.45em .9em;border-radius:6px;background:var(--gold);color:var(--ink);font-weight:700;font-size:${m.label}px;line-height:1;letter-spacing:.2em}
[dir="rtl"] .test-tag{right:auto;left:${m.padX}px}
`;
}

export function buildCardHtml(input: TemplateInput): string {
  const { card, lang, size, fonts, templateVersion } = input;
  const { width, height } = SIZES[size];
  const m = TEMPLATE_METRICS[size];
  const t = cardText(card, lang);
  const s = STRINGS[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const category = t.category ? html`<div class="category caps">${t.category}</div>` : '';
  const watermark = card.is_test
    ? html`<div class="test-watermark" aria-hidden="true"><span class="test-word latin">TEST</span><span class="test-tag latin">TEST</span></div>`
    : '';

  return html`<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}">
<meta name="robots" content="noindex">
<meta name="template-version" content="${templateVersion}">
<title>${t.company} · SPC Free Zone</title>
<style>${raw(fonts.css)}</style>
<style>${raw(buildCss(width, height, m, lang))}${raw(card.is_test ? watermarkCss(m) : '')}</style>
</head>
<body>
<div class="card">
  <div class="glow glow-a"></div>
  <div class="glow glow-b"></div>
  <header class="top">
    <div class="wordmark">SPC Free Zone</div>
    <div class="tagline">${t.tagline}</div>
  </header>
  <main class="middle">
    <div class="accent"></div>
    <h1 class="headline">${t.headline}</h1>
    <div class="company" data-autofit data-max="${m.nameMax}" data-min="${m.nameMin}" data-lines="2">${t.company}</div>
    ${raw(category)}
  </main>
  <footer class="bottom">
    <dl class="meta">
      <div class="meta-item"><dt class="caps">${s.licenceLabel}</dt><dd class="latin"><span dir="ltr">${t.licence}</span></dd></div>
      <div class="meta-item"><dt class="caps">${s.issuedLabel}</dt><dd>${t.issued}</dd></div>
      <div class="site latin">${t.website}</div>
    </dl>
    <div class="qr" aria-hidden="true"></div>
  </footer>
  ${raw(watermark)}
</div>
<script>document.fonts.ready.then(function(){${raw(autofitScript())}});</script>
</body>
</html>
`;
}
