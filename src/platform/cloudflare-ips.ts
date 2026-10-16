// Cloudflare's published IP ranges (docs/PORT-TO-NODE.md section 5). Fetched at startup from
// www.cloudflare.com, cached under DATA_DIR, with a bundled copy so tests and offline starts work.
// The same list, as text, lives in deploy/cloudflare-ips.txt for the web server's allow rule.
import { BlockList, isIP } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const CLOUDFLARE_IPS_V4_URL = 'https://www.cloudflare.com/ips-v4/';
export const CLOUDFLARE_IPS_V6_URL = 'https://www.cloudflare.com/ips-v6/';
export const CACHE_FILE_NAME = 'cloudflare-ips.json';

/** As published on 15 October 2026. Refresh: tools/refresh-cloudflare-ips.sh, or compare with the two URLs above. */
export const BUNDLED_CLOUDFLARE_RANGES: readonly string[] = [
  // IPv4
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  // IPv6
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Trimmed, lower-cased, and with the `::ffff:` prefix of an IPv4-mapped address removed. Null when not an IP. */
export function normaliseIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  let s = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (mapped) s = mapped[1]!;
  // A zone id (fe80::1%eth0) is not part of the address.
  const zone = s.indexOf('%');
  if (zone > 0) s = s.slice(0, zone);
  return isIP(s) ? s : null;
}

export interface Cidr {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** `a.b.c.d/n`, `x::/n`, or a bare address (full-length prefix). Null when malformed. */
export function parseCidr(entry: string): Cidr | null {
  const s = entry.trim().toLowerCase();
  if (!s) return null;
  const slash = s.indexOf('/');
  const addressRaw = slash >= 0 ? s.slice(0, slash) : s;
  const address = normaliseIp(addressRaw);
  if (!address) return null;
  const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
  const max = family === 'ipv6' ? 128 : 32;
  if (slash < 0) return { address, prefix: max, family };
  const prefixRaw = s.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixRaw)) return null;
  const prefix = Number(prefixRaw);
  if (prefix > max) return null;
  return { address, prefix, family };
}

/** A set of CIDR ranges with a fast membership test. Malformed entries are skipped. */
export class CidrSet {
  private readonly list = new BlockList();
  readonly cidrs: readonly string[];

  constructor(entries: readonly string[]) {
    const kept: string[] = [];
    for (const entry of entries) {
      const c = parseCidr(entry);
      if (!c) continue;
      this.list.addSubnet(c.address, c.prefix, c.family);
      kept.push(`${c.address}/${c.prefix}`);
    }
    this.cidrs = kept;
  }

  get size(): number {
    return this.cidrs.length;
  }

  has(ip: string | undefined | null): boolean {
    const n = normaliseIp(ip);
    if (!n) return false;
    return this.list.check(n, isIP(n) === 6 ? 'ipv6' : 'ipv4');
  }
}

/** One range per line, `#` comments allowed. Returns the valid CIDRs; throws when the text has none. */
export function parseRangeList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/#.*$/, '').trim();
    if (!s) continue;
    if (parseCidr(s)) out.push(s);
  }
  if (out.length === 0) throw new Error('no CIDR ranges found');
  return out;
}

export type RangeSource = 'fetched' | 'cache' | 'bundled';

export interface LoadRangesOptions {
  /** Where to cache the fetched list; null disables the cache. */
  cacheFile?: string | null;
  /** fetch implementation; null skips the network and uses the cache or the bundled list. */
  fetchImpl?: typeof fetch | null;
  timeoutMs?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

async function fetchList(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<string[]> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'text/plain' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseRangeList(await res.text());
}

export async function fetchCloudflareRanges(fetchImpl: typeof fetch = fetch, timeoutMs = 10000): Promise<string[]> {
  const [v4, v6] = await Promise.all([fetchList(fetchImpl, CLOUDFLARE_IPS_V4_URL, timeoutMs), fetchList(fetchImpl, CLOUDFLARE_IPS_V6_URL, timeoutMs)]);
  if (v4.length < 5 || v6.length < 3) throw new Error('Cloudflare range lists look truncated');
  return [...v4, ...v6];
}

interface CacheFile {
  fetched_at: string;
  ranges: string[];
}

/**
 * Live list when it can be fetched (and cache it), else the cached copy, else the bundled copy.
 * Never throws: an IP allowlist that cannot be loaded would otherwise take the whole service down.
 */
export async function loadCloudflareRanges(options: LoadRangesOptions = {}): Promise<{ set: CidrSet; source: RangeSource; fetchedAt: string | null }> {
  const log = options.log ?? (() => undefined);
  const fetchImpl = options.fetchImpl === undefined ? fetch : options.fetchImpl;
  const cacheFile = options.cacheFile ?? null;

  if (fetchImpl) {
    try {
      const ranges = await fetchCloudflareRanges(fetchImpl, options.timeoutMs ?? 10000);
      const fetchedAt = new Date().toISOString();
      if (cacheFile) {
        try {
          await fs.mkdir(path.dirname(cacheFile), { recursive: true });
          const cache: CacheFile = { fetched_at: fetchedAt, ranges };
          await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
        } catch (err) {
          log('cloudflare-ips: could not write cache', { file: cacheFile, message: err instanceof Error ? err.message : String(err) });
        }
      }
      return { set: new CidrSet(ranges), source: 'fetched', fetchedAt };
    } catch (err) {
      log('cloudflare-ips: fetch failed, falling back', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (cacheFile) {
    try {
      const cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Partial<CacheFile>;
      if (Array.isArray(cache.ranges) && cache.ranges.length > 0) {
        return { set: new CidrSet(cache.ranges), source: 'cache', fetchedAt: typeof cache.fetched_at === 'string' ? cache.fetched_at : null };
      }
    } catch {
      // No usable cache.
    }
  }

  return { set: new CidrSet(BUNDLED_CLOUDFLARE_RANGES), source: 'bundled', fetchedAt: null };
}

/** Holds the current range set and can refresh it in place (the daily job calls refresh()). */
export class CloudflareRanges {
  private current: CidrSet;
  source: RangeSource;

  private constructor(set: CidrSet, source: RangeSource, private readonly options: LoadRangesOptions) {
    this.current = set;
    this.source = source;
  }

  static async load(options: LoadRangesOptions = {}): Promise<CloudflareRanges> {
    const { set, source } = await loadCloudflareRanges(options);
    return new CloudflareRanges(set, source, options);
  }

  static bundled(): CloudflareRanges {
    return new CloudflareRanges(new CidrSet(BUNDLED_CLOUDFLARE_RANGES), 'bundled', { fetchImpl: null });
  }

  get set(): CidrSet {
    return this.current;
  }

  has(ip: string | undefined | null): boolean {
    return this.current.has(ip);
  }

  /** Re-fetch; keeps the current set when the fetch fails. */
  async refresh(): Promise<RangeSource> {
    const { set, source } = await loadCloudflareRanges({ ...this.options, cacheFile: this.options.cacheFile ?? null });
    if (source === 'fetched') {
      this.current = set;
      this.source = source;
    }
    return source;
  }
}
