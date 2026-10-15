const MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape for text nodes and double-quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}

/** Strip tags and collapse whitespace from untrusted free text before storing it. */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Tagged template that escapes interpolations unless wrapped in `raw()`. */
export class RawHtml {
  constructor(public readonly value: string) {}
  toString(): string {
    return this.value;
  }
}
export function raw(value: string): RawHtml {
  return new RawHtml(value);
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof RawHtml) out += v.value;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof RawHtml ? x.value : escapeHtml(x))).join('');
      else if (v !== null && v !== undefined && v !== false) out += escapeHtml(v);
    }
  });
  return out;
}

/** ASCII-only download filename: letters, digits and dashes. */
export function safeFilename(base: string, suffix: string): string {
  const ascii = base
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${ascii || 'spc-licensed'}-${suffix}`;
}
