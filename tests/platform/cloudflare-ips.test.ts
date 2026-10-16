// Cloudflare range handling and the three TRUST_PROXY modes (docs/PORT-TO-NODE.md section 5).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, isLoopbackOrPrivate, resolveClientIp, withClientIp } from '../../src/platform/client-ip.js';
import {
  BUNDLED_CLOUDFLARE_RANGES, CidrSet, CloudflareRanges, loadCloudflareRanges, normaliseIp, parseCidr, parseRangeList,
} from '../../src/platform/cloudflare-ips.js';
import { tempDir } from '../env.js';

const dir = tempDir('spcfz-cfips-');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CF = new CidrSet(BUNDLED_CLOUDFLARE_RANGES);

function fakeFetch(v4: string, v6: string, status = 200): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes('ips-v4') ? v4 : v6;
    return new Response(body, { status });
  }) as typeof fetch;
}

describe('bundled ranges and CidrSet', () => {
  it('the bundled list parses completely and matches the deploy/cloudflare-ips.txt copy', () => {
    expect(CF.size).toBe(BUNDLED_CLOUDFLARE_RANGES.length);
    expect(CF.size).toBeGreaterThanOrEqual(20);
    const file = path.resolve(import.meta.dirname, '../../deploy/cloudflare-ips.txt');
    const fromFile = parseRangeList(readFileSync(file, 'utf8'));
    expect(fromFile.sort()).toEqual([...BUNDLED_CLOUDFLARE_RANGES].sort());
  });

  it('matches v4, v6 and IPv4-mapped addresses, rejects everything else', () => {
    expect(CF.has('104.16.1.1')).toBe(true);
    expect(CF.has('172.64.0.9')).toBe(true);
    expect(CF.has('2606:4700::1')).toBe(true);
    expect(CF.has('2a06:98c0:1::1')).toBe(true);
    expect(CF.has('::ffff:104.16.1.1')).toBe(true);
    expect(CF.has('8.8.8.8')).toBe(false);
    expect(CF.has('127.0.0.1')).toBe(false);
    expect(CF.has('172.17.0.1')).toBe(false);
    expect(CF.has('2001:db8::1')).toBe(false);
    expect(CF.has('')).toBe(false);
    expect(CF.has(undefined)).toBe(false);
    expect(CF.has('not an ip')).toBe(false);
  });

  it('parseCidr and the set skip malformed entries', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual({ address: '10.0.0.0', prefix: 8, family: 'ipv4' });
    expect(parseCidr('2400:cb00::/32')).toEqual({ address: '2400:cb00::', prefix: 32, family: 'ipv6' });
    expect(parseCidr('10.0.0.1')).toEqual({ address: '10.0.0.1', prefix: 32, family: 'ipv4' });
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('x/8')).toBeNull();
    expect(parseCidr('')).toBeNull();
    const set = new CidrSet(['10.0.0.0/8', 'junk', '192.168.1.1']);
    expect(set.cidrs).toEqual(['10.0.0.0/8', '192.168.1.1/32']);
    expect(set.has('10.9.9.9')).toBe(true);
    expect(set.has('192.168.1.1')).toBe(true);
    expect(set.has('192.168.1.2')).toBe(false);
  });

  it('normaliseIp strips zones and the mapped prefix', () => {
    expect(normaliseIp(' 1.2.3.4 ')).toBe('1.2.3.4');
    expect(normaliseIp('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    expect(normaliseIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normaliseIp('nope')).toBeNull();
    expect(normaliseIp(null)).toBeNull();
  });

  it('parseRangeList reads one CIDR per line with comments and refuses an empty result', () => {
    expect(parseRangeList('# header\n10.0.0.0/8\n\n  2400:cb00::/32 # note\n')).toEqual(['10.0.0.0/8', '2400:cb00::/32']);
    expect(() => parseRangeList('# nothing here\n')).toThrow();
  });
});

describe('loadCloudflareRanges', () => {
  const cacheFile = path.join(dir, 'cache', 'cloudflare-ips.json');

  it('uses the fetched list and writes the cache', async () => {
    const r = await loadCloudflareRanges({ cacheFile, fetchImpl: fakeFetch('1.0.0.0/8\n2.0.0.0/8\n3.0.0.0/8\n4.0.0.0/8\n5.0.0.0/8\n', '2001:db8::/32\n2001:db9::/32\n2001:dba::/32\n') });
    expect(r.source).toBe('fetched');
    expect(r.set.has('3.3.3.3')).toBe(true);
    expect(r.set.has('104.16.1.1')).toBe(false);
    expect(existsSync(cacheFile)).toBe(true);
  });

  it('falls back to the cache when the fetch fails, and to the bundled list without a cache', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const cached = await loadCloudflareRanges({ cacheFile, fetchImpl: failing });
    expect(cached.source).toBe('cache');
    expect(cached.set.has('3.3.3.3')).toBe(true);

    const bundled = await loadCloudflareRanges({ cacheFile: path.join(dir, 'none.json'), fetchImpl: failing });
    expect(bundled.source).toBe('bundled');
    expect(bundled.set.has('104.16.1.1')).toBe(true);

    const offline = await loadCloudflareRanges({ fetchImpl: null });
    expect(offline.source).toBe('bundled');

    const badStatus = await loadCloudflareRanges({ fetchImpl: fakeFetch('', '', 500) });
    expect(badStatus.source).toBe('bundled');

    const truncated = await loadCloudflareRanges({ fetchImpl: fakeFetch('1.0.0.0/8\n', '2001:db8::/32\n') });
    expect(truncated.source).toBe('bundled');
  });

  it('CloudflareRanges.refresh keeps the current set when the fetch fails', async () => {
    const ranges = await CloudflareRanges.load({ fetchImpl: null });
    expect(ranges.source).toBe('bundled');
    expect(ranges.has('104.16.1.1')).toBe(true);
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r2 = await CloudflareRanges.load({ fetchImpl: failing });
    expect(await r2.refresh()).toBe('bundled');
    expect(r2.has('104.16.1.1')).toBe(true);
  });
});

describe('resolveClientIp', () => {
  const CF_EDGE = '104.16.1.1';
  const VISITOR = '203.0.113.10';

  it('off: the socket peer, whatever the header says', () => {
    expect(resolveClientIp('off', '127.0.0.1', VISITOR, CF)).toBe('127.0.0.1');
    expect(resolveClientIp('off', '198.51.100.7', undefined, CF)).toBe('198.51.100.7');
    expect(resolveClientIp('off', undefined, VISITOR, CF)).toBeNull();
  });

  it('cloudflare: the header only when the peer is a Cloudflare address', () => {
    expect(resolveClientIp('cloudflare', CF_EDGE, VISITOR, CF)).toBe(VISITOR);
    expect(resolveClientIp('cloudflare', '2606:4700::1', VISITOR, CF)).toBe(VISITOR);
    expect(resolveClientIp('cloudflare', CF_EDGE, undefined, CF)).toBe(CF_EDGE);
    expect(resolveClientIp('cloudflare', CF_EDGE, 'garbage', CF)).toBe(CF_EDGE);
    expect(resolveClientIp('cloudflare', '127.0.0.1', VISITOR, CF)).toBe('127.0.0.1');
    expect(resolveClientIp('cloudflare', '172.17.0.1', VISITOR, CF)).toBe('172.17.0.1');
    expect(resolveClientIp('cloudflare', '8.8.8.8', VISITOR, CF)).toBe('8.8.8.8');
    expect(resolveClientIp('cloudflare', CF_EDGE, VISITOR, null)).toBe(CF_EDGE);
  });

  it('local-proxy: the header only behind a loopback or private peer; absent header means unknown', () => {
    expect(resolveClientIp('local-proxy', '127.0.0.1', VISITOR, null)).toBe(VISITOR);
    expect(resolveClientIp('local-proxy', '172.17.0.1', VISITOR, null)).toBe(VISITOR);
    expect(resolveClientIp('local-proxy', '::ffff:172.18.0.1', VISITOR, null)).toBe(VISITOR);
    expect(resolveClientIp('local-proxy', '10.0.0.5', '2001:db8::7', null)).toBe('2001:db8::7');
    expect(resolveClientIp('local-proxy', '::1', VISITOR, null)).toBe(VISITOR);
    expect(resolveClientIp('local-proxy', 'fd00::1', VISITOR, null)).toBe(VISITOR);
    expect(resolveClientIp('local-proxy', '127.0.0.1', undefined, null)).toBeNull();
    expect(resolveClientIp('local-proxy', '127.0.0.1', 'garbage', null)).toBeNull();
    // A public peer is a direct connection: it is the client, the header is not trusted.
    expect(resolveClientIp('local-proxy', '8.8.8.8', VISITOR, null)).toBe('8.8.8.8');
    expect(resolveClientIp('local-proxy', CF_EDGE, VISITOR, CF)).toBe(CF_EDGE);
    expect(resolveClientIp('local-proxy', undefined, VISITOR, null)).toBeNull();
  });

  it('isLoopbackOrPrivate covers loopback, RFC 1918 and ULA only', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '::1', 'fc00::1', 'fdff::1', '::ffff:10.0.0.1']) {
      expect(isLoopbackOrPrivate(ip), ip).toBe(true);
    }
    for (const ip of ['172.32.0.1', '11.0.0.1', '8.8.8.8', '104.16.1.1', '169.254.1.1', 'fe80::1', '2001:db8::1', '', 'x']) {
      expect(isLoopbackOrPrivate(ip), ip).toBe(false);
    }
  });

  it('withClientIp sets or removes the header on a copy of the request', async () => {
    const original = new Request('http://x/v1/licence-issued', {
      method: 'POST',
      headers: { [CLIENT_IP_HEADER]: '1.1.1.1', 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    const set = withClientIp(original, VISITOR);
    expect(set.headers.get(CLIENT_IP_HEADER)).toBe(VISITOR);
    expect(set.headers.get('content-type')).toBe('application/json');
    expect(set.method).toBe('POST');
    expect(await set.text()).toBe('{"a":1}');

    const removed = withClientIp(new Request('http://x/', { headers: { [CLIENT_IP_HEADER]: '1.1.1.1' } }), null);
    expect(removed.headers.get(CLIENT_IP_HEADER)).toBeNull();
  });
});
