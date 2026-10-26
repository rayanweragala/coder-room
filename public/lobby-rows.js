import { WORKING, ENDED } from './util.js';
import { modelShown } from './model.js';

export const MAX_ROWS = 4;

/** Elapsed at minute precision ("<1m", "7m", "1h 5m") so a card only redraws once a minute. */
export function minuteText(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const activityOf = (t) => Math.max(t.lastActivity || 0, t.endedAt || 0, t.startedAt || 0);

/**
 * The compact per-agent rows of a lobby card: working agents first, then the most recently active. Pure.
 * @returns {{rows: {id:string, name:string, color:string, status:string, label:string, line:string, elapsed:string}[], more:number}}
 */
export function agentRows(agents, now = Date.now(), max = MAX_ROWS) {
  const sorted = [...agents].sort((a, b) => WORKING.includes(b.status) - WORKING.includes(a.status) || activityOf(b) - activityOf(a));
  const rows = sorted.slice(0, max).map((t) => {
    const end = ENDED.includes(t.status) && t.endedAt ? t.endedAt : now;
    return {
      id: t.id, name: t.name, model: modelShown(t.name, t.model), color: t.color, status: t.status, label: t.label || t.status,
      rc: t.rc, line: t.current || '', elapsed: t.startedAt ? minuteText(end - t.startedAt) : '',
    };
  });
  return { rows, more: Math.max(0, sorted.length - max) };
}

/** "+N more" text, or '' when everything fits. */
export function moreText(more) {
  return more > 0 ? `+${more} more` : '';
}
