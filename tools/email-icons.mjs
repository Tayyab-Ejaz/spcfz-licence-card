// The welcome email's footer pictures (src/mail/welcome.ts), for its black band: the social icons as white glyphs
// on dark circles, and the SPC logo in white. PNGs, since Gmail and Outlook do not show SVG in email. Icons are
// drawn at 3x for sharp screens and shown at 36 px. Each file is named by its content hash; after a change, run
// this and copy the printed names into src/mail/assets.ts.
//   node tools/email-icons.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve('assets/email');
const SIZE = 108;
const BG = '#26292f'; // dark circles on the footer's black band
const FG = '#ffffff';

// Glyphs on a 24 x 24 grid, centred in the circle at 50%. LinkedIn's letters are from Simple Icons (CC0); the
// others are drawn from basic shapes.
const GLYPHS = {
  linkedin: `<path fill="${FG}" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/>`,
  instagram: `<rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="${FG}" stroke-width="2.4"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="${FG}" stroke-width="2.4"/><circle cx="17.6" cy="6.4" r="1.45" fill="${FG}"/>`,
  facebook: `<path fill="${FG}" d="M13.6 22v-8.2h2.8l.45-3.3H13.6V8.4c0-.95.27-1.6 1.63-1.6H17V3.86c-.3-.04-1.33-.13-2.53-.13-2.5 0-4.2 1.53-4.2 4.33v2.44H7.45v3.3h2.82V22h3.33z"/>`,
  youtube: `<rect x="1" y="4.6" width="22" height="14.8" rx="4.2" fill="${FG}"/><path fill="${BG}" d="M9.7 8.6v6.8l5.9-3.4z"/>`,
};

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^(icon-|spc-logo-white-)/.test(f)) rmSync(path.join(OUT, f));
for (const [name, glyph] of Object.entries(GLYPHS)) {
  const pad = 30; // the glyph takes the middle 48 of 108
  const s = (SIZE - 2 * pad) / 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="${BG}"/><g transform="translate(${pad} ${pad}) scale(${s})">${glyph}</g></svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();
  const file = `icon-${name}-${createHash('sha256').update(png).digest('hex').slice(0, 10)}.png`;
  writeFileSync(path.join(OUT, file), png);
  console.log(name.padEnd(10), file, `${png.length} B`);
}

// The colour SPC logo (the card's, design/source/assets) turned white, keeping its shape from the alpha channel.
const LOGO = path.resolve('design/source/assets/a18673349b740aa2.png');
const alpha = await sharp(LOGO).ensureAlpha().extractChannel('alpha').raw().toBuffer();
const meta = await sharp(LOGO).metadata();
const white = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: '#ffffff' } })
  .joinChannel(alpha, { raw: { width: meta.width, height: meta.height, channels: 1 } })
  .png({ compressionLevel: 9 }).toBuffer();
const logoFile = `spc-logo-white-${createHash('sha256').update(white).digest('hex').slice(0, 10)}.png`;
writeFileSync(path.join(OUT, logoFile), white);
console.log('logo'.padEnd(10), logoFile, `${white.length} B`);

