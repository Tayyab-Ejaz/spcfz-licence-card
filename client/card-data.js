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

export function withCardData(Base) {
  return class CardLogic extends Base {
    fresh() {
      const f = super.fresh();
      const c = this.props.card;
      return {
        ...f,
        company: c.company_en,
        name: c.name_en || '', role: c.role_en || '',
        activity: c.activity_en || '',
        lang: c.lang === 'ar' ? 'ar' : 'en',
        photo: null, photoNote: '',
        ar: { company: c.company_ar || c.company_en, name: c.name_ar || '', role: c.role_ar || '', activity: c.activity_ar || '' },
      };
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
