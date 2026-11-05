// Captions for LinkedIn posts: the default one (the studio's Warm caption, ./captions.ts, shared with the studio),
// and the conversion of any caption into LinkedIn's "little text" format, where "@SPC Free Zone" becomes a real
// mention of SPC's company page and hashtags become LinkedIn hashtags.
import type { CardRow, Lang } from '../types.js';
import { captionFor } from './captions.js';

export { REFER_LINE } from './captions.js';

/**
 * The caption the studio suggests first (Warm; "you and your company", or "the company" when the licence names no
 * founder), for posts started from the welcome email. The role is the studio's default, Founder.
 */
export function defaultCaption(card: Pick<CardRow, 'company_name_en' | 'company_name_ar' | 'activity_category' | 'activity_category_ar' | 'founder_name_en'>, lang: Lang): string {
  const ar = lang === 'ar';
  return captionFor({
    lang,
    tone: 'warm',
    focus: card.founder_name_en ? 'both' : 'company',
    company: ar ? card.company_name_ar || card.company_name_en : card.company_name_en,
    role: ar ? 'المؤسس' : 'Founder',
    activity: (ar ? card.activity_category_ar : card.activity_category) ?? '',
  });
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
