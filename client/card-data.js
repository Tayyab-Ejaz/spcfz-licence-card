// Puts the licence's real data into the design's logic, which ships with sample values (Lumen & Ledger,
// 8 October 2026, licence 4425153.01). The design's logic files stay verbatim; this subclass overrides
// fresh() for the starting state and adjusts the values renderVals() returns.

import { renderCardImage } from './card-render.js';
import { captionFor } from '../src/linkedin/captions.ts';

export const PORTAL_URL = 'https://portal.spcfz.ae/frontend/login/';

const EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Month names as used in the UAE (Gregorian, Latin digits), matching the design's "أكتوبر 2026".
const AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function dates(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const mi = Math.min(11, Math.max(0, (m || 1) - 1));
  return {
    year: String(y), day: String(d),
    fullEn: `${d} ${EN[mi]} ${y}`, fullAr: `${d} ${AR[mi]} ${y}`,
    shortEn: `${d} ${EN[mi].slice(0, 3)} ${y}`,
    monthYearEn: `${EN[mi]} ${y}`, monthYearAr: `${AR[mi]} ${y}`,
    calEn: `${EN[mi].slice(0, 3).toUpperCase()} ${y}`,
  };
}

/** Fire-and-forget counter for the admin's metrics; never blocks or breaks the action. */
export function beacon(token, body) {
  try {
    const url = `/c/${token}/m`;
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(url, blob))) {
      fetch(url, { method: 'POST', body: blob, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
    }
  } catch (e) { /* metrics are best effort */ }
}

/** A name as text to compare: no spacing, one kind of dash, no invisible direction or joining marks. */
export function normName(t) {
  return String(t || '').normalize('NFC')
    .replace(/[​-‏‪-‮⁠-⁩؜﻿]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, '');
}

/** The design's name field holds 40 characters; a longer legal name becomes first and last name. */
export function cardName(full) {
  const n = String(full || '').trim().replace(/\s+/g, ' ');
  if (n.length <= 40) return n;
  const w = n.split(' ');
  const short = w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : n;
  return short.slice(0, 40);
}

// Launch Pass stub: the name's usable width (stub width minus padding) and the design's sizes.
const STUB = { sq: { width: 202, en: 30, ar: 24 }, ls: { width: 150, en: 22, ar: 17 } };
const FAMILY = { en: '"Inter", sans-serif', ar: '"Noto Kufi Arabic", "Inter", sans-serif' };
// Words break only at spaces and hyphens; breaking inside a word is the very last resort (lastResort).
const wrapCss = (lines, lastResort) => `white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};text-wrap:balance${lastResort ? ';overflow-wrap:anywhere' : ''}`;
const WRAP_CSS = wrapCss(2);
const measured = new Map();
let measureCtx = null;

function textWidth(text, px, lang) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `800 ${px}px ${FAMILY[lang]}`;
  if ('letterSpacing' in measureCtx) measureCtx.letterSpacing = `${-0.015 * px}px`;
  return measureCtx.measureText(text).width;
}

/**
 * Launch Pass stub name. If it fits on one line at the design's size, the design is unchanged. Otherwise it
 * wraps to two balanced lines, shrinking (1 px at a time, to no less than 75 %) only as far as needed for
 * the whole name to fit in two lines and its longest word in one. fitStub() then corrects it against the
 * real layout, going to three lines if needed, so a founder's surname is never cut off.
 */
export function stubName(name, lang, format) {
  const key = format === 'landscape' ? 'ls' : 'sq';
  const n = String(name || '').trim();
  const cacheKey = `${key}|${lang}|${n}|${document.fonts && document.fonts.status}`;
  if (measured.has(cacheKey)) return measured.get(cacheKey);
  const { width } = STUB[key];
  const base = STUB[key][lang];
  let result = { size: base, xtra: '' };
  if (n && textWidth(n, base, lang) > width) {
    const words = n.split(/[\s-]+/).filter(Boolean);
    let size = base;
    for (; size > Math.round(base * 0.75); size--) {
      const total = textWidth(n, size, lang);
      const longest = Math.max(...words.map((w) => textWidth(w, size, lang)));
      if (total <= width * 1.85 && longest <= width) break;
    }
    result = { size, xtra: WRAP_CSS };
  }
  measured.set(cacheKey, result);
  return result;
}

/** Day One: the design's day size fits one digit; two digits take 68 % of it, filling the diamond as the design's "8" does. */
export function calDaySizes(day) {
  return String(day).length > 1 ? { sq: Math.round(260 * 0.68), ls: Math.round(160 * 0.68) } : { sq: 260, ls: 160 };
}

const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
const PART_MS = 380;   // a Details part opening or closing
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const frameEl = () => document.querySelector('.m-frame');

export function withCardData(Base) {
  return class CardLogic extends Base {
    constructor(...args) {
      super(...args);
      // Phone layout: let the drawer slide down before it is removed (the design removes it at once).
      if (typeof this.closeSheet === 'function') {
        const close = this.closeSheet;
        this.closeSheet = () => this.closeSheetSmoothly(close);
      }
    }

    /**
     * Opening or closing the drawer moves and resizes the card preview in one render. Note where the frame was,
     * switch its own size transition off for this change, and let componentDidUpdate glide it from there (FLIP).
     */
    setState(update, cb) {
      if (update && typeof update === 'object' && 'sheet' in update && !!update.sheet !== !!this.state.sheet) {
        const frame = frameEl();
        if (frame && !reducedMotion()) {
          this.flipFrom = frame.getBoundingClientRect();
          this.flipTransition = this.flipTransition ?? frame.style.transition;
          frame.style.transition = 'none';
          const card = frame.querySelector('[data-lang]');
          if (card) card.style.transition = 'none';
        }
      }
      return super.setState(update, cb);
    }

    /**
     * Phone layout: a tap outside the open drawer closes it, the way a bottom sheet should. The tap is absorbed so
     * it does not also follow a link or press a button underneath. While the photo is being adjusted, touches on
     * the card frame stay with the card (drag to move, pinch to zoom).
     */
    watchOutsideTaps() {
      const open = !!this.state.sheet;
      if (open && !this.outsideTap) {
        this.outsideTap = (ev) => {
          const t = ev.target instanceof Element ? ev.target : null;
          if (!t || !this.state.sheet || t.closest('[data-screen-label="Sheet"]')) return;
          if (t.closest('.m-frame') && typeof this.isAdjusting === 'function' && this.isAdjusting()) return;
          const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
          document.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
          this.closeSheet();
        };
        document.addEventListener('pointerdown', this.outsideTap, true);
      } else if (!open && this.outsideTap) {
        document.removeEventListener('pointerdown', this.outsideTap, true);
        this.outsideTap = null;
      }
    }

    componentWillUnmount() {
      if (this.outsideTap) document.removeEventListener('pointerdown', this.outsideTap, true);
      this.outsideTap = null;
      if (this.askKeys) document.removeEventListener('keydown', this.askKeys);
      this.askKeys = null;
      if (super.componentWillUnmount) super.componentWillUnmount();
    }

    /**
     * The card as an image, through ./card-render.js: only the fonts the card uses, no cache-busting re-downloads,
     * a JPEG Blob for Share and a PNG data URL for Download. A render already running for the same card is
     * shared rather than started twice (the background pre-render and a Share tap can overlap).
     */
    async renderCard(asBlob) {
      const node = this.cardRef.current;
      const lib = window.htmlToImage;
      if (!node || !lib) throw new Error('unavailable');
      const st = this.state;
      const isLs = st.format === 'landscape';
      const size = { width: isLs ? 1200 : 1080, height: isLs ? 627 : st.format === 'portrait' ? 1350 : 1080 };
      const key = `${this.stateKey()}|${asBlob ? 'blob' : 'png'}`;
      if (this.rendering && this.rendering.key === key) return this.rendering.promise;
      const promise = renderCardImage(node, lib, { ...size, asBlob }).finally(() => {
        if (this.rendering && this.rendering.promise === promise) this.rendering = null;
      });
      this.rendering = { key, promise };
      return promise;
    }

    /**
     * Post to LinkedIn (27 October 2026; src/linkedin/routes.ts): the card as it looks now, as a JPEG, goes to the
     * service with the caption; the service keeps it for up to an hour and sends the customer to LinkedIn to sign
     * in, then to a page where they review the post and press Post now. Nothing is posted from here.
     */
    async postLinkedIn() {
      if (this.state.liBusy || this.state.busy || !this.preflight()) return;
      const c = this.props.card;
      const s = this.state;
      const caption = s.caption ?? this.autoCaption();
      this.setState({ liBusy: true });
      // Back from LinkedIn with the browser's back button restores this page as it was: un-stick the button.
      window.addEventListener('pageshow', (e) => { if (e.persisted) this.setState({ liBusy: false }); }, { once: true });
      try {
        const blob = await this.renderCard(true);
        const fd = new FormData();
        fd.append('image', blob, this.fileName(blob.type || 'image/jpeg'));
        fd.append('caption', caption);
        fd.append('lang', s.lang === 'ar' ? 'ar' : 'en');
        const res = await fetch(`/c/${encodeURIComponent(c.token)}/linkedin`, { method: 'POST', body: fd, credentials: 'same-origin' });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || typeof j.go !== 'string') throw new Error(j.error || String(res.status));
        window.location.assign(j.go);
      } catch (e) {
        this.setState({ liBusy: false });
        this.showToast(e && e.message === 'expired'
          ? 'This card has expired, so it can\'t be posted.'
          : 'LinkedIn didn\'t open. Try again, or download the card and post it yourself.');
      }
    }

    /**
     * The suggested caption (SPC's content writer, 5 November 2026): one source, src/linkedin/captions.ts, shared with
     * the server's default caption for posts started from the email. Custom starts empty.
     */
    autoCaption() {
      const s = this.state;
      const ar = s.lang === 'ar';
      const T = ar ? { ...s, ...s.ar } : s;
      return captionFor({ lang: ar ? 'ar' : 'en', tone: s.tone || 'warm', focus: s.focus, company: T.company || '', role: T.role || '', activity: T.activity || '' });
    }

    /** The shared file is a JPEG: same name, .jpg. Downloads stay PNG. */
    fileName(type) {
      const name = super.fileName();
      return type === 'image/jpeg' ? name.replace(/\.png$/, '.jpg') : name;
    }

    /**
     * Post, Share or Download while the card still waits for a photo or logo (SPC, 5 November 2026): instead of
     * the design's trip back to the photo step, ask on the spot (tools/build-studio.mjs IMG_ASK): add it now, or
     * continue with initials, which carries on with the button that was pressed. Text that needs fixing still
     * goes back to its part first, as the design does.
     */
    preflight() {
      if (!this.cardIntact()) {
        this.showToast('This card was changed outside the studio. Reload the page to continue.');
        return false;
      }
      const st = this.state;
      const e = this.cardIssues();
      const waiting = (st.imgMode === 'photo' && !st.photo) || (st.imgMode === 'logo' && !st.logo);
      if (!waiting || e.headline || e.name || e.role || e.activity || !this.pressed) return super.preflight();
      this.setState({ imgAsk: st.imgMode });
      return false;
    }

    /**
     * Before every Download, Share and Post to LinkedIn (SPC, 5 November 2026): the card must still show the company
     * as licensed, checked against the server's data, not the page's state. Catches the company edited through the
     * browser's tools (Inspect, or a React tools extension). With "Just you" the card shows no company, so there is
     * nothing to check. Spacing, dash variants and invisible direction marks are ignored, since the card wraps and
     * marks names its own way. A deterrent, like client/guard.js: it cannot stop a downloaded card being edited.
     */
    cardIntact() {
      const node = this.cardRef.current;
      const s = this.state;
      if (!node || s.focus === 'personal') return true;
      const c = this.props.card;
      const want = s.lang === 'ar' ? c.company_ar || c.company_en : c.company_en;
      return !want || normName(node.textContent).includes(normName(want));
    }

    /** Keeps the button the customer pressed, so "Continue with initials" can carry on with it. */
    remember(fn) {
      return typeof fn === 'function' ? (...args) => { this.pressed = () => fn(...args); return fn(...args); } : fn;
    }

    imgAskVals() {
      const s = this.state;
      const logo = s.imgAsk === 'logo';
      if (!this.askFileRef) this.askFileRef = { current: null };
      return {
        hasImgAsk: !!s.imgAsk,
        imgAskAlign: (s.vw || 1280) < 760 ? 'flex-end' : 'center',
        imgAskTitle: logo ? 'Add your logo?' : 'Add your photo?',
        imgAskBody: logo
          ? 'Your card has a space for your logo. Add it now, or continue with your initials.'
          : 'Your card has a space for your photo. Add one now, or continue with your initials.',
        imgAskIcon: logo ? 'ph-buildings' : 'ph-user',
        imgAskAddLabel: logo ? 'Add logo' : 'Add photo',
        imgAskFileRef: this.askFileRef,
        imgAskAdd: () => {
          this.target = logo ? 'logo' : 'photo';
          this.setState({ imgAsk: null });
          if (this.askFileRef.current) this.askFileRef.current.click();
        },
        imgAskFile: (ev) => {
          this.askedFile = true;
          this.onFile(ev);
        },
        imgAskInitials: () => {
          const go = this.pressed;
          this.setState({ imgAsk: null, imgMode: 'initials' }, () => { if (go) go(); });
        },
        imgAskClose: (ev) => { if (!ev || ev.target === ev.currentTarget) this.setState({ imgAsk: null }); },
      };
    }

    /**
     * Choosing what the card shows of the photo (tools/build-studio.mjs, "Adjust your photo"). The card draws the
     * photo as the design does: background-size cover, background-position X% Y%, then scale(zoom) around that same
     * point. In photo pixels that is a window of slotW / (zoom × cover) wide whose left edge is
     * X × (coverW − slotW / zoom) / cover, so the window and (X, Y, zoom) convert both ways without changing how the
     * card is drawn. The slot's size and shape are read from the card itself, so every style and format is right.
     */
    measureCrop() {
      const s = this.state;
      if (s.imgMode !== 'photo' || !s.photo) return;
      if (this.dimsFor !== s.photo) {
        this.dimsFor = s.photo;
        const im = new Image();
        const src = s.photo;
        im.onload = () => { if (this.state.photo === src) this.setState({ photoDims: { w: im.naturalWidth, h: im.naturalHeight } }); };
        im.src = src;
      }
      const el = this.cardRef.current && this.cardRef.current.querySelector('[role="img"][aria-label="Photo"]');
      if (!el || !el.clientWidth || !el.clientHeight) return;
      let box = el.parentElement;
      while (box && box !== this.cardRef.current && getComputedStyle(box).borderTopLeftRadius === '0px') box = box.parentElement;
      const r = box && box !== this.cardRef.current ? getComputedStyle(box).borderTopLeftRadius : '0px';
      const slot = { W: el.clientWidth, H: el.clientHeight, r };
      const stageW = this.cropRef && this.cropRef.current ? this.cropRef.current.clientWidth : 0;
      const old = s.cropSlot;
      if (!old || old.W !== slot.W || old.H !== slot.H || old.r !== slot.r) this.setState({ cropSlot: slot });
      if (stageW && stageW !== s.cropStageW) this.setState({ cropStageW: stageW });
    }

    /** The photo window for the current position and zoom, in photo pixels; null until the sizes are known. */
    cropWindow(st = this.state) {
      const slot = st.cropSlot, dims = st.photoDims;
      if (!slot || !dims || !dims.w || !dims.h) return null;
      const z = st.photoZoom || 1;
      const [px, py] = String(st.photoPos || '50% 35%').split(' ').map(parseFloat);
      const X = (isNaN(px) ? 50 : px) / 100, Y = (isNaN(py) ? 35 : py) / 100;
      const s0 = Math.max(slot.W / dims.w, slot.H / dims.h);
      const spareX = dims.w * s0 - slot.W / z, spareY = dims.h * s0 - slot.H / z;
      return { s0, z, w: slot.W / (z * s0), h: slot.H / (z * s0), x: (X * spareX) / s0, y: (Y * spareY) / s0, slot, dims };
    }

    /** Moves the window so its centre is (cx, cy) in photo pixels, at zoom z, kept inside the photo. */
    setCrop(z, cx, cy) {
      const st = this.state;
      const slot = st.cropSlot, dims = st.photoDims;
      z = Math.round(Math.max(1, Math.min(2.5, z)) * 100) / 100;
      if (!slot || !dims) { this.setState({ photoZoom: z }); return; }
      const s0 = Math.max(slot.W / dims.w, slot.H / dims.h);
      const w = slot.W / (z * s0), h = slot.H / (z * s0);
      const x = Math.max(0, Math.min(dims.w - w, cx - w / 2)), y = Math.max(0, Math.min(dims.h - h, cy - h / 2));
      const spareX = dims.w * s0 - slot.W / z, spareY = dims.h * s0 - slot.H / z;
      const X = spareX > 0.5 ? (x * s0) / spareX : 0.5, Y = spareY > 0.5 ? (y * s0) / spareY : 0.35;
      this.setState({ photoZoom: z, photoPos: `${(X * 100).toFixed(1)}% ${(Y * 100).toFixed(1)}%` });
    }

    /** Zoom around the window's centre (the design zoomed around a point that moved as it zoomed). */
    zoomTo(z) {
      const c = this.cropWindow();
      if (!c) { this.setState({ photoZoom: Math.round(Math.max(1, Math.min(2.5, z)) * 100) / 100 }); return; }
      this.setCrop(z, c.x + c.w / 2, c.y + c.h / 2);
    }

    cropVals() {
      const s = this.state;
      if (!this.cropRef) this.cropRef = { current: null };
      const stageW = s.cropStageW || 300;
      const stageH = 200;
      const c = this.cropWindow();
      const zero = { stageH, imgL: 0, imgT: 0, imgW: 0, imgH: 0, winL: 0, winT: 0, winW: 0, winH: 0, innerL: 0, innerT: 0, radius: '0' };
      let crop = zero;
      if (c) {
        const pad = 12;
        const fs = Math.min((stageW - 2 * pad) / c.dims.w, (stageH - 2 * pad) / c.dims.h);
        const imgW = c.dims.w * fs, imgH = c.dims.h * fs;
        const imgL = (stageW - imgW) / 2, imgT = (stageH - imgH) / 2;
        const winW = c.w * fs, winH = c.h * fs;
        const r = c.slot.r;
        const radius = /%$/.test(r) ? r : `${((parseFloat(r) || 0) * winW) / c.slot.W}px`;
        this.cropFs = fs;
        crop = {
          stageH, imgL, imgT, imgW, imgH,
          winL: imgL + c.x * fs, winT: imgT + c.y * fs, winW, winH,
          innerL: -c.x * fs, innerT: -c.y * fs, radius,
        };
      }
      return {
        crop,
        cropRef: this.cropRef,
        cropDown: (e) => {
          const w = this.cropWindow();
          if (!w || !this.cropFs) return;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
          this.cropDrag = { px: e.clientX, py: e.clientY, cx: w.x + w.w / 2, cy: w.y + w.h / 2, z: w.z, fs: this.cropFs };
        },
        cropMove: (e) => {
          const d = this.cropDrag;
          if (!d) return;
          this.setCrop(d.z, d.cx + (e.clientX - d.px) / d.fs, d.cy + (e.clientY - d.py) / d.fs);
        },
        cropUp: () => { this.cropDrag = null; },
        zoomIn: () => this.zoomTo((s.photoZoom || 1) + 0.25),
        zoomOut: () => this.zoomTo((s.photoZoom || 1) - 0.25),
        onZoom: (e) => this.zoomTo(parseFloat(e.target.value) || 1),
      };
    }

    /** While the question is open: focus its first button, Escape closes it. Once a photo or logo is in, say so. */
    watchImgAsk(prev) {
      const open = !!this.state.imgAsk;
      if (open && !this.askKeys) {
        this.askKeys = (ev) => { if (ev.key === 'Escape') this.setState({ imgAsk: null }); };
        document.addEventListener('keydown', this.askKeys);
        const first = document.querySelector('[data-img-ask] button');
        if (first) first.focus();
      } else if (!open && this.askKeys) {
        document.removeEventListener('keydown', this.askKeys);
        this.askKeys = null;
      }
      if (this.askedFile && prev && (this.state.photo !== prev.photo || this.state.logo !== prev.logo)) {
        this.askedFile = false;
        this.showToast(`${this.state.imgMode === 'logo' ? 'Logo' : 'Photo'} added. Check how it looks, then post or share your card.`);
      }
    }

    /**
     * Desktop only (SPC, 18 October 2026): in the Details step, Next walks through its four parts in order (who it
     * is about, photo, details, headline) and only the last one leads to Share; Back walks back the same way. A
     * part with a problem (rejected wording in the details or a custom headline) stops Next with the design's own
     * toast, as that part's Done does. The phone layout has no steps and keeps the design's behaviour.
     */
    detailsNav(v) {
      if (v.mChips || !v.sq || typeof v.next !== 'function') return {};
      const s = this.state;
      if (s.step === 2) {
        // Back from Share lands on the last part, so Back keeps walking through the parts.
        return { back: () => { v.back(); clearTimeout(this.subT); this.setState({ sub: 3 }); this.partScroll = 3; this.scrollToPart(); } };
      }
      if (s.step === 0) {
        // Into Details: bring the part that opens on screen (the panel can sit below the card on narrow windows).
        return { next: () => { v.next(); if (this.state.step === 1) { this.partScroll = typeof this.state.sub === 'number' ? this.state.sub : 0; this.scrollToPart(); } } };
      }
      if (s.step !== 1) return {};
      const LABELS = ['Next: Photo', 'Next: Your details', 'Next: Headline', 'Next: Share'];
      const i = typeof s.sub === 'number' ? s.sub : null;
      const blocked = (k) => {
        const e = this.cardIssues();
        return (k === 2 && (e.name || e.role || e.activity)) || (k === 3 && e.headline);
      };
      const open = (k, doneK) => {
        clearTimeout(this.subT);
        this.partScroll = k;
        this.setState((st) => ({ sub: k, subDone: doneK === undefined ? st.subDone : Array.from(new Set([...st.subDone, doneK])) }));
      };
      return {
        nextLabel: i === null ? 'Next: Share' : LABELS[i],
        next: () => {
          if (i === null) { v.next(); return; }
          if (blocked(i)) { this.showToast('Please fix the highlighted text first.'); return; }
          if (i < 3) { open(i + 1, i); return; }
          open(null, 3);
          v.next();
        },
        back: () => {
          if (i !== null && i > 0) { open(i - 1); return; }
          v.back();
        },
      };
    }

    /**
     * After Next or Back opens a part: bring it on screen if it is not, e.g. when the panel sits below the card.
     * When the parts are changing height (animateParts), wait until they have settled.
     */
    scrollToPart(settling = false) {
      const k = this.partScroll;
      this.partScroll = null;
      if (typeof k !== 'number' || this.state.step !== 1) return;
      const go = () => {
        const box = document.querySelector('[data-parts]');
        const part = box && box.children[k];
        if (!part) return;
        // Side by side the panel's step content scrolls inside the panel (FIT_LOGIC); stacked, the page scrolls.
        const pane = part.closest('[data-step-panel]');
        const v = pane && pane.scrollHeight > pane.clientHeight + 1 ? pane.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        const r = part.getBoundingClientRect();
        if (r.top >= v.top && r.bottom <= v.bottom) return;
        part.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: r.height > (v.bottom - v.top) * 0.8 ? 'start' : 'nearest' });
      };
      if (settling) setTimeout(go, PART_MS + 20);
      else requestAnimationFrame(go);
    }

    // ---- Desktop motion (SPC, 5 November 2026): steps slide, parts open and close smoothly, the card softens
    // when it changes. Short and quiet, and none of it with reduced motion. The phone layout has its own.

    /**
     * Side by side, the panel's step content scrolls inside the panel (FIT_LOGIC). While more of it is below, it
     * fades out at the foot (data-more) and the "More below" chip shows; scrolled down, its top edge fades too
     * (data-top). The chip is in the tab order only while it shows; if it goes while it has focus, focus moves
     * on to the step's main button.
     */
    watchPanel() {
      const pane = document.querySelector('[data-step-panel]');
      if (!pane) return;
      const mark = () => {
        const more = pane.scrollTop + pane.clientHeight < pane.scrollHeight - 2;
        if (more !== pane.hasAttribute('data-more')) pane.toggleAttribute('data-more', more);
        const top = pane.scrollTop > 2;
        if (top !== pane.hasAttribute('data-top')) pane.toggleAttribute('data-top', top);
        const cue = document.querySelector('[data-more-cue]');
        if (cue && (cue.tabIndex === 0) !== more) {
          cue.tabIndex = more ? 0 : -1;
          cue.setAttribute('aria-hidden', more ? 'false' : 'true');
          if (!more && document.activeElement === cue) {
            const main = [...cue.parentElement.querySelectorAll('button')].filter((b) => b !== cue).pop();
            if (main) main.focus({ preventScroll: true });
          }
        }
      };
      if (pane !== this.watchedPane) {
        this.watchedPane = pane;
        pane.addEventListener('scroll', mark, { passive: true });
      }
      mark();
    }

    /** Before a render (client/dc.js): the Details parts' heights as they are on screen, mid-animation included. */
    beforeUpdate() {
      const box = document.querySelector('[data-parts]');
      return box ? { parts: [...box.children].map((el) => el.getBoundingClientRect().height) } : null;
    }

    /** Style, Details and Share: the new step comes in from the side you are heading, a row at a time. */
    animateStep(prev) {
      if (!prev || prev.step === this.state.step || reducedMotion()) return;
      const panel = document.querySelector('[data-step-panel]');
      if (!panel) return;
      const dx = this.state.step > prev.step ? 16 : -16;
      [...panel.children].slice(0, 8).forEach((el, i) => el.animate(
        [{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 360, delay: i * 45, easing: EASE_OUT, fill: 'backwards' },
      ));
    }

    /**
     * Details: when a part opens or closes, or what it shows changes (a photo, a different image option), each part
     * moves from the height it had to the height it has, and a part that changed shows its new content fading in.
     * Typing changes nothing here. Returns whether anything moved.
     */
    animateParts(prev, snap) {
      const s = this.state;
      const box = document.querySelector('[data-parts]');
      if (!prev || !box || !snap || !snap.parts || prev.step !== 1 || s.step !== 1 || reducedMotion()) return false;
      const phase = (st, i) => (st.sub === i ? 'open' : (st.subDone || []).includes(i) ? 'done' : 'next');
      const swapped = [...box.children].map((_, i) => phase(prev, i) !== phase(s, i));
      const shown = prev.imgMode !== s.imgMode || prev.focus !== s.focus || !!prev.photo !== !!s.photo
        || !!prev.logo !== !!s.logo || prev.hIdx !== s.hIdx;
      if (!shown && !swapped.some(Boolean)) return false;
      let moved = false;
      [...box.children].forEach((el, i) => {
        const from = snap.parts[i];
        if (from == null) return;
        el.getAnimations().forEach((a) => a.cancel());
        const to = el.getBoundingClientRect().height;
        if (swapped[i] && el.firstElementChild) {
          el.firstElementChild.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
            { duration: 300, delay: to > from ? 90 : 0, easing: EASE_OUT, fill: 'backwards' });
        }
        if (Math.abs(to - from) < 2) return;
        moved = true;
        el.style.overflow = 'hidden';
        const a = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: PART_MS, easing: EASE_OUT });
        a.onfinish = a.oncancel = () => { el.style.overflow = ''; };
      });
      return moved;
    }

    /** The card preview softens for a moment when its style, format, language or view changes. */
    animateStage(prev) {
      if (!prev || frameEl() || reducedMotion()) return;   // frameEl: the phone layout, which has animateFrame
      const s = this.state;
      if (prev.tpl === s.tpl && prev.format === s.format && prev.lang === s.lang && prev.view === s.view) return;
      const frame = this.cardRef && this.cardRef.current && this.cardRef.current.parentElement
        && this.cardRef.current.parentElement.parentElement;
      if (!frame) return;
      frame.getAnimations().forEach((a) => a.cancel());
      frame.animate([{ opacity: 0.45, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
    }

    /** Details as they came from the licence, for the current card language, trimmed. */
    detailsEdited() {
      const s = this.state;
      if (!this.licenceDetails) this.licenceDetails = this.fresh();
      const now = s.lang === 'ar' ? s.ar || {} : s;
      const was = s.lang === 'ar' ? this.licenceDetails.ar || {} : this.licenceDetails;
      return ['name', 'role', 'activity'].some((k) => String(now[k] || '').trim() !== String(was[k] || '').trim());
    }

    closeSheetSmoothly(close) {
      if (this.sheetClosing) return;
      const s = this.state;
      const e = typeof this.cardIssues === 'function' ? this.cardIssues() : {};
      const blocked = (s.sheet === 'headline' && e.headline) || (s.sheet === 'details' && (e.name || e.role || e.activity));
      const sheet = document.querySelector('[data-screen-label="Sheet"]');
      if (blocked || !sheet || reducedMotion()) { close(); return; }
      this.sheetClosing = true;
      sheet.classList.add('m-closing');
      setTimeout(() => { this.sheetClosing = false; close(); }, 240);
    }

    /** After a render: glide the frame from where it was (drawer toggled), or soften a style/format/language swap. */
    animateFrame(prevState) {
      const frame = frameEl();
      if (!frame) return;
      if (this.flipFrom) {
        const from = this.flipFrom;
        this.flipFrom = null;
        const to = frame.getBoundingClientRect();
        this.flipping = true;
        const restore = () => {
          this.flipping = false;
          frame.style.transition = this.flipTransition ?? '';
          const card = frame.querySelector('[data-lang]');
          if (card) card.style.transition = 'transform .25s var(--ease-standard)';
          this.flipTransition = null;
        };
        if (!to.width || !to.height) { restore(); return; }
        const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = from.height / to.height;
        const anim = frame.animate(
          [{ transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transformOrigin: '0 0', transform: 'none' }],
          { duration: 340, easing: EASE_OUT },
        );
        anim.onfinish = anim.oncancel = () => { restore(); this.fitChrome(); };
        return;
      }
      if (!prevState || reducedMotion()) return;
      if (prevState.tpl !== this.state.tpl || prevState.format !== this.state.format || prevState.lang !== this.state.lang) {
        frame.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      }
    }

    fresh() {
      const f = super.fresh();
      const c = this.props.card;
      const nameEn = cardName(c.name_en);
      const nameAr = cardName(c.name_ar) || nameEn;   // like the company: no Arabic name, the English one
      return {
        ...f,
        // Portrait first (SPC, 5 November 2026): it takes the most room in the LinkedIn phone feed. The design
        // starts on Square, which tools/compare-design.mjs (designExact) still gets.
        format: c.designExact === true ? f.format : 'portrait',
        company: c.company_en,
        name: nameEn, role: c.role_en ?? (nameEn ? 'Founder' : ''),
        activity: c.activity_en || '',
        lang: c.lang === 'ar' ? 'ar' : 'en',
        photo: null, photoNote: '',
        ar: { company: c.company_ar || c.company_en, name: nameAr, role: c.role_ar ?? (nameAr ? 'المؤسس' : ''), activity: c.activity_ar || '' },
      };
    }

    componentDidMount() {
      super.componentDidMount();
      this.fitStub();
      this.fitChrome();
      this.fitDesk();
      this.watchPanel();
      if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { this.forceUpdate(); this.fitStub(); });
    }

    componentDidUpdate(...args) {
      super.componentDidUpdate(...args);
      this.fitStub();
      this.fitChrome();
      this.fitDesk();
      this.animateFrame(args[1]);
      this.animateStage(args[1]);
      this.animateStep(args[1]);
      const settling = this.animateParts(args[1], args[2]);
      // A part that opened on its own (an answer, Looks right) comes into view too, not only after Next or Back.
      const prev = args[1];
      if (prev && prev.step === 1 && this.state.step === 1 && typeof this.state.sub === 'number' && prev.sub !== this.state.sub
        && typeof this.partScroll !== 'number') this.partScroll = this.state.sub;
      this.watchPanel();
      if (settling) setTimeout(() => this.watchPanel(), PART_MS + 20);
      this.watchOutsideTaps();
      this.watchImgAsk(args[1]);
      this.measureCrop();
      this.scrollToPart(settling);
    }

    stubKey() {
      const s = this.state;
      const T = s.lang === 'ar' ? { ...s, ...s.ar } : s;
      return `${s.format}|${s.lang}|${s.focus}|${(T.name || '').trim()}`;
    }

    /**
     * After layout: if the Launch Pass stub name still overflows, adjust and let React render again:
     * one line at the design's size -> two lines down to 75 % -> three lines down to 60 %.
     * Each pass changes 1 px or one line, so it settles in a few frames. The export clones this DOM.
     */
    /**
     * Phone layout only: how much height the page needs besides the card preview (header, headline, format
     * switch, style switcher, toolbar, Share bar), so the patched logic sizes the card to leave all of it on
     * screen. Measured rather than assumed: a long company name wraps the headline onto more lines. The
     * value does not depend on the card's own size, so setting it settles after one render.
     */
    /**
     * Desktop: where the workspace (the row holding the card and the panel) starts on the page, so the card preview
     * fits the window below it (tools/build-studio.mjs FIT_LOGIC).
     */
    fitDesk() {
      const st = this.stageRef && this.stageRef.current;
      const row = st && st.parentElement;
      if (!row || (this.state.vw || window.innerWidth) < 760) return;   // the desktop layout, side by side or stacked
      const top = Math.round(row.getBoundingClientRect().top + window.scrollY);
      if (Math.abs(top - (this.state.deskTop || 0)) > 1) this.setState({ deskTop: top });
    }

    fitChrome() {
      if (this.state.sheet || this.flipping) return;   // mid-glide the frame is transformed; measure once it lands
      const tools = document.querySelector('.m-chips');
      const bar = document.querySelector('.m-bar');
      const card = document.querySelector('[data-lang]');
      const section = card && card.closest('section');
      if (!tools || !bar || !section) return;
      let stage = card;
      while (stage.parentElement && stage.parentElement !== section) stage = stage.parentElement;
      const st = stage.getBoundingClientRect();
      const sec = section.getBoundingClientRect();
      if (!st.height) return;
      const chrome = Math.round(st.top + window.scrollY + (sec.bottom - st.bottom) + tools.getBoundingClientRect().height + bar.getBoundingClientRect().height);
      if (Math.abs(chrome - (this.state.chromeH || 0)) > 1) this.setState({ chromeH: chrome });
    }

    fitStub() {
      if (this.props.card.designExact) return;
      const node = this.cardRef && this.cardRef.current;
      const el = node && node.querySelector('[data-fit="stub"]');
      if (!el) return;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const clamped = (cs.webkitLineClamp || 'none') !== 'none';
      const lh = parseFloat(cs.lineHeight) || size * 1.1;
      const wide = el.scrollWidth > el.clientWidth + 1; // a single word wider than the stub
      const over = clamped ? wide || el.scrollHeight > el.clientHeight + lh * 0.5 : wide;
      if (!over) return;
      const lang = this.state.lang === 'ar' ? 'ar' : 'en';
      const base = STUB[this.state.format === 'landscape' ? 'ls' : 'sq'][lang];
      const key = this.stubKey();
      const lines = clamped ? parseInt(cs.webkitLineClamp, 10) || 2 : 1;
      if (lines === 1) { this.setState({ stubFit: { key, size, lines: 2 } }); return; }
      if (lines === 2 && size > Math.round(base * 0.75)) { this.setState({ stubFit: { key, size: size - 1, lines: 2 } }); return; }
      if (lines === 2) { this.setState({ stubFit: { key, size, lines: 3 } }); return; }
      if (size > Math.round(base * 0.6)) { this.setState({ stubFit: { key, size: size - 1, lines: 3 } }); return; }
      if (!this.state.stubFit || !this.state.stubFit.lastResort) this.setState({ stubFit: { key, size, lines: 3, lastResort: true } });
    }

    renderVals() {
      const v = super.renderVals();
      const c = this.props.card;
      const s = this.state;
      const ar = s.lang === 'ar';
      const D = dates(c.issued_on);
      // designExact (set only by tools/compare-design.mjs) renders the design's own sizes, so the comparison
      // proves the rendering is identical; the data fixes below are proven by tools/stress-cards.mjs.
      const exact = c.designExact === true;
      const est = exact ? { size: STUB[s.format === 'landscape' ? 'ls' : 'sq'][ar ? 'ar' : 'en'], xtra: '' } : stubName(v.nameText, ar ? 'ar' : 'en', s.format);
      const fit = !exact && s.stubFit && s.stubFit.key === this.stubKey() ? s.stubFit : null;
      const stub = fit ? { size: Math.min(est.size, fit.size), xtra: wrapCss(fit.lines || 2, fit.lastResort) } : est;
      const uae = s.hIdx === 4 || s.hIdx === 5;
      const lang = s.lang;
      const liOn = c.linkedin === true;
      const track = (fn, kind, network) => (typeof fn === 'function'
        ? (...args) => { beacon(c.token, { kind, lang, network, size: s.format }); return fn(...args); }
        : fn);
      return {
        ...v,
        kicker: ar ? `${uae ? 'انطلاقة في الإمارات' : 'مشروع جديد'} · ${D.monthYearAr}` : `${uae ? 'UAE launch' : 'New business'} · ${D.monthYearEn}`,
        monthYear: ar ? D.monthYearAr : D.monthYearEn,
        year: D.year,
        dateFull: ar ? D.fullAr : D.fullEn,
        calMonth: ar ? D.monthYearAr : D.calEn,
        calDay: D.day,
        calDaySize: calDaySizes(D.day).sq,
        calDaySizeLs: calDaySizes(D.day).ls,
        stubNameSq: stub.size,
        stubNameLs: stub.size,
        stubNameXtra: stub.xtra,
        coLockNote: ar
          ? `Arabic name as registered on license ${c.licence_number}. It can't be changed here.`
          : `As registered on license ${c.licence_number}. It can't be changed here.`,
        t: { ...v.t, estYear: ar ? `تأسست ${D.year}` : `EST. ${D.year}` },
        hdrTitle: `${c.company_en} is licensed.`,
        hdrDate: D.fullEn,
        hdrDateShort: D.shortEn,
        hasHdrActivity: !!c.activity_en,
        hdrActivity: c.activity_en || '',
        licenceNo: c.licence_number,
        // Desktop Share step intro (tools/build-studio.mjs DESKTOP_SHARE_ACTIONS); the phone layout does not use it.
        shareIntro: 'Share your card with your network on LinkedIn, WhatsApp, or any other social media app of your choice.',
        captionPlaceholder: (s.tone || 'warm') === 'custom' ? 'Write your own caption' : '',
        // Desktop "More below" chip (watchPanel shows it): scroll the panel's step content on by most of a screen.
        moreBelow: () => {
          const pane = document.querySelector('[data-step-panel]');
          if (pane) pane.scrollBy({ top: Math.max(120, pane.clientHeight * 0.6), behavior: reducedMotion() ? 'auto' : 'smooth' });
        },
        // Desktop "Check your details": confirm as they came from the licence, or save what was changed.
        detailsDoneLabel: this.detailsEdited() ? 'Save and continue' : 'Looks right',
        detailsDoneIcon: this.detailsEdited() ? 'ph-arrow-right' : 'ph-check',
        // Post to LinkedIn (tools/build-studio.mjs): first and primary when on; Share and Download step down.
        liOn,
        postLinkedIn: this.remember(() => this.postLinkedIn()),
        liLabel: s.liBusy ? 'Opening LinkedIn…' : 'Post to LinkedIn',
        liShort: s.liBusy ? 'Opening…' : 'LinkedIn',
        shareVariant: liOn ? 'secondary' : 'primary',
        dlVariant: liOn ? 'secondary' : v.dlVariant,
        mDlVariant: liOn ? 'secondary' : 'primary',
        mShareLabel: liOn ? (s.busy ? 'Preparing…' : 'Share') : v.shareLabel,
        mBarCols: liOn ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)',
        portalUrl: PORTAL_URL,
        goPortal: () => window.location.assign(PORTAL_URL),
        ...this.detailsNav(v),
        ...this.imgAskVals(),
        ...this.cropVals(),
        download: track(this.remember(v.download), 'download'),
        shareCard: track(this.remember(v.shareCard), 'share', 'native'),
        copyCaption: track(v.copyCaption, 'caption'),
        openLinkedIn: track(v.openLinkedIn, 'share', 'linkedin'),
      };
    }
  };
}
