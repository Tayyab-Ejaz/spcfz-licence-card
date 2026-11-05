// The studio's right-click and developer-tools key guard (client/guard.js).
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { opensDevTools } from '../client/guard.js';

const key = (code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}, k = '') => ({
  code, key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: !!mods.meta,
});

describe('opensDevTools', () => {
  it('catches F12 and the developer-tools and view-source shortcuts on Windows, Linux and Mac', () => {
    for (const e of [
      key('F12', {}, 'F12'),
      key('KeyI', { ctrl: true, shift: true }), key('KeyJ', { ctrl: true, shift: true }), key('KeyC', { ctrl: true, shift: true }),
      key('KeyI', { meta: true, alt: true }, 'ˆ'), key('KeyJ', { meta: true, alt: true }), key('KeyC', { meta: true, shift: true }),
      key('KeyU', { ctrl: true }), key('KeyU', { meta: true, alt: true }),
    ]) expect(opensDevTools(e), JSON.stringify(e)).toBe(true);
  });

  it('leaves everyday keys alone: typing, copy, paste, select all, undo', () => {
    for (const e of [
      key('KeyI', {}, 'i'), key('KeyI', { shift: true }, 'I'), key('KeyC', { ctrl: true }), key('KeyC', { meta: true }),
      key('KeyV', { ctrl: true }), key('KeyA', { meta: true }), key('KeyZ', { ctrl: true }), key('KeyU', { ctrl: true, shift: true }),
      key('F5', {}, 'F5'),
    ]) expect(opensDevTools(e), JSON.stringify(e)).toBe(false);
  });
});
