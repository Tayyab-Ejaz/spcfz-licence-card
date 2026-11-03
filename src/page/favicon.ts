// The browser-tab and home-screen icon: SPC's site icon from www.spcfz.ae (3 November 2026), in assets/favicon,
// shipped in the image. /favicon.ico holds 16, 32 and 48 px; /apple-touch-icon.png is 180 px on white, since iOS
// paints transparency black.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/favicon');

const FILES: ReadonlyArray<{ route: string; file: string; type: string }> = [
  { route: '/favicon.ico', file: 'favicon.ico', type: 'image/x-icon' },
  { route: '/apple-touch-icon.png', file: 'apple-touch-icon.png', type: 'image/png' },
];

/** The links every page's <head> carries. */
export const FAVICON_LINKS = '<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">';

export const faviconRoutes = new Hono<AppEnv>();

for (const f of FILES) {
  const body = new Uint8Array(readFileSync(path.join(DIR, f.file)));
  faviconRoutes.get(f.route, () => new Response(body, {
    headers: { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  }));
}
