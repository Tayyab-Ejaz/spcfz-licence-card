// The welcome WhatsApp message (19 November 2026). WhatsApp only lets a business start a chat with a template Meta has
// approved, so the wording lives in Gallabox, not here: the service sends the template's name and fills its blanks.
//
// The template, as SPC creates it in Gallabox (docs/WHATSAPP.md):
//   header  image: the customer's own card picture, the same one the welcome email shows
//   body    TEMPLATE_TEXT below, with the variables {{name}} and {{company}}
//   footer  SPC Free Zone
//   button  a website button, "Open my card", URL https://licensed.spcfz.ae/c/{{1}} (the part after /c/ is per customer)
//
// TEMPLATE_TEXT is Claude's draft (English from SPC's welcome email copy; Arabic for review). It is what the admin's
// preview shows and what is pasted into Gallabox; once Meta approves a template, the approved words are what goes out.
import type { CardRow, Lang } from '../types.js';
import { cardImagePath } from '../page/studio.js';
import { phoneDigits } from './phone.js';

export const TEMPLATE_TEXT = {
  en: {
    body: 'Hi {{name}}, congratulations! {{company}} is officially licensed at SPC Free Zone.\n\nWe’ve built a personalised announcement card to help you break the news. Add your photo, then share it on LinkedIn or download it.',
    footer: 'SPC Free Zone',
    button: 'Open my card',
    /** {{name}} when the licence has no founder name. */
    noName: 'there',
  },
  ar: {
    body: 'مرحباً {{name}}، تهانينا! أصبحت {{company}} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر.\n\nصمّمنا لك بطاقة إعلان مخصصة لتساعدك على مشاركة الخبر. أضف صورتك، ثم شاركها على لينكدإن أو نزّلها.',
    footer: 'المنطقة الحرة لمدينة الشارقة للنشر',
    button: 'افتح بطاقتي',
    noName: 'بك',
  },
} as const;

/** The default template names, used until WHATSAPP_TEMPLATE_EN / _AR say otherwise. */
export const DEFAULT_TEMPLATE = { en: 'licence_card_welcome', ar: 'licence_card_welcome_ar' } as const;

export interface WelcomeWhatsapp {
  template: string;
  lang: Lang;
  /** The template's blanks. */
  values: { name: string; company: string };
  /** The website button's part after https://licensed.spcfz.ae/c/ */
  buttonSuffix: string;
  /** The card picture for the image header, or null for a template without one. */
  imageUrl: string | null;
  /** The whole studio link (for previews and the local copy). */
  studioUrl: string;
  /** The message as the customer reads it, from the draft wording (previews, the local outbox). */
  text: string;
}

/** WhatsApp refuses a template value with a line break, a tab or more than four spaces in a row. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

const firstName = (full: string | null): string | null => {
  const w = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return w[0] ?? null;
};

/**
 * The message for a card. Arabic customers get the Arabic template when WHATSAPP_TEMPLATE_AR is set, the English one
 * otherwise (English first, SPC). The button opens the studio in the message's language, counted as a WhatsApp visit.
 */
export function welcomeWhatsapp(
  card: CardRow,
  o: { baseUrl: string; lang: Lang; templates: { en?: string; ar?: string }; header: 'image' | 'none' },
): WelcomeWhatsapp {
  const lang: Lang = o.lang === 'ar' && o.templates.ar ? 'ar' : 'en';
  const t = TEMPLATE_TEXT[lang];
  const ar = lang === 'ar';
  const base = o.baseUrl.replace(/\/+$/, '');
  const company = oneLine((ar && card.company_name_ar) || card.company_name_en);
  const founder = (ar ? card.founder_name_ar || card.founder_name_en : card.founder_name_en) || null;
  const name = oneLine(firstName(founder) ?? t.noName);
  const buttonSuffix = `${card.token}?lang=${lang}&via=whatsapp`;
  const text = `${t.body.replace('{{name}}', name).replace('{{company}}', company)}\n\n${t.footer}`;
  return {
    template: (ar ? o.templates.ar : o.templates.en) || DEFAULT_TEMPLATE[lang],
    lang,
    values: { name, company },
    buttonSuffix,
    imageUrl: o.header === 'none' ? null : `${base}${cardImagePath(card, lang)}`,
    studioUrl: `${base}/c/${buttonSuffix}`,
    text,
  };
}

/** Who the message is for, as Gallabox files the contact: the founder's name, else the company's. */
export function recipientName(card: CardRow): string {
  return oneLine(card.founder_name_en || card.company_name_en).slice(0, 100);
}

/** The body of Gallabox's "send a WhatsApp template" request (POST /devapi/messages/whatsapp). */
export function gallaboxTemplateBody(m: WelcomeWhatsapp, o: { channelId: string; phone: string; name: string }): Record<string, unknown> {
  return {
    channelId: o.channelId,
    channelType: 'whatsapp',
    recipient: { name: o.name, phone: phoneDigits(o.phone) },
    whatsapp: {
      type: 'template',
      template: {
        templateName: m.template,
        bodyValues: m.values,
        ...(m.imageUrl ? { headerValues: { mediaUrl: m.imageUrl, mediaName: 'announcement-card.jpg' } } : {}),
        buttonValues: [{ index: 0, sub_type: 'url', parameters: { type: 'text', text: m.buttonSuffix } }],
      },
    },
  };
}
