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

// The design's logic reads these globals.
window.React = React;
window.htmlToImage = htmlToImage;

const card = JSON.parse(document.getElementById('card-data').textContent);
const DesktopLogic = withCardData(makeStudioLogic(StreamableLogic, React));
const MobileLogic = withCardData(makeMobileLogic(StreamableLogic, React));
const userProps = { prefillFromLicense: false, samplePhoto: false, startTemplate: 'dayone', card };
const MOBILE_QUERY = '(max-width: 759px)';
const TRANSIENT = new Set(['sheet', 'toast', 'busy', 'drag', 'stageW', 'vw', 'vh', 'canShare']);

function Root() {
  const mq = React.useMemo(() => window.matchMedia(MOBILE_QUERY), []);
  const [mobile, setMobile] = React.useState(mq.matches);
  const carry = React.useRef(null);
  React.useEffect(() => {
    const on = (e) => setMobile(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mq]);
  return React.createElement(Host, {
    key: mobile ? 'mobile' : 'desktop',
    Logic: mobile ? MobileLogic : DesktopLogic,
    ast: mobile ? mobileAst : studioAst,
    components,
    userProps,
    initialState: carry.current,
    onUnmount: (st) => { carry.current = Object.fromEntries(Object.entries(st).filter(([k]) => !TRANSIENT.has(k))); },
  });
}

createRoot(document.getElementById('dc-root')).render(React.createElement(Root));
