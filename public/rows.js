import { el, timeText } from './util.js';
import { markdownEl } from './markdown.js';
import { TALK, groupEvents, isLong, resultChip, editFoldText } from './stream.js';

const MARK = { thought: '✻', said: '●', user: '●', command: '$', edit: '✎', error: '!', done: '■' };

function editText(e) {
  return `${e.file}${e.add === undefined ? '' : ` +${e.add} −${e.del || 0}`}`;
}

function itemText(e) {
  return e.kind === 'edit' ? editText(e) : e.text || '';
}

function toggleRow(row, key, open) {
  row.addEventListener('click', () => {
    const on = !row.classList.contains('expanded');
    if (on) open.add(key); else open.delete(key);
    row.classList.toggle('expanded', on);
  });
  row.classList.toggle('expanded', open.has(key));
}

function commandRow(e, open, running) {
  const row = el('div', 'item cmdrow');
  row.tabIndex = 0;
  row.title = 'Click to expand';
  const chip = resultChip(e, running);
  row.append(el('span', 'cmdline', e.cmd || e.text || ''));
  if (e.gate) row.append(el('span', 'gatetag', 'gate'));
  row.append(el('span', `chip-res res-${chip.cls}`, chip.text));
  toggleRow(row, `c${e.n}`, open);
  row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') row.click(); });
  return row;
}

function editFold(items, open) {
  const row = el('div', 'item editfold');
  row.tabIndex = 0;
  row.append(el('div', 'foldhead', editFoldText(items)));
  const list = el('ul', 'foldlist');
  for (const e of items) list.append(el('li', null, editText(e)));
  row.append(list);
  toggleRow(row, `e${items[0].n}`, open);
  row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') row.click(); });
  return row;
}

function textItem(e, open) {
  const text = itemText(e);
  const box = el('div', 'item');
  const content = el('div', 'ibody');
  content.append(TALK.includes(e.kind) ? markdownEl(text) : el('pre', 'plain', text));
  box.append(content);
  if (!isLong(text)) return box;
  const fold = (on) => { box.classList.toggle('fold', on); more.textContent = on ? 'more' : 'less'; };
  const more = el('button', 'more');
  more.type = 'button';
  more.addEventListener('click', () => {
    const on = !box.classList.contains('fold');
    if (on) open.delete(e.n); else open.add(e.n);
    fold(on);
  });
  box.append(more);
  fold(!open.has(e.n));
  return box;
}

function rowKey(e, running) {
  return `${e.n}:${itemText(e).length}:${e.kind}:${e.ok}:${e.exit}:${running}`;
}

/**
 * The thought stream's blocks, one per group (time, kind marker, rows). Rows are cached in `cache` (keyed by event,
 * text length and result) so a re-render does not parse the Markdown again. Consecutive edits fold into one row.
 * `runningN` is the number of the command that is still running, if any.
 */
export function buildBlocks(events, { open, cache, runningN = null }) {
  const blocks = [];
  const used = new Set();
  for (const g of groupEvents(events)) {
    const block = el('div', `blk k-${g.kind}`);
    block.dataset.key = String(g.items[0].n);
    const body = el('div', 'bb');
    const rows = g.kind === 'edit' && g.items.length > 1 ? [[`E${g.items[0].n}:${g.items.length}:${g.items.at(-1).n}`, () => editFold(g.items, open)]]
      : g.items.map((e) => {
        const running = e.n === runningN;
        return [rowKey(e, running), () => (e.kind === 'command' ? commandRow(e, open, running) : textItem(e, open))];
      });
    for (const [key, make] of rows) {
      used.add(key);
      let node = cache.get(key);
      if (!node) { node = make(); cache.set(key, node); }
      body.append(node);
    }
    block.append(el('span', 'bt', timeText(g.at)), el('span', 'bm', MARK[g.kind] || ''), body);
    blocks.push(block);
  }
  for (const k of cache.keys()) if (!used.has(k)) cache.delete(k);
  return blocks;
}
