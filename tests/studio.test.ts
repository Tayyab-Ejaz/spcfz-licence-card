// The studio shell helpers and the static files route (src/page/studio.ts).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types.js';
import { STUDIO_DIR, jsonForScript, studioCsp, studioStaticRoutes } from '../src/page/studio.js';
import { createTestEnv } from './env.js';

describe('jsonForScript', () => {
  it('escapes everything that could end or confuse a script element, and still parses back', () => {
    const v = { s: '</script><!-- & \u2028\u2029 >' };
    const out = jsonForScript(v);
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual(v);
  });
});

describe('studioCsp', () => {
  it('allows only same-origin code, styles and fonts; data and blob images for uploads and exports', () => {
    const csp = studioCsp('abc', false);
    expect(csp).toContain("script-src 'self' 'nonce-abc'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('googletagmanager');
  });
  it('adds Google Tag Manager hosts only when asked', () => {
    expect(studioCsp('abc', true)).toContain('https://www.googletagmanager.com');
  });
});

describe('GET /static/studio/*', () => {
  const env = createTestEnv();
  const app = new Hono<AppEnv>().route('/', studioStaticRoutes);
  const get = (p: string) => app.request(p, undefined, env);

  it('refuses the manifest, traversal, odd names and unknown types', async () => {
    for (const p of ['/static/studio/manifest.json', '/static/studio/../package.json', '/static/studio/a/../../x.js', '/static/studio/x.html', '/static/studio/.env', '/static/studio/nope.js']) {
      expect((await get(p)).status, p).toBe(404);
    }
  });

  const manifestFile = path.join(STUDIO_DIR, 'manifest.json');
  it.skipIf(!existsSync(manifestFile))('serves built files with their type and a one-year immutable cache', async () => {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as { js: string; css: string };
    const js = await get(m.js);
    expect(js.status).toBe(200);
    expect(js.headers.get('Content-Type')).toContain('text/javascript');
    expect(js.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const css = await get(m.css);
    expect(css.headers.get('Content-Type')).toContain('text/css');
    const font = /url\("(\/static\/studio\/a\/[a-f0-9]+\.woff2)"\)/.exec(await css.text());
    expect(font).not.toBeNull();
    const f = await get(font![1]!);
    expect(f.status).toBe(200);
    expect(f.headers.get('Content-Type')).toBe('font/woff2');
  });
});
