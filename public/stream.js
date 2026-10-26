export const TALK = ['thought', 'say', 'intent', 'message', 'user'];
export const ALL_KINDS = [...TALK, 'command', 'edit', 'error', 'done'];
const GROUP = { say: 'said', intent: 'said', message: 'said' };
const GROUP_MS = 60_000;
const FOLD_LINES = 6;
const CHARS_PER_LINE = 75;
const BOTTOM_PX = 30;

const groupOf = (kind) => GROUP[kind] ?? kind;

/** Consecutive items of the same kind within 60 s (or of unknown time) form one block. */
export function groupEvents(events) {
  const groups = [];
  for (const e of events) {
    const g = groups.at(-1);
    const last = g?.items.at(-1);
    if (g && g.kind === groupOf(e.kind) && (last.at == null || e.at == null || e.at - last.at <= GROUP_MS)) g.items.push(e);
    else groups.push({ kind: groupOf(e.kind), at: e.at, items: [e] });
  }
  return groups;
}

/** How many items arrived since the reader scrolled up (`seen` = item count when they left the bottom). */
export function newCount(total, seen) {
  return seen == null ? 0 : Math.max(0, total - seen);
}

/** True when an item would take more than about 6 lines in the stream. */
export function isLong(text) {
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0);
  return lines > FOLD_LINES;
}

/** Plain, case-insensitive substring filter over an event's text, file and command. Empty query keeps everything. */
export function filterEvents(events, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return events;
  return events.filter((e) => [e.text, e.file, e.cmd].some((s) => s && String(s).toLowerCase().includes(q)));
}

/** Result chip of a command row: spinner while it runs, ✓ / ✗ (with the exit code when known) when it ended. */
export function resultChip(e, running = false) {
  if (e.ok === true) return { cls: 'ok', text: '✓' };
  if (e.ok === false) return { cls: 'fail', text: e.exit === undefined ? '✗' : `✗ ${e.exit}` };
  return running ? { cls: 'run', text: '' } : { cls: 'none', text: '' };
}

/** Collapsed edit row: distinct files and summed +/− (counts only when every edit knows them). */
export function foldEdits(items) {
  const known = items.every((e) => e.add !== undefined);
  return {
    files: new Set(items.map((e) => e.file)).size,
    add: known ? items.reduce((n, e) => n + e.add, 0) : null,
    del: known ? items.reduce((n, e) => n + (e.del || 0), 0) : null,
  };
}

export function editFoldText(items) {
  const f = foldEdits(items);
  const counts = f.add === null ? '' : ` · +${f.add} −${f.del}`;
  return `✎ ${f.files} file${f.files === 1 ? '' : 's'}${counts}`;
}

/** Panel heading: "Thoughts · q16" for a replayed round, "Live thoughts" otherwise. */
export function thoughtsHeading(t) {
  return t?.replay && t.round ? `Thoughts · ${t.round}` : 'Live thoughts';
}

/** Footer state: no indicator and no "new" pill in a replay; otherwise live or paused plus the pill count. */
export function footerState(t, stick, total, seen) {
  if (t?.replay) return { label: '', live: false, pill: 0 };
  return { label: stick ? '● Live' : '❚❚ Paused', live: stick, pill: stick ? 0 : newCount(total, seen) };
}

/** True when a scroll position is at (or within 30 px of) the bottom. */
export function atBottom(scrollTop, clientHeight, scrollHeight) {
  return scrollHeight - scrollTop - clientHeight < BOTTOM_PX;
}

/** Scroll anchor: the first visible block and how far its top is below the viewport top. */
export function anchorOf(tops, scrollTop) {
  for (const [key, top, height] of tops) if (top + height > scrollTop) return { key, offset: top - scrollTop };
  return null;
}

/** New scrollTop that keeps the anchored block where it was on screen. */
export function anchoredTop(newBlockTop, offset) {
  return Math.max(0, newBlockTop - offset);
}
