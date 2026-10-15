// Small helpers shared by the intake module. Nothing here touches storage or the network.

/** undefined, null, or a string that is empty after trimming. */
export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** A non-null, non-array object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Case-insensitive key form that also ignores spaces, underscores and dashes,
 * so "License No", "licenseNo" and "license_no" all compare equal.
 */
export function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]+/g, '');
}
