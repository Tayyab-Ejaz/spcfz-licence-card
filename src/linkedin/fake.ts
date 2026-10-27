// A stand-in for LinkedIn on the local copy (LINKEDIN_FAKE=1, refused by src/platform/config.ts unless BASE_URL is
// localhost): the whole "Post to LinkedIn" flow runs, with a pretend sign-in page here instead of LinkedIn's, and
// each "post" written to DATA_DIR/linkedin-outbox (the text LinkedIn would get, and the picture) instead of sent.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../types.js';
import { html } from '../util/html.js';
import type { LinkedinClient } from './client.js';

export const FAKE_SIGNIN_PATH = '/linkedin/fake-signin';

export function fakeLinkedinClient(env: Env): LinkedinClient {
  const outbox = path.join(env.DATA_DIR, 'linkedin-outbox');
  let image: { bytes: Uint8Array; type: string } | null = null;
  return {
    authorizeUrl: ({ redirectUri, state }) => `${FAKE_SIGNIN_PATH}?${new URLSearchParams({ redirect_uri: redirectUri, state }).toString()}`,
    exchangeCode: async () => ({ accessToken: 'local-fake-token', expiresIn: 3600 }),
    member: async () => ({ urn: 'urn:li:person:local', name: 'Local Tester', picture: null }),
    uploadImage: async (_t, _owner, bytes, type) => {
      image = { bytes, type };
      return 'urn:li:image:local';
    },
    createPost: async (_t, p) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      mkdirSync(outbox, { recursive: true });
      writeFileSync(path.join(outbox, `${stamp}.txt`), `author: ${p.author}\nalt text: ${p.altText}\n\n${p.commentary}\n`);
      if (image) writeFileSync(path.join(outbox, `${stamp}.${image.type === 'image/png' ? 'png' : 'jpg'}`), image.bytes);
      return `urn:li:share:${Date.now()}`;
    },
  };
}

/** The pretend sign-in page: Allow returns a code, Cancel returns LinkedIn's "cancelled" error. */
export const fakeSigninRoutes = new Hono<AppEnv>();

fakeSigninRoutes.get(FAKE_SIGNIN_PATH, (c) => {
  if (c.env.LINKEDIN_FAKE !== '1') return c.text('Not found', 404);
  const state = c.req.query('state') ?? '';
  const back = `/linkedin/callback?${new URLSearchParams({ state }).toString()}`;
  c.header('Cache-Control', 'no-store');
  return c.html(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pretend LinkedIn sign-in</title></head>
<body style="font:16px/1.5 -apple-system,Segoe UI,sans-serif;max-width:420px;margin:60px auto;padding:0 16px;color:#1d2226">
<p style="font-size:12px;color:#b42318;font-weight:700;letter-spacing:.08em">LOCAL COPY · NOT LINKEDIN</p>
<h1 style="font-size:22px">Allow SPC Free Zone to post for you?</h1>
<p>On the real site, this is LinkedIn's sign-in and consent page.</p>
<p><a href="${back}&code=local-code" style="display:inline-block;background:#0a66c2;color:#fff;padding:10px 18px;border-radius:24px;text-decoration:none;font-weight:600">Allow</a>
&nbsp; <a href="${back}&error=user_cancelled_authorize">Cancel</a></p>
</body></html>`);
});
