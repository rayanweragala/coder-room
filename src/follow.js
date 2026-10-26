import { Tail } from './tail.js';
import { backLines } from './backread.js';
import { createLogParser } from './parse-log.js';
import { Facts, KEEP_EVENTS, TIMELINE_KINDS } from './facts.js';

export const TAIL_ACTIVE = 384 * 1024;
export const TAIL_OLD = 96 * 1024;
export const ACTIVE_MS = 2 * 3_600_000;
export const BACK_BYTES = 2 * 1024 * 1024;
export const MAX_LINE_BYTES = 256 * 1024;
const STEP_BYTES = 64 * 1024;

/** Initial tail size for a coder log: 384 KB while the tile is working or ended within 2 h, else 96 KB. */
export function tailBytesFor(rec, now) {
  const lastAt = rec.endedAt ?? rec.at ?? 0;
  return rec.state === 'running' || now - lastAt <= ACTIVE_MS ? TAIL_ACTIVE : TAIL_OLD;
}

/** Follows one agent log: parses new lines into events and keeps what they imply (see Facts). */
export class LogFollower {
  /** @param {string} file @param {string} root @param {{orchestrator?: boolean, clock?: () => number, tailBytes?: number, backBytes?: number}} [opts] */
  constructor(file, root, { orchestrator = false, clock = Date.now, tailBytes = TAIL_ACTIVE, backBytes = BACK_BYTES } = {}) {
    this.file = file;
    this.root = root;
    this.orchestrator = orchestrator;
    this.clock = clock;
    this.backBytes = backBytes;
    this.tail = new Tail(file, tailBytes);
    this.tail.stepBytes = STEP_BYTES;
    this.#reset();
  }

  #reset() {
    this.parser = createLogParser({ root: this.root, orchestrator: this.orchestrator });
    this.facts = new Facts();
  }

  get grewAt() { return this.tail.mtimeMs; }
  get activity() { return this.facts.activity; }
  get current() { return this.facts.current; }
  get turn() { return this.facts.turn; }
  get seq() { return this.facts.seq; }

  /**
   * Orchestrator transcripts: reads backwards until KEEP_EVENTS events are found or `backBytes` are read, skipping
   * lines over 256 KB unparsed, then follows by offset from where the read began.
   */
  async #loadBack() {
    const counter = createLogParser({ root: this.root, orchestrator: true });
    const found = [];
    let readBytes = 0;
    let events = 0;
    const size = await backLines(this.file, (buf) => {
      if (buf[0] !== 0x7b) return false;
      const line = buf.toString('utf8');
      found.push(line);
      readBytes += buf.length + 1;
      events += counter.feed(line).filter((e) => TIMELINE_KINDS.has(e.kind)).length;
      return events >= KEEP_EVENTS;
    }, this.backBytes, MAX_LINE_BYTES);
    if (size === null) return;
    this.backPartial = readBytes < size;
    await this.tail.seek(size);
    for (let i = found.length - 1; i >= 0; i--) for (const ev of this.parser.feed(found[i])) this.facts.push(ev, null);
  }

  /** @returns {Promise<boolean>} true when anything changed */
  async poll() {
    const initial = !this.tail.started;
    if (initial && this.orchestrator) await this.#loadBack();
    const before = initial ? 0 : this.facts.seq;
    let reseted = false;
    do {
      const { lines, reset } = await this.tail.poll();
      if (reset) { this.#reset(); reseted = true; }
      const at = initial || reset || reseted ? null : this.clock();
      for (const raw of lines) for (const ev of this.parser.feed(raw)) this.facts.push(ev, at);
    } while (this.tail.more);
    if (initial || reseted) this.facts.meter.partial = this.orchestrator && initial ? this.backPartial : this.tail.fromTail;
    return reseted || this.facts.seq !== before;
  }
}
