// The owner's referral code (24 November 2026). Seven characters a person can read back without mixing them up:
// digits 2-9 and capitals without I, L and O (31 symbols, about 27.5 billion codes), so a code cannot be guessed and
// the link stays short: licensed.spcfz.ae/r/K7Q2MXA. Pure; no I/O.

export const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REF_LENGTH = 7;
export const REF_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/;

/** A new random code (crypto.getRandomValues, with rejection sampling so every symbol is equally likely). */
export function newRefCode(): string {
  const out: string[] = [];
  const limit = 256 - (256 % REF_ALPHABET.length);
  while (out.length < REF_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      if (b < limit && out.length < REF_LENGTH) out.push(REF_ALPHABET[b % REF_ALPHABET.length] as string);
    }
  }
  return out.join('');
}

/** The code as typed in a link (any case, stray spaces), or null when it cannot be one. */
export function readRefCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return REF_CODE_RE.test(s) ? s : null;
}
