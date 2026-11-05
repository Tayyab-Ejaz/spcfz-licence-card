// The suggested captions (src/linkedin/captions.ts), shared by the studio and the server's default caption.
import { describe, expect, it } from 'vitest';
import { REFER_LINE, captionFor } from '../src/linkedin/captions.js';
import { defaultCaption } from '../src/linkedin/caption.js';

const base = { company: 'Cedar & Quill Publishing FZE', role: 'Founder', activity: 'Book publishing' };

describe('captionFor', () => {
  it('uses the content writer\'s Warm and Professional text for "you and your company"', () => {
    expect(captionFor({ ...base, lang: 'en', tone: 'warm', focus: 'both' })).toBe(
      "Some personal news: I've officially started a new role as Founder at Cedar & Quill Publishing FZE, my own business, focusing on book publishing.\n\n"
      + "I'm grateful to everyone who helped me believe that this dream was worth following.\n\n"
      + 'Thank you @SPC Free Zone, Sharjah for helping me get my business license.\n\n'
      + `${REFER_LINE.en}\n\n#NewBusiness #Founder #SPCFreeZone`,
    );
    expect(captionFor({ ...base, lang: 'en', tone: 'pro', focus: 'both' })).toBe(
      "Pleased to announce that I've launched a business named Cedar & Quill Publishing FZE in the UAE. The focus will be on book publishing.\n\n"
      + "Need support with this field or want an expert's opinion? Send me a connection request or drop a message, I'd be glad to connect with you!\n\n"
      + 'Proudly licensed with @SPC Free Zone, Sharjah.\n\n'
      + `${REFER_LINE.en}\n\n#NewBusiness #Founder #SPCFreeZone`,
    );
  });

  it('fits every card type and both languages: the right names, SPC\'s mention, the referral line, no gaps', () => {
    for (const lang of ['en', 'ar'] as const) for (const tone of ['warm', 'pro']) for (const focus of ['both', 'company', 'personal']) {
      for (const activity of ['Book publishing', '']) {
        const c = captionFor({ ...base, role: lang === 'ar' ? 'المؤسس' : 'Founder', lang, tone, focus, activity });
        const where = `${lang} ${tone} ${focus} activity=${activity || 'none'}`;
        expect(c, where).toContain('@SPC Free Zone');
        expect(c, where).toContain(REFER_LINE[lang]);
        expect(c.includes('Cedar & Quill'), where).toBe(focus !== 'personal');
        expect(/focusing on \.|focus will be on \.| \.|،\s*\.|  /.test(c), where).toBe(false);
        if (activity) expect(c.toLowerCase(), where).toContain('book publishing');
        else expect(c, where).not.toMatch(/this field|في هذا المجال/);
        if (lang === 'en') expect(c.includes('#Founder'), where).toBe(focus !== 'company');
      }
    }
  });

  it('starts Custom empty', () => {
    expect(captionFor({ ...base, lang: 'en', tone: 'custom', focus: 'both' })).toBe('');
    expect(captionFor({ ...base, lang: 'ar', tone: 'custom', focus: 'company' })).toBe('');
  });

  it('is what a post from the welcome email starts with', () => {
    const card = { company_name_en: 'Cedar & Quill Publishing FZE', company_name_ar: null, activity_category: 'Book publishing', activity_category_ar: null, founder_name_en: 'Layla Haddad' };
    expect(defaultCaption(card, 'en')).toBe(captionFor({ ...base, lang: 'en', tone: 'warm', focus: 'both' }));
    expect(defaultCaption({ ...card, founder_name_en: null }, 'en')).toContain('Some news: Cedar & Quill Publishing FZE is now officially in business');
  });
});
