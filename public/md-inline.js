const MAX_DEPTH = 4;
const MAX_SPAN = 4000;
const SPECIAL = /[\n`*_[]/g;
const WORD =/[\p{L}\p{N}]/u;

/** http(s) URLs only; anything else (javascript:, data:, relative) is not a link. */
export function safeUrl(raw) {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

/** indexOf with a memo per needle, so a long run of unclosed markers never rescans the whole text. */
function finder(s) {
  const memo = new Map();
  return (needle, from) => {
    const m = memo.get(needle);
    if (m && from >= m.from && (m.pos === -1 || m.pos >= from)) return m.pos;
    const pos = s.indexOf(needle, from);
    memo.set(needle, { from, pos });
    return pos;
  };
}

/** Index of the `)` that closes a link target starting at `from` (balanced parentheses), or -1. */
function urlEnd(s, from) {
  let depth = 0;
  for (let j = from; j < s.length && j - from < 2000; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && depth-- === 0) return j;
    else if (s[j] === '\n') return -1;
  }
  return -1;
}

const space =(c) => c === undefined || /\s/.test(c);

/** Closing single `*` or `_` for an opener at `i`, or -1. */
function closer(s, find, mark, i) {
  let j = i + 1;
  for (let n = 0; n < 8; n++) {
    j = find(mark, j);
    if (j === -1 || j - i > MAX_SPAN) return -1;
    const ok = j > i + 1 && !space(s[j - 1]) && s[j + 1] !== mark && s[j - 1] !== mark;
    if (ok && (mark === '*' || !WORD.test(s[j + 1] ?? ' '))) return j;
    j++;
  }
  return -1;
}

/**
 * Inline tree of a text: nodes are {t:'text'|'code', v}, {t:'b'|'i', c}, {t:'a', href, c}, {t:'br'}.
 * Unclosed markers stay literal.
 */
export function parseInline(s, depth = 0) {
  const out = [];
  const find = finder(s);
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  const sub = (a, b) => (depth + 1 > MAX_DEPTH ? [{ t: 'text', v: s.slice(a, b) }] : parseInline(s.slice(a, b), depth + 1));
  let i = 0;
  while (i < s.length) {
    SPECIAL.lastIndex = i;
    const at = SPECIAL.exec(s)?.index ?? s.length;
    if (at > i) { buf += s.slice(i, at); i = at; continue; }
    const ch = s[i];
    let end = -1;
    if (ch === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
    if (ch === '`') {
      end = find('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, end) }); i = end + 1; continue; }
    } else if (ch === '*' && s[i + 1] === '*') {
      end = find('**', i + 2);
      if (end > i + 2 && !space(s[i + 2])) { flush(); out.push({ t: 'b', c: sub(i + 2, end) }); i = end + 2; continue; }
      buf += '**';
      i += 2;
      continue;
    } else if ((ch === '*' || ch === '_') && !space(s[i + 1]) && s[i + 1] !== ch && (ch === '*' || !WORD.test(s[i - 1] ?? ' '))) {
      end = closer(s, find, ch, i);
      if (end !== -1) { flush(); out.push({ t: 'i', c: sub(i + 1, end) }); i = end + 1; continue; }
    } else if (ch === '[') {
      const mid = find('](', i + 1);
      const close = mid === -1 ? -1 : urlEnd(s, mid + 2);
      if (mid > i + 1 && close !== -1 && !s.slice(i + 1, mid).includes('\n')) {
        flush();
        const kids = sub(i + 1, mid);
        const href = safeUrl(s.slice(mid + 2, close));
        if (href) out.push({ t: 'a', href, c: kids }); else out.push(...kids);
        i = close + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Plain text of an inline tree. */
export function inlineText(nodes) {
  return nodes.map((n) => (n.t === 'br' ? ' ' : n.c ? inlineText(n.c) : n.v)).join('');
}
