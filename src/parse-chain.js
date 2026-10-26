import { identityOf } from '../public/looks.js';

const ROLE = '(coder|review|investigate)';
const HM = '(\\d\\d):(\\d\\d)';
const RE_RUN = new RegExp(`^${ROLE} (\\S+) (started|finished) ${HM}(?: rc=(-?\\d+))?(?: on (.+))?$`);
const RE_LIMIT = new RegExp(`^${ROLE} (\\S+) LIMIT ${HM}(?: on (.+))?$`);
const RE_REFUSED = new RegExp(`^${ROLE} (\\S+) REFUSED ${HM}:?\\s*(.*)$`);
const RE_READY = new RegExp(`^round (\\S+) ready for orchestrator check ${HM}`);
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

/** Parses one line into an event carrying `hh`/`mm` instead of `at`; null for free text. */
function parseRaw(line) {
  let m = RE_RUN.exec(line);
  if (m) {
    return {
      type: m[3], role: m[1], round: m[2], hh: m[4], mm: m[5],
      rc: m[6] === undefined ? null : Number(m[6]), slot: slotOf(m[7]), who: identityOf(m[7]),
    };
  }
  m = RE_LIMIT.exec(line);
  if (m) return { type: 'limit', role: m[1], round: m[2], hh: m[3], mm: m[4], slot: slotOf(m[5]), who: identityOf(m[5]) };
  m = RE_REFUSED.exec(line);
  if (m) return { type: 'refused', role: m[1], round: m[2], hh: m[3], mm: m[4], slot: null, reason: m[5] };
  m = RE_READY.exec(line);
  if (m) return { type: 'ready', role: null, round: m[1], hh: m[2], mm: m[3], slot: null };
  return null;
}

function withAt({ hh, mm, ...ev }, at) {
  return { ...ev, at };
}

/**
 * Parses one chain.log line into {type, role?, round, at, rc?, slot?, reason?}; null for free text.
 * type is started | finished | limit | refused | ready. `at` is dated from the file mtime alone.
 */
export function parseChainLine(line, mtimeMs) {
  const ev = parseRaw(line);
  return ev && withAt(ev, stampToMs(ev.hh, ev.mm, mtimeMs));
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
    let at = onDayOf(ev.hh, ev.mm, ref);
    if (at > ref + (first ? 60_000 : 0)) at = dayBefore(at);
    first = false;
    ref = at;
    out.push(withAt(ev, at));
  }
  return out.reverse();
}

/** Round log file name for a role, per the run scripts. */
export function logName(role, round) {
  if (role === 'review') return `${round}-review.log`;
  if (role === 'investigate') return `${round}-investigate.log`;
  return `${round}.log`;
}
