export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function elapsedText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

export function timeText(ms) {
  return ms == null ? '' : new Date(ms).toTimeString().slice(0, 5);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "HH:MM" for today, "yesterday HH:MM", else "Oct 24 HH:MM". */
export function dayTimeText(ms, now = Date.now()) {
  if (ms == null) return '';
  const d = new Date(ms);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return timeText(ms);
  if (days === 1) return `yesterday ${timeText(ms)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${timeText(ms)}`;
}

export const ENDED = ['done', 'refused', 'rate-limited', 'stopped'];
export const WORKING = ['editing', 'running a gate', 'running a command', 'thinking'];
export const GATE_MARK = { ok: '✓', fail: '✗', running: '…' };

/** "3/7 ✓ · 4 files" for a grid tile. */
export function summaryText(t) {
  const parts = [];
  if (t.checklist?.length && t.checklistMode !== 'spec') parts.push(`${t.checklist.filter((c) => c.status === 'done').length}/${t.checklist.length} ✓`);
  if (t.files?.length) parts.push(`${t.files.length} file${t.files.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** "gate ✗ npm test" when the latest gate failed, else null. */
export function failedGateText(t) {
  const g = t.gates?.at(-1);
  return g?.status === 'fail' ? `gate ${GATE_MARK.fail} ${g.cmd}` : null;
}

/** Elapsed/clock text for a tile's meta row. */
export function elapsedOf(t) {
  if (!t?.startedAt) return '';
  const end = ENDED.includes(t.status) ? t.endedAt : null;
  return `${timeText(t.startedAt)} · ${elapsedText((end ?? Date.now()) - t.startedAt)}`;
}
