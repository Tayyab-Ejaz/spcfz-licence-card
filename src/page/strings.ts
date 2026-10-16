// Every visitor-facing string on the personal page, in both languages.
// The Arabic was drafted by Claude and must be reviewed by a native reader before launch (ARCHITECTURE section 12).
import type { Lang } from '../types.js';

export interface PageStrings {
  dir: 'ltr' | 'rtl';
  otherLang: Lang;
  /** Label of the toggle that switches to the other language. */
  otherLangLabel: string;
  switchLanguage: string;
  siteName: string;
  /** `{company}` is replaced with the company name in this language. */
  ogTitle: string;
  ogDescription: string;
  headline: string;
  intro: string;
  licenceNumber: string;
  licenceType: string;
  issuedOn: string;
  activity: string;
  imageAlt: string;
  chooseSize: string;
  download: string;
  shareHeading: string;
  shareHint: string;
  instagramHint: string;
  captionHeading: string;
  copyCaption: string;
  copied: string;
  copyFailed: string;
  preparingTitle: string;
  preparingBody: string;
  takingLonger: string;
  whatsappUs: string;
  expiredTitle: string;
  expiredBody: string;
  notFoundTitle: string;
  notFoundBody: string;
  contactUs: string;
  testRibbon: string;
  testNote: string;
  footerLine: string;
}

export const STRINGS: Record<Lang, PageStrings> = {
  en: {
    dir: 'ltr',
    otherLang: 'ar',
    otherLangLabel: 'العربية',
    switchLanguage: 'Switch language',
    siteName: 'SPC Free Zone',
    ogTitle: '{company} is officially licensed at SPC Free Zone',
    ogDescription: 'Official licence card for {company}, issued by SPC Free Zone, Sharjah.',
    headline: 'We’re officially licensed at SPC Free Zone',
    intro: 'Congratulations, {company}. Your licence card is ready to download and share.',
    licenceNumber: 'Licence number',
    licenceType: 'Licence type',
    issuedOn: 'Issued',
    activity: 'Activity',
    imageAlt: 'Licence card for {company}',
    chooseSize: 'Choose a size',
    download: 'Download image',
    shareHeading: 'Share the news',
    shareHint: 'Each button shares your personal page.',
    instagramHint: 'Instagram has no web share. Download the square or story image and paste the caption.',
    captionHeading: 'Caption',
    copyCaption: 'Copy caption',
    copied: 'Copied',
    copyFailed: 'Select the text and copy it',
    preparingTitle: 'Preparing your card',
    preparingBody: 'Your licence card is being created. This page refreshes itself; it usually takes under a minute.',
    takingLonger: 'Taking longer than usual?',
    whatsappUs: 'WhatsApp us',
    expiredTitle: 'This card is no longer available',
    expiredBody: 'Licence cards are kept for two years after issue. If you need a new one, please contact SPC Free Zone.',
    notFoundTitle: 'This link is not valid',
    notFoundBody: 'Check the link in your licence email, or contact SPC Free Zone.',
    contactUs: 'Contact us',
    testRibbon: 'TEST',
    testNote: 'This is a test card, not a real licence.',
    footerLine: 'SPC Free Zone · Sharjah Publishing City',
  },
  ar: {
    dir: 'rtl',
    otherLang: 'en',
    otherLangLabel: 'English',
    switchLanguage: 'تغيير اللغة',
    siteName: 'المنطقة الحرة لمدينة الشارقة للنشر',
    ogTitle: '{company} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر',
    ogDescription: 'بطاقة الترخيص الرسمية لشركة {company}، الصادرة عن المنطقة الحرة لمدينة الشارقة للنشر.',
    headline: 'نحن مرخّصون رسمياً في المنطقة الحرة لمدينة الشارقة للنشر',
    intro: 'تهانينا! بطاقة رخصة {company} جاهزة للتحميل والمشاركة.',
    licenceNumber: 'رقم الرخصة',
    licenceType: 'نوع الرخصة',
    issuedOn: 'تاريخ الإصدار',
    activity: 'النشاط',
    imageAlt: 'بطاقة رخصة {company}',
    chooseSize: 'اختر المقاس',
    download: 'تحميل الصورة',
    shareHeading: 'شارك الخبر',
    shareHint: 'كل زر يشارك صفحتك الشخصية.',
    instagramHint: 'لا يتيح إنستغرام المشاركة عبر الويب. حمّل الصورة المربّعة أو صورة الستوري والصق النص المرافق.',
    captionHeading: 'النص المرافق',
    copyCaption: 'نسخ النص',
    copied: 'تم النسخ',
    copyFailed: 'حدّد النص وانسخه',
    preparingTitle: 'نُجهّز بطاقتك',
    preparingBody: 'يتم الآن إنشاء بطاقة رخصتك. تتحدّث هذه الصفحة تلقائياً، وعادةً لا يستغرق ذلك أكثر من دقيقة.',
    takingLonger: 'هل يستغرق الأمر وقتاً أطول من المعتاد؟',
    whatsappUs: 'تواصل معنا عبر واتساب',
    expiredTitle: 'هذه البطاقة لم تعد متاحة',
    expiredBody: 'نحتفظ ببطاقات الرخص لمدة عامين من تاريخ الإصدار. إذا كنت بحاجة إلى بطاقة جديدة، يرجى التواصل مع المنطقة الحرة لمدينة الشارقة للنشر.',
    notFoundTitle: 'هذا الرابط غير صالح',
    notFoundBody: 'تحقّق من الرابط في رسالة الرخصة، أو تواصل مع المنطقة الحرة لمدينة الشارقة للنشر.',
    contactUs: 'تواصل معنا',
    testRibbon: 'تجريبي',
    testNote: 'هذه بطاقة تجريبية وليست رخصة فعلية.',
    footerLine: 'المنطقة الحرة لمدينة الشارقة للنشر',
  },
};

/** Replace `{name}` placeholders. Unknown placeholders are left as they are. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match: string, key: string) => vars[key] ?? match);
}

export const CONTACT_URL = 'https://www.spcfz.ae/contact-us/';
export const WHATSAPP_URL = 'https://wa.me/971502387267';
