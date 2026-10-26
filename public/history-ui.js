import { el, dayTimeText } from './util.js';
import { scrollable } from './scroll.js';
import { modelShown } from './model.js';
import {
  OUTCOMES, stripRoundId, outcomeChip, filterRows, barWidths, totals, totalsText, codersOf, rowStats, moveIndex,
} from './history.js';

const REFRESH_MS = 10_000;

function dot(who) {
  const d = el('span', 'hdot', (who?.name || '?').replace(/^Sonnet · /, '').charAt(0).toUpperCase());
  d.style.setProperty('--c', who?.color || '#94a3b8');
  d.title = who?.name || '';
  return d;
}

function rowEl(r, width, onOpen) {
  const chip = outcomeChip(r);
  const li = el('li', `hrow ho-${chip.cls}`);
  li.tabIndex = 0;
  li.dataset.round = r.round;
  const stats = rowStats(r);
  const top = el('div', 'htop');
  top.append(dot(r.who), el('b', 'hid', r.round), el('span', 'htitle', stripRoundId(r.title, r.round)), el('span', `hchip hc-${chip.cls}`, chip.text));
  const meta = el('div', 'hmeta');
  meta.append(el('span', null, dayTimeText(r.startedAt)), el('span', null, stats.duration), el('span', null, stats.tokens), el('span', null, stats.cost));
  if (modelShown(r.who?.name, r.model)) meta.append(el('span', 'hmodel', r.model));
  if (r.attempts.length > 1) meta.append(el('span', 'hatt', `${r.attempts.length} attempts`));
  if (r.fix) {
    const a = el('a', 'hfix', `→ ${r.fix}`);
    a.href = '#';
    a.dataset.round = r.fix;
    meta.append(a);
  }
  const bar = el('div', 'hbar');
  const fill = el('i');
  fill.style.width = `${width}%`;
  bar.append(fill);
  li.append(top, meta, bar);
  li.title = r.attempts.map((a) => `${a.role} ${a.outcome}${a.rc == null ? '' : ` rc=${a.rc}`}`).join('\n');
  li.addEventListener('click', (e) => {
    const fix = e.target.closest?.('.hfix');
    if (fix) { e.preventDefault(); e.stopPropagation(); onOpen(fix.dataset.round); return; }
    onOpen(r.round);
  });
  return li;
}

/**
 * The history panel: totals and filters on top, a vertical timeline of rounds (newest first) below. `load()` fetches
 * the project's rounds; the list refreshes every 10 s while the panel is shown. ↑/↓ move, Enter opens a row.
 */
export function createHistoryPanel(root, { load, onOpen }) {
  const head = el('div', 'hhead');
  const title = el('h2', null, 'History');
  const sum = el('div', 'hsum');
  const coderChips = el('div', 'hchips');
  const outcomeChips = el('div', 'hchips');
  head.append(title, sum, coderChips, outcomeChips);
  const list = scrollable(el('ul', 'hlist'));
  const empty = el('p', 'sub', 'No rounds recorded yet.');
  root.append(head, list, empty);
  let rows = [];
  let project = null;
  let coders = new Set();
  let outcome = 'all';
  let shown = [];
  let timer = null;
  let token = 0;

  function chips(box, items, isOn, toggle) {
    box.replaceChildren(...items.map(([key, label]) => {
      const b = el('button', 'chip' + (isOn(key) ? ' on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => { toggle(key); render(); });
      return b;
    }));
  }

  function render() {
    shown = filterRows(rows, { coders, outcome });
    title.textContent = project ? `History · ${project}` : 'History';
    sum.textContent = totalsText(totals(shown));
    chips(coderChips, codersOf(rows).map((w) => [w.id, w.name]), (k) => coders.has(k), (k) => (coders.has(k) ? coders.delete(k) : coders.add(k)));
    chips(outcomeChips, OUTCOMES, (k) => outcome === k, (k) => { outcome = k; });
    const widths = barWidths(shown);
    list.replaceChildren(...shown.map((r, i) => rowEl(r, widths[i], onOpen)));
    empty.hidden = shown.length > 0;
  }

  async function refresh() {
    const mine = ++token;
    let got;
    try { got = await load(project); } catch { return; }
    if (mine !== token || !project) return;
    rows = got;
    render();
  }

  function focusRow(step) {
    const nodes = [...list.children];
    const at = nodes.indexOf(document.activeElement?.closest?.('.hrow'));
    const next = moveIndex(at, step, nodes.length);
    nodes[next]?.focus();
  }

  root.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(-1); }
    else if (e.key === 'Enter' && e.target.classList?.contains('hrow')) { e.preventDefault(); e.target.click(); }
  });

  return {
    /** Shows the panel for `name` (null stops refreshing). */
    show(name) {
      clearInterval(timer);
      if (name !== project) { rows = []; coders = new Set(); outcome = 'all'; }
      project = name;
      if (!name) { token++; return; }
      render();
      refresh();
      timer = setInterval(refresh, REFRESH_MS);
      list.children[0]?.focus({ preventScroll: true });
    },
    stop() { clearInterval(timer); token++; project = null; },
  };
}
