// Entry for the customer studio served at /c/<token>. Reads the card data the server embedded in the
// page, picks the desktop or mobile design by viewport width, and mounts it. Edits carry over when the
// layout switches (rotation, window resize).
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as htmlToImage from 'html-to-image';
import studioAst from './generated/studio.ast.json';
import mobileAst from './generated/mobile.ast.json';
import makeStudioLogic from './generated/studio.logic.js';
import makeMobileLogic from './generated/mobile.logic.js';
import { Host, StreamableLogic } from './dc.js';
import { components } from './ds.js';
import { withCardData } from './card-data.js';
import { installGuard } from './guard.js';

// The design's logic reads these globals.
window.React = React;
window.htmlToImage = htmlToImage;

const card = JSON.parse(document.getElementById('card-data').textContent);
// No right-click menu or developer-tools keys on the card page (./guard.js); the stress and compare tools set debug.
if (card.debug !== true) installGuard();
// iPhone and iPad: Safari zooms into a tapped field under 16px and the layout breaks (SPC, 9 November 2026). The
// fields are 16px on touch screens (tools/build-studio.mjs); this makes sure nothing zooms on focus. Safari keeps
// pinch zoom whatever the viewport says, so people can still zoom by hand.
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iOS) document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
const DesktopLogic = withCardData(makeStudioLogic(StreamableLogic, React));
const MobileLogic = withCardData(makeMobileLogic(StreamableLogic, React));
const userProps = { prefillFromLicense: false, samplePhoto: false, startTemplate: 'dayone', card };
const MOBILE_QUERY = '(max-width: 759px)';
const TRANSIENT = new Set(['sheet', 'toast', 'busy', 'drag', 'stageW', 'vw', 'vh', 'canShare', 'chromeH', 'kbOpen', 'kbBelow', 'kbTop', 'typing', 'sheetFit']);

const keep = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => !TRANSIENT.has(k)));

function Root() {
  const mq = React.useMemo(() => window.matchMedia(MOBILE_QUERY), []);
  const [mobile, setMobile] = React.useState(mq.matches);
  const carry = React.useRef(null);
  const host = React.useRef(null);
  React.useEffect(() => {
    // Take the edits from the layout on screen before switching: the new layout is built before the old one
    // unmounts, so what onUnmount hands over arrives one switch too late (the first switch lost every edit).
    const on = (e) => {
      const st = host.current && host.current.logic && host.current.logic.state;
      if (st) carry.current = keep(st);
      setMobile(e.matches);
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mq]);
  return React.createElement(Host, {
    ref: host,
    key: mobile ? 'mobile' : 'desktop',
    Logic: mobile ? MobileLogic : DesktopLogic,
    ast: mobile ? mobileAst : studioAst,
    components,
    userProps,
    initialState: carry.current,
    onUnmount: (st) => { carry.current = keep(st); },
  });
}

createRoot(document.getElementById('dc-root')).render(React.createElement(Root));
