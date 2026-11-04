// Before an email goes out through SMTP, the recipient's domain must be able to receive email (4 November 2026, for
// Amazon SES's bounce review): it publishes a mail server (MX), or has no MX but an address record, which RFC 5321
// treats as its mail server. A domain that does not exist, or that says it takes no email (a "null MX", RFC 7505),
// would only bounce, so the email is not sent and the card says why. A lookup that fails for another reason (a DNS
// timeout) is "unknown" and the email is retried later, like a temporary SMTP failure.
import { Resolver } from 'node:dns/promises';

export type DomainVerdict = { ok: true } | { ok: false; reason: string } | { ok: null; reason: string };
export type DomainChecker = (domain: string) => Promise<DomainVerdict>;

/** The DNS calls the check needs, so tests can stand in for DNS. */
export interface MailDns {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

const NO_SUCH_NAME = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);
const codeOf = (err: unknown): string => (err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'ERROR');

async function hasAddress(dns: MailDns, domain: string): Promise<boolean | null> {
  for (const look of [() => dns.resolve4(domain), () => dns.resolve6(domain)]) {
    try {
      if ((await look()).length) return true;
    } catch (err) {
      if (!NO_SUCH_NAME.has(codeOf(err))) return null;
    }
  }
  return false;
}

export function domainChecker(dns: MailDns = new Resolver({ timeout: 5000, tries: 2 })): DomainChecker {
  return async (raw) => {
    const domain = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!domain) return { ok: false, reason: 'the address has no domain' };
    let mx: Array<{ exchange: string; priority: number }>;
    try {
      mx = await dns.resolveMx(domain);
    } catch (err) {
      const code = codeOf(err);
      if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return { ok: false, reason: `${domain} does not exist` };
      if (code !== 'ENODATA') return { ok: null, reason: `could not check ${domain} (${code})` };
      mx = [];
    }
    if (mx.some((r) => r.exchange && r.exchange !== '.')) return { ok: true };
    if (mx.length) return { ok: false, reason: `${domain} says it accepts no email` };
    const a = await hasAddress(dns, domain);
    if (a === null) return { ok: null, reason: `could not check ${domain}` };
    return a ? { ok: true } : { ok: false, reason: `${domain} has no mail server` };
  };
}

/** The domain part of an address (after the last @). */
export const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1);
