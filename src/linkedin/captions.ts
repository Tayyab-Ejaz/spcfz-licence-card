// The suggested LinkedIn captions, in one place for the studio (client/card-data.js autoCaption) and the server's
// default caption (./caption.ts). SPC's content writer's text (LinkedIn Milestone.xlsx, 5 November 2026): Warm and
// Professional for "you and your company" in English; the other cases and the Arabic follow the same lines and are
// for the writer's review (docs/ARABIC-STRINGS.md). Custom starts empty. No imports, so the studio can bundle it.

export type CaptionLang = 'en' | 'ar';

/**
 * The campaign the Refer a Friend link carries, so SPC's analytics can tell visits from these posts apart (SPC,
 * 9 November 2026: utm_campaign=Linkedin Milestone; the space written %20 so the link stays one piece in a post).
 */
export const REFER_UTM = '?utm_campaign=Linkedin%20Milestone';

/** SPC's Refer a Friend page, before the hashtags (3 November 2026). */
export const REFER_LINE: Record<CaptionLang, string> = {
  en: `Know someone planning to start a business in the UAE? Refer them to SPC Free Zone and earn up to AED 1,500:\nhttps://www.spcfz.ae/refer-a-friend/${REFER_UTM}`,
  ar: `هل تعرف شخصاً يخطط لتأسيس عمله في دولة الإمارات؟ رشّحه للمنطقة الحرة لمدينة الشارقة للنشر واكسب ما يصل إلى 1500 درهم إماراتي:\nhttps://www.spcfz.ae/ar/refer-a-friend/${REFER_UTM}`,
};

export interface CaptionInput {
  lang: CaptionLang;
  /** warm | pro | custom; anything else is warm. */
  tone: string;
  /** both (you and your company) | company | personal (just you); anything else is both. */
  focus: string;
  company: string;
  role: string;
  activity: string;
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
  return `${body}\n\n${REFER_LINE.en}\n\n${tags}`;
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
  return `${body}\n\n${REFER_LINE.ar}\n\n#مشروع_جديد #SPCFreeZone`;
}
