const WORKING = ['thinking', 'editing', 'running a gate', 'running a command'];
export const ORCHESTRATOR = 'orchestrator';

const isWorking = (t) => !!t && WORKING.includes(t.status);

/**
 * Which tile full screen should show. Stays on a working agent; otherwise the working coder whose log grew
 * most recently (ties keep list order); otherwise the Orchestrator. Pure: no DOM.
 * @param {{id:string, kind?:string, status:string, lastActivity?:number|null}[]} tiles
 * @param {string|null} currentId
 */
export function pickNext(tiles, currentId) {
  const current = tiles.find((t) => t.id === currentId);
  if (isWorking(current)) return currentId;
  let best = null;
  for (const t of tiles) {
    if (t.id === ORCHESTRATOR || t.kind === 'orchestrator' || !isWorking(t)) continue;
    if (!best || (t.lastActivity ?? 0) > (best.lastActivity ?? 0)) best = t;
  }
  if (best) return best.id;
  const orch = tiles.find((t) => t.id === ORCHESTRATOR || t.kind === 'orchestrator');
  return orch ? orch.id : currentId;
}

/** Banner text for a card whose agent stopped working, or null while it has not stopped. */
export function finishText(t) {
  if (!t) return null;
  if (t.status === 'rate-limited') return `${t.name} hit its limit`;
  if (t.status === 'refused') return `${t.name} was refused`;
  if (t.status !== 'done') return null;
  const round = t.round ? ` ${t.round}` : '';
  return t.rc != null && t.rc !== 0 ? `${t.name} failed${round} ✗ rc ${t.rc}` : `${t.name} finished${round} ✓`;
}

export const USER_BUSY_MS = 10_000;

/** True while the user scrolled the timeline or expanded an item within the last 10 s. */
export function userBusy(lastTouch, now) {
  return lastTouch != null && now - lastTouch < USER_BUSY_MS;
}
