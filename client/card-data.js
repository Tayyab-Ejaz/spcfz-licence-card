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

/** A big diagonal "TEST" over a test card's export, so a staff test image can never pass for a real one. */
function addTestWatermark(node) {
  const mark = document.createElement('div');
  const w = node.offsetWidth || 1080;
  mark.setAttribute('aria-hidden', 'true');
  Object.assign(mark.style, {
    position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none', zIndex: '9999', fontFamily: 'var(--font-sans)', color: 'rgba(7,19,41,.16)', transform: 'rotate(-24deg)',
  });
  const big = document.createElement('div');
  Object.assign(big.style, { fontSize: `${Math.round(w * 0.26)}px`, fontWeight: '800', letterSpacing: '.08em', lineHeight: '1' });
  big.textContent = 'TEST';
  const small = document.createElement('div');
  Object.assign(small.style, { fontSize: `${Math.round(w * 0.028)}px`, fontWeight: '700', letterSpacing: '.12em', marginTop: `${Math.round(w * 0.02)}px` });
  small.textContent = 'TEST CARD · NOT A REAL LICENCE';
  mark.append(big, small);
  const restore = getComputedStyle(node).position === 'static' ? node.style.position : null;
  if (restore !== null) node.style.position = 'relative';
  node.appendChild(mark);
  return () => { mark.remove(); if (restore !== null) node.style.position = restore; };
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

    async renderCard(asBlob) {
      const node = this.cardRef.current;
      const undo = this.props.card.is_test && node ? addTestWatermark(node) : null;
      try {
        return await super.renderCard(asBlob);
      } finally {
        if (undo) undo();
      }
    }

    renderVals() {
      const v = super.renderVals();
      const c = this.props.card;
      const s = this.state;
      const ar = s.lang === 'ar';
      const D = dates(c.issued_on);
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
