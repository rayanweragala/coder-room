import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Tail } from './tail.js';
import { LogFollower, tailBytesFor } from './follow.js';
import { discoverProjects, recentTranscripts } from './projects.js';
import { orchestratorFiles } from './orchestra.js';
import { HandoffGoals } from './goal.js';
import { parseChainLines, logName } from './parse-chain.js';
import { ChainModel, coderStatus, orchestratorStatus } from './state.js';
import { attemptKey, hasEnded, newerStart, findRotated } from './attempts.js';
import { RoundInfo } from './rounds.js';
import { buildChat } from './chat.js';
import { coderTile, orchestratorTile } from './tiles.js';

const ROUNDS_MS = 5_000;
const RESCAN_MS = 60_000;
const TRANSCRIPT_MS = 5_000;
const HOLD_TICKS = 2;

/** Polls the watched files once a second and keeps the tiles; emits `tile` / `remove` on change. */
export class Room {
  constructor({ roots, scanRoot, claudeProjects, home = os.homedir(), clock = Date.now, userName }) {
    this.userName = userName;
    Object.assign(this, { roots, scanRoot, claudeProjects, home, clock });
    this.recentRecs = [];
    this.model = new ChainModel();
    this.projects = [];
    this.chains = new Map();
    this.logs = new Map();
    this.orchs = new Map();
    this.assigned = new Map();
    this.goals = new HandoffGoals();
    this.goalOf = new Map();
    this.tiles = new Map();
    this.json = new Map();
    this.cache = new Map();
    this.chatSig = '';
    this.listeners = { tile: new Set(), remove: new Set(), chat: new Set(), handoff: new Set() };
    this.rounds = new RoundInfo();
    this.roundDocs = new Map();
    this.lastRounds = -Infinity;
    this.chat = [];
    this.chatJson = '[]';
    this.seen = new Map();
    this.primed = false;
    this.lastScan = -Infinity;
    this.lastTranscript = -Infinity;
    this.timer = null;
    this.stopped = false;
  }

  on(type, fn) {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  async start() {
    await this.tick();
    const loop = async () => {
      if (this.stopped) return;
      try { await this.tick(); } catch (e) { console.error('tick failed:', e.message); }
      if (!this.stopped) this.timer = setTimeout(loop, 1000);
    };
    this.timer = setTimeout(loop, 1000);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  #projectsView() {
    return this.projects.map((p) => ({ name: p.name, runsDir: p.runsName, goal: this.goalOf.get(p.dir)?.short || null, toward: this.goalOf.get(p.dir)?.toward || null }));
  }

  #working() {
    return [...this.tiles.values()].filter((t) => ['editing', 'running a gate', 'running a command', 'thinking'].includes(t.status)).length;
  }

  snapshot() {
    return {
      now: this.clock(), tiles: [...this.tiles.values()], projects: this.#projectsView(), chat: this.chat, working: this.#working(),
    };
  }

  /** `JSON.stringify(snapshot())`, assembled from each tile's cached JSON so unchanged tiles are not serialised again. */
  snapshotJson() {
    const tiles = [...this.tiles.keys()].map((id) => this.cache.get(id).json).join(',');
    return `{"now":${this.clock()},"tiles":[${tiles}],"projects":${JSON.stringify(this.#projectsView())},"chat":${this.chatJson},"working":${this.#working()}}`;
  }

  async tick() {
    const now = this.clock();
    if (now - this.lastScan >= RESCAN_MS) {
      this.lastScan = now;
      this.projects = await discoverProjects({ roots: this.roots, scanRoot: this.scanRoot });
      this.#dropGoneProjects();
    }
    for (const p of this.projects) await this.#pollChain(p);
    await this.#findRecent(now);
    await this.#pollLogs();
    if (now - this.lastTranscript >= TRANSCRIPT_MS) {
      this.lastTranscript = now;
      await this.#pickTranscripts(now);
    }
    for (const o of this.orchs.values()) await o.follower.poll();
    const missing = this.recentRecs.some((r) => !this.roundDocs.has(`${r.runsDir}\0${r.round}`) || !this.goalOf.has(r.dir))
      || [...this.orchs.keys()].some((dir) => !this.goalOf.has(dir));
    if (missing || now - this.lastRounds >= ROUNDS_MS) {
      this.lastRounds = now;
      await this.#pollRounds();
    }
    this.#publish(now);
  }

  #dropGoneProjects() {
    const alive = new Set(this.projects.map((p) => p.runsDir));
    for (const [k, c] of this.chains) {
      if (alive.has(k)) continue;
      this.chains.delete(k);
      this.model.clearProject(c.project.dir);
    }
  }

  async #pollChain(project) {
    let c = this.chains.get(project.runsDir);
    if (!c) {
      c = { project, tail: new Tail(path.join(project.runsDir, 'chain.log')) };
      this.chains.set(project.runsDir, c);
    }
    const { lines, reset } = await c.tail.poll();
    if (reset) this.model.clearProject(project.dir);
    for (const ev of parseChainLines(lines, c.tail.mtimeMs)) this.model.apply(project, ev);
  }

  /** Records that get a tile; the round log's mtime, when the log exists, is the strongest signal. */
  async #findRecent(now) {
    const mtimes = new Map();
    for (const r of this.model.all()) {
      const file = path.join(r.runsDir, logName(r.role, r.round));
      try {
        mtimes.set(file, (await fs.stat(file)).mtimeMs);
      } catch { /* no log yet */ }
    }
    this.recentRecs = this.model.recent(now, (r) => mtimes.get(path.join(r.runsDir, logName(r.role, r.round))));
  }

  /** One follower per attempt (see attempts.js): an ended or superseded attempt never follows a replaced `<round>.log`. */
  async #pollLogs() {
    const now = this.clock();
    const all = this.model.all();
    const wanted = new Set();
    for (const r of this.recentRecs) {
      const key = attemptKey(r);
      wanted.add(key);
      let b = this.logs.get(key);
      if (!b) {
        b = await this.#bind(r, all, now);
        this.logs.set(key, b);
      }
      await this.#pollBinding(b, r, all);
    }
    for (const k of this.logs.keys()) if (!wanted.has(k)) this.logs.delete(k);
  }

  /** An attempt that a newer one replaced reads its rotated log; any other follows `<round>.log`. */
  async #bind(r, all, now) {
    let file = path.join(r.runsDir, logName(r.role, r.round));
    let live = true;
    const newer = newerStart(r, all);
    if (newer != null) {
      const prev = await findRotated(r, { before: newer });
      if (prev) { file = prev; live = false; }
    }
    const follower = new LogFollower(file, r.dir, { clock: this.clock, tailBytes: tailBytesFor(r, now) });
    return { follower, live, ino: null, frozen: false, held: 0 };
  }

  async #pollBinding(b, r, all) {
    if (b.frozen) return;
    if (b.live && b.ino != null && await this.#replaced(b)) {
      if (hasEnded(r) || newerStart(r, all) != null) {
        await this.#freeze(b, r);
        return;
      }
      if (++b.held <= HOLD_TICKS) return;
    }
    await b.follower.poll();
    b.held = 0;
    if (b.live) b.ino = b.follower.tail.ino;
  }

  async #replaced(b) {
    try {
      const st = await fs.stat(b.follower.file);
      return st.ino !== b.ino || st.size < b.follower.tail.offset;
    } catch {
      return false;
    }
  }

  /** The live file was rotated away: read what is left of the old content from the rotated file, then stop following. */
  async #freeze(b, r) {
    const prev = await findRotated(r, { ino: b.ino });
    if (prev) {
      b.follower.file = prev;
      b.follower.tail.file = prev;
      await b.follower.poll();
    }
    b.frozen = true;
  }

  /** One orchestrator per project: the newest transcript assigned to it (see orchestra.js). */
  async #pickTranscripts(now) {
    const found = await recentTranscripts(this.projects, this.claudeProjects, this.home, now);
    const best = await orchestratorFiles(found, this.projects, this.assigned, now, this.home);
    const next = new Map();
    for (const p of this.projects) {
      const t = best.get(p.dir);
      if (!t) continue;
      const old = this.orchs.get(p.dir);
      next.set(p.dir, old?.file === t.file ? old
        : { file: t.file, project: p.name, follower: new LogFollower(t.file, p.dir, { orchestrator: true, clock: this.clock }) });
    }
    this.orchs = next;
  }

  async #pollRounds() {
    const active = new Set([...this.orchs.keys(), ...this.recentRecs.map((r) => r.dir)]);
    for (const p of this.projects) {
      if (active.has(p.dir)) {
        this.goalOf.set(p.dir, await this.goals.get(p));
      } else {
        this.goalOf.delete(p.dir);
        this.goals.drop(p);
      }
    }
    const next = new Map();
    for (const r of this.recentRecs) {
      const k = `${r.runsDir}\0${r.round}`;
      if (!next.has(k)) next.set(k, await this.rounds.get(r.runsDir, r.round));
    }
    this.rounds.retain(next.keys());
    this.roundDocs = next;
  }

  #publish(now) {
    const next = new Map();
    const orchs = new Map();
    const coders = [];
    for (const r of this.recentRecs) {
      const f = this.logs.get(attemptKey(r))?.follower;
      const docs = this.roundDocs.get(`${r.runsDir}\0${r.round}`) ?? { spec: null, report: null };
      const st = coderStatus(r, f?.activity, f?.grewAt, now);
      const key = [r.id, f?.seq, st.status, st.quiet, f?.current, f?.grewAt, r.round, r.role, r.rc, r.reason, r.startedAt, r.endedAt, r.model, docs];
      const tile = this.#tileFor(r.id, key, () => coderTile(r, f, docs, st));
      next.set(r.id, tile);
      coders.push(tile);
      this.#noteHandoff(r);
    }
    for (const [dir, o] of this.orchs) {
      const f = o.follower;
      const mine = coders.filter((t) => t.project === o.project);
      const st = orchestratorStatus({ turn: f.turn, activity: f.activity, grewAt: f.grewAt }, mine, now);
      const goal = this.goalOf.get(dir);
      const id = o.project ? `orchestrator@${o.project}` : 'orchestrator';
      const key = [id, f.seq, st.status, st.watching, f.current, f.grewAt, goal];
      orchs.set(id, this.#tileFor(id, key, () => orchestratorTile(o, st, goal)));
    }
    this.primed = true;
    this.#swapTiles(new Map([...orchs, ...next]));
    this.#publishChat(now);
  }

  /** The tile and its JSON, rebuilt only when the key (everything the tile is made from) changed. */
  #tileFor(id, key, build) {
    const k = JSON.stringify(key);
    const hit = this.cache.get(id);
    if (hit?.key === k) return hit.tile;
    const tile = build();
    this.cache.set(id, { key: k, tile, json: JSON.stringify(tile) });
    return tile;
  }

  #noteHandoff(r) {
    const key = `${r.round}:${r.state}`;
    const changed = this.seen.get(r.id) !== key;
    this.seen.set(r.id, key);
    if (!changed || !this.primed) return;
    const ev = r.state === 'running' ? { type: 'spec', to: r.id } : r.state === 'done' ? { type: 'report', from: r.id } : null;
    if (ev) for (const fn of this.listeners.handoff) fn({ ...ev, project: r.project });
  }

  #publishChat(now) {
    const sig = `${Math.floor(now / 60_000)}|${[...this.orchs.values()].map((o) => `${o.project}:${o.file}:${o.follower.seq}`).join(',')}`;
    if (sig === this.chatSig) return;
    this.chatSig = sig;
    const orchs = [...this.orchs.values()].map((o) => ({ project: o.project, events: o.follower.facts.events }));
    this.chat = buildChat({ orchs, now, userName: this.userName });
    const j = JSON.stringify(this.chat);
    if (j === this.chatJson) return;
    this.chatJson = j;
    for (const fn of this.listeners.chat) fn(this.chat);
  }

  #swapTiles(next) {
    for (const id of this.tiles.keys()) {
      if (next.has(id)) continue;
      this.json.delete(id);
      for (const fn of this.listeners.remove) fn(id);
    }
    for (const id of this.cache.keys()) if (!next.has(id)) this.cache.delete(id);
    this.tiles = next;
    for (const [id] of next) {
      const j = this.cache.get(id).json;
      if (this.json.get(id) === j) continue;
      this.json.set(id, j);
      for (const fn of this.listeners.tile) fn(this.tiles.get(id));
    }
  }
}
