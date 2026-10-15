// Auto-fit for the variable text zones (docs/ARCHITECTURE.md section 6): the company name starts
// at data-max px, shrinks in 2 px steps until it fits in data-lines lines, stops at data-min, and
// shows an ellipsis if it still overflows.
//
// AUTOFIT_FN runs inside headless Chromium, never in the Worker. Puppeteer serialises it with
// Function.prototype.toString, and autofitScript() does the same for the inline <script>, so the
// body must be self-contained: no imports, no module-level helpers, no closures over this file.
// The interfaces below are type-only and vanish at compile time; they exist because tsconfig has
// no DOM lib (it would clash with @cloudflare/workers-types).

interface FitStyle {
  fontSize: string;
  overflow: string;
  textOverflow: string;
  display: string;
  setProperty(name: string, value: string): void;
}

interface FitElement {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly style: FitStyle;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface FitDocument {
  querySelectorAll(selectors: string): ArrayLike<FitElement>;
}

export const AUTOFIT_FN: () => void = () => {
  const doc = (globalThis as unknown as { document: FitDocument }).document;
  const nodes = Array.from(doc.querySelectorAll('[data-autofit]'));
  for (const el of nodes) {
    const max = Number(el.getAttribute('data-max')) || 64;
    const min = Number(el.getAttribute('data-min')) || 24;
    const lines = Number(el.getAttribute('data-lines')) || 1;

    el.style.display = '-webkit-box';
    el.style.setProperty('-webkit-box-orient', 'vertical');
    el.style.setProperty('-webkit-line-clamp', String(lines));
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'clip';

    // With line-clamp the box is cut to `lines` lines while scrollHeight reports the full text,
    // so overflow shows as scrollHeight > clientHeight. One pixel of slack covers rounding.
    const fits = (): boolean => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;

    let size = max;
    el.style.fontSize = size + 'px';
    while (!fits() && size - 2 >= min) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
    if (!fits()) {
      el.style.textOverflow = 'ellipsis';
      el.setAttribute('data-autofit-overflow', '1');
    }
    el.setAttribute('data-autofit-size', String(size));
  }
};

/** The same logic as a self-contained IIFE, for an inline <script>. Derived from AUTOFIT_FN so the two cannot drift. */
export function autofitScript(): string {
  return `(${AUTOFIT_FN.toString()})();`;
}
