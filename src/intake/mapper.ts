// Field mapping: turns whatever the ERP sends into the thirteen canonical keys and nothing else
// (ARCHITECTURE section 4 "Field mapping", C5, C6). Pure; no I/O.
import type { CanonicalFields } from '../types.js';
import { isBlank, isPlainObject, normaliseKey } from './common.js';

export type CanonicalKey = keyof CanonicalFields;

/** The only keys that may leave this module. Order is the precedence used when aliases compete. */
export const CANONICAL_KEYS: readonly CanonicalKey[] = [
  'licence_number',
  'company_name_en',
  'company_name_ar',
  'licence_type',
  'activity_category',
  'activity_category_ar',
  'founder_name_en',
  'founder_name_ar',
  'issued_on',
  'preferred_language',
  'licence_expires_on',
  'customer_email',
  'cc_email',
];

/**
 * Built-in aliases so an empty FIELD_MAP still works for common ERP names.
 * Matched on top-level payload keys after `normaliseKey`, so case, spaces,
 * underscores and dashes do not matter. Earlier entries win.
 */
const ALIASES: Readonly<Record<CanonicalKey, readonly string[]>> = {
  licence_number: [
    'licence_number', 'license_number', 'licenseNo', 'licence_no', 'LicenseNumber', 'license', 'licence',
    'trade_license_number', 'trade_licence_number', 'tl_number',
  ],
  company_name_en: [
    'company_name_en', 'company_name', 'company', 'name_en', 'legal_name', 'company_name_english', 'CompanyNameEn',
  ],
  company_name_ar: ['company_name_ar', 'company_name_arabic', 'name_ar', 'arabic_name', 'CompanyNameAr'],
  licence_type: ['licence_type', 'license_type', 'type', 'licence_category', 'license_category'],
  activity_category: ['activity_category', 'activity', 'activities', 'business_activity', 'activity_name', 'category'],
  activity_category_ar: ['activity_category_ar', 'activity_ar', 'activity_name_ar', 'business_activity_ar', 'category_ar'],
  founder_name_en: [
    'founder_name_en', 'founder_name', 'founder', 'owner_name_en', 'owner_name', 'owner', 'founder_name_english',
    'shareholder_name', 'shareholders', 'investor_name', 'manager_name', 'FounderName', 'OwnerName',
  ],
  founder_name_ar: ['founder_name_ar', 'founder_name_arabic', 'owner_name_ar', 'founder_ar', 'owner_ar', 'FounderNameAr', 'OwnerNameAr'],
  issued_on: ['issued_on', 'issue_date', 'issued_at', 'licence_issue_date', 'license_issue_date', 'date_of_issue'],
  preferred_language: ['preferred_language', 'language', 'lang', 'locale', 'customer_language'],
  licence_expires_on: [
    'licence_expires_on', 'license_expires_on', 'licence_expiry_date', 'license_expiry_date', 'licence_expiry', 'license_expiry',
    'expiry_date', 'expiration_date', 'expires_on', 'expiry', 'valid_until', 'valid_to', 'LicenseExpiryDate', 'ExpiryDate',
  ],
  customer_email: [
    'customer_email', 'email', 'email_address', 'contact_email', 'owner_email', 'founder_email', 'applicant_email',
    'client_email', 'investor_email', 'EmailAddress', 'CustomerEmail', 'ContactEmail',
  ],
  cc_email: ['cc_email', 'cc', 'account_manager_email', 'relationship_manager_email', 'rm_email', 'agent_email', 'sales_email'],
};

/** Sub-fields read from an activity object, in order of preference. Compared after `normaliseKey`. */
const ACTIVITY_NAME_KEYS: readonly string[] = [
  'name_en', 'name', 'Description_EN', 'description', 'activity_name', 'activity', 'title',
];

/** Arabic sub-fields of the same activity object. Never falls back to the English keys above. */
const ACTIVITY_NAME_AR_KEYS: readonly string[] = [
  'name_ar', 'Description_AR', 'description_ar', 'activity_name_ar', 'title_ar',
];

/** A founder/owner sent as an object (or a list of shareholders): the name fields to read, in order. */
const PERSON_NAME_KEYS: readonly string[] = ['name_en', 'full_name_en', 'full_name', 'name', 'english_name', 'display_name'];
const PERSON_NAME_AR_KEYS: readonly string[] = ['name_ar', 'full_name_ar', 'arabic_name'];
/** The email inside the same owner/founder object, when the ERP sends no top-level email. */
const PERSON_EMAIL_KEYS: readonly string[] = ['email', 'email_address', 'emailAddress', 'contact_email'];

/** Canonical keys whose value may arrive as an object or list, with the sub-fields to read. */
const NAMED: Partial<Record<CanonicalKey, readonly string[]>> = {
  activity_category: ACTIVITY_NAME_KEYS,
  activity_category_ar: ACTIVITY_NAME_AR_KEYS,
  founder_name_en: PERSON_NAME_KEYS,
  founder_name_ar: PERSON_NAME_AR_KEYS,
};
/** English key -> its Arabic sibling, read from the same object when no Arabic field is sent. */
const SIBLINGS: ReadonlyArray<[CanonicalKey, CanonicalKey, readonly string[]]> = [
  ['activity_category', 'activity_category_ar', ACTIVITY_NAME_AR_KEYS],
  ['founder_name_en', 'founder_name_ar', PERSON_NAME_AR_KEYS],
  ['founder_name_en', 'customer_email', PERSON_EMAIL_KEYS],
];

/** normalised alias -> canonical key, built once. The canonical names themselves are included. */
const ALIAS_INDEX: ReadonlyMap<string, CanonicalKey> = (() => {
  const m = new Map<string, CanonicalKey>();
  for (const key of CANONICAL_KEYS) {
    for (const alias of ALIASES[key]) {
      const n = normaliseKey(alias);
      if (!m.has(n)) m.set(n, key);
    }
  }
  return m;
})();

export function isCanonicalKey(v: unknown): v is CanonicalKey {
  return typeof v === 'string' && (CANONICAL_KEYS as readonly string[]).includes(v);
}

/** Resolve a configured target name to a canonical key: exact, or through the alias table. */
function resolveCanonical(target: unknown): CanonicalKey | null {
  if (isCanonicalKey(target)) return target;
  if (typeof target !== 'string') return null;
  return ALIAS_INDEX.get(normaliseKey(target)) ?? null;
}

/** Parse the FIELD_MAP var. Invalid JSON, a non-object, or entries with unknown targets are ignored. */
export function parseFieldMap(fieldMapJson: string): Array<[path: string, key: CanonicalKey]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fieldMapJson);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  const out: Array<[string, CanonicalKey]> = [];
  for (const [path, target] of Object.entries(parsed)) {
    const key = resolveCanonical(target);
    if (key && path.trim() !== '') out.push([path.trim(), key]);
  }
  return out;
}

/**
 * Read a value by literal key first, then by dotted path. Numeric segments index arrays.
 * Returns undefined when any step is missing.
 */
export function getPath(obj: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (seg === '') return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg)) return undefined;
      cur = cur[Number(seg)];
    } else if (isPlainObject(cur)) {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = cur[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Own keys of an object indexed by their normalised form. The first key to claim a form wins. */
function normalisedIndex(obj: Record<string, unknown>): Map<string, unknown> {
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const n = normaliseKey(k);
    if (!index.has(n)) index.set(n, v);
  }
  return index;
}

/**
 * The ERP may send the activity as a list, or as an object, or as a list of objects.
 * Take the first list item; from an object take the first of the known name fields.
 * Scalars pass through untouched; anything else comes back undefined.
 */
export function unwrapActivity(value: unknown, nameKeys: readonly string[] = ACTIVITY_NAME_KEYS): unknown {
  let v: unknown = value;
  if (Array.isArray(v)) v = v.length > 0 ? (v as unknown[])[0] : undefined;
  if (isPlainObject(v)) {
    const index = normalisedIndex(v);
    for (const k of nameKeys) {
      const hit = index.get(normaliseKey(k));
      if (!isBlank(hit)) return hit;
    }
    return undefined;
  }
  return v;
}

function candidateFor(key: CanonicalKey, raw: unknown): unknown {
  const keys = NAMED[key];
  const v = keys ? unwrapActivity(raw, keys) : raw;
  return isBlank(v) ? undefined : v;
}

/**
 * Map a parsed ERP payload to the canonical keys.
 *
 * 1. Apply FIELD_MAP: `{ "<erp field or dotted.path>": "<canonical name>" }`. Invalid JSON = empty map.
 * 2. Fill any canonical key still missing from the built-in alias table (top-level keys only).
 *
 * Blank values (undefined, null, whitespace-only) never count as found, so a later source may fill the key.
 * The result holds only canonical keys that were found; every other field is dropped on the floor (C6).
 */
export function mapPayload(payload: unknown, fieldMapJson: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(payload)) return out;

  // The raw value each English field came from: its Arabic sibling (e.g. Description_AR) is read from it.
  const sources = new Map<CanonicalKey, unknown>();

  for (const [path, key] of parseFieldMap(fieldMapJson)) {
    if (key in out) continue;
    const raw = getPath(payload, path);
    const candidate = candidateFor(key, raw);
    if (candidate !== undefined) {
      out[key] = candidate;
      sources.set(key, raw);
    }
  }

  const index = normalisedIndex(payload);
  for (const key of CANONICAL_KEYS) {
    if (key in out) continue;
    for (const alias of ALIASES[key]) {
      const raw = index.get(normaliseKey(alias));
      const candidate = candidateFor(key, raw);
      if (candidate !== undefined) {
        out[key] = candidate;
        sources.set(key, raw);
        break;
      }
    }
  }

  // Only an object can carry an Arabic sibling; a plain name (or a list of names) has none.
  for (const [en, ar, keys] of SIBLINGS) {
    const src = sources.get(en);
    if (ar in out || src === undefined) continue;
    const first: unknown = Array.isArray(src) ? (src as unknown[])[0] : src;
    if (isPlainObject(first)) {
      const v = unwrapActivity(first, keys);
      if (!isBlank(v)) out[ar] = v;
    }
  }

  return out;
}
