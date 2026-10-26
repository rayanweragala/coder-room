import { identityOf } from '../public/looks.js';

export const DAY_MS = 86_400_000;
export const QUIET_MS = 3 * 60_000;
export const WAITING_MS = 2 * 60_000;

/** Folds parsed chain.log lines (in file order) into one record per coder slot. */
export class ChainModel {
  constructor() {
    this.slots = new Map();
    this.startedSlot = new Map();
    this.seq = 0;
  }

  clearProject(dir) {
    for (const [k, r] of this.slots) if (r.dir === dir) this.slots.delete(k);
    for (const k of this.startedSlot.keys()) if (k.startsWith(`${dir}\0`)) this.startedSlot.delete(k);
  }

  /** @param {{name:string, dir:string, runsDir:string}} project */
  apply(project, ev) {
    if (ev.type === 'ready') {
      for (const r of this.slots.values()) {
        if (r.dir === project.dir && r.round === ev.round && r.state === 'running') {
          r.state = 'done';
          r.endedAt = ev.at;
        }
      }
      return;
    }
    const who = ev.who ?? (ev.slot ? identityOf(ev.slot) : null) ?? this.startedSlot.get(`${project.dir}\0${ev.round}`);
    if (!who) return;
    const slot = who.id;
    const key = `${project.dir}\0${slot}`;
    const cur = this.slots.get(key);
    const same = cur && cur.round === ev.round && cur.role === ev.role;
    if (cur && !same && cur.at > ev.at) return;
    const rec = same ? cur : {
      slot, id: `${slot}@${project.name}`, name: who.name, color: who.color, char: who.kind, look: who.look,
      dir: project.dir, runsDir: project.runsDir, project: project.name,
      role: ev.role, round: ev.round, startedAt: ev.at, endedAt: null, rc: null, reason: null,
    };
    rec.at = ev.at;
    rec.reason = null;
    rec.model = who.model ?? rec.model ?? null;
    if (ev.type === 'started') {
      Object.assign(rec, { state: 'running', startedAt: ev.at, endedAt: null, rc: null, startSeq: ++this.seq });
      this.startedSlot.set(`${project.dir}\0${ev.round}`, who);
    } else if (ev.type === 'finished') {
      Object.assign(rec, { state: 'done', rc: ev.rc, endedAt: ev.at });
    } else if (ev.type === 'limit') {
      Object.assign(rec, { state: 'rate-limited', endedAt: ev.at });
    } else if (ev.type === 'refused') {
      Object.assign(rec, { state: 'refused', endedAt: ev.at, reason: ev.reason || null });
    }
    this.slots.set(key, rec);
  }

  all() {
    return [...this.slots.values()];
  }

  /**
   * Records still worth a tile: the round log's mtime decides when `logMtime(rec)` knows it (undefined for a
   * missing log), else the record's dated chain line must be within the last 24 h.
   */
  recent(now, logMtime = () => undefined) {
    return this.all().filter((r) => now - (logMtime(r) ?? r.at) <= DAY_MS);
  }
}

/** Status of a coder tile. `activity` is the status implied by its latest log event; `grewAt` the log mtime. */
export function coderStatus(rec, activity, grewAt, now) {
  if (rec.state === 'rate-limited') return { status: 'rate-limited', quiet: null };
  if (rec.state === 'refused') return { status: 'refused', quiet: null };
  if (rec.state === 'done') return { status: 'done', quiet: null };
  const last = Math.max(grewAt || 0, rec.startedAt);
  const idle = now - last;
  return {
    status: activity || 'thinking',
    quiet: idle > QUIET_MS ? Math.floor(idle / 60_000) : null,
  };
}

export const WORKING_STATUSES = ['thinking', 'editing', 'running a gate', 'running a command'];
export const WORKING_MS = 20_000;

/** The coder tile to watch and the label for it: the most recently active working coder, "+N" for the rest. */
function watchOf(tiles) {
  const working = tiles.filter((t) => t.kind === 'coder' && WORKING_STATUSES.includes(t.status))
    .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  if (!working.length) return null;
  const t = working[0];
  const more = working.length > 1 ? ` +${working.length - 1}` : '';
  const round = t.round ? ` · ${t.round}` : '';
  return {
    label: `watching ${t.name}${round}${more}`, name: t.name, round: t.round ?? null, color: t.color, caption: t.caption ?? null,
  };
}

/**
 * Status of the orchestrator tile. `signals` = {turn: {seen, open, workAt}, activity, grewAt} from its transcript;
 * `projectTiles` are the tiles of the same project. Working while its turn is open or it worked in the last 20 s;
 * after a turn end it is `watching` a working coder, else `waiting for you`. A transcript with no turn-end line
 * counts as ended once it has been quiet for 2 minutes.
 * @returns {{status: string, label: string|null, watching: object|null, quiet: null}}
 */
export function orchestratorStatus({ turn, activity, grewAt }, projectTiles, now) {
  const state = (status, watching = null) => ({ status, label: watching?.label ?? null, watching, quiet: null });
  if (!grewAt) return state('waiting for you');
  const recentWork = turn.workAt != null && now - turn.workAt <= WORKING_MS;
  const quiet = now - grewAt > WAITING_MS;
  const ended = turn.seen ? !turn.open : quiet;
  if (!ended || recentWork) return state(activity || 'thinking');
  const watching = watchOf(projectTiles);
  return watching ? state('watching', watching) : state('waiting for you');
}
