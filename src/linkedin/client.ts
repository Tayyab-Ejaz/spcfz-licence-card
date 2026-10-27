// LinkedIn's member APIs, as "Post to LinkedIn" uses them (docs/ARCHITECTURE.md section 17):
//   sign in   www.linkedin.com/oauth/v2/authorization, scope "openid profile w_member_social"
//   token     www.linkedin.com/oauth/v2/accessToken (authorization code -> member access token)
//   who       api.linkedin.com/v2/userinfo (OpenID Connect: sub, name, picture)
//   image     api.linkedin.com/rest/images?action=initializeUpload, then PUT the bytes to the upload URL
//   post      api.linkedin.com/rest/posts (the post's URN comes back in the x-restli-id header)
// The token lives only in memory for the few minutes a post takes (./drafts.ts); nothing here stores it.

import type { Env } from '../types.js';

export const LINKEDIN_SCOPE = 'openid profile w_member_social';

/** The LinkedIn app is set up (or the local copy's pretend one): show the buttons, accept posts. */
export function linkedinEnabled(env: Pick<Env, 'LINKEDIN_CLIENT_ID' | 'LINKEDIN_CLIENT_SECRET' | 'LINKEDIN_FAKE'>): boolean {
  return Boolean((env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) || env.LINKEDIN_FAKE === '1');
}
/** A version LinkedIn supports for about a year from its month; LINKEDIN_API_VERSION overrides it. */
export const DEFAULT_API_VERSION = '202606';
/** LinkedIn's limit for a post's text. */
export const MAX_COMMENTARY = 3000;

const TIMEOUT_MS = 20_000;

export type LinkedinErrorKind = 'auth' | 'denied' | 'rate' | 'rejected' | 'upstream';

export class LinkedinError extends Error {
  constructor(readonly kind: LinkedinErrorKind, message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'LinkedinError';
  }
}

export interface Member {
  /** urn:li:person:<sub>, the author of the post. */
  urn: string;
  name: string;
  picture: string | null;
}

export interface LinkedinClient {
  authorizeUrl(o: { redirectUri: string; state: string }): string;
  exchangeCode(o: { code: string; redirectUri: string }): Promise<{ accessToken: string; expiresIn: number }>;
  member(accessToken: string): Promise<Member>;
  uploadImage(accessToken: string, owner: string, bytes: Uint8Array, type: string): Promise<string>;
  createPost(accessToken: string, o: { author: string; commentary: string; image: string; altText: string }): Promise<string>;
}

export interface ClientOptions {
  clientId: string;
  clientSecret: string;
  version?: string;
  fetch?: typeof fetch;
  oauthBase?: string;
  apiBase?: string;
}

function kindFor(status: number): LinkedinErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'denied';
  if (status === 429) return 'rate';
  if (status === 400 || status === 422) return 'rejected';
  return 'upstream';
}

/** LinkedIn's error bodies carry "message" (REST) or "error_description" (OAuth); keep a short, single line. */
async function reason(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const m = j['message'] ?? j['error_description'] ?? j['error'];
    if (typeof m === 'string') return m.slice(0, 300);
  } catch {
    // not JSON
  }
  return text.replace(/\s+/g, ' ').slice(0, 300) || res.statusText;
}

export function linkedinClient(o: ClientOptions): LinkedinClient {
  const f = o.fetch ?? fetch;
  const oauth = (o.oauthBase ?? 'https://www.linkedin.com/oauth/v2').replace(/\/$/, '');
  const api = (o.apiBase ?? 'https://api.linkedin.com').replace(/\/$/, '');
  const version = o.version ?? DEFAULT_API_VERSION;

  async function call(step: string, url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new LinkedinError('upstream', `${step}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new LinkedinError(kindFor(res.status), `${step}: ${res.status} ${await reason(res)}`, res.status);
    return res;
  }

  const rest = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': version,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  });

  return {
    authorizeUrl({ redirectUri, state }) {
      const q = new URLSearchParams({ response_type: 'code', client_id: o.clientId, redirect_uri: redirectUri, state, scope: LINKEDIN_SCOPE });
      return `${oauth}/authorization?${q.toString()}`;
    },

    async exchangeCode({ code, redirectUri }) {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: o.clientId, client_secret: o.clientSecret });
      const res = await call('token', `${oauth}/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof j.access_token !== 'string' || !j.access_token) throw new LinkedinError('upstream', 'token: no access_token in the reply');
      return { accessToken: j.access_token, expiresIn: typeof j.expires_in === 'number' ? j.expires_in : 0 };
    },

    async member(token) {
      const res = await call('userinfo', `${api}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await res.json()) as { sub?: unknown; name?: unknown; given_name?: unknown; family_name?: unknown; picture?: unknown };
      if (typeof j.sub !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(j.sub)) throw new LinkedinError('upstream', 'userinfo: no member id');
      const name = typeof j.name === 'string' && j.name.trim()
        ? j.name.trim()
        : [j.given_name, j.family_name].filter((x): x is string => typeof x === 'string').join(' ').trim();
      const picture = typeof j.picture === 'string' && /^https:\/\//.test(j.picture) ? j.picture : null;
      return { urn: `urn:li:person:${j.sub}`, name: name || 'LinkedIn member', picture };
    },

    async uploadImage(token, owner, bytes, type) {
      const init = await call('image upload start', `${api}/rest/images?action=initializeUpload`, {
        method: 'POST',
        headers: rest(token),
        body: JSON.stringify({ initializeUploadRequest: { owner } }),
      });
      const j = (await init.json()) as { value?: { uploadUrl?: unknown; image?: unknown } };
      const uploadUrl = j.value?.uploadUrl;
      const image = j.value?.image;
      if (typeof uploadUrl !== 'string' || !/^https:\/\//.test(uploadUrl) || typeof image !== 'string') {
        throw new LinkedinError('upstream', 'image upload start: no upload address in the reply');
      }
      await call('image upload', uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body: bytes });
      return image;
    },

    async createPost(token, p) {
      const res = await call('post', `${api}/rest/posts`, {
        method: 'POST',
        headers: rest(token),
        body: JSON.stringify({
          author: p.author,
          commentary: p.commentary,
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          content: { media: { id: p.image, altText: p.altText.slice(0, 4086) } },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });
      const urn = res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id');
      if (!urn || !/^urn:li:(share|ugcPost):\d+$/.test(urn)) throw new LinkedinError('upstream', 'post: LinkedIn did not return the post id');
      return urn;
    },
  };
}
