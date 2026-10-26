import { parseInline, inlineText } from './md-inline.js';

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*\S)\s*$/;
const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim()));
const startsBlock = (line, next) => FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || /^\s*>/.test(line)
  || (line.includes('|') && next !== undefined && next.includes('-') && TABLE_SEP.test(next) && next.includes('|'));

function parseList(lines, i) {
  const ordered = /^\s*\d/.test(lines[i]);
  const items = [];
  let base = null;
  for (; i < lines.length; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m) {
      if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { // indented continuation
        const last = items.at(-1).children.at(-1) ?? items.at(-1);
        last.inline.push({ t: 'br' }, ...parseInline(lines[i].trim()));
        continue;
      }
      break;
    }
    const indent = m[1].replace(/\t/g, '  ').length;
    base ??= indent;
    if (indent <= base) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ inline: parseInline(m[3]), children: [] });
    } else if (items.length) {
      items.at(-1).children.push({ inline: parseInline(m[3]), children: [] });
    } else break;
  }
  return { block: { type: ordered ? 'ol' : 'ul', items }, next: i };
}

/** Block tree of a text: {type: 'p'|'h'|'code'|'ul'|'ol'|'quote'|'table', ...}. Never throws. */
export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }
    if ((m = FENCE.exec(line))) {
      const body = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ type: 'code', lang: m[1], text: body.join('\n') });
      i++; // closing fence (or end of input for an unclosed one)
    } else if ((m = HEADING.exec(line))) {
      blocks.push({ type: 'h', level: m[1].length, inline: parseInline(m[2]) });
      i++;
    } else if (/^\s*>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', inline: parseInline(body.join('\n')) });
    } else if (ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
    } else if (startsBlock(line, lines[i + 1]) && line.includes('|')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      blocks.push({ type: 'table', head, rows });
    } else {
      const body = [line];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1]); i++) body.push(lines[i]);
      blocks.push({ type: 'p', inline: parseInline(body.join('\n')) });
    }
  }
  return blocks;
}

/** One line of plain text (markers stripped) for compact previews. */
export function plainText(text) {
  const blocks = parseMarkdown(text);
  const part = (b) => (b.type === 'code' ? b.text : b.type === 'table' ? b.head.map(inlineText).join(' ')
    : b.items ? b.items.map((it) => inlineText(it.inline)).join(' ') : inlineText(b.inline));
  return blocks.map(part).join(' ').replace(/\s+/g, ' ').trim();
}

function renderInline(nodes, doc) {
  const frag = doc.createDocumentFragment();
  for (const n of nodes) {
    if (n.t === 'text') frag.append(doc.createTextNode(n.v));
    else if (n.t === 'br') frag.append(doc.createElement('br'));
    else {
      const e = doc.createElement({ b: 'strong', i: 'em', code: 'code', a: 'a' }[n.t]);
      if (n.t === 'code') e.textContent = n.v;
      else e.append(renderInline(n.c, doc));
      if (n.t === 'a') { e.href = n.href; e.target = '_blank'; e.rel = 'noopener noreferrer'; }
      frag.append(e);
    }
  }
  return frag;
}

function renderList(b, doc) {
  const list = doc.createElement(b.type);
  for (const it of b.items) {
    const li = doc.createElement('li');
    li.append(renderInline(it.inline, doc));
    if (it.children.length) li.append(renderList({ type: b.type, items: it.children }, doc));
    list.append(li);
  }
  return list;
}

function renderTable(b, doc) {
  const wrap = doc.createElement('div');
  wrap.className = 'md-table';
  const table = doc.createElement('table');
  const row = (cs, tag) => {
    const tr = doc.createElement('tr');
    for (const c of cs) { const cell = doc.createElement(tag); cell.append(renderInline(c, doc)); tr.append(cell); }
    return tr;
  };
  const thead = doc.createElement('thead');
  thead.append(row(b.head, 'th'));
  const tbody = doc.createElement('tbody');
  for (const r of b.rows) tbody.append(row(r, 'td'));
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderBlock(b, doc) {
  if (b.type === 'ul' || b.type === 'ol') return renderList(b, doc);
  if (b.type === 'table') return renderTable(b, doc);
  if (b.type === 'code') {
    const pre = doc.createElement('pre');
    pre.className = 'md-code';
    const code = doc.createElement('code');
    code.textContent = b.text;
    if (b.lang) code.dataset.lang = b.lang;
    pre.append(code);
    return pre;
  }
  const e = doc.createElement(b.type === 'quote' ? 'blockquote' : 'p');
  if (b.type === 'h') e.className = `md-h md-h${b.level}`;
  e.append(renderInline(b.inline, doc));
  return e;
}

/** DocumentFragment built only from createElement / createTextNode, so text can never become markup. */
export function renderMarkdown(tree, doc = document) {
  const frag = doc.createDocumentFragment();
  for (const b of tree) frag.append(renderBlock(b, doc));
  return frag;
}

/** A `div.md` holding the rendered Markdown of `text`. */
export function markdownEl(text, doc = document) {
  const box = doc.createElement('div');
  box.className = 'md';
  box.append(renderMarkdown(parseMarkdown(text), doc));
  return box;
}
