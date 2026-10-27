// A post on its way to LinkedIn: the picture, the caption, and, once the customer has signed in, their LinkedIn
// access token. In memory only, for 15 minutes from the last step; never written to disk or the database. A
// restart forgets every draft, and the customer starts again from their card (one more tap). One process serves
// the site, so memory is the whole store.
import type { Lang } from '../types.js';
import { randomSecret } from '../util/crypto.js';
import type { Member } from './client.js';

export const DRAFT_TTL_MS = 15 * 60_000;
const MAX_DRAFTS = 300;
const MAX_BYTES = 96 * 1024 * 1024; // the server also runs other portals; a draft is about 1 MB

export interface Draft {
  /** The cookie value: who may review and publish this draft. */
  id: string;
  /** The OAuth state for the current sign-in; null once used. */
  state: string | null;
  /** On the review form, so a post needs both the cookie and the page. */
  formKey: string;
  cardId: string;
  token: string;
  lang: Lang;
  isTest: boolean;
  company: string;
  /** studio: the picture the customer made; email: the server-drawn card (src/page/card-image.ts). */
  source: 'studio' | 'email';
  image: Uint8Array;
  imageType: 'image/jpeg' | 'image/png';
  caption: string;
  expiresAt: number;
  member: Member | null;
  accessToken: string | null;
  /** Set while the post is being made, so a second press waits for the first instead of posting twice. */
  posting: Promise<void> | null;
  posted: { urn: string } | null;
}

export type NewDraft = Pick<Draft, 'cardId' | 'token' | 'lang' | 'isTest' | 'company' | 'source' | 'image' | 'imageType' | 'caption'>;

export class DraftStore {
  private readonly drafts = new Map<string, Draft>();

  constructor(private readonly now: () => number = Date.now) {}

  create(d: NewDraft): Draft {
    this.sweep();
    const draft: Draft = {
      ...d,
      id: randomSecret(40),
      state: randomSecret(40),
      formKey: randomSecret(32),
      expiresAt: this.now() + DRAFT_TTL_MS,
      member: null,
      accessToken: null,
      posting: null,
      posted: null,
    };
    this.drafts.set(draft.id, draft);
    this.trim();
    return draft;
  }

  get(id: string | undefined | null): Draft | null {
    if (!id) return null;
    const d = this.drafts.get(id);
    if (!d) return null;
    if (d.expiresAt <= this.now()) {
      this.drafts.delete(id);
      return null;
    }
    return d;
  }

  byState(state: string | undefined | null): Draft | null {
    if (!state) return null;
    for (const d of this.drafts.values()) if (d.state === state) return this.get(d.id);
    return null;
  }

  /** Another 15 minutes from now, after each step the customer takes. */
  touch(d: Draft): void {
    d.expiresAt = this.now() + DRAFT_TTL_MS;
  }

  /** A fresh sign-in (the token expired, or LinkedIn refused it): a new state, the old token dropped. */
  restart(d: Draft): string {
    d.state = randomSecret(40);
    d.accessToken = null;
    d.member = null;
    this.touch(d);
    return d.state;
  }

  get size(): number {
    return this.drafts.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [k, d] of this.drafts) if (d.expiresAt <= now) this.drafts.delete(k);
  }

  /** Bounded memory: drop the oldest drafts beyond the count or byte limit. */
  private trim(): void {
    let bytes = 0;
    for (const d of this.drafts.values()) bytes += d.image.byteLength;
    while (this.drafts.size > MAX_DRAFTS || bytes > MAX_BYTES) {
      const oldest = this.drafts.keys().next().value;
      if (oldest === undefined) break;
      bytes -= this.drafts.get(oldest)?.image.byteLength ?? 0;
      this.drafts.delete(oldest);
    }
  }
}
