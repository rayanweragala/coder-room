import { identityOf } from '../public/looks.js';

const ROLE = '(coder|review|investigate|research)';
const STAMP = '(?:(\\d{4})-(\\d\\d)-(\\d\\d) )?(\\d\\d):(\\d\\d)';
const RE_RUN = new RegExp(`^${ROLE} (\\S+) (started|finished) ${STAMP}(?: rc=(-?\\d+))?(?: on (.+))?$`);
const RE_LIMIT = new RegExp(`^${ROLE} (\\S+) LIMIT ${STAMP}(?: on (.+))?$`);
const RE_REFUSED = new RegExp(`^${ROLE} (\\S+) REFUSED ${STAMP}:?\\s*(.*)$`);
const RE_READY = new RegExp(`^round (\\S+) ready for orchestrator check ${STAMP}`);
const RE_STOPPED_HEAD = new RegExp(`^${ROLE} (\\S+) (?:.*?\\s)?STOPPED\\b(.*)$`);
const RE_STAMP_END = /(?:(\d{4})-(\d\d)-(\d\d) )?(\d\d):(\d\d)(?=:|\s*$)/;
const RE_ANCHOR = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)\b/;

/** Identity ({id, name, kind, look, color}) for a slot id or the text after " on "; null when empty. */
export function slotInfo(on) {
  return identityOf(on);
}

/** Slot id (the coder name, lowercase) from the text after " on " (e.g. "codex gpt-6.1-sol", "claude-main sonnet"), or null. */
export function slotOf(on) {
  return identityOf(on)?.id ?? null;
}

function onDayOf(hh, mm, refMs) {
  const d = new Date(refMs);
  d.setHours(Number(hh), Number(mm), 0, 0);
  return d.getTime();
}

function dayBefore(ms) {
  const d = new Date(ms);
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** Date for an HH:MM stamp: the day of the file's mtime, or the day before when that would be in the future. */
export function stampToMs(hh, mm, mtimeMs) {
  const ms = onDayOf(hh, mm, mtimeMs);
  return ms > mtimeMs + 60_000 ? dayBefore(ms) : ms;
}

/** Clock fields from regex groups [year, month, day, hh, mm]; `exact` is the local ms when the stamp has a date. */
function stampOf([y, mo, d, hh, mm]) {
  const exact = y === undefined ? null : new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)).getTime();
  return { hh, mm, exact };
}

/** `<role> <round> ... STOPPED <text> [DATE ]HH:MM[: reason]`: the stamp that ends the text or precedes the `:`. */
function parseStopped(line) {
  const head = RE_STOPPED_HEAD.exec(line);
  const at = head && RE_STAMP_END.exec(head[3]);
  if (!at) return null;
  const reason = head[3].slice(at.index + at[0].length).replace(/^:\s*/, '').trim();
  return { type: 'stopped', role: head[1], round: head[2], ...stampOf(at.slice(1, 6)), slot: null, reason: reason || null };
}

/** Parses one line into an event carrying `hh`/`mm`/`exact` instead of `at`; null for free text. */
function parseRaw(line) {
  let m = RE_RUN.exec(line);
  if (m) {
    return {
      type: m[3], role: m[1], round: m[2], ...stampOf(m.slice(4, 9)),
      rc: m[9] === undefined ? null : Number(m[9]), slot: slotOf(m[10]), who: identityOf(m[10]),
    };
  }
  m = RE_LIMIT.exec(line);
  if (m) return { type: 'limit', role: m[1], round: m[2], ...stampOf(m.slice(3, 8)), slot: slotOf(m[8]), who: identityOf(m[8]) };
  m = RE_REFUSED.exec(line);
  if (m) return { type: 'refused', role: m[1], round: m[2], ...stampOf(m.slice(3, 8)), slot: null, reason: m[8] };
  m = RE_READY.exec(line);
  if (m) return { type: 'ready', role: null, round: m[1], ...stampOf(m.slice(2, 7)), slot: null };
  return parseStopped(line);
}

function withAt({ hh, mm, exact, ...ev }, at) {
  return { ...ev, at };
}

/**
 * Parses one chain.log line into {type, role?, round, at, rc?, slot?, reason?}; null for free text.
 * type is started | finished | limit | refused | stopped | ready. `at` is dated from the file mtime alone unless the
 * line carries a date.
 */
export function parseChainLine(line, mtimeMs) {
  const ev = parseRaw(line);
  return ev && withAt(ev, ev.exact ?? stampToMs(ev.hh, ev.mm, mtimeMs));
}

/**
 * Parses chain.log lines (file order) into dated events. Stamps carry only HH:MM, so lines are dated by walking
 * backwards from the end: the last line is on the mtime's day (the day before when later than the mtime), and a
 * line later than the one after it is a day earlier. `YYYY-MM-DD HH:MM` free-text lines are exact anchors.
 */
export function parseChainLines(lines, mtimeMs) {
  const out = [];
  let ref = mtimeMs;
  let first = true;
  for (let i = lines.length - 1; i >= 0; i--) {
    const a = RE_ANCHOR.exec(lines[i]);
    if (a) {
      ref = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]), Number(a[4]), Number(a[5])).getTime();
      first = false;
      continue;
    }
    const ev = parseRaw(lines[i]);
    if (!ev) continue;
    let at = ev.exact ?? onDayOf(ev.hh, ev.mm, ref);
    if (ev.exact === null && at > ref + (first ? 60_000 : 0)) at = dayBefore(at);
    first = false;
    ref = at;
    out.push(withAt(ev, at));
  }
  return out.reverse();
}

/** Round log file name for a role, per the run scripts. */
export function logName(role, round) {
  if (role === 'review') return `${round}-review.log`;
  if (role === 'investigate') return `${round}-${role}.log`;
  return `${round}.log`;
}
