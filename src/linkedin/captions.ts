// The suggested LinkedIn captions, in one place for the studio (client/card-data.js autoCaption) and the server's
// default caption (./caption.ts). SPC's content writer's text (LinkedIn Milestone.xlsx, 5 November 2026): Warm and
// Professional for "you and your company" in English; the other cases and the Arabic follow the same lines and are
// for the writer's review (docs/ARABIC-STRINGS.md). Custom starts empty. No imports, so the studio can bundle it.

export type CaptionLang = 'en' | 'ar';

/** The invitation before the hashtags (3 November 2026; SPC's wording of 20 November 2026). */
export const REFER_TEXT: Record<CaptionLang, string> = {
  en: 'Are you also planning to start a business in the UAE in the near future? Click the link below!',
  ar: 'هل تخطط أنت أيضاً لتأسيس عمل في دولة الإمارات قريباً؟ اضغط على الرابط أدناه!',
};

/**
 * Where the link goes when the card has no referral link (never, once src/referral/ has given it a code): SPC's
 * landing page for referred friends, without any tracking (SPC, 24 November 2026: "our link shouldn't show the
 * details").
 */
export const REFER_FALLBACK: Record<CaptionLang, string> = {
  en: 'https://www.spcfz.ae/single-visa-promotion/',
  ar: 'https://www.spcfz.ae/ar/single-visa-promotion/',
};

/**
 * The invitation and the owner's own referral link (SPC, 24 November 2026: the link is the owner's, so a friend's
 * lead reaches Zoho with them as the referrer; src/referral/). `url` is the card's BASE_URL/r/<code>[/ar].
 */
export function referLine(lang: CaptionLang, url?: string | null): string {
  return `${REFER_TEXT[lang]}\n${url || REFER_FALLBACK[lang]}`;
}

export interface CaptionInput {
  lang: CaptionLang;
  /** warm | pro | custom; anything else is warm. */
  tone: string;
  /** both (you and your company) | company | personal (just you); anything else is both. */
  focus: string;
  company: string;
  role: string;
  activity: string;
  /** The owner's referral link in this language (src/referral/links.ts); the plain landing page when missing. */
  referUrl?: string | null;
}

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function captionFor(i: CaptionInput): string {
  if (i.tone === 'custom') return '';
  const pro = i.tone === 'pro';
  const focus = i.focus === 'company' || i.focus === 'personal' ? i.focus : 'both';
  return i.lang === 'ar' ? arabic(i, pro, focus) : english(i, pro, focus);
}

function english(i: CaptionInput, pro: boolean, focus: string): string {
  const co = i.company.trim() || 'my business';
  const role = i.role.trim() || 'Founder';
  const a = lowerFirst(i.activity.trim());
  const focusing = a ? `, focusing on ${a}` : '';
  const theFocus = a ? ` The focus will be on ${a}.` : '';
  const field = a ? 'with this field ' : '';
  let body: string;
  if (!pro) {
    const thanks = "I'm grateful to everyone who helped me believe that this dream was worth following.\n\nThank you @SPC Free Zone, Sharjah for helping me get my business license.";
    body = focus === 'company'
      ? `Some news: ${co} is now officially in business${focusing}.\n\nWe're grateful to everyone who helped us believe that this dream was worth following.\n\nThank you @SPC Free Zone, Sharjah for helping us get our business license.`
      : focus === 'personal'
        ? `Some personal news: I've officially started a new role as ${role} of my own business${focusing}.\n\n${thanks}`
        : `Some personal news: I've officially started a new role as ${role} at ${co}, my own business${focusing}.\n\n${thanks}`;
  } else {
    const reach = `Need support ${field}or want an expert's opinion? Send me a connection request or drop a message, I'd be glad to connect with you!`;
    body = focus === 'company'
      ? `Pleased to announce that ${co} is now licensed in the UAE.${theFocus}\n\nNeed support ${field}or want an expert's opinion? Drop us a message, we'd be glad to connect with you!`
      : focus === 'personal'
        ? `Pleased to announce that I've launched my own business in the UAE.${theFocus}\n\n${reach}`
        : `Pleased to announce that I've launched a business named ${co} in the UAE.${theFocus}\n\n${reach}`;
    body += '\n\nProudly licensed with @SPC Free Zone, Sharjah.';
  }
  const tags = focus === 'company' ? '#NewBusiness #SPCFreeZone' : '#NewBusiness #Founder #SPCFreeZone';
  return `${body}\n\n${referLine('en', i.referUrl)}\n\n${tags}`;
}

function arabic(i: CaptionInput, pro: boolean, focus: string): string {
  const co = i.company.trim() || 'مشروعي';
  const role = i.role.trim() || 'المؤسس';
  const a = i.activity.trim();
  const focusing = a ? `، مع التركيز على ${a}` : '';
  const theFocus = a ? ` سيكون التركيز على ${a}.` : '';
  const field = a ? ' في هذا المجال' : '';
  let body: string;
  if (!pro) {
    const thanks = 'أشكر كل من ساعدني على الإيمان بأن هذا الحلم يستحق السعي وراءه.\n\nشكراً @SPC Free Zone في الشارقة على مساعدتي في الحصول على رخصة عملي.';
    body = focus === 'company'
      ? `خبر سعيد: أصبحت ${co} جاهزة للأعمال رسمياً${focusing}.\n\nنشكر كل من ساعدنا على الإيمان بأن هذا الحلم يستحق السعي وراءه.\n\nشكراً @SPC Free Zone في الشارقة على مساعدتنا في الحصول على رخصة أعمالنا.`
      : focus === 'personal'
        ? `خبر شخصي سعيد: بدأت رسمياً دوراً جديداً بصفتي ${role} في مشروعي الخاص${focusing}.\n\n${thanks}`
        : `خبر شخصي سعيد: بدأت رسمياً دوراً جديداً بصفتي ${role} في ${co}، مشروعي الخاص${focusing}.\n\n${thanks}`;
  } else {
    const reach = `هل تحتاج إلى دعم${field} أو إلى رأي خبير؟ أرسل لي طلب تواصل أو رسالة، ويسعدني التواصل معك!`;
    body = focus === 'company'
      ? `يسعدنا أن نعلن أن ${co} أصبحت مرخّصة في دولة الإمارات.${theFocus}\n\nهل تحتاج إلى دعم${field} أو إلى رأي خبير؟ راسلنا، ويسعدنا التواصل معك!`
      : focus === 'personal'
        ? `يسعدني أن أعلن أنني أطلقت مشروعي الخاص في دولة الإمارات.${theFocus}\n\n${reach}`
        : `يسعدني أن أعلن أنني أطلقت مشروعاً باسم ${co} في دولة الإمارات.${theFocus}\n\n${reach}`;
    body += '\n\nبترخيص من @SPC Free Zone في الشارقة، بكل فخر.';
  }
  return `${body}\n\n${referLine('ar', i.referUrl)}\n\n#مشروع_جديد #SPCFreeZone`;
}
