const RAISING = ['done', 'rate-limited', 'refused'];
export const FRESH_MS = 10 * 60_000;
const KEEP_MS = 7 * 24 * 3_600_000;

/** Acknowledgement store for one viewer: `base` is the oldest time a hand may be raised for. */
export function initAcks(stored, now) {
  const keys = {};
  for (const [k, at] of Object.entries(stored?.keys ?? {})) if (now - at < KEEP_MS) keys[k] = at;
  const visit = Number.isFinite(stored?.visit) ? stored.visit : now;
  return { base: visit - FRESH_MS, visit: now, keys };
}

/** Key that identifies one raised hand: tile + round + when it ended (or last activity for a waiting Orchestrator). */
export function handKey(t) {
  if (t.kind === 'orchestrator' || t.id === 'orchestrator') return `${t.id}||${t.lastActivity ?? 0}|${t.status}`;
  return `${t.id}|${t.round ?? ''}|${t.endedAt ?? 0}|${t.status}`;
}

function sinceOf(t) {
  return (t.kind === 'orchestrator' || t.id === 'orchestrator' ? t.lastActivity : t.endedAt) ?? 0;
}

function raising(t) {
  if (t.kind === 'orchestrator' || t.id === 'orchestrator') return t.status === 'waiting for you';
  return RAISING.includes(t.status);
}

/**
 * Raised hands, oldest first: tiles in a raising state whose key was not acknowledged and that are not older than
 * `acks.base` (10 minutes before this viewer's previous visit, or before now on a first visit).
 * @returns {{id: string, key: string, since: number}[]}
 */
export function handsFor(tiles, acks, now = Date.now()) {
  const base = acks.base ?? now - FRESH_MS;
  return tiles
    .filter(raising)
    .map((t) => ({ id: t.id, key: handKey(t), since: sinceOf(t) }))
    .filter((h) => !(h.key in acks.keys) && h.since >= base)
    .sort((a, b) => a.since - b.since);
}

/** A copy of `acks` with `key` acknowledged at `now`. */
export function acknowledge(acks, key, now = Date.now()) {
  return { ...acks, keys: { ...acks.keys, [key]: now } };
}
