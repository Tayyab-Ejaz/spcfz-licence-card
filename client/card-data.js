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

const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const frameEl = () => document.querySelector('.m-frame');

export function withCardData(Base) {
  return class CardLogic extends Base {
    constructor(...args) {
      super(...args);
      // Phone layout: let the drawer slide down before it is removed (the design removes it at once).
      if (typeof this.closeSheet === 'function') {
        const close = this.closeSheet;
        this.closeSheet = () => this.closeSheetSmoothly(close);
      }
    }

    /**
     * Opening or closing the drawer moves and resizes the card preview in one render. Note where the frame was,
     * switch its own size transition off for this change, and let componentDidUpdate glide it from there (FLIP).
     */
    setState(update, cb) {
      if (update && typeof update === 'object' && 'sheet' in update && !!update.sheet !== !!this.state.sheet) {
        const frame = frameEl();
        if (frame && !reducedMotion()) {
          this.flipFrom = frame.getBoundingClientRect();
          this.flipTransition = this.flipTransition ?? frame.style.transition;
          frame.style.transition = 'none';
          const card = frame.querySelector('[data-lang]');
          if (card) card.style.transition = 'none';
        }
      }
      return super.setState(update, cb);
    }

    /**
     * Phone layout: a tap outside the open drawer closes it, the way a bottom sheet should. The tap is absorbed so
     * it does not also follow a link or press a button underneath. While the photo is being adjusted, touches on
     * the card frame stay with the card (drag to move, pinch to zoom).
     */
    watchOutsideTaps() {
      const open = !!this.state.sheet;
      if (open && !this.outsideTap) {
        this.outsideTap = (ev) => {
          const t = ev.target instanceof Element ? ev.target : null;
          if (!t || !this.state.sheet || t.closest('[data-screen-label="Sheet"]')) return;
          if (t.closest('.m-frame') && typeof this.isAdjusting === 'function' && this.isAdjusting()) return;
          const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
          document.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
          this.closeSheet();
        };
        document.addEventListener('pointerdown', this.outsideTap, true);
      } else if (!open && this.outsideTap) {
        document.removeEventListener('pointerdown', this.outsideTap, true);
        this.outsideTap = null;
      }
    }

    componentWillUnmount() {
      if (this.outsideTap) document.removeEventListener('pointerdown', this.outsideTap, true);
      this.outsideTap = null;
      if (super.componentWillUnmount) super.componentWillUnmount();
    }

    /**
     * Desktop only (SPC, 18 October 2026): in the Details step, Next walks through its four parts in order (who it
     * is about, photo, details, headline) and only the last one leads to Share; Back walks back the same way. A
     * part with a problem (rejected wording in the details or a custom headline) stops Next with the design's own
     * toast, as that part's Done does. The phone layout has no steps and keeps the design's behaviour.
     */
    detailsNav(v) {
      if (v.mChips || !v.sq || typeof v.next !== 'function') return {};
      const s = this.state;
      if (s.step === 2) {
        // Back from Share lands on the last part, so Back keeps walking through the parts.
        return { back: () => { v.back(); clearTimeout(this.subT); this.setState({ sub: 3 }); this.partScroll = 3; this.scrollToPart(); } };
      }
      if (s.step === 0) {
        // Into Details: bring the part that opens on screen (the panel can sit below the card on narrow windows).
        return { next: () => { v.next(); if (this.state.step === 1) { this.partScroll = typeof this.state.sub === 'number' ? this.state.sub : 0; this.scrollToPart(); } } };
      }
      if (s.step !== 1) return {};
      const LABELS = ['Next: Photo', 'Next: Your details', 'Next: Headline', 'Next: Share'];
      const i = typeof s.sub === 'number' ? s.sub : null;
      const blocked = (k) => {
        const e = this.cardIssues();
        return (k === 2 && (e.name || e.role || e.activity)) || (k === 3 && e.headline);
      };
      const open = (k, doneK) => {
        clearTimeout(this.subT);
        this.partScroll = k;
        this.setState((st) => ({ sub: k, subDone: doneK === undefined ? st.subDone : Array.from(new Set([...st.subDone, doneK])) }));
      };
      return {
        nextLabel: i === null ? 'Next: Share' : LABELS[i],
        next: () => {
          if (i === null) { v.next(); return; }
          if (blocked(i)) { this.showToast('Please fix the highlighted text first.'); return; }
          if (i < 3) { open(i + 1, i); return; }
          open(null, 3);
          v.next();
        },
        back: () => {
          if (i !== null && i > 0) { open(i - 1); return; }
          v.back();
        },
      };
    }

    /** After Next or Back opens a part: bring it on screen if it is not, e.g. when the panel sits below the card. */
    scrollToPart() {
      const k = this.partScroll;
      this.partScroll = null;
      if (typeof k !== 'number' || this.state.step !== 1) return;
      requestAnimationFrame(() => {
        const input = document.querySelector('input[type=file]');
        const part = input && input.nextElementSibling && input.nextElementSibling.children[k];
        if (!part) return;
        const r = part.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= window.innerHeight) return;
        part.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: r.height > window.innerHeight * 0.8 ? 'start' : 'nearest' });
      });
    }

    closeSheetSmoothly(close) {
      if (this.sheetClosing) return;
      const s = this.state;
      const e = typeof this.cardIssues === 'function' ? this.cardIssues() : {};
      const blocked = (s.sheet === 'headline' && e.headline) || (s.sheet === 'details' && (e.name || e.role || e.activity));
      const sheet = document.querySelector('[data-screen-label="Sheet"]');
      if (blocked || !sheet || reducedMotion()) { close(); return; }
      this.sheetClosing = true;
      sheet.classList.add('m-closing');
      setTimeout(() => { this.sheetClosing = false; close(); }, 240);
    }

    /** After a render: glide the frame from where it was (drawer toggled), or soften a style/format/language swap. */
    animateFrame(prevState) {
      const frame = frameEl();
      if (!frame) return;
      if (this.flipFrom) {
        const from = this.flipFrom;
        this.flipFrom = null;
        const to = frame.getBoundingClientRect();
        this.flipping = true;
        const restore = () => {
          this.flipping = false;
          frame.style.transition = this.flipTransition ?? '';
          const card = frame.querySelector('[data-lang]');
          if (card) card.style.transition = 'transform .25s var(--ease-standard)';
          this.flipTransition = null;
        };
        if (!to.width || !to.height) { restore(); return; }
        const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = from.height / to.height;
        const anim = frame.animate(
          [{ transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transformOrigin: '0 0', transform: 'none' }],
          { duration: 340, easing: EASE_OUT },
        );
        anim.onfinish = anim.oncancel = () => { restore(); this.fitChrome(); };
        return;
      }
      if (!prevState || reducedMotion()) return;
      if (prevState.tpl !== this.state.tpl || prevState.format !== this.state.format || prevState.lang !== this.state.lang) {
        frame.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      }
    }

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
      this.fitChrome();
      if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { this.forceUpdate(); this.fitStub(); });
    }

    componentDidUpdate(...args) {
      super.componentDidUpdate(...args);
      this.fitStub();
      this.fitChrome();
      this.animateFrame(args[1]);
      this.watchOutsideTaps();
      this.scrollToPart();
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
    /**
     * Phone layout only: how much height the page needs besides the card preview (header, headline, format
     * switch, style switcher, toolbar, Share bar), so the patched logic sizes the card to leave all of it on
     * screen. Measured rather than assumed: a long company name wraps the headline onto more lines. The
     * value does not depend on the card's own size, so setting it settles after one render.
     */
    fitChrome() {
      if (this.state.sheet || this.flipping) return;   // mid-glide the frame is transformed; measure once it lands
      const tools = document.querySelector('.m-chips');
      const bar = document.querySelector('.m-bar');
      const card = document.querySelector('[data-lang]');
      const section = card && card.closest('section');
      if (!tools || !bar || !section) return;
      let stage = card;
      while (stage.parentElement && stage.parentElement !== section) stage = stage.parentElement;
      const st = stage.getBoundingClientRect();
      const sec = section.getBoundingClientRect();
      if (!st.height) return;
      const chrome = Math.round(st.top + window.scrollY + (sec.bottom - st.bottom) + tools.getBoundingClientRect().height + bar.getBoundingClientRect().height);
      if (Math.abs(chrome - (this.state.chromeH || 0)) > 1) this.setState({ chromeH: chrome });
    }

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
        // Desktop Share step intro (tools/build-studio.mjs DESKTOP_SHARE_ACTIONS); the phone layout does not use it.
        shareIntro: v.canShare
          ? 'Share your card to LinkedIn, WhatsApp or any app, or download it to post later. Your caption is below.'
          : 'Download your card and post it anywhere, with the caption below.',
        portalUrl: PORTAL_URL,
        goPortal: () => window.location.assign(PORTAL_URL),
        ...this.detailsNav(v),
        download: track(v.download, 'download'),
        shareCard: track(v.shareCard, 'share', 'native'),
        copyCaption: track(v.copyCaption, 'caption'),
        openLinkedIn: track(v.openLinkedIn, 'share', 'linkedin'),
      };
    }
  };
}
