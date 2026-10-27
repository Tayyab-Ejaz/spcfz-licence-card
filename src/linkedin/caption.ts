// Captions for LinkedIn posts: the default one (the studio's "warm" caption, client logic autoCaption), and the
// conversion of any caption into LinkedIn's "little text" format, where "@SPC Free Zone" becomes a real mention of
// SPC's company page and hashtags become LinkedIn hashtags.
import type { CardRow, Lang } from '../types.js';

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** The caption the studio writes by default (tone "warm"; "you and your company", or "the company" without a founder). */
export function defaultCaption(card: Pick<CardRow, 'company_name_en' | 'company_name_ar' | 'activity_category' | 'activity_category_ar' | 'founder_name_en'>, lang: Lang): string {
  const person = Boolean(card.founder_name_en);
  if (lang === 'ar') {
    const co = card.company_name_ar || card.company_name_en;
    const a = card.activity_category_ar || '';
    const body = person
      ? `خبر سعيد: أصبحت ${co} شركة مرخّصة رسمياً.\n\n${a ? `سنركّز على ${a}، وأشكر كل من ساعدنا على الوصول إلى اليوم الأول.` : 'أشكر كل من ساعدنا على الوصول إلى اليوم الأول.'}`
      : `أصبحنا شركة مرخّصة رسمياً. ${co} تفتح أبوابها للأعمال${a ? `، مع التركيز على ${a}` : ''}.\n\nشكراً لكل من ساعدنا على الوصول إلى اليوم الأول.`;
    return `${body}\n\nبترخيص من @SPC Free Zone في الشارقة.\n\n#مشروع_جديد #SPCFreeZone`;
  }
  const co = card.company_name_en;
  const a = lowerFirst(card.activity_category ?? '');
  const body = person
    ? `Some personal news: ${co} is now officially licensed.\n\n${a ? `We'll be focusing on ${a}, and I'm grateful to everyone who helped us reach day one.` : "I'm grateful to everyone who helped us reach day one."}`
    : `We're now officially licensed. ${co} is open for business${a ? `, focusing on ${a}` : ''}.\n\nThank you to everyone who helped us reach day one.`;
  return `${body}\n\nLicensed with @SPC Free Zone, Sharjah.\n\n#NewBusiness #SPCFreeZone`;
}

/** LinkedIn's reserved characters in little text; each is escaped with a backslash. */
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
const escapeLittle = (s: string): string => s.replace(RESERVED, (ch) => `\\${ch}`);

/** urn:li:organization:<id> from either form; null when unusable. */
export function orgUrn(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (/^\d{1,20}$/.test(v)) return `urn:li:organization:${v}`;
  return /^urn:li:organization:\d{1,20}$/.test(v) ? v : null;
}

const TOKEN = /(@SPC Free Zone)|#([\p{L}\p{N}_]+)/gu;

/**
 * The caption as LinkedIn little text. "@SPC Free Zone" becomes a mention of `org` when given (else plain text);
 * "#Word" becomes a hashtag; everything else is escaped so it shows exactly as typed.
 */
export function toLittleText(caption: string, org: string | null): string {
  let out = '';
  let last = 0;
  for (const m of caption.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    out += escapeLittle(caption.slice(last, at));
    if (m[1]) out += org ? `@[SPC Free Zone](${org})` : escapeLittle(m[1]);
    else out += `{hashtag|\\#|${escapeLittle(m[2] ?? '')}}`;
    last = at + m[0].length;
  }
  return out + escapeLittle(caption.slice(last));
}
