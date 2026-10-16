import type { Lang } from '../types.js';

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/** YYYY-MM-DD for the current day in Asia/Dubai. */
export function todayInDubai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Accepts ISO dates, ISO datetimes, DD/MM/YYYY, DD-MM-YYYY and "15 Oct 2026"
 * style strings. Returns YYYY-MM-DD or null. Ambiguous DD/MM vs MM/DD is read
 * as day first, which is the UAE convention.
 */
export function parseDate(input: unknown): string | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString().slice(0, 10);
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) return validYmd(iso[1]!, iso[2]!, iso[3]!);
  const dmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) return validYmd(dmy[3]!, dmy[2]!.padStart(2, '0'), dmy[1]!.padStart(2, '0'));
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function validYmd(y: string, m: string, d: string): string | null {
  const ymd = `${y}-${m}-${d}`;
  if (!ISO_DATE.test(ymd)) return null;
  const date = new Date(`${ymd}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === ymd ? ymd : null;
}

/** "October 2026" / "أكتوبر 2026" (Latin digits in both languages, per DESIGN-HANDOFF). */
export function formatMonthYear(ymd: string, lang: Lang): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const locale = lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}
