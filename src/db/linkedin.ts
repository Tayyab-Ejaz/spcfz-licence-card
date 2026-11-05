// Posts made through "Post to LinkedIn" (migrations/0007_email_linkedin.sql). No token or member id is stored.
import type { D1Database } from '../types.js';
import { ulid } from '../util/crypto.js';

export interface LinkedinPostRow {
  id: string;
  card_id: string;
  status: 'posted' | 'failed';
  post_urn: string | null;
  error: string | null;
  lang: string | null;
  created_at: string;
}

/** Records a post or a failed try; returns its id. */
export async function insertLinkedinPost(db: D1Database, p: Omit<LinkedinPostRow, 'id'>): Promise<string> {
  const id = ulid();
  await db.prepare('INSERT INTO linkedin_posts (id, card_id, status, post_urn, error, lang, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(id, p.card_id, p.status, p.post_urn, p.error ? p.error.slice(0, 500) : null, p.lang, p.created_at).run();
  return id;
}

export async function getLinkedinPost(db: D1Database, id: string): Promise<LinkedinPostRow | null> {
  return (await db.prepare('SELECT * FROM linkedin_posts WHERE id = ?1').bind(id).first<LinkedinPostRow>()) ?? null;
}

export async function linkedinPostsForCard(db: D1Database, cardId: string): Promise<LinkedinPostRow[]> {
  return (await db.prepare('SELECT * FROM linkedin_posts WHERE card_id = ?1 ORDER BY created_at DESC').bind(cardId).all<LinkedinPostRow>()).results ?? [];
}

/** A post with the card it is about, for the admin's lists and the monthly report. */
export interface PostWithCard {
  id: string;
  card_id: string;
  post_urn: string | null;
  lang: string | null;
  created_at: string;
  company_name_en: string;
  licence_number: string;
  is_test: boolean;
}

type RawPostWithCard = Omit<PostWithCard, 'is_test'> & { is_test: number };
const POST_WITH_CARD = `SELECT p.id, p.card_id, p.post_urn, p.lang, p.created_at, c.company_name_en, c.licence_number, c.is_test
  FROM linkedin_posts p JOIN cards c ON c.id = p.card_id WHERE p.status = 'posted'`;

/** The latest posts made with Post to LinkedIn, test cards included (they are marked). */
export async function recentLinkedinPosts(db: D1Database, limit = 10): Promise<PostWithCard[]> {
  const r = await db.prepare(`${POST_WITH_CARD} ORDER BY p.created_at DESC LIMIT ?1`).bind(limit).all<RawPostWithCard>();
  return (r.results ?? []).map((x) => ({ ...x, is_test: x.is_test === 1 }));
}

/** Posts on real cards (not test cards) made in [from, to), ISO times, oldest first. */
export async function linkedinPostsBetween(db: D1Database, from: string, to: string): Promise<PostWithCard[]> {
  const r = await db.prepare(`${POST_WITH_CARD} AND c.is_test = 0 AND p.created_at >= ?1 AND p.created_at < ?2 ORDER BY p.created_at`)
    .bind(from, to).all<RawPostWithCard>();
  return (r.results ?? []).map((x) => ({ ...x, is_test: x.is_test === 1 }));
}
