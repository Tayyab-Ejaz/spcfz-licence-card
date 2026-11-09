// Which browsers make the card image from the Safari-safe copy (client/card-render.js needsSafeCopy).
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { needsSafeCopy } from '../client/card-render.js';

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
