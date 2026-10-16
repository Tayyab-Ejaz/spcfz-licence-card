// Establishing the client address behind the proxy chain (docs/PORT-TO-NODE.md section 5).
//
// In production the chain is Cloudflare -> Apache on the host (Cloudflare-only via Require ip) -> docker-proxy
// -> this container, so the socket peer is the Docker bridge gateway, never Cloudflare. `TRUST_PROXY`
// says which peers may vouch for the `CF-Connecting-IP` header. The result is written back into that
// header on the request the application sees, so intake and admin keep reading `CF-Connecting-IP` as before.
import { BlockList, isIP } from 'node:net';
import type { TrustProxy } from '../types.js';
import type { CidrSet } from './cloudflare-ips.js';
import { normaliseIp } from './cloudflare-ips.js';

export const CLIENT_IP_HEADER = 'CF-Connecting-IP';

const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');       // loopback
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');        // RFC 1918
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');     // RFC 1918 (Docker's default bridge is in here)
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');    // RFC 1918
PRIVATE.addAddress('::1', 'ipv6');               // loopback
PRIVATE.addSubnet('fc00::', 7, 'ipv6');          // ULA

/** Loopback, RFC 1918 or IPv6 ULA: a reverse proxy on this host or on the same private network. */
export function isLoopbackOrPrivate(ip: string | undefined | null): boolean {
  const n = normaliseIp(ip);
  if (!n) return false;
  return PRIVATE.check(n, isIP(n) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * The client address for a request, or null when it cannot be established.
 *
 * `off`: the socket peer, header ignored.
 * `cloudflare`: the header when the peer is a Cloudflare address, else the peer.
 * `local-proxy`: the header when the peer is loopback or private; absent or malformed header -> null
 *   (the intake allowlist then rejects, which is the safe failure). A public peer is taken as is.
 */
export function resolveClientIp(
  mode: TrustProxy,
  peer: string | undefined | null,
  header: string | undefined | null,
  cloudflare: Pick<CidrSet, 'has'> | null,
): string | null {
  const peerIp = normaliseIp(peer);
  const headerIp = normaliseIp(header);
  switch (mode) {
    case 'off':
      return peerIp;
    case 'cloudflare':
      if (peerIp && cloudflare && cloudflare.has(peerIp)) return headerIp ?? peerIp;
      return peerIp;
    case 'local-proxy':
      if (peerIp && isLoopbackOrPrivate(peerIp)) return headerIp;
      return peerIp;
  }
}

/** A copy of the request whose `CF-Connecting-IP` header is the resolved client address, or absent when unknown. */
export function withClientIp(request: Request, clientIp: string | null): Request {
  const headers = new Headers(request.headers);
  if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);
  else headers.delete(CLIENT_IP_HEADER);
  return new Request(request, { headers });
}
