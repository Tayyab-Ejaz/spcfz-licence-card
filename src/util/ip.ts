/** Parse the ERP_IP_ALLOWLIST var: comma, space or newline separated. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** Exact IPv4/IPv6 match, or IPv4 CIDR containment. An empty allowlist allows nothing. */
export function ipAllowed(ip: string | undefined | null, allowlist: string[]): boolean {
  if (!ip || allowlist.length === 0) return false;
  const needle = ip.trim().toLowerCase();
  for (const entry of allowlist) {
    if (entry === needle) return true;
    const slash = entry.indexOf('/');
    if (slash > 0) {
      const base = ipv4ToInt(entry.slice(0, slash));
      const bits = Number(entry.slice(slash + 1));
      const target = ipv4ToInt(needle);
      if (base === null || target === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((base & mask) >>> 0 === (target & mask) >>> 0) return true;
    }
  }
  return false;
}

/**
 * The key a rate limiter counts under. IPv4: the address. IPv6: its /64 prefix, because a single
 * connection is normally handed a whole /64 and could otherwise rotate addresses to dodge per-address
 * limits. IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as the IPv4 address. Unparseable input is returned as is.
 */
export function rateKeyForIp(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!s.includes(':')) return s;
  const mapped = s.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/) ?? s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return mapped[1];
  const halves = s.split('::');
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return s;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
