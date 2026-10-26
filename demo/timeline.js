// Timeline helpers: lanes put steps at absolute seconds; the appender plays them in time order.

const GAPS = [2.0, 2.8, 1.8, 3.0, 2.2, 3.0, 2.4, 2.9, 2.1, 3.0];

export const text = (lines) => `${lines.join('\n')}\n`;
const pad = (n) => String(n).padStart(2, '0');
export const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** One actor's clock: every step lands 1-3 s after the previous one (offset keeps lanes from moving in lockstep). */
export class Lane {
  constructor(start = 0, offset = 0) {
    this.t = start;
    this.i = offset;
    this.steps = [];
  }

  /** Adds a step with these writes after the next gap (or `gap` seconds). */
  add(writes, gap) {
    this.t += gap ?? GAPS[this.i++ % GAPS.length];
    this.steps.push({ at: this.t, writes: [].concat(writes) });
    return this;
  }

  /** Moves the clock forward to `t` seconds when it is behind. */
  sync(t) {
    this.t = Math.max(this.t, t);
    return this;
  }

  /** Appends each log step (a list of lines) to `file`; the first one creates the file when `create` is set. */
  log(file, logSteps, create = false) {
    logSteps.forEach((lines, k) => this.add({ file, text: text(lines), create: create && k === 0 }));
    return this;
  }
}

export function chainLine(round, type, on, role = 'coder') {
  const hm = nowHm();
  if (type === 'ready') return `round ${round} ready for orchestrator check ${hm}`;
  return `${role} ${round} ${type} ${hm}${type === 'finished' ? ' rc=0' : ''}${on ? ` on ${on}` : ''}`;
}
