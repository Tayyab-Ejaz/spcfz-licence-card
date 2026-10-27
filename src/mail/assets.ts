// Pictures the emails load from this service (assets/email, shipped in the image). Each file name carries a
// hash of its content, so a new picture gets a new address and mail clients and Cloudflare can cache for good.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EMAIL_ASSET_DIR = path.resolve(HERE, '../../assets/email');

/** The header banner (SPC, 27 October 2026, the slim one): white SPC Free Zone logo on brand blue, 1200 x 250 for 600 px. */
export const EMAIL_HEADER = 'spc-header-9ae060a595.jpg';

/** The footer's social links (as on www.spcfz.ae, 27 October 2026), with icons from tools/email-icons.mjs. */
export const SOCIAL: ReadonlyArray<{ name: string; href: string; icon: string }> = [
  { name: 'LinkedIn', href: 'https://www.linkedin.com/company/spcfreezone/', icon: 'icon-linkedin-2cd82cb42e.png' },
  { name: 'Instagram', href: 'https://www.instagram.com/spcfreezone', icon: 'icon-instagram-794b6bcaa3.png' },
  { name: 'Facebook', href: 'https://www.facebook.com/SPCFZ.WhereMoreIsPossible', icon: 'icon-facebook-46e4bc2edf.png' },
  { name: 'YouTube', href: 'https://www.youtube.com/@spcfreezone', icon: 'icon-youtube-dd753659e0.png' },
];

/** SPC's phone and WhatsApp, as on www.spcfz.ae. */
export const PHONE = { href: 'tel:80077239', label: '800 SPCFZ (77239)' };
export const WHATSAPP = 'https://wa.me/971502387267';

const FILE_RE = /^[a-z0-9-]{1,80}\.(jpg|png)$/;

export const emailAssetRoutes = new Hono<AppEnv>();

emailAssetRoutes.get('/static/email/:file', async (c) => {
  const file = c.req.param('file');
  if (!FILE_RE.test(file)) return c.text('Not found', 404);
  let body: Buffer;
  try {
    body = await readFile(path.join(EMAIL_ASSET_DIR, file));
  } catch {
    return c.text('Not found', 404);
  }
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
