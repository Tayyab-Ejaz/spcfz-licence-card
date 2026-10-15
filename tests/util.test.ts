import { describe, expect, it } from 'vitest';
import { TOKEN_RE, contentHash, randomSecret, randomToken, sha256Hex, timingSafeEqualStr, ulid } from '../src/util/crypto';
import { escapeHtml, html, raw, safeFilename, stripHtml } from '../src/util/html';
import { ipAllowed, parseAllowlist } from '../src/util/ip';
import { addDays, formatMonthYear, parseDate, todayInDubai } from '../src/util/time';
import { csvToObjects, parseCsv } from '../src/util/csv';

describe('crypto', () => {
  it('randomToken is 22 base62 chars and unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = randomToken();
      expect(t).toMatch(TOKEN_RE);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });
  it('ulid sorts by time', () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a.length).toBe(26);
    expect(a < b).toBe(true);
  });
  it('randomSecret has the requested length', () => {
    expect(randomSecret()).toHaveLength(48);
    expect(randomSecret(10)).toHaveLength(10);
  });
  it('sha256Hex is stable', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('timingSafeEqualStr compares strings of any length', async () => {
    expect(await timingSafeEqualStr('secret', 'secret')).toBe(true);
    expect(await timingSafeEqualStr('secret', 'secret ')).toBe(false);
    expect(await timingSafeEqualStr('', 'x')).toBe(false);
  });
  it('contentHash ignores key order and treats undefined as null', async () => {
    const a = await contentHash({ a: 1, b: 'x', c: null });
    const b = await contentHash({ c: undefined, b: 'x', a: 1 });
    const c = await contentHash({ a: 1, b: 'y', c: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('html', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  it('tagged template escapes values unless raw', () => {
    const out = html`<p>${'<b>'}${raw('<i>')}${['<', raw('>')]}${null}${false}</p>`;
    expect(out).toBe('<p>&lt;b&gt;<i>&lt;></p>');
  });
  it('stripHtml removes tags and collapses whitespace', () => {
    expect(stripHtml(' Nimbus <script>x</script>  Publishing ')).toBe('Nimbus x Publishing');
  });
  it('safeFilename is ASCII only and never empty', () => {
    expect(safeFilename('Nimbus Publishing FZE', 'en-square')).toBe('Nimbus-Publishing-FZE-en-square');
    expect(safeFilename('نيمبوس', 'ar-story')).toBe('spc-licensed-ar-story');
    expect(safeFilename('Café "Déjà" Vu', 'x')).toBe('Cafe-Deja-Vu-x');
  });
});

describe('ip', () => {
  const list = parseAllowlist(' 203.0.113.10, 198.51.100.0/24\n2001:DB8::1 ');
  it('parses mixed separators and lower-cases', () => {
    expect(list).toEqual(['203.0.113.10', '198.51.100.0/24', '2001:db8::1']);
  });
  it('matches exact and CIDR, rejects others and empty lists', () => {
    expect(ipAllowed('203.0.113.10', list)).toBe(true);
    expect(ipAllowed('198.51.100.77', list)).toBe(true);
    expect(ipAllowed('198.51.101.1', list)).toBe(false);
    expect(ipAllowed('2001:db8::1', list)).toBe(true);
    expect(ipAllowed('203.0.113.11', list)).toBe(false);
    expect(ipAllowed('203.0.113.10', [])).toBe(false);
    expect(ipAllowed(undefined, list)).toBe(false);
  });
  it('ignores malformed CIDR entries', () => {
    expect(ipAllowed('10.0.0.1', ['10.0.0.0/99', '10.0.0.x/8'])).toBe(false);
    expect(ipAllowed('10.9.9.9', ['10.0.0.0/8'])).toBe(true);
  });
});

describe('time', () => {
  it('todayInDubai is YYYY-MM-DD in Asia/Dubai', () => {
    // 23:30 UTC on 14 Oct is already 15 Oct in Dubai (UTC+4).
    expect(todayInDubai(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15');
    expect(todayInDubai(new Date('2026-10-14T19:30:00Z'))).toBe('2026-10-14');
  });
  it('parseDate accepts common formats and rejects junk', () => {
    expect(parseDate('2026-10-15')).toBe('2026-10-15');
    expect(parseDate('2026-10-15T09:12:33Z')).toBe('2026-10-15');
    expect(parseDate('15/10/2026')).toBe('2026-10-15');
    expect(parseDate('15-10-2026')).toBe('2026-10-15');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
    expect(parseDate(42)).toBeNull();
    expect(parseDate('')).toBeNull();
  });
  it('formatMonthYear uses Latin digits in Arabic', () => {
    expect(formatMonthYear('2026-10-15', 'en')).toBe('October 2026');
    const ar = formatMonthYear('2026-10-15', 'ar');
    expect(ar).toContain('2026');
    expect(ar).toMatch(/أكتوبر|تشرين الأول/);
  });
  it('addDays adds whole days', () => {
    expect(addDays('2026-10-15T00:00:00.000Z', 7)).toBe('2026-10-22T00:00:00.000Z');
  });
});

describe('csv', () => {
  it('parses quotes, doubled quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  });
  it('csvToObjects lower-cases headers and trims', () => {
    const objs = csvToObjects('﻿Licence Number, company_name_en\nSPC-1 , Nimbus ');
    expect(objs).toEqual([{ licence_number: 'SPC-1', company_name_en: 'Nimbus' }]);
  });
});
