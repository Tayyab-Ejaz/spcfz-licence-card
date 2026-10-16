// Field mapping: turns whatever the ERP sends into the seven canonical keys and nothing else
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
  'issued_on',
  'preferred_language',
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
  issued_on: ['issued_on', 'issue_date', 'issued_at', 'licence_issue_date', 'license_issue_date', 'date_of_issue'],
  preferred_language: ['preferred_language', 'language', 'lang', 'locale', 'customer_language'],
};

/** Sub-fields read from an activity object, in order of preference. Compared after `normaliseKey`. */
const ACTIVITY_NAME_KEYS: readonly string[] = [
  'name_en', 'name', 'Description_EN', 'description', 'activity_name', 'activity', 'title',
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
export function unwrapActivity(value: unknown): unknown {
  let v: unknown = value;
  if (Array.isArray(v)) v = v.length > 0 ? (v as unknown[])[0] : undefined;
  if (isPlainObject(v)) {
    const index = normalisedIndex(v);
    for (const k of ACTIVITY_NAME_KEYS) {
      const hit = index.get(normaliseKey(k));
      if (!isBlank(hit)) return hit;
    }
    return undefined;
  }
  return v;
}

function candidateFor(key: CanonicalKey, raw: unknown): unknown {
  const v = key === 'activity_category' ? unwrapActivity(raw) : raw;
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

  for (const [path, key] of parseFieldMap(fieldMapJson)) {
    if (key in out) continue;
    const candidate = candidateFor(key, getPath(payload, path));
    if (candidate !== undefined) out[key] = candidate;
  }

  const index = normalisedIndex(payload);
  for (const key of CANONICAL_KEYS) {
    if (key in out) continue;
    for (const alias of ALIASES[key]) {
      const candidate = candidateFor(key, index.get(normaliseKey(alias)));
      if (candidate !== undefined) {
        out[key] = candidate;
        break;
      }
    }
  }

  return out;
}
