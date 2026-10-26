import { el, timeText } from './util.js';
import { needsPlace } from './chat-order.js';
import { markdownEl } from './markdown.js';

const COLORS = { orchestrator: '#14b8a6', user: '#e2e8f0' };
const CLAMP_LINES = 6;
const CHARS_PER_LINE = 40;

/** True when a message would take more than 6 lines in the chat column. */
export function isLong(text) {
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0);
  return lines > CLAMP_LINES;
}

function avatar(from) {
  const a = el('span', 'avatar', from.name.replace(/^Sonnet · /, '').charAt(0).toUpperCase());
  a.style.background = from.color || COLORS[from.id] || '#94a3b8';
  return a;
}

function build(m) {
  const row = el('div', 'msg');
  row.dataset.id = m.id;
  const head = el('div', 'mh');
  const name = el('b', null, m.from.name);
  name.style.color = m.from.color;
  head.append(name);
  if (m.to) head.append(el('span', 'arrow', `→ ${m.to.name}`));
  head.append(el('span', 'mt', timeText(m.at)));
  const text = m.full ?? m.text;
  const body = el('div', 'mb clamp');
  body.append(markdownEl(text));
  row.append(avatar(m.from), el('div', 'mc'));
  row.lastChild.append(head, body);
  if (isLong(text)) {
    const more = el('button', 'more', 'more');
    more.type = 'button';
    more.addEventListener('click', () => {
      const open = body.classList.toggle('clamp');
      more.textContent = open ? 'more' : 'less';
    });
    row.lastChild.append(more);
  } else {
    body.classList.remove('clamp');
  }
  return row;
}

/** Group-call chat: newest at the bottom; rows are built once per message id. */
export function createChat(list) {
  const rows = new Map();
  return {
    set(messages) {
      const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      const ids = new Set(messages.map((m) => m.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
      let prev = null;
      for (const m of messages) {
        let row = rows.get(m.id);
        if (!row) { row = build(m); rows.set(m.id, row); }
        if (needsPlace(row.isConnected, row.previousElementSibling, prev)) (prev ? prev.after(row) : list.prepend(row));
        prev = row;
      }
      if (stick) list.scrollTop = list.scrollHeight;
    },
  };
}
