// Where things live: bucket keys and public URLs. Shared by render, page, admin and cron.
//
// Image URLs carry `?v=<first 8 chars of content_hash>` so a regenerated card has a new URL and the
// previous one can stay cached at the edge for a year (docs/PORT-TO-NODE.md section 2). The image
// route itself ignores the query; only the cache key changes.
import type { CardRow, Env, Lang, R2Bucket, Size } from './types.js';
import { LANGS, SIZE_NAMES } from './types.js';

export const SHARE_LINK = 'https://www.spcfz.ae/?utm_source=licensed-card&utm_medium=social&utm_campaign=licence-card';

/** What an image URL needs from a card: its token and the hash its images were rendered from. */
export type ImageRef = Pick<CardRow, 'token' | 'content_hash'>;

function baseUrl(env: Pick<Env, 'BASE_URL'>): string {
  return env.BASE_URL.replace(/\/+$/, '');
}

export function pageUrl(env: Pick<Env, 'BASE_URL'>, token: string): string {
  return `${baseUrl(env)}/c/${token}`;
}

export function imageKey(token: string, lang: Lang, size: Size): string {
  return `cards/${token}/${lang}-${size}.png`;
}

/** The version tag for a card's images: the first 8 hex chars of its content hash. */
export function imageVersion(card: ImageRef | string): string {
  const hash = typeof card === 'string' ? card : card.content_hash;
  return hash.slice(0, 8);
}

/** Site-relative image URL with the version query, for the page's own markup. */
export function imagePath(card: ImageRef, lang: Lang, size: Size): string {
  return `/c/${card.token}/${lang}-${size}.png?v=${imageVersion(card)}`;
}

/** Absolute image URL with the version query, for Open Graph tags and the admin. */
export function imageUrl(env: Pick<Env, 'BASE_URL'>, card: ImageRef, lang: Lang, size: Size): string {
  return `${baseUrl(env)}${imagePath(card, lang, size)}`;
}

export function allImageKeys(token: string): string[] {
  const keys: string[] = [];
  for (const lang of LANGS) for (const size of SIZE_NAMES) keys.push(imageKey(token, lang, size));
  return keys;
}

export async function putImage(bucket: R2Bucket, token: string, lang: Lang, size: Size, png: ArrayBuffer | Uint8Array): Promise<void> {
  await bucket.put(imageKey(token, lang, size), png, {
    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  });
}

export async function deleteCardImages(bucket: R2Bucket, token: string): Promise<void> {
  await bucket.delete(allImageKeys(token));
}

/**
 * No-op, kept for its call sites. There is no edge cache to purge from the origin any more: image URLs
 * are versioned, so a re-render changes the URL instead, and a deleted or expired card answers 404 from
 * the origin while any cached copies of its old URLs age out.
 */
export async function purgeImageCache(_env: Pick<Env, 'BASE_URL'>, _token: string): Promise<void> {
  return;
}
