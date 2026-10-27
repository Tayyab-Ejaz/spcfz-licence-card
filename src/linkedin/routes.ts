// "Post to LinkedIn" (docs/ARCHITECTURE.md section 17). Two ways in, one way out:
//   studio  POST /c/:token/linkedin   the picture the customer made + their caption (fetch from the studio)
//   email   GET  /c/:token/linkedin   the server-drawn card + the default caption (the welcome email's button)
// then LinkedIn sign-in -> GET /linkedin/callback -> GET /linkedin/review (caption editable) ->
// POST /linkedin/publish -> GET /linkedin/done. Nothing is posted until the customer presses Post now on the
// review page. Drafts and tokens stay in memory (./drafts.ts); the database keeps only the outcome.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import sharp from 'sharp';
import type { AppEnv, CardRow, Env, Lang } from '../types.js';
import { isLang } from '../types.js';
import { bumpMetric, getCardByToken } from '../db/cards.js';
import { insertLinkedinPost } from '../db/linkedin.js';
import { background } from '../util/background.js';
import { TOKEN_RE, bytesToBase64 } from '../util/crypto.js';
import { isPast, nowIso, todayInDubai } from '../util/time.js';
import { cachedCardImage, cardImageInput } from '../page/card-image.js';
import { PORTAL_URL } from '../page/strings.js';
import { defaultCaption, orgUrn, toLittleText } from './caption.js';
import { LinkedinError, MAX_COMMENTARY, linkedinClient } from './client.js';
import type { LinkedinClient, LinkedinErrorKind } from './client.js';
import { DraftStore } from './drafts.js';
import { fakeLinkedinClient } from './fake.js';
import type { Draft } from './drafts.js';
import { LI_STRINGS, linkedinCsp, renderPostedPage, renderProblemPage, renderReviewPage } from './view.js';

const COOKIE = 'li_draft';
/** The studio's picture: 2160 px square at most, a JPEG of 1 to 3 MB; generous for a PNG fallback. */
const MAX_UPLOAD = 12 * 1024 * 1024;
const MAX_FORM = 64 * 1024;
const MAX_SIDE = 6000;

export interface LinkedinRouteOptions {
  /** Tests pass a fake; null when LinkedIn is not set up. */
  client?: (env: Env) => LinkedinClient | null;
  drafts?: DraftStore;
}

function defaultClient(env: Env): LinkedinClient | null {
  if (env.LINKEDIN_FAKE === '1') return fakeLinkedinClient(env);
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) return null;
  return linkedinClient({ clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, version: env.LINKEDIN_API_VERSION });
}

const baseOf = (c: Context<AppEnv>): string => (c.env.BASE_URL || new URL(c.req.url).origin).replace(/\/$/, '');
const redirectUri = (c: Context<AppEnv>): string => `${baseOf(c)}/linkedin/callback`;
const cardUrl = (d: Pick<Draft, 'token' | 'lang'>): string => `/c/${d.token}?lang=${d.lang}`;
const companyOf = (card: CardRow, lang: Lang): string => (lang === 'ar' ? card.company_name_ar || card.company_name_en : card.company_name_en);
const isLive = (card: CardRow | null): card is CardRow => Boolean(card && card.status !== 'expired' && !isPast(card.expires_at));

/** Line breaks kept, other control characters dropped, a sane upper bound before the 3,000 check. */
export function cleanCaption(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_COMMENTARY * 2);
}

/** A JPEG or PNG of sensible size, judged from its header; anything else is refused. */
async function imageType(bytes: Uint8Array): Promise<'image/jpeg' | 'image/png' | null> {
  try {
    const m = await sharp(bytes).metadata();
    if (!m.width || !m.height || m.width > MAX_SIDE || m.height > MAX_SIDE) return null;
    return m.format === 'jpeg' ? 'image/jpeg' : m.format === 'png' ? 'image/png' : null;
  } catch {
    return null;
  }
}

function makeNonce(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

function pageHeaders(c: Context<AppEnv>, nonce: string): void {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Content-Security-Policy', linkedinCsp(nonce));
  // The callback carries the sign-in code in its address; no page here passes its address on.
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
}

function setDraftCookie(c: Context<AppEnv>, d: Draft): void {
  setCookie(c, COOKIE, d.id, { httpOnly: true, secure: baseOf(c).startsWith('https:'), sameSite: 'Lax', path: '/', maxAge: 30 * 60 });
}

/** The studio's request must come from the studio: same origin, by Origin or by Sec-Fetch-Site. */
function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header('Origin');
  if (origin) return origin === new URL(baseOf(c)).origin || origin === new URL(c.req.url).origin;
  return c.req.header('Sec-Fetch-Site') === 'same-origin';
}

function errorText(lang: Lang, kind: LinkedinErrorKind): string {
  const s = LI_STRINGS[lang];
  return { auth: s.errAuth, denied: s.errDenied, rate: s.errRate, rejected: s.errRejected, upstream: s.errUpstream }[kind];
}

function logFailure(step: string, d: Pick<Draft, 'token'> | null, err: unknown): void {
  console.warn('linkedin', {
    step,
    token_prefix: d ? d.token.slice(0, 4) : null,
    kind: err instanceof LinkedinError ? err.kind : 'internal',
    message: err instanceof Error ? err.message.slice(0, 300) : String(err),
  });
}

export function createLinkedinRoutes(o: LinkedinRouteOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const drafts = o.drafts ?? new DraftStore();
  const clientFor = o.client ?? defaultClient;

  const draftOf = (c: Context<AppEnv>): Draft | null => drafts.get(getCookie(c, COOKIE));

  function expired(c: Context<AppEnv>, lang: Lang, d: Draft | null = null): Response | Promise<Response> {
    const nonce = makeNonce();
    pageHeaders(c, nonce);
    const s = LI_STRINGS[lang];
    const primary = d ? { href: cardUrl(d), label: s.openCard } : { href: PORTAL_URL, label: s.portal };
    return c.html(renderProblemPage({ lang, nonce, title: s.expiredTitle, message: s.expiredBody, primary }), 410);
  }

  function review(c: Context<AppEnv>, d: Draft, error: string | null = null, signInAgain = false, status: 200 | 400 | 502 = 200): Response | Promise<Response> {
    const nonce = makeNonce();
    pageHeaders(c, nonce);
    const m = d.member;
    return c.html(renderReviewPage({
      lang: d.lang,
      nonce,
      name: m?.name ?? '',
      picture: m?.picture ?? null,
      company: d.company,
      caption: d.caption,
      formKey: d.formKey,
      imageUrl: '/linkedin/image',
      cardUrl: cardUrl(d),
      error,
      signInAgain,
    }), status);
  }

  // ------------------------------------------------------------------ in from the studio

  app.post('/c/:token/linkedin', async (c) => {
    c.header('Cache-Control', 'no-store');
    const client = clientFor(c.env);
    if (!client) return c.json({ error: 'off' }, 404);
    if (!sameOrigin(c)) return c.json({ error: 'origin' }, 403);
    const declared = Number(c.req.header('Content-Length') ?? 'NaN');
    if (!Number.isFinite(declared)) return c.json({ error: 'length' }, 411);
    if (declared > MAX_UPLOAD) return c.json({ error: 'size' }, 413);
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'card' }, 404);
    const card = await getCardByToken(c.env.DB, token);
    if (!card) return c.json({ error: 'card' }, 404);
    if (!isLive(card)) return c.json({ error: 'expired' }, 410);

    let form: Record<string, string | File>;
    try {
      form = (await c.req.parseBody()) as Record<string, string | File>;
    } catch {
      return c.json({ error: 'form' }, 400);
    }
    const file = form['image'];
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD) return c.json({ error: 'image' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = await imageType(bytes);
    if (!type) return c.json({ error: 'image' }, 400);
    const langV = form['lang'];
    const lang: Lang = isLang(langV) ? langV : card.preferred_language;

    const d = drafts.create({
      cardId: card.id,
      token,
      lang,
      isTest: card.is_test,
      company: companyOf(card, lang),
      source: 'studio',
      image: bytes,
      imageType: type,
      caption: cleanCaption(form['caption']) || defaultCaption(card, lang),
    });
    setDraftCookie(c, d);
    return c.json({ go: client.authorizeUrl({ redirectUri: redirectUri(c), state: d.state ?? '' }) });
  });

  // ------------------------------------------------------------------ in from the welcome email

  app.get('/c/:token/linkedin', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.text('Not found', 404);
    const card = await getCardByToken(c.env.DB, token);
    if (!card) return c.redirect(`/c/${token}`, 302);
    const langQ = c.req.query('lang');
    const lang: Lang = isLang(langQ) ? langQ : card.preferred_language;
    // Expired cards show their expired page; without LinkedIn set up, the button leads to the card itself.
    const client = clientFor(c.env);
    if (!isLive(card) || !client) return c.redirect(`/c/${token}?lang=${lang}`, 302);

    let image: Buffer;
    try {
      image = await cachedCardImage(`${token}:${card.content_hash}:${lang}`, cardImageInput(card, lang));
    } catch (err) {
      logFailure('card image', { token }, err);
      const nonce = makeNonce();
      pageHeaders(c, nonce);
      const s = LI_STRINGS[lang];
      return c.html(renderProblemPage({ lang, nonce, title: s.problemTitle, message: s.errImage, primary: { href: `/c/${token}?lang=${lang}`, label: s.openCard } }), 503);
    }
    const d = drafts.create({
      cardId: card.id,
      token,
      lang,
      isTest: card.is_test,
      company: companyOf(card, lang),
      source: 'email',
      image: new Uint8Array(image),
      imageType: 'image/jpeg',
      caption: defaultCaption(card, lang),
    });
    setDraftCookie(c, d);
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect(client.authorizeUrl({ redirectUri: redirectUri(c), state: d.state ?? '' }), 302);
  });

  // ------------------------------------------------------------------ back from LinkedIn

  app.get('/linkedin/callback', async (c) => {
    const client = clientFor(c.env);
    // Found by its state, not only the cookie: a phone can hand the sign-in to the LinkedIn app and come back in
    // another browser. The state is a 40-character secret only this sign-in has, and it works once.
    const d = drafts.byState(c.req.query('state'));
    const langQ = c.req.query('lang');
    if (!d || !client) return expired(c, isLang(langQ) ? langQ : 'en', draftOf(c));
    d.state = null;
    drafts.touch(d);
    setDraftCookie(c, d);

    const s = LI_STRINGS[d.lang];
    if (c.req.query('error') || !c.req.query('code')) {
      // user_cancelled_login, user_cancelled_authorize, or LinkedIn refused the app.
      const nonce = makeNonce();
      pageHeaders(c, nonce);
      return c.html(renderProblemPage({ lang: d.lang, nonce, title: s.cancelledTitle, message: s.cancelledBody, primary: { href: cardUrl(d), label: s.backToCard }, secondary: { href: '/linkedin/again', label: s.tryAgain } }), 200);
    }
    try {
      const t = await client.exchangeCode({ code: c.req.query('code') ?? '', redirectUri: redirectUri(c) });
      d.member = await client.member(t.accessToken);
      d.accessToken = t.accessToken;
    } catch (err) {
      logFailure('sign-in', d, err);
      const nonce = makeNonce();
      pageHeaders(c, nonce);
      const kind = err instanceof LinkedinError ? err.kind : 'upstream';
      return c.html(renderProblemPage({ lang: d.lang, nonce, title: s.problemTitle, message: errorText(d.lang, kind === 'auth' ? 'upstream' : kind), primary: { href: '/linkedin/again', label: s.tryAgain }, secondary: { href: cardUrl(d), label: s.backToCard } }), 502);
    }
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect('/linkedin/review', 303);
  });

  app.get('/linkedin/again', (c) => {
    const client = clientFor(c.env);
    const d = draftOf(c);
    if (!d || !client) return expired(c, 'en', d);
    if (d.posted) return c.redirect('/linkedin/done', 303);
    const state = drafts.restart(d);
    c.header('Cache-Control', 'no-store');
    return c.redirect(client.authorizeUrl({ redirectUri: redirectUri(c), state }), 302);
  });

  // ------------------------------------------------------------------ review and post

  app.get('/linkedin/review', (c) => {
    const d = draftOf(c);
    if (!d) return expired(c, 'en');
    if (d.posted) return c.redirect('/linkedin/done', 303);
    if (!d.accessToken || !d.member) return c.redirect('/linkedin/again', 303);
    drafts.touch(d);
    return review(c, d);
  });

  app.get('/linkedin/image', (c) => {
    const d = draftOf(c);
    if (!d) return c.text('Not found', 404);
    return new Response(new Uint8Array(d.image), {
      headers: { 'Content-Type': d.imageType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
    });
  });

  app.post('/linkedin/publish', async (c) => {
    const d = draftOf(c);
    if (!d) return expired(c, 'en');
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_FORM) return review(c, d, LI_STRINGS[d.lang].tooLong, false, 400);
    let form: Record<string, string | File>;
    try {
      form = (await c.req.parseBody()) as Record<string, string | File>;
    } catch {
      return review(c, d, LI_STRINGS[d.lang].errRejected, false, 400);
    }
    if (form['k'] !== d.formKey) return expired(c, d.lang, d);
    if (d.posted) return c.redirect('/linkedin/done', 303);

    const caption = cleanCaption(form['caption']);
    if (caption) d.caption = caption;
    drafts.touch(d);
    if (d.caption.length > MAX_COMMENTARY) return review(c, d, LI_STRINGS[d.lang].tooLong, false, 400);
    if (d.posting) {
      // A second press while the first is still posting: wait for it rather than post twice.
      await d.posting.catch(() => undefined);
      if (d.posted) return c.redirect('/linkedin/done', 303);
    }
    const client = clientFor(c.env);
    if (!client || !d.accessToken || !d.member) return c.redirect('/linkedin/again', 303);

    const accessToken = d.accessToken;
    const author = d.member.urn;
    const altText = LI_STRINGS[d.lang].imageAlt.replace('{company}', d.company);
    const org = orgUrn(c.env.LINKEDIN_ORG_URN);
    let failure: unknown = null;
    d.posting = (async () => {
      const image = await client.uploadImage(accessToken, author, d.image, d.imageType);
      let urn: string;
      try {
        urn = await client.createPost(accessToken, { author, commentary: toLittleText(d.caption, org), image, altText });
      } catch (err) {
        // A mention LinkedIn will not take (the page name differs, or the page is gone): post with plain text.
        if (!(org && err instanceof LinkedinError && err.kind === 'rejected')) throw err;
        logFailure('post with mention', d, err);
        urn = await client.createPost(accessToken, { author, commentary: toLittleText(d.caption, null), image, altText });
      }
      d.posted = { urn };
    })();
    try {
      await d.posting;
    } catch (err) {
      failure = err;
    } finally {
      d.posting = null;
    }

    // Read again: the post set it while this handler waited (TypeScript still has the earlier null check).
    const posted = d.posted as Draft['posted'];
    if (posted) {
      d.accessToken = null; // posted once; the token is not needed again
      const urn = posted.urn;
      await insertLinkedinPost(c.env.DB, { card_id: d.cardId, status: 'posted', post_urn: urn, error: null, lang: d.lang, created_at: nowIso() })
        .catch((err: unknown) => logFailure('record', d, err));
      if (!d.isTest) {
        background(bumpMetric(c.env.DB, { card_id: d.cardId, kind: 'share', lang: d.lang, network: 'linkedin' }, todayInDubai())
          .catch((err: unknown) => logFailure('metric', d, err)), 'metric');
      }
      return c.redirect('/linkedin/done', 303);
    }

    logFailure('publish', d, failure);
    const kind: LinkedinErrorKind = failure instanceof LinkedinError ? failure.kind : 'upstream';
    await insertLinkedinPost(c.env.DB, {
      card_id: d.cardId,
      status: 'failed',
      post_urn: null,
      error: failure instanceof Error ? `${kind}: ${failure.message}` : kind,
      lang: d.lang,
      created_at: nowIso(),
    }).catch((err: unknown) => logFailure('record', d, err));
    if (kind === 'auth') {
      d.accessToken = null;
      return review(c, d, errorText(d.lang, 'auth'), true, 502);
    }
    return review(c, d, errorText(d.lang, kind), false, 502);
  });

  app.get('/linkedin/done', (c) => {
    const d = draftOf(c);
    if (!d) return expired(c, 'en');
    if (!d.posted) return c.redirect('/linkedin/review', 303);
    const nonce = makeNonce();
    pageHeaders(c, nonce);
    return c.html(renderPostedPage({
      lang: d.lang,
      nonce,
      company: d.company,
      postUrl: `https://www.linkedin.com/feed/update/${d.posted.urn}/`,
      imageUrl: '/linkedin/image',
      cardUrl: cardUrl(d),
    }));
  });

  return app;
}
