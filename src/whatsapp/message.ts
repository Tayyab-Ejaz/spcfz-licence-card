// The welcome WhatsApp message (19 November 2026). WhatsApp only lets a business start a chat with a template Meta has
// approved, so the wording lives in Gallabox, not here: the service sends the template's name and fills its blanks.
//
// The template SPC got approved (Gallabox, 24 November 2026; read back through the API the same day):
//   name      24112026_linkedin_milestone, English, Marketing, on the "SPC Free Zone- Marketing" number
//   header    image: the customer's own card picture in the Day One style (/c/<token>/card/…-dayone.jpg; SPC's choice,
//             25 November 2026). The welcome email keeps the Daylight style.
//   body      TEMPLATE_TEXT.body below, with ONE variable, {{variable_1}}: the customer's studio link
//   footer    none
//   button    a website button, "View My Post", URL https://licensed.spcfz.ae/c/{{1}} (the part after /c/ is per customer)
// Its predecessor 19112026_linkedin_milestone is the same without the header (WHATSAPP_TEMPLATE_EN=19112026_linkedin_milestone
// with WHATSAPP_HEADER=none); the first real send, to SPC's own phone on 24 November 2026, was delivered with that one.
//
// TEMPLATE_TEXT is a copy of the approved words, for the admin's preview and the local outbox. If SPC changes the
// template in Gallabox, change it here too; a new variable or a header needs a code change, because Gallabox refuses
// a send whose values do not match the template.
//
// English only: SPC decided on 24 November 2026 that every customer gets the English message, whatever their preferred
// language (the welcome email still follows it). The link and the button open the studio in English to match.
import type { CardRow } from '../types.js';
import { cardImagePath } from '../page/studio.js';
import { phoneDigits } from './phone.js';

export const TEMPLATE_TEXT = {
  body:
    "*You're Officially A Business Owner: Let Everyone Know!*\nCongratulations on starting your business!\n\n" +
    "We've made a personalised announcement card to help you share the news with your network. Want to try a different design or make changes to the content? Click the link below: {{variable_1}}\n\n" +
    'Welcome to the SPC Free Zone family! We wish you success in the years to come.',
  button: 'View My Post',
} as const;

/** The template's name in Gallabox, used until WHATSAPP_TEMPLATE_EN says otherwise. */
export const DEFAULT_TEMPLATE = '24112026_linkedin_milestone';

export interface WelcomeWhatsapp {
  template: string;
  /** The template's blanks, by the variable names Gallabox gives them. */
  values: { variable_1: string };
  /** The website button's part after https://licensed.spcfz.ae/c/ */
  buttonSuffix: string;
  /** The card picture for the image header, or null for a template without one (WHATSAPP_HEADER=none). */
  imageUrl: string | null;
  /** The whole studio link: the body's {{variable_1}}, and where the button goes. */
  studioUrl: string;
  /** The message as the customer reads it (previews, the local outbox). */
  text: string;
}

/** WhatsApp refuses a template value with a line break, a tab or more than four spaces in a row. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** The message for a card, in English. The link and the button open the studio, counted as a WhatsApp visit. */
export function welcomeWhatsapp(card: CardRow, o: { baseUrl: string; template?: string; header: 'image' | 'none' }): WelcomeWhatsapp {
  const base = o.baseUrl.replace(/\/+$/, '');
  const buttonSuffix = `${card.token}?lang=en&via=whatsapp`;
  const studioUrl = `${base}/c/${buttonSuffix}`;
  return {
    template: o.template || DEFAULT_TEMPLATE,
    values: { variable_1: studioUrl },
    buttonSuffix,
    imageUrl: o.header === 'image' ? `${base}${cardImagePath(card, 'en', 'dayone')}` : null,
    studioUrl,
    text: TEMPLATE_TEXT.body.replace('{{variable_1}}', studioUrl),
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
