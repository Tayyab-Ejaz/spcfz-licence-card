// The owner's referral link (24 November 2026): BASE_URL/r/<code> for the English caption, BASE_URL/r/<code>/ar for
// the Arabic one, which opens SPC's Arabic landing page. Nothing about the owner is in it. Pure; no I/O.
import type { Lang } from '../types.js';

export function referUrl(baseUrl: string, code: string | null | undefined, lang: Lang): string | null {
  if (!code || !/^https?:\/\//.test(baseUrl)) return null;
  return `${baseUrl.replace(/\/+$/, '')}/r/${code}${lang === 'ar' ? '/ar' : ''}`;
}
