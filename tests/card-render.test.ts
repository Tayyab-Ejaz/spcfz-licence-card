// Which browsers make the card image from the Safari-safe copy (client/card-render.js needsSafeCopy).
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { isFlat, needsSafeCopy } from '../client/card-render.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; CPH2581) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
};

describe('needsSafeCopy', () => {
  it('is on for every iPhone and iPad browser and for Safari on a Mac', () => {
    expect(needsSafeCopy(UA.iphoneSafari, 'iPhone', 5)).toBe(true);
    expect(needsSafeCopy(UA.iphoneChrome, 'iPhone', 5)).toBe(true);
    expect(needsSafeCopy(UA.ipadAsMac, 'MacIntel', 5)).toBe(true);
    expect(needsSafeCopy(UA.macSafari, 'MacIntel', 0)).toBe(true);
  });
  it('is off for Chrome, Edge and Android, which draw the card as it is', () => {
    expect(needsSafeCopy(UA.macChrome, 'MacIntel', 0)).toBe(false);
    expect(needsSafeCopy(UA.android, 'Linux armv8l', 5)).toBe(false);
    expect(needsSafeCopy(UA.windowsEdge, 'Win32', 0)).toBe(false);
  });
});

describe('isFlat', () => {
  // A 4 x 4 RGBA image: the left half one colour, the right half a checkerboard.
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = x < 2 ? 214 : (x + y) % 2 ? 30 : 230;
    data.set([v, v, v, 255], (y * 4 + x) * 4);
  }
  it('sees an empty frame (one colour) as flat', () => {
    expect(isFlat(data, 4, { x: 0, y: 0, w: 2, h: 4 })).toBe(true);
  });
  it('sees a picture as not flat', () => {
    expect(isFlat(data, 4, { x: 2, y: 0, w: 2, h: 4 })).toBe(false);
  });
});
