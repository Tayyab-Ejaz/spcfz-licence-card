// Pure helpers of the studio's data layer (client/card-data.js).
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { calDaySizes, cardName, dates } from '../client/card-data.js';

describe('dates', () => {
  it('formats the issue date the way the cards show it, in both languages', () => {
    expect(dates('2026-10-08')).toMatchObject({ day: '8', year: '2026', fullEn: '8 October 2026', fullAr: '8 أكتوبر 2026', shortEn: '8 Oct 2026', calEn: 'OCT 2026', monthYearAr: 'أكتوبر 2026' });
    expect(dates('2026-09-28')).toMatchObject({ day: '28', calEn: 'SEP 2026', monthYearEn: 'September 2026' });
  });
});

describe('calDaySizes', () => {
  it("keeps the design's size for one digit and shrinks two digits to fit the diamond", () => {
    expect(calDaySizes('8')).toEqual({ sq: 260, ls: 160 });
    expect(calDaySizes('28')).toEqual({ sq: 177, ls: 109 });
  });
});

describe('cardName', () => {
  it('keeps names up to 40 characters and shortens longer legal names to first and last name', () => {
    expect(cardName('Mariam Fawzy')).toBe('Mariam Fawzy');
    expect(cardName('  Layla   Haddad ')).toBe('Layla Haddad');
    expect(cardName('Mohammed bin Abdullah bin Rashid Al Example Al Somebody')).toBe('Mohammed Somebody');
    expect(cardName(null)).toBe('');
  });
});
