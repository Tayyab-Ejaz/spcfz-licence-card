// Where things live: R2 keys, public URLs, and the edge cache for images. Shared by render, page, admin and cron.
import type { Env, Lang, Size } from './types';
import { LANGS, SIZE_NAMES } from './types';

export const SHARE_LINK = 'https://www.spcfz.ae/?utm_source=licensed-card&utm_medium=social&utm_campaign=licence-card';

export function pageUrl(env: Pick<Env, 'BASE_URL'>, token: string): string {
  return `${env.BASE_URL.replace(/\/+$/, '')}/c/${token}`;
}

export function imageKey(token: string, lang: Lang, size: Size): string {
  return `cards/${token}/${lang}-${size}.png`;
}

export function imageUrl(env: Pick<Env, 'BASE_URL'>, token: string, lang: Lang, size: Size): string {
  return `${pageUrl(env, token)}/${lang}-${size}.png`;
}

export function allImageKeys(token: string): string[] {
  const keys: string[] = [];
  for (const lang of LANGS) for (const size of SIZE_NAMES) keys.push(imageKey(token, lang, size));
  return keys;
}

export async function putImage(bucket: R2Bucket, token: string, lang: Lang, size: Size, png: ArrayBuffer | Uint8Array): Promise<void> {
  await bucket.put(imageKey(token, lang, size), png, {
    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' },
  });
}

export async function deleteCardImages(bucket: R2Bucket, token: string): Promise<void> {
  await bucket.delete(allImageKeys(token));
}

/** The image route caches by full URL in `caches.default`; call this after a re-render or a delete. */
export async function purgeImageCache(env: Pick<Env, 'BASE_URL'>, token: string): Promise<void> {
  const cache = caches.default;
  await Promise.all(
    LANGS.flatMap((lang) => SIZE_NAMES.map((size) => cache.delete(new Request(imageUrl(env, token, lang, size))))),
  );
}
