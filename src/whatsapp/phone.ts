// Mobile numbers for the welcome WhatsApp message. The ERP and staff type numbers in every shape (050 123 4567,
// +971 (0) 50…, 00971…, 971…, +91 98765 43210); libphonenumber-js reads them, with the UAE as the home country.
// Only numbers that can be a mobile are kept: a landline cannot receive WhatsApp. Pure; no I/O.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

const MOBILE_TYPES = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE']);

/** Arabic-Indic and Persian digits as ASCII, so "٠٥٠١٢٣٤٥٦٧" reads like "0501234567". */
function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function mobile(text: string): string | null {
  const p = parsePhoneNumberFromString(text, 'AE');
  if (!p || !p.isValid()) return null;
  const type = p.getType();
  return type && MOBILE_TYPES.has(type) ? p.number : null;
}

/**
 * The number in international form (+971501234567), or null when it is not a mobile number we can place.
 * A number without + or 00 is read as a UAE number first, then as an international number missing its +
 * (919876543210). A local number from another country (0300 1234567) is refused: its country cannot be known.
 */
export function normalisePhone(v: unknown): string | null {
  const raw = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : null;
  if (raw === null) return null;
  const s = asciiDigits(raw).trim().replace(/^(tel|whatsapp|wa):/i, '').replace(/[‎‏‪-‮]/g, '');
  if (!/\d/.test(s) || s.length > 40) return null;
  const compact = s.replace(/[\s\-().\/]/g, '');
  const intl = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  const found = mobile(intl);
  if (found) return found;
  if (/^[1-9]\d{7,14}$/.test(intl)) return mobile(`+${intl}`);
  return null;
}

/** For WhatsApp providers that want digits only (Gallabox: 971501234567). */
export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** +971 50 123 4567, for people to read. */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

/** A comma or space separated list of numbers (the test-number setting): the usable ones and the rest. */
export function parsePhoneList(text: string | null | undefined): { phones: string[]; bad: string[] } {
  const phones: string[] = [];
  const bad: string[] = [];
  for (const part of (text ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const n = normalisePhone(part);
    if (n) { if (!phones.includes(n)) phones.push(n); } else bad.push(part);
  }
  return { phones, bad };
}
