import { el } from './util.js';
import { SPLIT_DEFAULT, clampSplit, splitVars, splitFromPointer } from './split.js';

const KEY = 'coder-room-split';
const STEP = 5;

function read() {
  try { return clampSplit(localStorage.getItem(KEY)); } catch { return SPLIT_DEFAULT; }
}

function write(pct) {
  try { localStorage.setItem(KEY, String(pct)); } catch { /* storage unavailable */ }
}

/**
 * The drag handle between feed and drawer. `mount(tileRoot)` puts it in the open agent's tile so it sits in the
 * stage grid; pointer drag, arrow keys and double-click set the split, which is remembered.
 */
export function createSplit(stage) {
  const handle = el('div', 'splitter');
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', 'Resize feed and details');
  handle.tabIndex = 0;
  handle.title = 'Drag to resize, double-click to reset';
  let pct = read();

  function set(next, save = true) {
    pct = clampSplit(next);
    for (const [k, v] of Object.entries(splitVars(pct))) stage.style.setProperty(k, v);
    handle.setAttribute('aria-valuenow', String(pct));
    if (save) write(pct);
  }

  function bounds() {
    const feed = stage.querySelector('.tile.big .feed')?.getBoundingClientRect();
    const drawer = stage.querySelector('.tile.big .drawer')?.getBoundingClientRect();
    return feed && drawer ? { top: feed.top, height: drawer.bottom - feed.top } : null;
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    handle.setPointerCapture?.(e.pointerId);
    stage.classList.add('dragging');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!stage.classList.contains('dragging')) return;
    const b = bounds();
    if (b) set(splitFromPointer(e.clientY, b.top, b.height), false);
  });
  const end = () => {
    if (!stage.classList.contains('dragging')) return;
    stage.classList.remove('dragging');
    write(pct);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => set(SPLIT_DEFAULT));
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); set(pct - STEP); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); set(pct + STEP); }
  });
  set(pct, false);

  return {
    mount(tileRoot) { if (tileRoot && handle.parentNode !== tileRoot) tileRoot.append(handle); if (!tileRoot) handle.remove(); },
  };
}
