// The studio turns off the right-click menu and the keys that open the browser's developer tools (SPC, 5 November
// 2026), so the card's locked details (company, licence) are not edited through Inspect. A deterrent, not a lock:
// the browser's own menu still opens the tools, and a downloaded card can be edited elsewhere. Text fields keep
// their right-click menu (paste, spelling suggestions); nothing there reaches the locked details.

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// Letters by their key position, so Mac's Option combinations (which change e.key) are caught too.
const TOOLS = new Set(['KeyI', 'KeyJ', 'KeyC']); // tools, console, pick an element

/** F12; Ctrl+Shift+I/J/C (Windows, Linux) and Cmd+Option+I/J/C or Cmd+Shift+C (Mac); view source, Ctrl+U or Cmd+Option+U. */
export function opensDevTools(e) {
  if (e.key === 'F12' || e.code === 'F12') return true;
  if (e.ctrlKey && e.shiftKey && TOOLS.has(e.code)) return true;
  if (e.metaKey && (e.altKey || e.shiftKey) && TOOLS.has(e.code)) return true;
  if (e.code === 'KeyU' && ((e.ctrlKey && !e.shiftKey && !e.altKey) || (e.metaKey && e.altKey))) return true;
  return false;
}

export function installGuard(doc = document) {
  doc.addEventListener('contextmenu', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest(EDITABLE)) return;
    e.preventDefault();
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (!opensDevTools(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
