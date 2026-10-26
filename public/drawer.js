import { el, failedGateText } from './util.js';
import { markdownEl } from './markdown.js';
import { scrollable } from './scroll.js';
import { stripRoundId } from './history.js';

const MARK = { done: '✓', doing: '◐', todo: '○' };
const TABS = [['goal', 'Goal'], ['checks', 'Checklist'], ['files', 'Files']];
const OPEN_KEY = 'coder-room-drawer';
const TAB_KEY = 'coder-room-drawer-tab';

const empty = (text) => el('div', 'sub', text);

function goalBody(t) {
  if (!t.goal) return [empty('No goal yet')];
  const kids = [el('div', 'goal-title', stripRoundId(t.goal.title, t.round)), el('div', 'goal-text')];
  kids[1].append(markdownEl(t.goal.summary || ''));
  if (t.goal.toward) kids.push(el('div', 'toward', `Working toward: ${t.goal.toward}`));
  return kids;
}

function checksBody(t) {
  if (!t.checklist.length) return [empty('No checklist yet')];
  if (t.checklistMode === 'spec') {
    const items = el('ul', 'checks');
    for (const c of t.checklist) items.append(el('li', 'ck-todo', `• ${c.text}`));
    return [el('div', 'sub', 'Spec items'), items];
  }
  const done = t.checklist.filter((c) => c.status === 'done').length;
  const bar = el('div', 'progress');
  const fill = el('i');
  fill.style.width = `${Math.round((done / t.checklist.length) * 100)}%`;
  bar.append(fill);
  const list = el('ul', 'checks');
  for (const c of t.checklist) list.append(el('li', `ck-${c.status}`, `${MARK[c.status]} ${c.text}`));
  const head = el('div', 'sub', `${done} of ${t.checklist.length} done`);
  const gate = failedGateText(t);
  if (gate) head.append(el('span', 'gatefail', ` · ${gate}`));
  return [head, bar, list];
}

function filesBody(t) {
  if (!t.files.length) return [empty('No files touched yet')];
  const list = el('ul', 'files');
  for (const f of t.files) {
    const li = el('li', f.outside ? 'out' : undefined);
    li.append(el('span', 'fn', f.file), el('span', 'cnt', f.add === undefined ? `${f.edits}×` : `${f.edits}× +${f.add} −${f.del}`));
    list.append(li);
  }
  return [list];
}

function reportBody(t) {
  const r = t.reportMd;
  if (!r) return [empty('No report for this round')];
  const box = el('div', 'goal-text');
  box.append(markdownEl(r.markdown));
  return r.more ? [box, empty('… first 40 lines; the rest is in the report file')] : [box];
}

const BODY = { goal: goalBody, checks: checksBody, files: filesBody, report: reportBody };

/** The tabs a tile gets: Report only on a replayed round. */
export const tabsFor = (t) => (t?.replay ? [...TABS, ['report', 'Report']] : TABS);

function read(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/**
 * The Details drawer: its own area under the feed (see split.js) with the Goal, Checklist and Files tabs. Closed by
 * default; the open state and last tab are remembered. `mount(tile)` moves it into the open agent's tile.
 */
export function createDrawer({ onChange } = {}) {
  const root = el('aside', 'drawer');
  root.setAttribute('aria-label', 'Details');
  const tabs = el('div', 'tabs');
  const body = scrollable(el('div', 'drawerbody'));
  root.append(tabs, body);
  let tile = null;
  let isOpen = read(OPEN_KEY, '0') === '1';
  let tab = TABS.some(([k]) => k === read(TAB_KEY, 'goal')) ? read(TAB_KEY, 'goal') : 'goal';

  function render() {
    root.classList.toggle('open', isOpen);
    root.inert = !isOpen;
    const list = tabsFor(tile);
    const shown = list.some(([k]) => k === tab) ? tab : 'goal';
    tabs.replaceChildren(...list.map(([key, label]) => {
      const b = el('button', 'chip' + (shown === key ? ' on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => api.open(key));
      return b;
    }));
    if (tile) body.replaceChildren(...BODY[shown](tile));
  }

  const api = {
    get isOpen() { return isOpen; },
    mount(tileRoot) { if (tileRoot && root.parentNode !== tileRoot) tileRoot.append(root); if (!tileRoot) root.remove(); },
    update(t) { tile = t; if (isOpen) render(); },
    open(key) {
      if (key) tab = key;
      isOpen = true;
      write(OPEN_KEY, '1'); write(TAB_KEY, tab);
      render(); onChange?.(true);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      write(OPEN_KEY, '0');
      render(); onChange?.(false);
    },
    toggle() { if (isOpen) api.close(); else api.open(); },
  };
  render();
  return api;
}
