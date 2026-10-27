// Validation and normalisation of the mapped fields (ARCHITECTURE section 4, table "Field mapping"). Pure; no I/O.
import type { CanonicalFields, Lang } from '../types.js';
import { stripHtml } from '../util/html.js';
import { parseDate, todayInDubai } from '../util/time.js';
import { isBlank } from './common.js';

export type ValidationResult = { ok: true; fields: CanonicalFields } | { ok: false; errors: string[] };

export const LIMITS = {
  licence_number: { min: 3, max: 40 },
  company_name_en: { min: 2, max: 120 },
  company_name_ar: { max: 120 },
  licence_type: { max: 60 },
  activity_category: { max: 80 },
  activity_category_ar: { max: 80 },
  // Generous: a long legal name must not reject the licence. The studio shortens it for the card.
  founder_name_en: { max: 120 },
  founder_name_ar: { max: 120 },
} as const;

/** Strings and finite numbers are text; everything else is not. */
function asText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Optional free text: blank -> null; non-text -> error; HTML stripped and whitespace collapsed;
 * over the limit -> error (the value is still returned so the caller can keep collecting errors).
 */
function optionalText(input: Record<string, unknown>, key: string, max: number, errors: string[]): string | null {
  const v = input[key];
  if (isBlank(v)) return null;
  const text = asText(v);
  if (text === null) {
    errors.push(`${key}: must be text`);
    return null;
  }
  const clean = stripHtml(text);
  if (clean === '') return null;
  if (clean.length > max) errors.push(`${key}: must be at most ${max} characters`);
  return clean;
}

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[A-Za-z]{2,}$/;

/** Optional email address: blank -> null; trimmed and lower-cased; one address, at most 254 characters. */
function optionalEmail(input: Record<string, unknown>, key: string, errors: string[]): string | null {
  const v = input[key];
  if (isBlank(v)) return null;
  if (typeof v !== 'string') {
    errors.push(`${key}: must be an email address`);
    return null;
  }
  const s = v.trim().toLowerCase().replace(/^mailto:/, '');
  if (s.length > 254 || !EMAIL_RE.test(s)) {
    errors.push(`${key}: must be one valid email address`);
    return null;
  }
  return s;
}

/** en / ar in the forms an ERP is likely to send; null when unrecognised. */
export function normaliseLanguage(v: unknown): Lang | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === '') return null;
  if (s === 'en' || s === 'eng' || s === 'english' || s.startsWith('en-') || s.startsWith('en_')) return 'en';
  if (s === 'ar' || s === 'ara' || s === 'arabic' || s.startsWith('ar-') || s.startsWith('ar_')) return 'ar';
  if (s === 'عربي' || s === 'عربية' || s === 'العربية') return 'ar';
  if (s === 'إنجليزي' || s === 'انجليزي' || s === 'الإنجليزية' || s === 'الانجليزية') return 'en';
  return null;
}

/**
 * Validate the mapped fields and produce the canonical record. Every error is collected;
 * nothing stops at the first one. Messages name the field, e.g. "licence_number: required".
 */
export function validateCanonical(input: Record<string, unknown>, opts: { today?: string } = {}): ValidationResult {
  const errors: string[] = [];

  // licence_number: required, text or number, trimmed, internal whitespace collapsed, uppercased, 3..40.
  let licence_number = '';
  const rawLicence = input['licence_number'];
  if (isBlank(rawLicence)) {
    errors.push('licence_number: required');
  } else {
    const text = asText(rawLicence);
    if (text === null) {
      errors.push('licence_number: must be text');
    } else {
      licence_number = text.trim().replace(/\s+/g, ' ').toUpperCase();
      const { min, max } = LIMITS.licence_number;
      if (licence_number.length < min || licence_number.length > max) {
        errors.push(`licence_number: must be ${min} to ${max} characters`);
      }
    }
  }

  // company_name_en: required, HTML stripped, 2..120.
  let company_name_en = '';
  const rawName = input['company_name_en'];
  if (isBlank(rawName)) {
    errors.push('company_name_en: required');
  } else {
    const text = asText(rawName);
    if (text === null) {
      errors.push('company_name_en: must be text');
    } else {
      company_name_en = stripHtml(text);
      const { min, max } = LIMITS.company_name_en;
      if (company_name_en === '') errors.push('company_name_en: required');
      else if (company_name_en.length < min || company_name_en.length > max) {
        errors.push(`company_name_en: must be ${min} to ${max} characters`);
      }
    }
  }

  const company_name_ar = optionalText(input, 'company_name_ar', LIMITS.company_name_ar.max, errors);
  const licence_type = optionalText(input, 'licence_type', LIMITS.licence_type.max, errors);
  const activity_category = optionalText(input, 'activity_category', LIMITS.activity_category.max, errors);
  const activity_category_ar = optionalText(input, 'activity_category_ar', LIMITS.activity_category_ar.max, errors);
  const founder_name_en = optionalText(input, 'founder_name_en', LIMITS.founder_name_en.max, errors);
  const founder_name_ar = optionalText(input, 'founder_name_ar', LIMITS.founder_name_ar.max, errors);

  // issued_on: optional, any date parseDate accepts, default today in Asia/Dubai.
  let issued_on = opts.today ?? todayInDubai();
  const rawIssued = input['issued_on'];
  if (!isBlank(rawIssued)) {
    const parsed = parseDate(rawIssued);
    if (parsed === null) errors.push('issued_on: unrecognised date');
    else issued_on = parsed;
  }

  // licence_expires_on: optional; the card expires after this day. Never before the issue date.
  let licence_expires_on: string | null = null;
  const rawExpiry = input['licence_expires_on'];
  if (!isBlank(rawExpiry)) {
    const parsed = parseDate(rawExpiry);
    if (parsed === null) errors.push('licence_expires_on: unrecognised date');
    else if (parsed < issued_on) errors.push('licence_expires_on: before issued_on');
    else licence_expires_on = parsed;
  }

  // customer_email, cc_email: optional; where the welcome email goes, and an optional copy.
  const customer_email = optionalEmail(input, 'customer_email', errors);
  const cc_email = optionalEmail(input, 'cc_email', errors);

  // preferred_language: optional, en or ar in any common spelling, default en.
  let preferred_language: Lang = 'en';
  const rawLang = input['preferred_language'];
  if (!isBlank(rawLang)) {
    const lang = normaliseLanguage(rawLang);
    if (lang === null) errors.push('preferred_language: must be en or ar');
    else preferred_language = lang;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      licence_number,
      company_name_en,
      company_name_ar,
      licence_type,
      activity_category,
      activity_category_ar,
      founder_name_en,
      founder_name_ar,
      issued_on,
      preferred_language,
      licence_expires_on,
      customer_email,
      cc_email,
    },
  };
}
