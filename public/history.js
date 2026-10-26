import { fmtTokens, fmtCost } from './tokens.js';
import { elapsedText } from './util.js';

export const OUTCOMES = [['all', 'All'], ['done', '✓ done'], ['failed', '✗ failed'], ['limit', 'limit'], ['refused', 'refused'], ['running', 'running']];

/** Drops a leading round id and its separator (—, -, :) from a spec title: "q16 — X" becomes "X". */
export function stripRoundId(title, round) {
  if (!title || !round) return title || '';
  const lead = title.trimStart();
  if (!lead.toLowerCase().startsWith(round.toLowerCase())) return title;
  const rest = lead.slice(round.length);
  const sep = /^\s*[—–:-]\s+|^\s*[—–:]\s*/.exec(rest);
  return sep ? rest.slice(sep[0].length).trim() || title : title;
}

/** Outcome as the filter sees it: interrupted attempts count as failed. */
export const outcomeKey = (r) => (r.outcome === 'interrupted' ? 'failed' : r.outcome);

/** Chip text and CSS class for a row's outcome. */
export function outcomeChip(r) {
  switch (outcomeKey(r)) {
    case 'done': return { cls: 'ok', text: '✓' };
    case 'failed': return { cls: 'fail', text: r.rc == null ? '✗' : `✗ rc ${r.rc}` };
    case 'limit': return { cls: 'limit', text: 'limit' };
    case 'refused': return { cls: 'refused', text: 'refused' };
    default: return { cls: 'run', text: 'running' };
  }
}

/** Rows that pass the coder filter (set of coder ids; empty = all) and the outcome filter ('all' = every outcome). */
export function filterRows(rows, { coders = new Set(), outcome = 'all' } = {}) {
  return rows.filter((r) => (!coders.size || coders.has(r.who?.id)) && (outcome === 'all' || outcomeKey(r) === outcome));
}

/** Bar widths in percent, relative to the longest duration in view; unknown durations get 0, others at least 4. */
export function barWidths(rows) {
  const longest = Math.max(0, ...rows.map((r) => r.durationMs || 0));
  return rows.map((r) => (r.durationMs && longest ? Math.max(4, Math.round((r.durationMs / longest) * 100)) : 0));
}

/** Totals of the visible rounds: counts, output tokens (or Codex totals are not summed) and cost. */
export function totals(rows) {
  const t = { rounds: rows.length, done: 0, fix: 0, limit: 0, out: 0, cost: 0 };
  for (const r of rows) {
    const k = outcomeKey(r);
    if (k === 'done') t.done++;
    if (k === 'limit') t.limit++;
    if (r.fix) t.fix++;
    t.out += r.tokens?.out || 0;
    t.cost += r.tokens?.cost || 0;
  }
  return t;
}

export function totalsText(t) {
  const parts = [`${t.rounds} round${t.rounds === 1 ? '' : 's'}`, `${t.done} done`, `${t.fix} fix`, `${t.limit} limit`];
  if (t.out > 0) parts.push(`${fmtTokens(t.out)} out`);
  if (t.cost > 0) parts.push(fmtCost(t.cost));
  return parts.join(' · ');
}

/** Distinct coders of the rows, in first-seen order. */
export function codersOf(rows) {
  const seen = new Map();
  for (const r of rows) if (r.who && !seen.has(r.who.id)) seen.set(r.who.id, r.who);
  return [...seen.values()];
}

/** Row stats: duration, output tokens (or Codex total) and cost; empty strings when unknown. */
export function rowStats(r) {
  const tk = r.tokens;
  const tokens = !tk || tk.incomplete ? '' : tk.total != null ? `${fmtTokens(tk.total)} tok` : `${fmtTokens(tk.out)} out`;
  return {
    duration: r.durationMs == null ? '' : elapsedText(r.durationMs),
    tokens,
    cost: tk && !tk.incomplete ? fmtCost(tk.cost) ?? '' : '',
  };
}

/** Moves a list selection by `step`, clamped to the list. */
export function moveIndex(index, step, length) {
  if (!length) return -1;
  return Math.min(length - 1, Math.max(0, (index < 0 ? (step > 0 ? -1 : length) : index) + step));
}
