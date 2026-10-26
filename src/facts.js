import { statusOf, currentOf, captionOf, oneLine, fullText, isGate, TEXT_MAX } from './events.js';
import { UsageMeter } from './usage.js';
// edit events keep a monitor `diff` (up to 6 lines) only while they are the newest edit

export const KEEP_EVENTS = 120;
const KEEP_GATES = 12;
const KEEP_FILES = 30;
export const TIMELINE_KINDS = new Set(['thought', 'say', 'intent', 'edit', 'command', 'todo', 'message', 'user', 'error', 'done']);

/** What one agent log has shown so far: the event stream plus the caption, files, gates and checklist it implies. */
export class Facts {
  constructor({ keep = KEEP_EVENTS } = {}) {
    this.keep = keep;
    this.events = [];
    this.seq = 0;
    this.activity = null;
    this.current = null;
    this.ended = null;
    this.caption = null;
    this.captionSeq = 0;
    this.todos = [];
    this.files = new Map();
    this.gates = [];
    this.turn = { seen: false, open: true, workAt: null };
    this.meter = new UsageMeter();
    this.todoSig = null;
    this.model = null;
  }

  usage() { return this.meter.view(); }

  /** One compact "☑ checklist 3/5" row, only when the done-count or the item count changed since the last one. */
  #checklistRow(ev, at) {
    const done = this.todos.filter((t) => t.status === 'completed').length;
    const sig = `${done}/${this.todos.length}`;
    if (!this.todos.length || sig === this.todoSig) return;
    this.todoSig = sig;
    this.#append({ kind: 'todo', text: `☑ checklist ${sig}`, ts: ev.ts }, at);
  }

  /** Orchestrator turn state: a turn-end closes the turn; the user, a wake-up or assistant work opens it. */
  #turn(ev, at) {
    const when = ev.ts ?? at ?? null;
    if (ev.kind === 'turn-end') {
      this.turn = { seen: true, open: false, workAt: this.turn.workAt };
    } else if (ev.kind === 'user' || ev.kind === 'wake') {
      this.turn.open = true;
      this.activity = 'thinking';
    } else if (TIMELINE_KINDS.has(ev.kind) && ev.kind !== 'result') {
      this.turn.open = true;
      if (when !== null) this.turn.workAt = when;
    }
  }

  /** Coder logs keep the first model seen (the init event); an orchestrator transcript follows its latest one. */
  #model(ev) {
    if (this.model && !ev.latest) return;
    if (this.model === ev.model) return;
    this.model = ev.model;
    this.seq++;
  }

  push(ev, at) {
    if (ev.kind === 'model') return this.#model(ev);
    this.#turn(ev, at);
    if (ev.kind === 'usage') {
      if (this.meter.add(ev)) this.seq++;
      return;
    }
    const st = statusOf(ev);
    if (st) this.activity = st;
    const cur = currentOf(ev);
    if (cur) this.current = cur;
    if (ev.kind === 'done') this.ended = ev.text;
    if (ev.kind === 'result') return this.#result(ev);
    const cap = captionOf(ev);
    if (cap) { this.caption = cap; this.captionSeq = this.seq + 1; }
    if (ev.kind === 'todo') {
      this.todos = ev.todos || [];
      this.#checklistRow(ev, at);
      return;
    }
    if (ev.kind === 'done' && ev.dup && this.events.at(-1)?.kind === 'say') this.events.pop();
    if (ev.kind === 'edit') this.#touch(ev);
    if (ev.kind === 'command' && isGate(ev.cmd)) {
      this.gates.push({ cmd: oneLine(ev.cmd, 160), status: 'running', id: ev.id });
      if (this.gates.length > KEEP_GATES) this.gates.shift();
    }
    if (TIMELINE_KINDS.has(ev.kind)) this.#append(ev, at);
  }

  #append(ev, at) {
    const prev = this.events.at(-1);
    if (ev.cont && prev && prev.kind === ev.kind && prev.text.length < TEXT_MAX) {
      prev.text = fullText(`${prev.text}\n${ev.text}`);
      this.seq++;
      prev.n = this.seq;
      return;
    }
    const { cont, ts, dup, ...rest } = ev;
    if (ev.kind === 'command' && isGate(ev.cmd)) rest.gate = true;
    if (ev.kind === 'edit' && this.diffEvent) delete this.diffEvent.diff;
    const entry = { n: ++this.seq, at: ts ?? at, ...rest };
    if (ev.kind === 'edit') this.diffEvent = entry.diff?.length ? entry : null;
    this.events.push(entry);
    if (this.events.length > this.keep) this.events.shift();
  }

  #result(ev) {
    const match = (e) => e.kind === 'command' && e.ok === undefined && (!ev.id || e.id === ev.id);
    const cmd = this.events.findLast(match);
    if (cmd) {
      cmd.ok = ev.ok;
      const code = ev.ok ? null : /^(\d+)\s/.exec(ev.text || '');
      if (code) cmd.exit = Number(code[1]);
    }
    const gate = this.gates.findLast((g) => g.status === 'running' && (!ev.id || g.id === ev.id));
    if (gate) gate.status = ev.ok ? 'ok' : 'fail';
    if (cmd || gate) this.seq++;
  }

  #touch(ev) {
    const f = this.files.get(ev.file) ?? { file: ev.file, edits: 0, add: 0, del: 0, known: true };
    this.files.delete(ev.file);
    f.edits++;
    if (ev.add === undefined) f.known = false;
    else { f.add += ev.add; f.del += ev.del || 0; }
    this.files.set(ev.file, f);
  }

  filesList() {
    const outside = (f) => /^[/~]/.test(f.file);
    const all = [...this.files.values()].reverse();
    return [...all.filter((f) => !outside(f)), ...all.filter(outside)].slice(0, KEEP_FILES)
      .map((f) => {
        const out = outside(f) ? { outside: true } : {};
        return f.known ? { ...f, ...out } : { file: f.file, edits: f.edits, ...out };
      });
  }

  gatesList() {
    return this.gates.map(({ cmd, status }) => ({ cmd, status }));
  }

  checklist() {
    return this.todos.map((t) => ({
      text: t.text, status: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo',
    }));
  }
}
