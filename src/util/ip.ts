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
