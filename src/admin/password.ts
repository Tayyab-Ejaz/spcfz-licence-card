// Password hashing for staff accounts: scrypt from node:crypto, a fresh 16-byte salt per password, parameters
// stored with the hash so they can be raised later without breaking existing accounts.
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const N = 32768; // 2^15: about 0.1 s and 32 MB per check
const R = 8;
const P = 1;
const KEY_LEN = 64;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

function scrypt(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const maxmem = (n: number, r: number): number => 256 * n * r;

/** A problem with a proposed password, or null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `use at most ${MAX_PASSWORD_LENGTH} characters`;
  if (password.trim() !== password) return 'no spaces at the start or end';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length < 8 || expected.length < 32) return false;
  const key = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: maxmem(n, r) });
  return timingSafeEqual(key, expected);
}

let dummy: Promise<string> | null = null;
/**
 * Spend the same time as a real check when the email is unknown, so response timing does not reveal which
 * addresses have accounts.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('not a real account password');
  await verifyPassword(password, await dummy);
}
