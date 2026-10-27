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

export async function insertLinkedinPost(db: D1Database, p: Omit<LinkedinPostRow, 'id'>): Promise<void> {
  await db.prepare('INSERT INTO linkedin_posts (id, card_id, status, post_urn, error, lang, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(ulid(), p.card_id, p.status, p.post_urn, p.error ? p.error.slice(0, 500) : null, p.lang, p.created_at).run();
}

export async function linkedinPostsForCard(db: D1Database, cardId: string): Promise<LinkedinPostRow[]> {
  return (await db.prepare('SELECT * FROM linkedin_posts WHERE card_id = ?1 ORDER BY created_at DESC').bind(cardId).all<LinkedinPostRow>()).results ?? [];
}
