// "Post to LinkedIn" (ARCHITECTURE section 17): the two ways in, sign-in, review, publish, and the guards on each
// step, against a fake LinkedIn; then the API client against a fake fetch, and the caption's little-text form.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import sharp from 'sharp';
import type { AppEnv, CanonicalFields, CardRow } from '../src/types.js';
import { getCardById, insertCard, metricsForCard, setCardStatus } from '../src/db/cards.js';
import { linkedinPostsForCard } from '../src/db/linkedin.js';
import { randomToken } from '../src/util/crypto.js';
import { flushBackground } from '../src/util/background.js';
import { createLinkedinRoutes } from '../src/linkedin/routes.js';
import { DraftStore, DRAFT_TTL_MS } from '../src/linkedin/drafts.js';
import { LinkedinError, linkedinClient } from '../src/linkedin/client.js';
import type { LinkedinClient } from '../src/linkedin/client.js';
import { defaultCaption, orgUrn, toLittleText } from '../src/linkedin/caption.js';
import { createTestEnv } from './env.js';

const env = createTestEnv({ LINKEDIN_ORG_URN: '1234567' });
const ORIGIN = 'https://licensed.test';

interface Fake extends LinkedinClient {
  calls: string[];
  posts: { commentary: string; author: string; altText: string }[];
  failPost: LinkedinError[];
  failExchange: LinkedinError | null;
}

function fakeClient(): Fake {
  const f: Fake = {
    calls: [],
    posts: [],
    failPost: [],
    failExchange: null,
    authorizeUrl: ({ redirectUri, state }) => `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ redirect_uri: redirectUri, state })}`,
    exchangeCode: async ({ code }) => {
      f.calls.push(`exchange:${code}`);
      if (f.failExchange) throw f.failExchange;
      return { accessToken: 'tok-1', expiresIn: 3600 };
    },
    member: async () => {
      f.calls.push('member');
      return { urn: 'urn:li:person:abc123', name: 'Layla <Haddad>', picture: null };
    },
    uploadImage: async (_t, owner) => {
      f.calls.push(`upload:${owner}`);
      return 'urn:li:image:img1';
    },
    createPost: async (_t, p) => {
      f.calls.push('post');
      const fail = f.failPost.shift();
      if (fail) throw fail;
      f.posts.push(p);
      return `urn:li:share:${7000 + f.posts.length}`;
    },
  };
  return f;
}

let fake: Fake;
let drafts: DraftStore;
let enabled = true;
let clock = Date.now();
const app = new Hono<AppEnv>().route('/', createLinkedinRoutes({ client: () => (enabled ? fake : null), drafts: (drafts = new DraftStore(() => clock)) }));

let seq = 0;
async function seedCard(o: { fields?: Partial<CanonicalFields>; is_test?: boolean; expires_at?: string | null } = {}): Promise<CardRow> {
  seq += 1;
  const created = await insertCard(env.DB, {
    token: randomToken(),
    is_test: o.is_test ?? false,
    fields: {
      licence_number: `SPC-2026-${String(seq).padStart(5, '0')}`,
      company_name_en: 'Nimbus Publishing FZE',
      company_name_ar: 'نيمبوس للنشر',
      licence_type: null,
      activity_category: 'Publishing',
      activity_category_ar: null,
      founder_name_en: 'Layla Haddad',
      founder_name_ar: null,
      issued_on: '2026-10-01',
      preferred_language: 'en',
      licence_expires_on: null,
      customer_email: null,
      cc_email: null,
      ...o.fields,
    },
    content_hash: `hash-${seq}`,
    source: 'manual',
    expires_at: o.expires_at ?? null,
  });
  await setCardStatus(env.DB, created.id, 'ready');
  const card = await getCardById(env.DB, created.id);
  if (!card) throw new Error('seed');
  return card;
}

const jpeg = (): Promise<Buffer> => sharp({ create: { width: 64, height: 64, channels: 3, background: '#004dff' } }).jpeg().toBuffer();

async function studioPost(token: string, o: { image?: Blob | null; caption?: string; origin?: string | null; lang?: string } = {}): Promise<Response> {
  const fd = new FormData();
  if (o.image !== null) fd.append('image', o.image ?? new Blob([new Uint8Array(await jpeg())], { type: 'image/jpeg' }), 'card.jpg');
  fd.append('caption', o.caption ?? 'Big news.\n\nLicensed with @SPC Free Zone, Sharjah.\n\n#NewBusiness');
  if (o.lang) fd.append('lang', o.lang);
  const body = new Response(fd);
  const bytes = await body.arrayBuffer();
  const headers: Record<string, string> = { 'Content-Type': body.headers.get('Content-Type') ?? '', 'Content-Length': String(bytes.byteLength) };
  if (o.origin !== null) headers['Origin'] = o.origin ?? ORIGIN;
  return app.request(`/c/${token}/linkedin`, { method: 'POST', headers, body: bytes }, env);
}

const cookieOf = (res: Response): string => {
  const m = /li_draft=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '');
  if (!m || !m[1]) throw new Error('no draft cookie');
  return `li_draft=${m[1]}`;
};
const stateOf = (url: string): string => new URL(url, ORIGIN).searchParams.get('state') ?? '';

/** Studio start, sign-in, back on the review page: returns the cookie and the review page's form key. */
async function signedIn(card: CardRow, caption?: string): Promise<{ cookie: string; key: string; review: string }> {
  const start = await studioPost(card.token, caption === undefined ? {} : { caption });
  expect(start.status).toBe(200);
  const { go } = (await start.json()) as { go: string };
  const cookie = cookieOf(start);
  const cb = await app.request(`/linkedin/callback?code=c0de&state=${encodeURIComponent(stateOf(go))}`, { headers: { Cookie: cookie } }, env);
  expect(cb.status).toBe(303);
  expect(cb.headers.get('Location')).toBe('/linkedin/review');
  const review = await (await app.request('/linkedin/review', { headers: { Cookie: cookie } }, env)).text();
  const key = /name="k" value="([^"]+)"/.exec(review)?.[1] ?? '';
  return { cookie, key, review };
}

async function publish(cookie: string, form: Record<string, string>): Promise<Response> {
  return await app.request('/linkedin/publish', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
    body: new URLSearchParams(form).toString(),
  }, env);
}

beforeEach(async () => {
  fake = fakeClient();
  enabled = true;
  clock = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM linkedin_posts'),
    env.DB.prepare('DELETE FROM metrics'),
    env.DB.prepare('DELETE FROM cards'),
  ]);
});

describe('starting from the studio', () => {
  it('takes the picture and caption, sets a private cookie and sends the customer to LinkedIn', async () => {
    const card = await seedCard();
    const res = await studioPost(card.token);
    expect(res.status).toBe(200);
    const { go } = (await res.json()) as { go: string };
    const u = new URL(go);
    expect(u.origin).toBe('https://www.linkedin.com');
    expect(u.searchParams.get('redirect_uri')).toBe('https://licensed.test/linkedin/callback');
    expect(stateOf(go)).toMatch(/^[0-9A-Za-z]{40}$/);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses requests from other sites, files that are not pictures, and expired or unknown cards', async () => {
    const card = await seedCard();
    const before = drafts.size;
    expect((await studioPost(card.token, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await studioPost(card.token, { origin: null })).status).toBe(403);
    expect((await studioPost(card.token, { image: null })).status).toBe(400);
    expect((await studioPost(card.token, { image: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/jpeg' }) })).status).toBe(400);
    expect((await studioPost('0000000000000000000000')).status).toBe(404);
    const old = await seedCard({ expires_at: '2025-01-01T00:00:00.000Z' });
    expect((await studioPost(old.token)).status).toBe(410);
    expect(drafts.size).toBe(before);
  });

  it('is off when LinkedIn is not set up', async () => {
    enabled = false;
    const card = await seedCard();
    expect((await studioPost(card.token)).status).toBe(404);
  });
});

describe('sign-in, review and post', () => {
  it('posts once, with the mention and hashtags, and records the post', async () => {
    const card = await seedCard();
    const { cookie, key, review } = await signedIn(card);
    expect(fake.calls).toEqual(['exchange:c0de', 'member']);
    expect(review).toContain('Layla &lt;Haddad&gt;');
    expect(review).toContain('Licensed with @SPC Free Zone, Sharjah.');
    expect(review).toContain('src="/linkedin/image"');

    const img = await app.request('/linkedin/image', { headers: { Cookie: cookie } }, env);
    expect(img.headers.get('Content-Type')).toBe('image/jpeg');
    expect(img.headers.get('Cache-Control')).toBe('private, no-store');

    const res = await publish(cookie, { k: key, caption: 'Edited <b>text</b> by #Layla.\n\nLicensed with @SPC Free Zone.' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/linkedin/done');
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.author).toBe('urn:li:person:abc123');
    expect(fake.posts[0]?.commentary).toBe('Edited \\<b\\>text\\</b\\> by {hashtag|\\#|Layla}.\n\nLicensed with @[SPC Free Zone](urn:li:organization:1234567).');
    expect(fake.posts[0]?.altText).toBe('Nimbus Publishing FZE is officially licensed with SPC Free Zone');

    const done = await (await app.request('/linkedin/done', { headers: { Cookie: cookie } }, env)).text();
    expect(done).toContain('https://www.linkedin.com/feed/update/urn:li:share:7001/');

    // Pressing again, or reloading, does not post twice.
    expect((await publish(cookie, { k: key, caption: 'again' })).headers.get('Location')).toBe('/linkedin/done');
    expect(fake.posts).toHaveLength(1);

    const rows = await linkedinPostsForCard(env.DB, card.id);
    expect(rows.map((r) => [r.status, r.post_urn, r.lang])).toEqual([['posted', 'urn:li:share:7001', 'en']]);
    await flushBackground();
    const m = await metricsForCard(env.DB, card.id);
    expect(m.find((x) => x.kind === 'share' && x.network === 'linkedin')?.count).toBe(1);
  });

  it('two presses at once still make one post', async () => {
    const card = await seedCard();
    const { cookie, key } = await signedIn(card);
    const [a, b] = await Promise.all([publish(cookie, { k: key, caption: 'One' }), publish(cookie, { k: key, caption: 'One' })]);
    expect([a.status, b.status]).toEqual([303, 303]);
    expect(fake.posts).toHaveLength(1);
  });

  it('needs the review page (its form key) and the cookie', async () => {
    const card = await seedCard();
    const { cookie } = await signedIn(card);
    expect((await publish(cookie, { k: 'wrong', caption: 'x' })).status).toBe(410);
    expect((await publish('li_draft=nope', { k: 'x', caption: 'x' })).status).toBe(410);
    expect(fake.posts).toHaveLength(0);
  });

  it('refuses a caption over 3,000 characters without posting', async () => {
    const card = await seedCard();
    const { cookie, key } = await signedIn(card);
    const res = await publish(cookie, { k: key, caption: 'a'.repeat(3001) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('3,000');
    expect(fake.posts).toHaveLength(0);
  });

  it('posts without the mention when LinkedIn refuses it', async () => {
    const card = await seedCard();
    const { cookie, key } = await signedIn(card);
    fake.failPost.push(new LinkedinError('rejected', 'post: 422 invalid mention', 422));
    expect((await publish(cookie, { k: key, caption: 'With @SPC Free Zone' })).status).toBe(303);
    expect(fake.posts[0]?.commentary).toBe('With \\@SPC Free Zone');
  });

  it('an expired LinkedIn sign-in asks to sign in again and records the failure', async () => {
    const card = await seedCard();
    const { cookie, key } = await signedIn(card);
    fake.failPost.push(new LinkedinError('auth', 'post: 401 expired', 401));
    const res = await publish(cookie, { k: key, caption: 'Hello' });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('/linkedin/again');
    expect(body).toContain('Hello');
    expect((await linkedinPostsForCard(env.DB, card.id))[0]?.status).toBe('failed');
    const again = await app.request('/linkedin/again', { headers: { Cookie: cookie } }, env);
    expect(again.status).toBe(302);
    expect(stateOf(again.headers.get('Location') ?? '')).toMatch(/^[0-9A-Za-z]{40}$/);
  });

  it('a state works once, and an unknown one shows the timed-out page', async () => {
    const card = await seedCard();
    const start = await studioPost(card.token);
    const { go } = (await start.json()) as { go: string };
    const url = `/linkedin/callback?code=c0de&state=${stateOf(go)}`;
    expect((await app.request(url, {}, env)).status).toBe(303); // no cookie: a phone that came back in another browser
    expect((await app.request(url, {}, env)).status).toBe(410);
    expect((await app.request('/linkedin/callback?code=c0de&state=forged', {}, env)).status).toBe(410);
  });

  it('cancelling at LinkedIn posts nothing and offers the way back', async () => {
    const card = await seedCard();
    const start = await studioPost(card.token);
    const { go } = (await start.json()) as { go: string };
    const res = await app.request(`/linkedin/callback?error=user_cancelled_authorize&state=${stateOf(go)}`, { headers: { Cookie: cookieOf(start) } }, env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Nothing was posted');
    expect(body).toContain(`/c/${card.token}?lang=en`);
    expect(fake.calls).toEqual([]);
  });

  it('a draft lasts 15 minutes from the last step', async () => {
    const card = await seedCard();
    const { cookie } = await signedIn(card);
    clock += DRAFT_TTL_MS + 1;
    expect((await app.request('/linkedin/review', { headers: { Cookie: cookie } }, env)).status).toBe(410);
  });

  it('test cards post but are not counted', async () => {
    const card = await seedCard({ is_test: true });
    const { cookie, key } = await signedIn(card);
    expect((await publish(cookie, { k: key, caption: 'x' })).status).toBe(303);
    await flushBackground();
    expect(await metricsForCard(env.DB, card.id)).toEqual([]);
  });

  it('pages carry a strict policy and no referrer', async () => {
    const card = await seedCard();
    const { cookie } = await signedIn(card);
    const res = await app.request('/linkedin/review', { headers: { Cookie: cookie } }, env);
    expect(res.headers.get('Content-Security-Policy')).toMatch(/default-src 'none'.*img-src 'self' https:\/\/media\.licdn\.com/);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('starting from the welcome email', () => {
  it('uses the server-drawn card and the default caption, in the link\'s language', async () => {
    const card = await seedCard();
    const res = await app.request(`/c/${card.token}/linkedin?lang=ar`, {}, env);
    expect(res.status).toBe(302);
    const go = res.headers.get('Location') ?? '';
    expect(go).toMatch(/^https:\/\/www\.linkedin\.com\//);
    const cookie = cookieOf(res);
    await app.request(`/linkedin/callback?code=c&state=${stateOf(go)}`, { headers: { Cookie: cookie } }, env);
    const review = await (await app.request('/linkedin/review', { headers: { Cookie: cookie } }, env)).text();
    expect(review).toContain('dir="rtl"');
    expect(review).toContain(defaultCaption(card, 'ar').split('\n')[0]);
    const img = await app.request('/linkedin/image', { headers: { Cookie: cookie } }, env);
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, 1080]);
  }, 20_000);

  it('expired cards, and LinkedIn not set up, lead to the card page', async () => {
    const old = await seedCard({ expires_at: '2025-01-01T00:00:00.000Z' });
    expect((await app.request(`/c/${old.token}/linkedin`, {}, env)).headers.get('Location')).toBe(`/c/${old.token}?lang=en`);
    enabled = false;
    const card = await seedCard();
    expect((await app.request(`/c/${card.token}/linkedin?lang=ar`, {}, env)).headers.get('Location')).toBe(`/c/${card.token}?lang=ar`);
  });
});

describe('LinkedIn API client', () => {
  function recorder(replies: Response[]): { fetch: typeof fetch; seen: { url: string; init: RequestInit }[] } {
    const seen: { url: string; init: RequestInit }[] = [];
    return {
      seen,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), init: init ?? {} });
        const r = replies.shift();
        if (!r) throw new Error('no reply queued');
        return r;
      }) as typeof fetch,
    };
  }

  it('asks for the posting scope and exchanges the code with the secret in the body', async () => {
    const r = recorder([Response.json({ access_token: 'AT', expires_in: 5184000 })]);
    const c = linkedinClient({ clientId: 'cid', clientSecret: 'shh', fetch: r.fetch });
    const u = new URL(c.authorizeUrl({ redirectUri: 'https://licensed.test/linkedin/callback', state: 's' }));
    expect(u.searchParams.get('scope')).toBe('openid profile w_member_social');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(await c.exchangeCode({ code: 'k', redirectUri: 'https://licensed.test/linkedin/callback' })).toEqual({ accessToken: 'AT', expiresIn: 5184000 });
    expect(r.seen[0]?.url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    const body = new URLSearchParams(String(r.seen[0]?.init.body));
    expect([body.get('grant_type'), body.get('client_secret'), body.get('code')]).toEqual(['authorization_code', 'shh', 'k']);
  });

  it('uploads the picture and creates the post with the versioned REST headers', async () => {
    const r = recorder([
      Response.json({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/abc', image: 'urn:li:image:C4E' } }),
      new Response(null, { status: 201 }),
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:6844785523593134080' } }),
    ]);
    const c = linkedinClient({ clientId: 'cid', clientSecret: 'shh', fetch: r.fetch, version: '202606' });
    const image = await c.uploadImage('AT', 'urn:li:person:me', new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(image).toBe('urn:li:image:C4E');
    const urn = await c.createPost('AT', { author: 'urn:li:person:me', commentary: 'Hi', image, altText: 'alt' });
    expect(urn).toBe('urn:li:share:6844785523593134080');
    const h = r.seen[2]?.init.headers as Record<string, string>;
    expect([h['LinkedIn-Version'], h['X-Restli-Protocol-Version'], h['Authorization']]).toEqual(['202606', '2.0.0', 'Bearer AT']);
    const post = JSON.parse(String(r.seen[2]?.init.body)) as Record<string, unknown>;
    expect(post).toMatchObject({ author: 'urn:li:person:me', visibility: 'PUBLIC', lifecycleState: 'PUBLISHED', content: { media: { id: 'urn:li:image:C4E', altText: 'alt' } } });
  });

  it('turns LinkedIn errors into kinds, with a short reason', async () => {
    const r = recorder([new Response(JSON.stringify({ message: 'Expired access token', status: 401 }), { status: 401 })]);
    const c = linkedinClient({ clientId: 'cid', clientSecret: 'shh', fetch: r.fetch });
    await expect(c.member('AT')).rejects.toMatchObject({ kind: 'auth', status: 401, message: 'userinfo: 401 Expired access token' });
  });
});

describe('caption as LinkedIn little text', () => {
  it('escapes reserved characters and keeps Arabic hashtags', () => {
    expect(toLittleText('a_b (c) [d] *e* ~f~ <g> {h} |i| \\j', null)).toBe('a\\_b \\(c\\) \\[d\\] \\*e\\* \\~f\\~ \\<g\\> \\{h\\} \\|i\\| \\\\j');
    expect(toLittleText('#مشروع_جديد #SPCFreeZone', null)).toBe('{hashtag|\\#|مشروع\\_جديد} {hashtag|\\#|SPCFreeZone}');
  });

  it('accepts the page id in either form', () => {
    expect(orgUrn('1234')).toBe('urn:li:organization:1234');
    expect(orgUrn('urn:li:organization:1234')).toBe('urn:li:organization:1234');
    expect(orgUrn('spc-free-zone')).toBeNull();
  });
});
