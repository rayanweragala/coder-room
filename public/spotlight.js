import { el, WORKING } from './util.js';
import { scrollable } from './scroll.js';
import { TALK, ALL_KINDS, footerState, thoughtsHeading, filterEvents, atBottom, anchorOf, anchoredTop } from './stream.js';
import { buildBlocks } from './rows.js';

const COMMANDS_KEY = 'coder-room-commands';

function loadCommands() {
  try { return localStorage.getItem(COMMANDS_KEY) !== '0'; } catch { return true; }
}

function saveCommands(on) {
  try { localStorage.setItem(COMMANDS_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

/**
 * The live thoughts panel inside the open agent's own `stream` element. The header, list and footer are built once
 * per stream; a tile update only swaps the list's blocks, so the filter box keeps focus and a reader who scrolled
 * up stays on the same block. Expanded rows, the commands switch and the filter survive re-renders.
 */
export function createSpotlight() {
  const open = new Set();
  const cache = new Map();
  const state = { tile: null, stream: null, tileId: null, commands: loadCommands(), stick: true, seen: null, total: 0, filter: '', panel: null };

  function makePanel() {
    const input = el('input', 'filter');
    input.type = 'search';
    input.placeholder = 'filter  /';
    input.setAttribute('aria-label', 'Filter thoughts');
    input.value = state.filter;
    input.addEventListener('input', () => { state.filter = input.value; render(state.tile, state.stream); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      input.value = '';
      state.filter = '';
      input.blur();
      render(state.tile, state.stream);
    });
    const toggle = el('button', 'switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.append(el('span', null, 'commands'), el('i'));
    toggle.addEventListener('click', () => {
      state.commands = !state.commands;
      saveCommands(state.commands);
      render(state.tile, state.stream);
    });
    const head = el('div', 'streamhead');
    const title = el('h3', null, 'Live thoughts');
    head.append(title, input, toggle);
    const list = scrollable(el('div', 'timeline'));
    const live = el('span', 'live');
    const pill = el('button', 'newpill');
    pill.type = 'button';
    const foot = el('div', 'streamfoot');
    foot.append(live, pill);
    pill.addEventListener('click', () => { state.stick = true; state.seen = state.total; list.scrollTop = list.scrollHeight; footer(); });
    list.addEventListener('scroll', () => {
      state.stick = atBottom(list.scrollTop, list.clientHeight, list.scrollHeight);
      if (state.stick) state.seen = state.total;
      footer();
    }, { passive: true });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => { if (state.stick) list.scrollTop = list.scrollHeight; }).observe(list);
    }
    return { head, title, input, toggle, list, live, pill, foot };
  }

  function footer() {
    const p = state.panel;
    if (!p) return;
    const f = footerState(state.tile, state.stick, state.total, state.seen);
    p.title.textContent = thoughtsHeading(state.tile);
    p.live.textContent = f.label;
    p.live.classList.toggle('on', f.live);
    p.pill.hidden = f.pill === 0;
    p.pill.textContent = `▼ ${f.pill} new`;
  }

  function fill(t) {
    const p = state.panel;
    const kinds = new Set(state.commands ? ALL_KINDS : TALK);
    const shown = filterEvents(t.events.filter((x) => kinds.has(x.kind)), state.filter);
    state.total = shown.length;
    if (state.stick || state.seen == null) state.seen = state.total;
    p.toggle.classList.toggle('on', state.commands);
    p.toggle.setAttribute('aria-checked', String(state.commands));
    const lastCmd = t.events.findLast((x) => x.kind === 'command');
    const runningN = lastCmd && lastCmd.ok === undefined && WORKING.includes(t.status) ? lastCmd.n : null;
    const list = p.list;
    const blocks = [...list.children];
    const anchor = state.stick ? null : anchorOf(blocks.map((b) => [b.dataset.key, b.offsetTop, b.offsetHeight]), list.scrollTop);
    list.replaceChildren(...buildBlocks(shown, { open, cache, runningN }));
    if (state.stick) { list.scrollTop = list.scrollHeight; return; }
    const same = anchor && [...list.children].find((b) => b.dataset.key === anchor.key);
    if (same) list.scrollTop = anchoredTop(same.offsetTop, anchor.offset);
  }

  function render(t, stream) {
    if (state.stream && state.stream !== stream) state.stream.replaceChildren();
    if (state.stream !== stream) {
      state.panel = stream ? makePanel() : null;
      if (stream) stream.replaceChildren(state.panel.head, state.panel.list, state.panel.foot);
    }
    if (t && state.tileId !== t.id) { state.tileId = t.id; cache.clear(); open.clear(); state.seen = null; state.stick = true; }
    state.tile = t;
    state.stream = stream;
    if (!t || !state.panel) return;
    fill(t);
    footer();
  }

  return {
    show(t, fresh, stream) {
      if (fresh) { state.stick = true; state.seen = null; open.clear(); cache.clear(); }
      render(t, stream);
    },
    focusFilter() { state.panel?.input.focus(); },
  };
}
