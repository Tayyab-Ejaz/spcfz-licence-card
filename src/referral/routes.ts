// The owner's referral link (SPC, 24 November 2026: "The referral link should be specific for each owner, so they
// get the reward ... our link shouldn't show the details").
//
// GET /r/<code>[/ar]  The caption's link. Counts the click, keeps the code in a cookie on .spcfz.ae for 30 days and
//                     opens SPC's landing page (/single-visa-promotion/, or the Arabic one) with nothing added to its
//                     address, so the page is served from its cache like any visit. An unknown code opens the page
//                     too, without the cookie: a friend never sees an error.
// GET /api/referrer/<code>
//                     For SPC's website only (Bearer REFERRER_API_KEY): when a lead is sent from the landing page with
//                     the cookie, the website's spcfz-referral plugin asks who the code belongs to and sends that
//                     person to Zoho as the referrer (name, email, phone; Lead Source "Referral").
//
// Test cards' links work the same way (SPC tests with "tayyabtest" emails); they are not counted.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AppEnv, CardRow, Env, MetricKind } from '../types.js';
import { bumpMetric, getCardByRefCode } from '../db/cards.js';
import { background } from '../util/background.js';
import { timingSafeEqualStr } from '../util/crypto.js';
import { todayInDubai } from '../util/time.js';
import { readRefCode } from './code.js';

/** The cookie SPC's website reads (spcfz-referral/spcfz-referral.php COOKIE). */
export const REFER_COOKIE = 'spcfz_ref';
export const REFER_COOKIE_DAYS = 30;
export const DEFAULT_LANDING = {
  en: 'https://www.spcfz.ae/single-visa-promotion/',
  ar: 'https://www.spcfz.ae/ar/single-visa-promotion/',
} as const;
export const DEFAULT_COOKIE_DOMAIN = '.spcfz.ae';
/** REFERRER_API_KEY must be at least this long, or the lookup stays closed. */
export const MIN_KEY_LENGTH = 32;

export function landingUrl(env: Env, lang: 'en' | 'ar'): string {
  return (lang === 'ar' ? env.REFER_LANDING_AR : env.REFER_LANDING_EN) || DEFAULT_LANDING[lang];
}

/** The cookie's Domain: .spcfz.ae unless set; "host" leaves it out (the local copy, where both sites are localhost). */
function cookieDomain(env: Env): string | undefined {
  const d = (env.REFER_COOKIE_DOMAIN ?? '').trim();
  if (d.toLowerCase() === 'host') return undefined;
  return d || DEFAULT_COOKIE_DOMAIN;
}

function count(c: Context<AppEnv>, card: CardRow, kind: MetricKind, network: string | null = null): void {
  if (card.is_test) return;
  background(
    bumpMetric(c.env.DB, { card_id: card.id, kind, lang: card.preferred_language, network }, todayInDubai()).catch((err: unknown) => {
      console.warn('metric failed', { kind, message: err instanceof Error ? err.message : String(err) });
    }),
    'metric',
  );
}

/** Who the referrer is, for Zoho: the founder (English, else Arabic), else the company. */
export function referrerOf(card: CardRow): { name: string; email: string | null; phone: string | null } {
  const name = (card.founder_name_en || card.founder_name_ar || card.company_name_en || '').trim();
  return { name, email: card.customer_email, phone: card.customer_phone };
}

export const referralRoutes = new Hono<AppEnv>();

async function follow(c: Context<AppEnv>, lang: 'en' | 'ar'): Promise<Response> {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const code = readRefCode(c.req.param('code'));
  const card = code ? await getCardByRefCode(c.env.DB, code) : null;
  if (card && code) {
    setCookie(c, REFER_COOKIE, code, {
      domain: cookieDomain(c.env),
      path: '/',
      maxAge: REFER_COOKIE_DAYS * 24 * 60 * 60,
      httpOnly: true,
      secure: c.env.BASE_URL.startsWith('https:'),
      sameSite: 'Lax',
    });
    count(c, card, 'ref_click', lang);
  }
  return c.redirect(landingUrl(c.env, lang), 302);
}

referralRoutes.get('/r/:code', (c) => follow(c, 'en'));
referralRoutes.get('/r/:code/ar', (c) => follow(c, 'ar'));

referralRoutes.get('/api/referrer/:code', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const key = (c.env.REFERRER_API_KEY ?? '').trim();
  // Without a key the lookup does not exist.
  if (key.length < MIN_KEY_LENGTH) return c.text('Not found', 404);
  const auth = c.req.header('Authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!given || !(await timingSafeEqualStr(given, key))) return c.json({ error: 'unauthorized' }, 401);

  const code = readRefCode(c.req.param('code'));
  const card = code ? await getCardByRefCode(c.env.DB, code) : null;
  const form = (c.req.query('form') ?? '').replace(/\D/g, '').slice(0, 9);
  const entry = (c.req.query('entry') ?? '').replace(/\D/g, '').slice(0, 12);
  if (!card || !code) {
    console.log('referral lookup', { code: code ?? 'malformed', found: false, form, entry });
    return c.json({ error: 'unknown code' }, 404);
  }
  // One lookup per lead sent from the landing page with this code.
  count(c, card, 'ref_lead');
  console.log('referral lookup', { code, card_id: card.id, test: card.is_test, form, entry });
  const r = referrerOf(card);
  return c.json({
    code,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: card.company_name_en,
    licence_number: card.licence_number,
    test: card.is_test,
  });
});
