const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, for ULIDs

/** 128 bits of randomness as 22 base62 characters. Never derived from any input (ARCHITECTURE C2). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

export const TOKEN_RE = /^[0-9A-Za-z]{22}$/;

/** Sortable 26-char ULID. */
export function ulid(now: number = Date.now()): string {
  let t = BigInt(now);
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = BASE32[Number(t % 32n)] + time;
    t /= 32n;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = BASE32[Number(n % 32n)] + rand;
    n /= 32n;
  }
  return time + rand;
}

/** 48 random characters from a cryptographic source, for webhook secrets. */
export function randomSecret(length = 48): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += BASE62[b % 62];
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string equality. Both sides are hashed first so differing
 * lengths leak nothing, then compared with the platform primitive.
 */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/** Stable hash of the canonical fields, used for idempotency (ARCHITECTURE section 4). */
export async function contentHash(fields: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(fields).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, fields[k] ?? null]));
  return sha256Hex(canonical);
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(bin);
}
