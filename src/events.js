/**
 * @typedef {{kind:'thought'|'say'|'intent'|'edit'|'command'|'result'|'todo'|'message'|'user'|'error'|'done',
 *   text:string, file?:string, cmd?:string, ok?:boolean, add?:number, del?:number, todos?:{text:string,status:string}[],
 *   id?:string, cont?:boolean}} LogEvent
 */

const ENV = '(?:[\\w.-]+=\\S*\\s+)*';
const GATE_WORD = new RegExp(
  `^${ENV}(?:npx\\s+)?(?:\\S*/)?(?:locked-mvn|locked-npx|mvn|vitest|tsc|eslint)(?![\\w-])`
  + `|^${ENV}npm (?:run )?(?:test|build|lint)(?![\\w-])|^${ENV}node --test`);

/** True when a command's first line runs a gate tool at a command word (line start or after `&&`, `||`, `;`, `|`). */
export function isGate(cmd) {
  const first = String(cmd ?? '').split('\n', 1)[0];
  return first.split(/&&|\|\||;|\|/).some((seg) => GATE_WORD.test(seg.trim()));
}
export const TEXT_MAX = 2000;

export function stripRoot(text, root) {
  if (!root || !text) return text || '';
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(esc + '/', 'g'), '').replace(new RegExp(esc + '(?![\\w.-])', 'g'), '.');
}

export function oneLine(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Text kept for an event: trimmed, at most 2,000 chars, line breaks kept. */
export function fullText(text, max = TEXT_MAX) {
  const t = String(text ?? '').trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Status a log event implies for a running agent, or null when it changes nothing. */
export function statusOf(ev) {
  switch (ev.kind) {
    case 'edit': return 'editing';
    case 'command': return isGate(ev.cmd) ? 'running a gate' : 'running a command';
    case 'say':
    case 'thought':
    case 'intent': return 'thinking';
    default: return null;
  }
}

/** Latest "current file or command" text for an event, or null. */
export function currentOf(ev) {
  const v = ev.kind === 'edit' ? ev.file : ev.kind === 'command' ? ev.cmd : null;
  return v ? oneLine(v, 120) : null;
}

/** Live subtitle text for an event, or null when it is not caption material. */
export function captionOf(ev) {
  return ev.kind === 'thought' || ev.kind === 'say' || ev.kind === 'intent' ? oneLine(ev.text, 220) : null;
}

export const DIFF_LINES = 6;
const DIFF_WIDTH = 48;

/** Up to 6 monitor diff lines ("-old" / "+new", each cut to 48 chars); blank lines are skipped. */
export function diffLines(oldText, newText, max = DIFF_LINES) {
  const pick = (s) => String(s ?? '').split('\n').filter((l) => l.trim()).map((l) => l.trimEnd().slice(0, DIFF_WIDTH));
  const olds = pick(oldText);
  const news = pick(newText);
  const nNew = Math.min(news.length, max - Math.min(olds.length, Math.ceil(max / 2)));
  const nOld = Math.min(olds.length, max - nNew);
  return [...olds.slice(0, nOld).map((l) => `-${l}`), ...news.slice(0, nNew).map((l) => `+${l}`)];
}

/** Lines in a string (0 for empty). */
export function lineCount(s) {
  return s ? String(s).split('\n').length : 0;
}
