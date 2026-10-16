// Puts the licence's real data into the design's logic, which ships with sample values (Lumen & Ledger,
// 8 October 2026, licence 4425153.01). The design's logic files stay verbatim; this subclass overrides
// fresh() for the starting state and adjusts the values renderVals() returns.

export const PORTAL_URL = 'https://portal.spcfz.ae/frontend/login/';

const EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Month names as used in the UAE (Gregorian, Latin digits), matching the design's "أكتوبر 2026".
const AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function dates(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const mi = Math.min(11, Math.max(0, (m || 1) - 1));
  return {
    year: String(y), day: String(d),
    fullEn: `${d} ${EN[mi]} ${y}`, fullAr: `${d} ${AR[mi]} ${y}`,
    shortEn: `${d} ${EN[mi].slice(0, 3)} ${y}`,
    monthYearEn: `${EN[mi]} ${y}`, monthYearAr: `${AR[mi]} ${y}`,
    calEn: `${EN[mi].slice(0, 3).toUpperCase()} ${y}`,
  };
}

/** Fire-and-forget counter for the admin's metrics; never blocks or breaks the action. */
export function beacon(token, body) {
  try {
    const url = `/c/${token}/m`;
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(url, blob))) {
      fetch(url, { method: 'POST', body: blob, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
    }
  } catch (e) { /* metrics are best effort */ }
}

/** The design's name field holds 40 characters; a longer legal name becomes first and last name. */
export function cardName(full) {
  const n = String(full || '').trim().replace(/\s+/g, ' ');
  if (n.length <= 40) return n;
  const w = n.split(' ');
  const short = w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : n;
  return short.slice(0, 40);
}

// Launch Pass stub: the name's usable width (stub width minus padding) and the design's sizes.
const STUB = { sq: { width: 202, en: 30, ar: 24 }, ls: { width: 150, en: 22, ar: 17 } };
const FAMILY = { en: '"Inter", sans-serif', ar: '"Noto Kufi Arabic", "Inter", sans-serif' };
// Words break only at spaces and hyphens; breaking inside a word is the very last resort (lastResort).
const wrapCss = (lines, lastResort) => `white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};text-wrap:balance${lastResort ? ';overflow-wrap:anywhere' : ''}`;
const WRAP_CSS = wrapCss(2);
const measured = new Map();
let measureCtx = null;

function textWidth(text, px, lang) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `800 ${px}px ${FAMILY[lang]}`;
  if ('letterSpacing' in measureCtx) measureCtx.letterSpacing = `${-0.015 * px}px`;
  return measureCtx.measureText(text).width;
}

/**
 * Launch Pass stub name. If it fits on one line at the design's size, the design is unchanged. Otherwise it
 * wraps to two balanced lines, shrinking (1 px at a time, to no less than 75 %) only as far as needed for
 * the whole name to fit in two lines and its longest word in one. fitStub() then corrects it against the
 * real layout, going to three lines if needed, so a founder's surname is never cut off.
 */
export function stubName(name, lang, format) {
  const key = format === 'landscape' ? 'ls' : 'sq';
  const n = String(name || '').trim();
  const cacheKey = `${key}|${lang}|${n}|${document.fonts && document.fonts.status}`;
  if (measured.has(cacheKey)) return measured.get(cacheKey);
  const { width } = STUB[key];
  const base = STUB[key][lang];
  let result = { size: base, xtra: '' };
  if (n && textWidth(n, base, lang) > width) {
    const words = n.split(/[\s-]+/).filter(Boolean);
    let size = base;
    for (; size > Math.round(base * 0.75); size--) {
      const total = textWidth(n, size, lang);
      const longest = Math.max(...words.map((w) => textWidth(w, size, lang)));
      if (total <= width * 1.85 && longest <= width) break;
    }
    result = { size, xtra: WRAP_CSS };
  }
  measured.set(cacheKey, result);
  return result;
}

/** Day One: the design's day size fits one digit; two digits take 68 % of it, filling the diamond as the design's "8" does. */
export function calDaySizes(day) {
  return String(day).length > 1 ? { sq: Math.round(260 * 0.68), ls: Math.round(160 * 0.68) } : { sq: 260, ls: 160 };
}

export function withCardData(Base) {
  return class CardLogic extends Base {
    fresh() {
      const f = super.fresh();
      const c = this.props.card;
      const nameEn = cardName(c.name_en);
      const nameAr = cardName(c.name_ar) || nameEn;   // like the company: no Arabic name, the English one
      return {
        ...f,
        company: c.company_en,
        name: nameEn, role: c.role_en ?? (nameEn ? 'Founder' : ''),
        activity: c.activity_en || '',
        lang: c.lang === 'ar' ? 'ar' : 'en',
        photo: null, photoNote: '',
        ar: { company: c.company_ar || c.company_en, name: nameAr, role: c.role_ar ?? (nameAr ? 'المؤسس' : ''), activity: c.activity_ar || '' },
      };
    }

    componentDidMount() {
      super.componentDidMount();
      this.fitStub();
      if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { this.forceUpdate(); this.fitStub(); });
    }

    componentDidUpdate(...args) {
      super.componentDidUpdate(...args);
      this.fitStub();
    }

    stubKey() {
      const s = this.state;
      const T = s.lang === 'ar' ? { ...s, ...s.ar } : s;
      return `${s.format}|${s.lang}|${s.focus}|${(T.name || '').trim()}`;
    }

    /**
     * After layout: if the Launch Pass stub name still overflows, adjust and let React render again:
     * one line at the design's size -> two lines down to 75 % -> three lines down to 60 %.
     * Each pass changes 1 px or one line, so it settles in a few frames. The export clones this DOM.
     */
    fitStub() {
      if (this.props.card.designExact) return;
      const node = this.cardRef && this.cardRef.current;
      const el = node && node.querySelector('[data-fit="stub"]');
      if (!el) return;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const clamped = (cs.webkitLineClamp || 'none') !== 'none';
      const lh = parseFloat(cs.lineHeight) || size * 1.1;
      const wide = el.scrollWidth > el.clientWidth + 1; // a single word wider than the stub
      const over = clamped ? wide || el.scrollHeight > el.clientHeight + lh * 0.5 : wide;
      if (!over) return;
      const lang = this.state.lang === 'ar' ? 'ar' : 'en';
      const base = STUB[this.state.format === 'landscape' ? 'ls' : 'sq'][lang];
      const key = this.stubKey();
      const lines = clamped ? parseInt(cs.webkitLineClamp, 10) || 2 : 1;
      if (lines === 1) { this.setState({ stubFit: { key, size, lines: 2 } }); return; }
      if (lines === 2 && size > Math.round(base * 0.75)) { this.setState({ stubFit: { key, size: size - 1, lines: 2 } }); return; }
      if (lines === 2) { this.setState({ stubFit: { key, size, lines: 3 } }); return; }
      if (size > Math.round(base * 0.6)) { this.setState({ stubFit: { key, size: size - 1, lines: 3 } }); return; }
      if (!this.state.stubFit || !this.state.stubFit.lastResort) this.setState({ stubFit: { key, size, lines: 3, lastResort: true } });
    }

    renderVals() {
      const v = super.renderVals();
      const c = this.props.card;
      const s = this.state;
      const ar = s.lang === 'ar';
      const D = dates(c.issued_on);
      // designExact (set only by tools/compare-design.mjs) renders the design's own sizes, so the comparison
      // proves the rendering is identical; the data fixes below are proven by tools/stress-cards.mjs.
      const exact = c.designExact === true;
      const est = exact ? { size: STUB[s.format === 'landscape' ? 'ls' : 'sq'][ar ? 'ar' : 'en'], xtra: '' } : stubName(v.nameText, ar ? 'ar' : 'en', s.format);
      const fit = !exact && s.stubFit && s.stubFit.key === this.stubKey() ? s.stubFit : null;
      const stub = fit ? { size: Math.min(est.size, fit.size), xtra: wrapCss(fit.lines || 2, fit.lastResort) } : est;
      const uae = s.hIdx === 4 || s.hIdx === 5;
      const lang = s.lang;
      const track = (fn, kind, network) => (typeof fn === 'function'
        ? (...args) => { beacon(c.token, { kind, lang, network, size: s.format }); return fn(...args); }
        : fn);
      return {
        ...v,
        kicker: ar ? `${uae ? 'انطلاقة في الإمارات' : 'مشروع جديد'} · ${D.monthYearAr}` : `${uae ? 'UAE launch' : 'New business'} · ${D.monthYearEn}`,
        monthYear: ar ? D.monthYearAr : D.monthYearEn,
        year: D.year,
        dateFull: ar ? D.fullAr : D.fullEn,
        calMonth: ar ? D.monthYearAr : D.calEn,
        calDay: D.day,
        calDaySize: calDaySizes(D.day).sq,
        calDaySizeLs: calDaySizes(D.day).ls,
        stubNameSq: stub.size,
        stubNameLs: stub.size,
        stubNameXtra: stub.xtra,
        coLockNote: ar
          ? `Arabic name as registered on license ${c.licence_number}. It can't be changed here.`
          : `As registered on license ${c.licence_number}. It can't be changed here.`,
        t: { ...v.t, estYear: ar ? `تأسست ${D.year}` : `EST. ${D.year}` },
        hdrTitle: `${c.company_en} is licensed.`,
        hdrDate: D.fullEn,
        hdrDateShort: D.shortEn,
        hasHdrActivity: !!c.activity_en,
        hdrActivity: c.activity_en || '',
        licenceNo: c.licence_number,
        portalUrl: PORTAL_URL,
        download: track(v.download, 'download'),
        shareCard: track(v.shareCard, 'share', 'native'),
        copyCaption: track(v.copyCaption, 'caption'),
        openLinkedIn: track(v.openLinkedIn, 'share', 'linkedin'),
      };
    }
  };
}
