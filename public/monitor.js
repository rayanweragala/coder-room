const DIFF_CHARS = 28;
const NAME_CHARS = 14;
const FLASH_MS = 2000;
const GREEN = '#4ade80';
const RED = '#f87171';
const SOFT = { '-': '#fca5a5', '+': '#86efac' };

/** First line of a command, cut to `max` chars with an ellipsis. */
export function cmdLine(cmd, max) {
  const first = String(cmd ?? '').split('\n', 1)[0].trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** What the editing monitor shows: file title, "+N −M" when known and up to 6 diff lines ({sign, text}). */
export function editView(ev) {
  if (!ev) return null;
  const file = String(ev.file || '');
  const base = file.length > NAME_CHARS ? `…${file.slice(-(NAME_CHARS - 1))}` : file;
  const lines = (ev.diff || []).slice(0, 6).map((l) => ({ sign: l[0], text: cmdLine(l.slice(1), DIFF_CHARS) }));
  return { title: base, counts: ev.add === undefined ? '' : `+${ev.add} −${ev.del || 0}`, lines };
}

/** 'ok' / 'fail' when a command just got its result (it was still running when last seen), else null. */
export function resultFlash(prev, cur) {
  if (!prev || !cur || prev.n !== cur.n || prev.ok !== undefined || cur.ok === undefined) return null;
  return cur.ok ? 'ok' : 'fail';
}

function setText(root, sel, text, fill) {
  const n = root.querySelector(sel);
  if (!n) return;
  n.textContent = text;
  if (fill) n.setAttribute('fill', fill);
}

function showEdit(root, tile) {
  const view = editView(tile.status === 'editing' ? tile.events.findLast((e) => e.kind === 'edit') : null);
  const has = !!view && (view.lines.length > 0 || view.counts !== '');
  root.classList.toggle('has-diff', has);
  setText(root, '.fname', (tile.current || '').slice(-24));
  setText(root, '.difftitle', view?.title ?? '');
  setText(root, '.diffcnt', view?.counts ?? '');
  root.querySelectorAll('.dl').forEach((n, i) => {
    const l = view?.lines[i];
    n.textContent = l ? `${l.sign}${l.text}` : '';
    n.setAttribute('fill', l ? SOFT[l.sign] || '#cbd5e1' : '#cbd5e1');
  });
}

function showCommand(v, tile) {
  const root = v.root;
  const cmd = tile.events.findLast((e) => e.kind === 'command');
  const text = cmdLine(cmd?.cmd ?? tile.current ?? '', 24);
  setText(root, '.cmdtext', `$ ${text.slice(0, 15)}`);
  root.querySelector('.cursor').setAttribute('x', 12 + Math.min(text.length, 15) * 4.8);
  setText(root, '.gatecmd', text);
  const cur = cmd ? { n: cmd.n, ok: cmd.ok } : null;
  const flash = v.isNew ? null : resultFlash(v.mon.last, cur);
  v.mon.last = cur;
  if (!flash) return;
  for (const sel of ['.cmdres', '.gateres']) setText(root, sel, flash === 'ok' ? '✓' : '✗', flash === 'ok' ? GREEN : RED);
  clearTimeout(v.mon.timer);
  v.mon.timer = setTimeout(() => { setText(root, '.cmdres', ''); setText(root, '.gateres', ''); }, FLASH_MS);
}

function showWatching(root, tile) {
  const w = tile.status === 'watching' ? tile.watching : null;
  setText(root, '.watchtitle', w ? `▶ ${w.name.replace(/^Sonnet · /, '')}${w.round ? ` · ${w.round}` : ''}` : '', w?.color || '#93c5fd');
  setText(root, '.watchcap', w?.caption ? w.caption.slice(0, 21) : '', w?.color || '#93c5fd');
}

/** Updates every monitor text of a tile view (SVG `textContent` only) from its tile. */
export function updateMonitor(v, tile, isNew) {
  v.mon ??= { last: null, timer: null };
  v.isNew = isNew;
  const fail = tile.status === 'done' && tile.rc != null && tile.rc !== 0;
  showWatching(v.root, tile);
  showEdit(v.root, tile);
  showCommand(v, tile);
  setText(v.root, '.donetext', tile.status !== 'done' ? '' : fail ? `✗ rc ${tile.rc}` : `✓ ${tile.round || ''}`);
}

export function stopMonitor(v) {
  clearTimeout(v.mon?.timer);
}
