export const CHAT_MAX = 300;
const SHOW_CHARS = 400;
const DAY_MS = 86_400_000;

const ORCH = { id: 'orchestrator', name: 'Orchestrator', color: '#14b8a6' };
export const DEFAULT_USER_NAME = 'You';

function msg(id, project, at, from, to, text) {
  const full = String(text).trim();
  const m = { id, project, at, from, to: to ? { id: to.id, name: to.name } : null, text: full.slice(0, SHOW_CHARS) };
  if (full.length > SHOW_CHARS) m.full = full;
  return m;
}

/**
 * The user's conversation with each project's orchestrator for the last 24 h, oldest first. Coder messages,
 * hand-offs, limits and refusals are not chat.
 * @param {{orchs: {project: string, events: object[]}[], now: number, userName?: string}} input
 */
export function buildChat({ orchs, now, userName = DEFAULT_USER_NAME }) {
  const USER = { id: 'user', name: userName, color: '#e2e8f0' };
  const out = [];
  for (const o of orchs) {
    const mine = [];
    for (const e of o.events) {
      if (e.kind === 'message') mine.push(msg(`orch:${o.project}:${e.at}:${e.n}`, o.project, e.at, ORCH, USER, e.text));
      else if (e.kind === 'user') mine.push(msg(`user:${o.project}:${e.at}:${e.n}`, o.project, e.at, USER, null, e.text));
    }
    out.push(...mine.filter((m) => m.at == null || now - m.at <= DAY_MS).slice(-CHAT_MAX));
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.id < b.id ? -1 : 1));
}
