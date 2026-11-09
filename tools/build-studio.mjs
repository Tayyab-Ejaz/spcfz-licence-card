// Builds the customer studio (the personal page) from the design exports in design/source/.
//
//   node tools/build-studio.mjs
//
// 1. Reads design/source/{studio,mobile}/template.html and applies DATA_PATCHES, which turn the design's
//    sample values (company, date, licence number, activity, portal link) into bindings. Every patch must
//    match exactly once, so a new export that moved them fails the build instead of shipping sample data.
// 2. Parses each template the way the design runtime does (encodeCase, then the HTML parser) and emits a
//    compact AST (client/generated/<name>.ast.json) that client/dc.js renders with React. No template code
//    is evaluated at runtime; every binding in these templates is a plain path lookup.
// 3. Wraps each logic class (design/source/<name>/logic.js, verbatim) as an ES module factory.
// 4. Writes public/studio/: the stylesheet (the template's <helmet> styles, hover rules, page CSS), the
//    referenced assets, the esbuild bundle of client/main.js, and manifest.json naming the hashed files.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseFragment } from 'parse5';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'design', 'source');
const GEN = path.join(ROOT, 'client', 'generated');
const OUT = path.join(ROOT, 'public', 'studio');
const ASSET_URL = '/static/studio/a/';
const LAYOUTS = ['studio', 'mobile'];

// ------------------------------------------------------------------ data patches

const SEP = '<span style="width:1px;height:14px;background:var(--spc-border)"></span>';
const DATA_PATCHES = {
  studio: [
    ['<span>Lumen &amp; Ledger FZ-LLC is licensed.</span>', '<span>{{ hdrTitle }}</span>'],
    ['<strong style="font-weight:600;color:var(--spc-ink)">8 October 2026</strong>', '<strong style="font-weight:600;color:var(--spc-ink)">{{ hdrDate }}</strong>'],
    [/<span>Activity <strong style="font-weight:600;color:var\(--spc-ink\)">Financial advisory for small businesses<\/strong><\/span>(\s*)<span style="width:1px;height:14px;background:var\(--spc-border\)"><\/span>/,
      `<sc-if value="{{ hasHdrActivity }}"><span>Main Activity <strong style="font-weight:600;color:var(--spc-ink)">{{ hdrActivity }}</strong></span>$1${SEP}</sc-if>`],
    ['<strong style="font-weight:600;color:var(--spc-ink)">4425153.01</strong>', '<strong style="font-weight:600;color:var(--spc-ink)">{{ licenceNo }}</strong>'],
    ['<a href="#" ', '<a href="{{ portalUrl }}" '],
  ],
  mobile: [
    ['<span>Lumen &amp; Ledger FZ-LLC is licensed.</span>', '<span>{{ hdrTitle }}</span>'],
    ['Issued 8 Oct 2026 · License no. 4425153.01', 'Issued on {{ hdrDateShort }} · License no. {{ licenceNo }}'],
    ['<a href="#" ', '<a href="{{ portalUrl }}" '],
  ],
};
// Robustness patches for real data, applied to both layouts (docs/ARCHITECTURE.md section 7). Each binds a
// value that client/card-data.js sets to the design's own value for the design's sample data, so the
// sample still renders pixel-identically, and adapts it for data the design did not show.
const ROBUSTNESS_PATCHES = [
  // Day One: the day number was sized for one digit ("8"); two digits must stay inside the diamond.
  ['font-size:260px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}',
    'font-size:{{ calDaySize }}px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}'],
  ['font-size:160px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}',
    'font-size:{{ calDaySizeLs }}px;font-weight:800;line-height:1;letter-spacing:-.06em;color:var(--spc-ink)">{{ calDay }}'],
  // Launch Pass stub: one line with an ellipsis cuts long founder names; let them wrap to two lines.
  [/opacity:\{\{ nameOpacity \}\};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\{\{ nameText \}\}<\/span>(\s*)<sc-if value="\{\{ hasRole \}\}"><span style="font-size:20px/,
    'opacity:{{ nameOpacity }};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;{{ stubNameXtra }}">{{ nameText }}</span>$1<sc-if value="{{ hasRole }}"><span style="font-size:20px'],
  [/opacity:\{\{ nameOpacity \}\};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\{\{ nameText \}\}<\/span>(\s*)<sc-if value="\{\{ hasRole \}\}"><span style="font-size:15px/,
    'opacity:{{ nameOpacity }};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;{{ stubNameXtra }}">{{ nameText }}</span>$1<sc-if value="{{ hasRole }}"><span style="font-size:15px'],
];
// Mark the stub name so client/card-data.js can measure the laid-out element and shrink it until it fits.
ROBUSTNESS_PATCHES.push(
  ['<span style="font-size:{{ stubNameSq }}px;', '<span data-fit="stub" style="font-size:{{ stubNameSq }}px;'],
  ['<span style="font-size:{{ stubNameLs }}px;', '<span data-fit="stub" style="font-size:{{ stubNameLs }}px;'],
);
DATA_PATCHES.studio.push(...ROBUSTNESS_PATCHES);

// Desktop Share step (SPC, 17–18 October 2026). The design's version led with "Download, then post it on LinkedIn",
// put the phone-worded Share hint between the two buttons and had an Open LinkedIn button. Now: an intro that
// leads with Share, then Share and a full-width Download stacked with one gap; no hint text and no LinkedIn
// shortcut. The phone layout is untouched.
// Post to LinkedIn (SPC, 27 October 2026): when the service has LinkedIn set up (card data `linkedin`), a first,
// primary button posts the card straight to the customer's LinkedIn (src/linkedin/); Share and Download follow.
const DESKTOP_SHARE_ACTIONS = `<p style="font-size:14.5px;line-height:1.5;color:var(--spc-muted);text-wrap:pretty">{{ shareIntro }}</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <sc-if value="{{ liOn }}" hint-placeholder-val="{{ false }}">
              <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="lg" sc-camel-on-click="{{ postLinkedIn }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-linkedin-logo" style="font-size:19px"></i><span>{{ liLabel }}</span></x-import>
            </sc-if>
            <sc-if value="{{ canShare }}" hint-placeholder-val="{{ false }}">
              <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="{{ shareVariant }}" size="lg" sc-camel-on-click="{{ shareCard }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-share-network" style="font-size:18px"></i><span>{{ shareLabel }}</span></x-import>
            </sc-if>
            <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="{{ dlVariant }}" size="lg" sc-camel-on-click="{{ download }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-download-simple" style="font-size:18px"></i><span>{{ downloadLabel }}</span></x-import>
          </div>`;
// Desktop, last step (SPC, 18 October 2026): a Done button that takes the customer back to the portal, in place
// of the "Step 3 of 3" label. Same tab, like the header's "Back to Customer Portal" link.
DATA_PATCHES.studio.push([
  '<sc-if value="{{ isStep2 }}"><span style="font-size:13px;font-weight:600;color:var(--spc-muted)">Step 3 of 3</span></sc-if>',
  '<sc-if value="{{ isStep2 }}"><x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="md" sc-camel-on-click="{{ goPortal }}" hint-size="120px,46px"><span>Done</span><i class="ph-bold ph-check" style="font-size:15px"></i></x-import></sc-if>',
]);
DATA_PATCHES.studio.push(
  [/<p style="font-size:14\.5px;line-height:1\.5;color:var\(--spc-muted\);text-wrap:pretty">Download your card, then post it on LinkedIn with the caption below\.<\/p>[\s\S]*?LinkedIn opens with your caption filled in[^<]*<\/p>\s*<\/div>/,
    DESKTOP_SHARE_ACTIONS],
);

// Both layouts (SPC, 17 October 2026): no LinkedIn "@SPC Free Zone" tagging tip under the caption.
for (const layout of ['studio', 'mobile']) {
  DATA_PATCHES[layout].push([/\s*<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:14px;background:var\(--blue-50\)">\s*<i class="ph-bold ph-at"[\s\S]*?<\/div>/, '']);
}
DATA_PATCHES.mobile.push(...ROBUSTNESS_PATCHES);

// Phone layout changes SPC asked for on 16 October 2026:
// - the share bar keeps only its main button: the "Download card" / "Open LinkedIn" links under Share, and the
//   "Open LinkedIn and attach it" link under Download (phones that cannot share files), are gone;
// - the six editing controls (Headline, Photo, Details, About, Language, Caption) show at once, as one toolbar
//   row with the icon above the label, instead of a sideways-scrolling row where only three and a half showed;
// - the card preview is sized from the space the page really leaves (client/card-data.js measures it into
//   state.chromeH), so the headline, card, style switcher, toolbar and Share button fit one screen.
DATA_PATCHES.mobile.push(
  [/\s*<div style="display:flex;justify-content:center;gap:4px">[\s\S]*?Open LinkedIn<i [^>]*><\/i><\/span>\s*<\/div>/, ''],
  [/\s*<div style="display:flex;justify-content:center">\s*<span sc-camel-on-click="\{\{ openLinkedIn \}\}"[\s\S]*?<\/span>\s*<\/div>/, ''],
  ['<div style="display:flex;gap:8px;overflow-x:auto;padding:4px 16px 14px;scrollbar-width:none">',
    '<div class="m-chips m-in" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;padding:2px 12px 10px">'],
  ['position:relative;flex-shrink:0;display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 15px;border-radius:999px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--spc-border);font-size:13.5px;',
    'position:relative;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;padding:6px 2px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--spc-border);font-size:11.5px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;'],
  ['<i class="ph-bold {{ c.icon }}" style="font-size:16px;color:var(--spc-blue)"></i>',
    '<i class="ph-bold {{ c.icon }}" style="font-size:20px;color:var(--spc-blue)"></i>'],
  ['<span style="position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--danger-500, #d92d20)"></span>',
    '<span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--danger-500, #d92d20)"></span>'],
  // Motion hooks (client/card-data.js and MOBILE_CSS): what fades in when the drawer closes, and the card frame.
  ['<div style="display:flex;flex-direction:column;gap:6px;padding:18px 16px 4px"', '<div class="m-in" style="display:flex;flex-direction:column;gap:6px;padding:18px 16px 4px"'],
  ['<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:4px;width:100%;box-sizing:border-box;background:var(--spc-soft)',
    '<div class="m-in" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:4px;width:100%;box-sizing:border-box;background:var(--spc-soft)'],
  ['<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%">',
    '<div class="m-in" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%">'],
  ['<div style="width:{{ dispW }}px;height:{{ dispH }}px;max-width:100%;overflow:hidden;position:relative;transition:width .25s var(--ease-standard),height .25s var(--ease-standard)">',
    '<div class="m-frame" style="width:{{ dispW }}px;height:{{ dispH }}px;max-width:100%;overflow:hidden;position:relative;transition:width .25s var(--ease-standard),height .25s var(--ease-standard)">'],
  // The card inside the frame rescales with it instead of jumping while the frame eases to its new size.
  ['transform:scale({{ scale }});transform-origin:0 0;overflow:hidden;font-family:var(--font-sans);-webkit-font-smoothing:antialiased;background:#fff">',
    'transform:scale({{ scale }});transform-origin:0 0;transition:transform .25s var(--ease-standard);overflow:hidden;font-family:var(--font-sans);-webkit-font-smoothing:antialiased;background:#fff">'],
  ['<div style="position:sticky;bottom:0;margin-top:auto;display:flex;flex-direction:column;gap:6px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--spc-border)">',
    '<div class="m-bar m-in" style="position:sticky;bottom:0;margin-top:auto;display:grid;grid-template-columns:{{ mBarCols }};gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--spc-border)">'
    + '\n      <sc-if value="{{ liOn }}" hint-placeholder-val="{{ false }}">'
    + '\n        <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="lg" sc-camel-on-click="{{ postLinkedIn }}" style="display:block;min-width:0" hint-size="100%,54px"><i class="ph-bold ph-linkedin-logo" style="font-size:19px"></i><span>{{ liShort }}</span></x-import>'
    + '\n      </sc-if>'],
  // Post to LinkedIn (27 October 2026): beside it, Share (or Download) steps down to the secondary style.
  ['variant="primary" size="lg" sc-camel-on-click="{{ shareCard }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-share-network" style="font-size:18px"></i><span>{{ shareLabel }}</span>',
    'variant="{{ shareVariant }}" size="lg" sc-camel-on-click="{{ shareCard }}" style="display:block;min-width:0" hint-size="100%,54px"><i class="ph-bold ph-share-network" style="font-size:18px"></i><span>{{ mShareLabel }}</span>'],
  ['variant="primary" size="lg" sc-camel-on-click="{{ download }}" style="display:block" hint-size="100%,54px">',
    'variant="{{ mDlVariant }}" size="lg" sc-camel-on-click="{{ download }}" style="display:block;min-width:0" hint-size="100%,54px">'],
);

// Both layouts (SPC, 5 November 2026): Post, Share or Download pressed while the card still waits for a photo (or
// logo) asks right there: add one now, or continue with initials (client/card-data.js preflight). The design sent
// the customer back to the photo step with a toast instead. A centred card on desktop, a bottom card on phones.
// The prompt has its own file input, always on the page: the design's sits inside desktop step 1 only.
const IMG_ASK = `<input type="file" accept="image/*" ref="{{ imgAskFileRef }}" sc-camel-on-change="{{ imgAskFile }}" style="display:none">
<sc-if value="{{ hasImgAsk }}" hint-placeholder-val="{{ false }}">
  <div sc-camel-on-click="{{ imgAskClose }}" style="position:fixed;inset:0;z-index:60;display:flex;align-items:{{ imgAskAlign }};justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom));background:rgba(7,19,41,.45)">
    <div data-img-ask="" role="dialog" aria-modal="true" aria-labelledby="img-ask-title" style="width:100%;max-width:400px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:22px 20px 20px;border-radius:20px;background:#fff;box-shadow:0 18px 48px rgba(7,19,41,.22)">
      <div style="display:flex;flex-direction:column;gap:6px">
        <p id="img-ask-title" style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:var(--spc-ink)">{{ imgAskTitle }}</p>
        <p style="margin:0;font-size:14.5px;line-height:1.5;color:var(--spc-muted);text-wrap:pretty">{{ imgAskBody }}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="lg" sc-camel-on-click="{{ imgAskAdd }}" style="display:block" hint-size="100%,54px"><i class="ph-bold {{ imgAskIcon }}" style="font-size:18px"></i><span>{{ imgAskAddLabel }}</span></x-import>
        <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="secondary" size="lg" sc-camel-on-click="{{ imgAskInitials }}" style="display:block" hint-size="100%,54px"><span>Continue with initials</span></x-import>
      </div>
    </div>
  </div>
</sc-if>

<sc-if value="{{ hasToast }}"`;
for (const layout of ['studio', 'mobile']) DATA_PATCHES[layout].push(['<sc-if value="{{ hasToast }}"', IMG_ASK]);

// Both layouts (SPC, 5 November 2026): the Google review request (client/card-data.js maybeAskReview), once, after
// the first download or share. Neutral words and no stars to tap here: everyone is asked the same way, and the
// rating is given on Google. Shaped like the photo prompt above.
const REVIEW_ASK = `<sc-if value="{{ hasReviewAsk }}" hint-placeholder-val="{{ false }}">
  <div sc-camel-on-click="{{ reviewClose }}" style="position:fixed;inset:0;z-index:60;display:flex;align-items:{{ reviewAskAlign }};justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom));background:rgba(7,19,41,.45)">
    <div data-review-ask="" role="dialog" aria-modal="true" aria-labelledby="review-ask-title" style="width:100%;max-width:400px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:22px 20px 20px;border-radius:20px;background:#fff;box-shadow:0 18px 48px rgba(7,19,41,.22)">
      <div style="display:flex;flex-direction:column;gap:6px">
        <p id="review-ask-title" style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:var(--spc-ink)">How was getting your licence with SPC Free Zone?</p>
        <p style="margin:0;font-size:14.5px;line-height:1.5;color:var(--spc-muted);text-wrap:pretty">A short Google review helps other founders find us. It takes a minute.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="primary" size="lg" sc-camel-on-click="{{ reviewGo }}" style="display:block" hint-size="100%,54px"><i class="ph-bold ph-star" style="font-size:18px"></i><span>Leave a Google review</span></x-import>
        <x-import component-from-global-scope="SPCFreeZoneDesignSystem_792df0.Button" variant="secondary" size="lg" sc-camel-on-click="{{ reviewLater }}" style="display:block" hint-size="100%,54px"><span>Not now</span></x-import>
      </div>
    </div>
  </div>
</sc-if>

<sc-if value="{{ hasToast }}"`;
for (const layout of ['studio', 'mobile']) DATA_PATCHES[layout].push(['<sc-if value="{{ hasToast }}"', REVIEW_ASK]);

// Adjust your photo (SPC, 5 November 2026). The design's − and + beside the zoom slider were icons only, and the
// desktop preview was a small circle whatever the card's photo shape. Now − and + zoom (both layouts), and on
// desktop a crop view replaces the circle: the whole photo, dimmed, with a frame in the shape of the card's photo
// space showing exactly what the card shows. Drag the frame to choose; zoom keeps its centre
// (client/card-data.js crop*).
const zoomBtn = (dir, size) => `<button type="button" aria-label="Zoom ${dir === 'minus' ? 'out' : 'in'}" sc-camel-on-click="{{ ${dir === 'minus' ? 'zoomOut' : 'zoomIn'} }}" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;padding:0;border:0;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1px var(--spc-border);color:var(--spc-ink);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation"><i class="ph-bold ph-${dir}" style="font-size:13px"></i></button>`;
const ZOOM_ICON = (dir) => `<i class="ph-bold ph-${dir}" style="font-size:13px;color:var(--spc-muted)"></i>`;
DATA_PATCHES.studio.push(
  [/<div style="display:flex;align-items:center;gap:18px;padding:14px;border-radius:18px;background:var\(--spc-soft\)">\s*<div sc-camel-on-pointer-down="\{\{ adjDown \}\}"[\s\S]*?<\/div>\s*<\/div>/,
    `<div style="display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:18px;background:var(--spc-soft)">
                    <div ref="{{ cropRef }}" sc-camel-on-pointer-down="{{ cropDown }}" sc-camel-on-pointer-move="{{ cropMove }}" sc-camel-on-pointer-up="{{ cropUp }}" sc-camel-on-pointer-cancel="{{ cropUp }}" style="position:relative;width:100%;height:{{ crop.stageH }}px;border-radius:12px;overflow:hidden;background:#071329;cursor:grab;touch-action:none;user-select:none">
                      <div style="position:absolute;left:{{ crop.imgL }}px;top:{{ crop.imgT }}px;width:{{ crop.imgW }}px;height:{{ crop.imgH }}px;background-image:{{ photoBg }};background-size:100% 100%;opacity:.35;pointer-events:none"></div>
                      <div style="position:absolute;left:{{ crop.winL }}px;top:{{ crop.winT }}px;width:{{ crop.winW }}px;height:{{ crop.winH }}px;border-radius:{{ crop.radius }};overflow:hidden;box-shadow:0 0 0 2px #fff,0 6px 18px rgba(7,19,41,.45);pointer-events:none">
                        <div style="position:absolute;left:{{ crop.innerL }}px;top:{{ crop.innerT }}px;width:{{ crop.imgW }}px;height:{{ crop.imgH }}px;background-image:{{ photoBg }};background-size:100% 100%"></div>
                      </div>
                    </div>`],
  ['Drag the photo to move it. Use the slider to zoom.', 'Drag the frame to choose what shows on your card. Use − and + to zoom.'],
  [ZOOM_ICON('minus'), zoomBtn('minus', 32)],
  [ZOOM_ICON('plus'), zoomBtn('plus', 32)],
);
DATA_PATCHES.mobile.push([ZOOM_ICON('minus'), zoomBtn('minus', 40)], [ZOOM_ICON('plus'), zoomBtn('plus', 40)]);

// Phone layout, iPhone keyboard (SPC, 9 November 2026): the drawer sits at the bottom of the visible area, on top of
// the keyboard, and the page is pinned to the top of it while the keyboard is open (client/card-data.js
// watchKeyboard). Without the keyboard both are as before (bottom 0; relative with no offset).
DATA_PATCHES.mobile.push(
  ['<div data-screen-label="Sheet" style="position:fixed;left:50%;bottom:0;transform:translateX(-50%);',
    '<div data-screen-label="Sheet" style="position:fixed;left:50%;bottom:{{ sheetBottom }}px;transform:translateX(-50%);'],
  ['<div style="position:relative;max-width:480px;margin:0 auto;min-height:{{ vhPx }}px;height:{{ wrapH }};',
    '<div style="position:{{ wrapPos }};top:{{ wrapTop }}px;left:0;right:0;max-width:480px;margin:0 auto;min-height:{{ vhPx }}px;height:{{ wrapH }};'],
);

// Logic patches: the same exactly-once rule, applied to design/source/<layout>/logic.js before it is wrapped.
// Share (SPC, 19 October 2026): hand the share menu the image only. With text alongside, LinkedIn's app keeps the
// text and drops the image. The caption is still copied to the clipboard first; after sharing, a toast says to paste
// it (or where to copy it from, when the clipboard refused).
const SHARE_PATCHES = [
  // The shared file takes the type and name of what renderCard returns (a JPEG since client/card-render.js).
  ["if (blob) this.cached = { key, file: new File([blob], this.fileName(), { type: 'image/png' }) }",
    "if (blob) this.cached = { key, file: new File([blob], this.fileName(blob.type), { type: blob.type || 'image/png' }) }"],
  ["        file = new File([blob], this.fileName(), { type: 'image/png' });",
    "        file = new File([blob], this.fileName(blob.type), { type: blob.type || 'image/png' });"],
  ['    this.copyText(caption);\n', '    const copied = this.copyText(caption);\n'],
  ['await navigator.share({ files: [file], text: caption });',
    "await navigator.share({ files: [file] }); this.markSaved && this.markSaved(); copied.then((ok) => this.showToast(ok ? 'Caption copied. Paste it into your post.' : 'Copy the caption from Caption, then paste it into your post.'));"],
];
// SPC's content writer (LinkedIn Milestone.xlsx, 5 November 2026). Wording only, both layouts where both show it:
// step headings and subcopy, the Standard style (was Daylight), format notes and order (Portrait first), who-is-it-
// about and image options, the activity field, headlines (four presets and "Write custom headline"; the two UAE
// expansion presets are gone, so the "UAE launch" kicker no longer appears), caption tabs (Short became Custom, which
// starts empty) and their note. The captions themselves are in src/linkedin/captions.ts.
DATA_PATCHES.studio.push(
  ['Choose a style</h2>', 'Choose a template</h2>'],
  // No line under the Style heading (SPC, 5 November 2026), not even the writer's "Switch between styles at any point."
  ['<p style="font-size:14.5px;line-height:1.5;color:var(--spc-muted);text-wrap:pretty">Every style uses the same details, so you can switch at any point.</p>', ''],
  ['">Daylight</span>', '">Standard</span>'],
  ['Your details come from your license. The company name is locked; other changes only affect the card.',
    'These have been auto-filled from your license. All details (except company name) can be modified for the card.'],
  ['">Share it</h2>', '">Share the Joy!</h2>'],
  ['<span>Issued <strong', '<span>Issued on <strong'],
  [/( *<span sc-camel-on-click="\{\{ fmtSquare \}\}"[^\n]*\n)( *<span sc-camel-on-click="\{\{ fmtPortrait \}\}"[^\n]*\n)/, '$2$1'],
);
for (const layout of ['studio', 'mobile']) {
  DATA_PATCHES[layout].push(['<textarea dir="{{ dir }}" value="{{ caption }}"', '<textarea dir="{{ dir }}" value="{{ caption }}" placeholder="{{ captionPlaceholder }}"']);
}
// The role and activity boxes showed the trimmed text, so a space typed at the end vanished at once ("Managing
// Director" or "Book publishing" could not be typed). The boxes now show what was typed; the card, the checks and
// the summaries still use the trimmed text.
for (const layout of ['studio', 'mobile']) {
  DATA_PATCHES[layout].push(['value="{{ role }}"', 'value="{{ roleInput }}"'], ['value="{{ activity }}"', 'value="{{ activityInput }}"']);
}
const INPUT_LOGIC = [
  ['name: T.name, company: T.company, isAr: ar,', 'name: T.name, roleInput: T.role, activityInput: T.activity, company: T.company, isAr: ar,'],
];
const CONTENT_LOGIC = [
  ["const presets = ar ? ['بدأنا العمل رسمياً.', 'اليوم الأول.', 'أصبح الأمر رسمياً.', 'أبوابنا مفتوحة الآن.', 'الآن في الإمارات.', 'افتتحنا فرعنا في الإمارات.'] : ['Officially in business.', 'Day one.', \"It's official.\", 'Now open for business.', 'Now in the UAE.', 'Our UAE branch is open.'];",
    "const presets = ar ? ['مفتوحون للأعمال!', 'اليوم الأول!', 'أصبح الأمر رسمياً!', 'أبوابنا مفتوحة الآن.', '', ''] : ['Open for business!', 'Day one!', \"It's official!\", 'Now open for business.', '', ''];"],
  // Slots 4 and 5 (the UAE presets) are no longer offered; 6 stays the custom headline, as the design numbers it.
  ["const chips = [...presets, 'Write your own'].map((label, i) => {",
    "const chips = [...presets, 'Write custom headline'].map((label, i) => [label, i]).filter(([, i]) => i < 4 || i === 6).map(([label, i]) => {"],
  ["['short', 'Short']", "['custom', 'Custom']"],
  ["'Suggested from your details. Edit it however you like.'", "'Edit these captions to add or remove details.'"],
  ["LinkedIn\\'s standard wide image size, good for desktop feeds.", 'Best for laptops.'],
  ['Works in any feed.', 'Good on any device.'],
  ['Fills more of the screen on phones.', 'Best for phones.'],
  ["'You and your company', 'Your name and role, plus the company name'", "'You and your company', 'Your name, role, and company name'"],
  ["'The company', 'Company name and activity, without your name'", "'The company', 'Company name and main activity'"],
  ["'A headshot, JPG or PNG. Drop it here or click.'", "'JPG or PNG works best'"],
  ["'Upload your company logo'", "'Upload your logo'"],
  ["'PNG with a transparent background works best'", "'Use a PNG file with a transparent background'"],
  ['desc: `"${imgIni}" in SPC blue, nothing to upload`', "desc: 'Add your initials'"],
  ["actFieldLabel: s.focus === 'personal' ? 'What you do' : 'What your company does'", "actFieldLabel: 'What your business does'"],
  // Not the resolution (SPC, 5 November 2026): customers only need to know it worked.
  ["'Card downloaded at 2× resolution. It\\'s ready to post.'", "'Your card is downloaded and ready to post.'"],
  // A download (and a completed share, in SHARE_PATCHES) means the customer has their card: client/card-data.js
  // stops asking before the page is left until they change something again.
  ["      this.showToast('Your card is downloaded and ready to post.');", "      this.markSaved && this.markSaved();\n      this.showToast('Your card is downloaded and ready to post.');"],
];
const MOBILE_CONTENT_LOGIC = [
  ["names = { daylight: 'Daylight',", "names = { daylight: 'Standard',"],
  ["styleName: names[s.tpl] || 'Daylight'", "styleName: names[s.tpl] || 'Standard'"],
  ["fmtOpts: [['square', 'Square', 12, 12], ['portrait', 'Portrait', 10, 13], ['landscape', 'Landscape', 15, 9]]",
    "fmtOpts: [['portrait', 'Portrait', 10, 13], ['square', 'Square', 12, 12], ['landscape', 'Landscape', 15, 9]]"],
];

// One canvas height for every format (SPC, 5 November 2026). In the card preview the desktop stage keeps the height a
// portrait card takes at this window size, and a square or landscape card sits centred in it, so switching formats
// moves neither the stage nor the panel beside or below it. The feed preview (Share step) keeps its own height. The
// phone layout already does this: its card area is a fixed height while a sheet is open.
DATA_PATCHES.studio.push(
  ['      <div style="position:relative;z-index:1;width:{{ dispW }}px;max-width:100%;background:#fff;',
    '      <div style="position:relative;z-index:1;align-self:stretch;flex:1 0 auto;min-height:{{ frameBoxH }}px;display:flex;align-items:center;justify-content:center"><div style="position:relative;z-index:1;width:{{ dispW }}px;max-width:100%;background:#fff;'],
  ['      </div>\n      <sc-if value="{{ feed }}" hint-placeholder-val="{{ false }}"><span style="position:relative;z-index:1;font-size:12.5px',
    '      </div></div>\n      <sc-if value="{{ feed }}" hint-placeholder-val="{{ false }}"><span style="position:relative;z-index:1;font-size:12.5px'],
);
// Desktop motion (SPC, 5 November 2026; client/card-data.js animateStep, animateParts, animateStage). Markers for
// the step panels and the Details parts; the line between steps fills instead of switching colour, and a step's
// tick pops in when it is done. "Looks right" becomes "Save and continue" once a detail differs from the licence.
DATA_PATCHES.studio.push(
  ['<sc-if value="{{ isStep0 }}" hint-placeholder-val="{{ true }}">\n        <div style="display:flex;flex-direction:column;gap:22px">',
    '<sc-if value="{{ isStep0 }}" hint-placeholder-val="{{ true }}">\n        <div data-step-panel="0" style="display:flex;flex-direction:column;gap:18px;flex:{{ panelFlex }};min-height:0;overflow-y:{{ panelScroll }};overscroll-behavior:contain;padding:{{ panelPad }};margin:{{ panelMargin }}">'],
  ['<sc-if value="{{ isStep1 }}" hint-placeholder-val="{{ false }}">\n        <div style="display:flex;flex-direction:column;gap:18px">',
    '<sc-if value="{{ isStep1 }}" hint-placeholder-val="{{ false }}">\n        <div data-step-panel="1" style="display:flex;flex-direction:column;gap:18px;flex:{{ panelFlex }};min-height:0;overflow-y:{{ panelScroll }};overscroll-behavior:contain;padding:{{ panelPad }};margin:{{ panelMargin }}">'],
  ['<sc-if value="{{ isStep2 }}" hint-placeholder-val="{{ false }}">\n        <div style="display:flex;flex-direction:column;gap:22px">',
    '<sc-if value="{{ isStep2 }}" hint-placeholder-val="{{ false }}">\n        <div data-step-panel="2" style="display:flex;flex-direction:column;gap:22px;flex:{{ panelFlex }};min-height:0;overflow-y:{{ panelScroll }};overscroll-behavior:contain;padding:{{ panelPad }};margin:{{ panelMargin }}">'],
  ['<div style="display:flex;flex-direction:column;border-bottom:1px solid var(--spc-border)">',
    '<div data-parts="" style="display:flex;flex-direction:column;border-bottom:1px solid var(--spc-border)">'],
  ['<sc-if value="{{ st.done }}"><i class="ph-bold ph-check" style="font-size:14px"></i></sc-if>',
    '<sc-if value="{{ st.done }}"><i class="ph-bold ph-check spc-pop" style="font-size:14px"></i></sc-if>'],
  ['<span style="flex:1;min-width:12px;height:2px;border-radius:2px;background:{{ st.lineBg }}"></span>',
    '<span style="flex:1;min-width:12px;height:2px;border-radius:2px;background:linear-gradient(var(--success-500),var(--success-500)) 0 0/{{ st.lineFill }} 100% no-repeat,var(--spc-border);transition:background-size .5s cubic-bezier(.2,.8,.2,1)"></span>'],
  ['<span>Looks right</span><i class="ph-bold ph-check" style="font-size:13px"></i>',
    '<span>{{ detailsDoneLabel }}</span><i class="ph-bold {{ detailsDoneIcon }}" style="font-size:13px"></i>'],
);
// Colour changes in the side panel (a chosen template's ring, the format and language switches, a field's border)
// ease instead of snapping. :where() keeps this below every rule of the design system's own components.
const STUDIO_MOTION_CSS = [
  ':where([data-screen-label="Customize"]) *{transition-property:background-color,border-color,color,box-shadow;transition-duration:.2s;transition-timing-function:ease}',
  '@keyframes spc-pop{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:none}}',
  '.spc-pop{display:inline-block;animation:spc-pop .4s cubic-bezier(.2,.8,.2,1) both}',
  '@media (prefers-reduced-motion:reduce){:where([data-screen-label="Customize"]) *{transition:none!important}.spc-pop{animation:none}}',
  // The panel's step content, while more of it is below (client/card-data.js watchPanel): it fades out at the foot,
  // and the "See more" chip shows (its caret nudges down twice as it appears).
  '[data-step-panel][data-more]{-webkit-mask-image:linear-gradient(#000 calc(100% - 40px),transparent);mask-image:linear-gradient(#000 calc(100% - 40px),transparent)}',
  // Scrolled down, its top edge softens the same way rather than cutting through a row.
  '[data-step-panel][data-top]{-webkit-mask-image:linear-gradient(transparent,#000 24px);mask-image:linear-gradient(transparent,#000 24px)}',
  '[data-step-panel][data-top][data-more]{-webkit-mask-image:linear-gradient(transparent,#000 24px,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(transparent,#000 24px,#000 calc(100% - 40px),transparent)}',
  '[data-more-cue]{opacity:0;transform:translate(-50%,-30%);pointer-events:none;transition:opacity .2s ease,transform .25s cubic-bezier(.2,.8,.2,1)}',
  '[data-more-cue]:focus-visible{outline:2px solid var(--spc-blue);outline-offset:2px}',
  '[data-more-cue]:hover{box-shadow:0 0 0 1px var(--blue-200,#c7d6ff),0 8px 20px rgba(0,77,255,.16)!important}',
  '[data-step-panel][data-more]~[data-nav] [data-more-cue]{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}',
  '@keyframes spc-nudge{0%,100%{transform:none}50%{transform:translateY(2px)}}',
  '[data-step-panel][data-more]~[data-nav] [data-more-cue] i{animation:spc-nudge .7s ease-in-out .2s 2}',
  '@media (prefers-reduced-motion:reduce){[data-more-cue],[data-more-cue] i{transition:none!important;animation:none!important}}',
].join('');
// Desktop workspace (SPC, 5 November 2026). Side by side (1080px and wider), the card and the panel are one height,
// the window's height below where the workspace starts (client/card-data.js measures that as deskTop) less a 24px
// margin, kept between 500 and 820px. The card is as large as that height allows and sits centred in its canvas;
// the panel's step content scrolls inside the panel when it is longer, with Back / Next at the panel's foot. So the
// page itself does not scroll on a laptop, the card is never cut off, and the two columns always line up. On short
// windows (under 820px) the page title is more compact. The "1080 × 1350 px" line above the card is gone (the
// format note says it). Narrower windows keep the stacked layout.
DATA_PATCHES.studio.push(
  ['font-size:clamp(30px,4vw,46px)', 'font-size:{{ titleSize }}'],
  ['box-shadow:{{ asideShadow }};padding:{{ asidePad }};display:flex;flex-direction:column;gap:26px">',
    'box-shadow:{{ asideShadow }};padding:{{ asidePad }};display:flex;flex-direction:column;gap:{{ asideGap }}px">'],
  // While more of the panel's step content is below, a "See more" chip sits on the line above Back / Next (in the
  // gap between the content and the buttons, so it covers neither) and scrolls the panel on a click. client/card-
  // data.js watchPanel sets data-more and makes the chip reachable by keyboard only while it shows.
  ['<div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:{{ navPad }};border-top:1px solid var(--spc-border);position:{{ navPos }};left:0;right:0;bottom:0;z-index:{{ navZ }};background:#fff;box-shadow:{{ navShadow }}">',
    '<div data-nav="" style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:{{ navPad }};border-top:1px solid var(--spc-border);position:{{ navPos }};left:0;right:0;bottom:0;z-index:{{ navZ }};background:#fff;box-shadow:{{ navShadow }}">'
    + '<button type="button" data-more-cue="" tabindex="-1" aria-hidden="true" aria-label="Scroll down for more options" sc-camel-on-click="{{ moreBelow }}" style="position:absolute;left:50%;top:0;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 12px 0 9px;border:0;border-radius:999px;background:#fff;box-shadow:0 0 0 1px var(--spc-border),0 4px 12px rgba(7,19,41,.10);font:inherit;font-size:12px;font-weight:700;color:var(--spc-ink);cursor:pointer;white-space:nowrap;z-index:2"><i class="ph-bold ph-caret-down" style="font-size:12px;color:var(--spc-blue)"></i>See more</button>'],
  ['<section ref="{{ stageRef }}" data-screen-label="Preview" style="flex:1 1 560px;min-width:0;position:{{ stagePos }};',
    '<section ref="{{ stageRef }}" data-screen-label="Preview" style="flex:1 1 560px;min-width:0;height:{{ deskH }};position:{{ stagePos }};'],
  ['<aside data-screen-label="Customize" style="flex:1 1 360px;max-width:{{ asideMax }};align-self:stretch;',
    '<aside data-screen-label="Customize" style="flex:1 1 360px;max-width:{{ asideMax }};align-self:stretch;height:{{ deskH }};'],
);
const FIT_LOGIC = [
  ['    const side = (s.vw || 1280) >= 1000;', '    const side = (s.vw || 1280) >= 1080;'],
  // The Share step's feed preview (the post with its header and Like / Comment row) shows only where the card in it
  // can be at least 340px wide; on laptop heights a portrait card in it would be a sliver, so the card shows as on
  // the other steps.
  ["    const feed = s.view === 'feed';",
    "    const fitH = Math.min(820, Math.max(450, (s.vh || 900) - (s.deskTop || 200) - 24)), sideW = (s.vw || 1280) >= 1080;\n"
    + "    const stagePadPx = 2 * Math.min(32, Math.max(16, (s.vw || 1280) * .024)), compactHead = sideW && (s.vh || 900) < 820;\n"
    + "    const feed = s.view === 'feed' && (!sideW || (fitH - stagePadPx - 236) * nativeW / cardH >= 340);"],
  ["const budget = side ? (s.vh || 900) - 32 - 2 * Math.min(40, Math.max(16, (s.vw || 1280) * .035)) - 60 - (feed ? 200 : 0) : ",
    "const budget = side ? fitH - stagePadPx - (feed ? 236 : 0) : "],
  // Stacked (under 1080px, e.g. a tablet held sideways) the card is no taller than the window either.
  ["mStick ? Math.min((s.vh || 800) * .34, 300) : 9999;", "mStick ? Math.min((s.vh || 800) * .34, 300) : Math.max(320, (s.vh || 900) - (s.deskTop || 200) - 24 - stagePadPx - (feed ? 236 : 0));"],
  ["stagePad: mobile ? '14px 16px 16px' : 'clamp(16px,3.5vw,40px)'", "stagePad: mobile ? '14px 16px 16px' : 'clamp(16px,2.4vw,32px)'"],
  ["sizeRowDisp: mobile ? 'none' : 'flex'", "sizeRowDisp: 'none'"],
  ["navPos: mobile ? 'fixed' : 'static'", "navPos: mobile ? 'fixed' : 'relative'"],
  ["mainPb: mobile ? 120 : 72, headPad: mobile ? '22px 0 18px' : '40px 0 32px',",
    "mainPb: mobile ? 120 : side ? 24 : 72, headPad: mobile ? '22px 0 18px' : compactHead ? '14px 0 16px' : '26px 0 22px', titleSize: compactHead ? '30px' : 'clamp(28px,3vw,40px)',"
    + " deskH: side ? `${fitH}px` : 'auto', panelFlex: side ? '1 1 auto' : '0 1 auto', panelScroll: side ? 'auto' : 'visible', panelPad: side ? '3px' : '0', panelMargin: side ? '-3px' : '0', asideGap: side ? 20 : 26,"],
];
// The header (SPC, 5 November 2026: "hover effect should be better"; chosen from three variations): a "Need help?
// 800 77239" call link beside "Back to Customer Portal" as a blue outlined button that fills on hover, its arrow
// nudging back. On phones the help link is a round phone button and the button reads "Portal". The number is the
// email footer's (src/mail/assets.ts PHONE).
const HELP_LINK = '<a data-help-link="" href="tel:80077239" aria-label="Need help? Call SPC Free Zone on 800 77239"><i class="ph ph-phone" style="font-size:16px"></i><span>Need help? 800 77239</span></a>';
for (const layout of ['studio', 'mobile']) {
  DATA_PATCHES[layout].push([
    layout === 'studio'
      ? '<a href="{{ portalUrl }}" style="display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--spc-ink)"><i class="ph ph-arrow-left" style="font-size:16px"></i>{{ backLabel }}</a>'
      : '<a href="{{ portalUrl }}" style="display:inline-flex;align-items:center;gap:6px;min-height:44px;font-size:14px;font-weight:600;color:var(--spc-ink)"><i class="ph ph-arrow-left" style="font-size:16px"></i>Portal</a>',
    `<span data-nav-actions="" style="display:inline-flex;align-items:center">${HELP_LINK}`
      + (layout === 'studio'
        ? '<a data-portal-link="" href="{{ portalUrl }}" style="display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--spc-ink)"><i class="ph ph-arrow-left" style="font-size:16px"></i><span>{{ backLabel }}</span></a>'
        : '<a data-portal-link="" href="{{ portalUrl }}" style="display:inline-flex;align-items:center;gap:6px;min-height:44px;font-size:14px;font-weight:600;color:var(--spc-ink)"><i class="ph ph-arrow-left" style="font-size:16px"></i><span>Portal</span></a>')
      + '</span>',
  ]);
}
const NAV_CSS = [
  // No underline from the design system's a:hover, an arrow that can move, a clear keyboard ring.
  '[data-portal-link],[data-help-link]{text-decoration:none!important;-webkit-tap-highlight-color:transparent}',
  '[data-portal-link] i,[data-help-link] i{transition:transform .22s cubic-bezier(.2,.8,.2,1)}',
  '[data-portal-link]:focus-visible,[data-help-link]:focus-visible{outline:2px solid var(--spc-blue);outline-offset:3px;border-radius:999px}',
  '[data-nav-actions]{gap:22px}',
  '[data-help-link]{display:inline-flex;align-items:center;gap:7px;font-size:14px;font-weight:600;color:var(--spc-muted);transition:color .18s ease}',
  '[data-help-link]:hover{color:var(--spc-blue)}',
  '[data-portal-link]{padding:9px 17px 9px 14px!important;border:1.5px solid var(--spc-blue);border-radius:999px;color:var(--spc-blue)!important;transition:background-color .18s ease,color .18s ease,box-shadow .18s ease,transform .12s ease}',
  '[data-portal-link]:hover{background:var(--spc-blue);color:#fff!important;box-shadow:0 6px 16px -6px rgba(0,77,255,.55)}',
  '[data-portal-link]:hover i{transform:translateX(-3px)}',
  '[data-portal-link]:active{transform:scale(.97)}',
  // Phones: the help link is a round phone button; both keep a 40px touch target.
  // Phone logo 25% larger (SPC, 9 November 2026: 34 -> 42px), but never closer than 12px to the buttons: on narrower
  // phones it takes the room there is (187px = the header's 32px of padding, the buttons' 143px, the 12px gap).
  '@media (max-width:759px){header img{height:42px!important;max-width:calc(100vw - 187px);object-fit:contain;object-position:left center}}',
  '@media (max-width:759px){[data-nav-actions]{gap:8px}[data-help-link] span{display:none}'
    + '[data-help-link]{width:40px;height:40px;justify-content:center;border:1px solid var(--spc-border);border-radius:50%;color:var(--spc-ink)}'
    + '[data-portal-link]{min-height:40px!important;padding-top:0!important;padding-bottom:0!important}}',
  // The smallest phones (320px): a slightly smaller logo and a tighter button, so the header stays on screen.
  '@media (max-width:359px){header img{height:28px!important;max-width:calc(100vw - 178px)}[data-portal-link]{padding-left:10px!important;padding-right:12px!important}}',
  '@media (hover:none){[data-portal-link]:hover i,[data-help-link]:hover i{transform:none}}',
  '@media (prefers-reduced-motion:reduce){[data-portal-link],[data-portal-link] i,[data-help-link]{transition:none!important}}',
].join('');
const STAGE_LOGIC = [
  ...FIT_LOGIC,
  ["lineBg: i < s.step ? 'var(--success-500)' : 'var(--spc-border)',",
    "lineBg: i < s.step ? 'var(--success-500)' : 'var(--spc-border)', lineFill: i < s.step ? '100%' : '0%',"],
  // The same sum as dispW above, for a portrait card.
  ['    const dispH = Math.round(cardH * scale);\n',
    '    const dispH = Math.round(cardH * scale);\n'
    + '    const tallW = Math.floor(Math.min(Math.max(mStick ? 150 : 260, budget * 1080 / 1350), Math.min(avail, 540)));\n'
    + '    const frameBoxH = feed ? 0 : Math.round(1350 * tallW / 1080);\n'],
  // Side by side the workspace has a set height (FIT_LOGIC), so the stage need not stick.
  ["      dispW, dispH, cardH, scale, stagePos: side || mStick ? 'sticky' : 'relative',",
    "      dispW, dispH, cardH, scale, frameBoxH, stagePos: mStick ? 'sticky' : 'relative',"],
  ["stageTop: side ? '16px' : '0px',", "stageTop: '0px',"],
];

const LOGIC_PATCHES = {
  studio: [...SHARE_PATCHES, ...CONTENT_LOGIC, ...STAGE_LOGIC, ...INPUT_LOGIC],
  mobile: [
    ...INPUT_LOGIC,
    ['const availH = sheet ? Math.max(90, vh - 56 - sheetH - 28) : Math.max(200, vh - 420);',
      'const availH = sheet ? Math.max(90, vh - 56 - sheetH - 28) : Math.max(180, vh - (s.chromeH || 440) - 8);'],
    ...SHARE_PATCHES,
    ...CONTENT_LOGIC,
    ...MOBILE_CONTENT_LOGIC,
  ],
};

// Sample values that must not survive into the markup after patching (input placeholders excepted).
const LEFTOVERS = [/Lumen/, /4425153/, /\b\d{1,2} Oct(ober)? 2026\b/];

function applyPatches(name, html, patches = DATA_PATCHES[name]) {
  for (const [from, to] of patches) {
    const re = typeof from === 'string' ? new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(from.source, 'g');
    const n = (html.match(re) || []).length;
    if (n !== 1) throw new Error(`${name}: patch ${String(from).slice(0, 60)}… matched ${n} times, expected 1`);
    html = html.replace(re, to);
  }
  return html;
}

// ------------------------------------------------------------------ runtime-equivalent parsing

const CAMEL_ATTR = 'sc-camel-';
const RAW_WRAP = { select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody', thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr', td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption' };
const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const EVENT_MAP = {
  onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp',
  onkeypress: 'onKeyPress', onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave',
  onfocus: 'onFocus', onblur: 'onBlur', ondoubleclick: 'onDoubleClick', oncontextmenu: 'onContextMenu', onmousemove: 'onMouseMove',
  onmouseover: 'onMouseOver', onmouseout: 'onMouseOut', onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointermove: 'onPointerMove',
  onpointerenter: 'onPointerEnter', onpointerleave: 'onPointerLeave', onpointercancel: 'onPointerCancel', onpointerover: 'onPointerOver',
  onpointerout: 'onPointerOut', ongotpointercapture: 'onGotPointerCapture', onlostpointercapture: 'onLostPointerCapture', ontouchstart: 'onTouchStart',
  ontouchend: 'onTouchEnd', ontouchmove: 'onTouchMove', ontouchcancel: 'onTouchCancel', ondragstart: 'onDragStart', ondragend: 'onDragEnd',
  ondragenter: 'onDragEnter', ondragleave: 'onDragLeave', ondragover: 'onDragOver', onanimationstart: 'onAnimationStart',
  onanimationend: 'onAnimationEnd', onanimationiteration: 'onAnimationIteration', ontransitionend: 'onTransitionEnd',
};
const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function encodeCase(html) {
  html = html.replace(new RegExp('<(x-import|dc-import)(' + ATTRS + ')/>', 'gi'), (_, t, a) => '<' + t + a + '></' + t + '>');
  html = html.replace(/<helmet(\s|>)/gi, '<sc-helmet$1').replace(/<\/helmet\s*>/gi, '</sc-helmet>');
  html = html.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g, (_, sp, n, eq) => sp + CAMEL_ATTR + n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + eq);
  for (const [real, alias] of Object.entries(RAW_WRAP)) html = html.replace(new RegExp('(</?)' + real + '(?=[\\s>])', 'gi'), '$1' + alias);
  return html;
}

/** Attribute value -> spec: string (static), {b: path} (whole binding) or {p: parts} (mixed, odd = path). */
function spec(raw) {
  const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (whole) return { b: whole[1].trim() };
  if (raw.includes('{{')) return { p: raw.split(/\{\{([\s\S]+?)\}\}/g).map((s, i) => (i & 1 ? s.trim() : s)) };
  return raw;
}

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function importantify(css) {
  css = stripComments(css);
  const decls = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { decls.push(css.slice(start, i)); start = i + 1; }
  }
  decls.push(css.slice(start));
  return decls.map((d) => d.trim()).filter(Boolean).map((d) => (/!important\s*$/i.test(d) ? d : d + ' !important')).join(';');
}

const pseudoRules = new Map(); // "pseudo|css" -> class
function pseudoClass(pseudo, css) {
  const k = pseudo + '|' + css;
  if (!pseudoRules.has(k)) pseudoRules.set(k, 'scp' + pseudoRules.size.toString(36));
  return pseudoRules.get(k);
}

function collectProps(attrs, kind) {
  const props = []; const pseudo = [];
  for (const { name, value } of attrs) {
    if (name === 'sc-name' || name === 'data-dc-tpl') continue;
    let key = name;
    if (key.startsWith(CAMEL_ATTR)) key = kebabToCamel(key.slice(CAMEL_ATTR.length));
    if (key === 'hint-size') continue;
    if (key.startsWith('style-')) { pseudo.push(pseudoClass(key.slice(6), value)); continue; }
    if (kind !== 'dom') {
      if (key.includes('-') && !(kind === 'x-import' && (key.startsWith('aria-') || key.startsWith('data-')))) key = kebabToCamel(key);
    } else if (key === 'class') key = 'className';
    else if (key === 'for') key = 'htmlFor';
    else if (key.startsWith('on')) key = EVENT_MAP[key] || 'on' + key[2].toUpperCase() + key.slice(3);
    props.push([key, spec(value)]);
  }
  return { props, pseudo };
}

const attrOf = (node, n) => (node.attrs || []).find((a) => a.name === n)?.value;
const styles = { studio: [], mobile: [] };

function walk(node, layout) {
  if (node.nodeName === '#text') {
    const v = node.value;
    if (v.includes('{{')) return ['T', v.split(/\{\{([\s\S]+?)\}\}/g).map((s, i) => (i & 1 ? s.trim() : s))];
    if (!v.trim() && !v.includes(' ')) return null;
    return ['t', v];
  }
  if (!node.tagName) return null;
  const tag = node.tagName.toLowerCase();
  const kids = () => (node.childNodes || []).map((c) => walk(c, layout)).filter(Boolean);
  if (tag === 'sc-helmet') {
    for (const c of node.childNodes || []) if (c.tagName === 'style') styles[layout].push((c.childNodes || []).map((t) => t.value || '').join(''));
    return null;
  }
  if (tag === 'sc-for') return ['for', spec(attrOf(node, 'list') || ''), attrOf(node, 'as') || 'item', kids()];
  if (tag === 'sc-if') return ['if', spec(attrOf(node, 'value') || ''), kids()];
  if (tag === 'x-import') {
    const full = attrOf(node, 'component-from-global-scope') || '';
    const comp = full.split('.').pop();
    const style = attrOf(node, 'style');
    const rest = (node.attrs || []).filter((a) => !['component-from-global-scope', 'component', 'name', 'from', 'style'].includes(a.name));
    const { props } = collectProps(rest, 'x-import');
    return ['x', comp, style != null ? spec(style) : null, props, kids()];
  }
  if (tag === 'script' || tag === 'style') throw new Error(`${layout}: unexpected <${tag}> outside <helmet>`);
  const { props, pseudo } = collectProps(node.attrs || [], 'dom');
  return ['e', RAW_UNWRAP[tag] || tag, props, kids(), pseudo.length ? pseudo.join(' ') : null];
}

function compileTemplate(layout) {
  let html = readFileSync(path.join(SRC, layout, 'template.html'), 'utf8');
  html = applyPatches(layout, html);
  const open = /<x-dc(?:\s[^>]*)?>/.exec(html);
  const close = html.lastIndexOf('</x-dc>');
  if (!open || close < 0) throw new Error(`${layout}: no <x-dc> block`);
  let inner = html.slice(open.index + open[0].length, close);
  inner = inner.replace(/asset:([a-f0-9]{16}\.[a-z0-9]+)/g, (_, f) => ASSET_URL + f);
  const markupOnly = inner.replace(/<helmet>[\s\S]*?<\/helmet>/i, '');
  for (const re of LEFTOVERS) if (re.test(markupOnly)) throw new Error(`${layout}: sample value ${re} still in markup after patching`);
  const frag = parseFragment(encodeCase(inner));
  return frag.childNodes.map((c) => walk(c, layout)).filter(Boolean);
}

// ------------------------------------------------------------------ css

const FULL_PAGE_CSS = 'html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}';
// Phone layout CSS: tighter toolbar type on 320–359 px handsets, a pressed state on the toolbar, and the drawer motion.
const MOBILE_CSS = [
  '@media (max-width:359px){.m-chips{gap:4px!important;padding-left:8px!important;padding-right:8px!important}',
  '.m-chips>span{font-size:10px!important;letter-spacing:-.01em}.m-chips>span>i{font-size:18px!important}}',
  '.m-chips>span{transition:transform .12s ease,background .12s ease}.m-chips>span:active{background:var(--blue-50)!important;transform:scale(.96)}',
  // The drawer slides up when it opens and down when it closes (card-data.js adds .m-closing and waits for it);
  // what the drawer hides rises back in when it closes.
  '@keyframes m-sheet-in{from{transform:translate(-50%,100%)}to{transform:translate(-50%,0)}}',
  '@keyframes m-sheet-out{from{transform:translate(-50%,0)}to{transform:translate(-50%,100%)}}',
  '@keyframes m-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
  '[data-screen-label="Sheet"]{animation:m-sheet-in .34s cubic-bezier(.2,.8,.2,1) both;transition:height .25s var(--ease-standard)}',
  '[data-screen-label="Sheet"].m-closing{animation:m-sheet-out .22s cubic-bezier(.4,0,1,1) both;pointer-events:none}',
  '.m-in{animation:m-rise .3s cubic-bezier(.2,.8,.2,1) both}',
  // iPhone Safari zooms the page into a text field whose type is under 16px when it is tapped (SPC, 9 November 2026:
  // the details fields were 15px). On phones and touch tablets the fields' text is 16px, so it does not; pinch zoom
  // stays available (no maximum-scale in the viewport).
  '@media (max-width:759px),(hover:none) and (pointer:coarse){input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=file]),textarea,select{font-size:16px!important}}',
  '@media (prefers-reduced-motion:reduce){[data-screen-label="Sheet"],[data-screen-label="Sheet"].m-closing,.m-in{animation:none!important}.m-frame,.m-frame>*{transition:none!important}}',
].join('');
function cleanCss(css) {
  css = css.replace(/,\s*url\(["']?asset:dropped[^)]*\)\s*format\(["'][^"']*["']\)/g, '');
  css = css.replace(/url\(["']?asset:dropped[^)]*\)\s*format\(["'][^"']*["']\)\s*,\s*/g, '');
  if (css.includes('asset:dropped')) throw new Error('a dropped asset is still referenced by the CSS');
  return css.replace(/asset:([a-f0-9]{16}\.[a-z0-9]+)/g, (_, f) => ASSET_URL + f);
}

// ------------------------------------------------------------------ main

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'a'), { recursive: true });
mkdirSync(GEN, { recursive: true });

const used = new Set();
for (const layout of LAYOUTS) {
  const ast = compileTemplate(layout);
  const json = JSON.stringify(ast);
  for (const m of json.matchAll(/\/static\/studio\/a\/([a-f0-9]{16}\.[a-z0-9]+)/g)) used.add(m[1]);
  writeFileSync(path.join(GEN, `${layout}.ast.json`), json);
  const logic = applyPatches(`${layout} logic`, readFileSync(path.join(SRC, layout, 'logic.js'), 'utf8'), LOGIC_PATCHES[layout]);
  if (!/class Component extends DCLogic/.test(logic)) throw new Error(`${layout}: logic.js does not define "class Component extends DCLogic"`);
  writeFileSync(path.join(GEN, `${layout}.logic.js`),
    `// GENERATED by tools/build-studio.mjs from design/source/${layout}/logic.js. Do not edit.\n` +
    `export default function makeLogic(DCLogic, React) {\n${logic}\n;return Component;\n}\n`);
}

const a = styles.studio.join('\n'), b = styles.mobile.join('\n');
if (a !== b) console.warn('note: studio and mobile <helmet> styles differ; using the studio set, which both layouts were checked against');
const hover = [...pseudoRules].map(([k, cls]) => { const [p, ...rest] = k.split('|'); const css = rest.join('|'); return `.${cls}:${p}{${importantify(css)}}`; }).join('\n');
const css = cleanCss(a) + '\n' + hover + '\n' + FULL_PAGE_CSS + '\n' + MOBILE_CSS + '\n' + STUDIO_MOTION_CSS + '\n' + NAV_CSS + '\n';
for (const m of css.matchAll(/\/static\/studio\/a\/([a-f0-9]{16}\.[a-z0-9]+)/g)) used.add(m[1]);
const cssName = `studio-${hash(css)}.css`;
writeFileSync(path.join(OUT, cssName), css);
for (const f of used) copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, 'a', f));

const result = await build({
  entryPoints: [path.join(ROOT, 'client', 'main.js')],
  bundle: true, minify: true, format: 'iife', target: ['es2020'], write: false, legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.json': 'json' }, logLevel: 'warning',
});
const js = result.outputFiles[0].contents;
const jsName = `app-${hash(js)}.js`;
writeFileSync(path.join(OUT, jsName), js);
// The link-preview image (WhatsApp, LinkedIn, iMessage): one branded 1200 x 630 picture for every card, made from
// design/og/licence-preview.html. The page's Open Graph tags point at it (src/page/studio.ts).
const og = readFileSync(path.join(ROOT, 'design', 'og', 'licence-preview.jpg'));
const ogName = `og-${hash(og)}.jpg`;
writeFileSync(path.join(OUT, ogName), og);
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ js: `/static/studio/${jsName}`, css: `/static/studio/${cssName}`, og: `/static/studio/${ogName}` }, null, 2) + '\n');
console.log(`studio built: ${jsName} (${Math.round(js.length / 1024)} KB), ${cssName} (${Math.round(css.length / 1024)} KB), ${used.size} assets, ${pseudoRules.size} hover rules`);
