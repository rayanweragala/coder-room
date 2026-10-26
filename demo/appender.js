// Plays the demo plan: appends the next lines to the synthetic logs every 1-3 s so the room looks alive.
// Part of the demo command, not the server. Refuses to write outside the demo dir.
import fs from 'node:fs';
import path from 'node:path';

const inside = (dir, file) => {
  const rel = path.relative(dir, path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Starts one loop per actor (a list of `{at?, writes: [{file, text, create?, rotate?}]}` steps; `text` may be a function).
 * A step with `at` (seconds from the start) waits until then; one without waits `minMs`..`maxMs`. `speed` divides
 * every wait (`Infinity` plays with no waiting, in step order).
 * @param {{at?: number, writes: object[]}[][]} actors
 * @param {{dir: string, minMs?: number, maxMs?: number, speed?: number, rand?: () => number}} opts
 * @returns {{stop: () => void, done: Promise<void>}}
 */
export function startAppender(actors, { dir, minMs = 1000, maxMs = 3000, speed = 1, rand = Math.random }) {
  const root = path.resolve(dir);
  const waits = new Set();
  const began = Date.now();
  let stopped = false;
  const sleep = (ms) => new Promise((resolve) => {
    const w = { resolve, timer: setTimeout(() => { waits.delete(w); resolve(); }, ms) };
    waits.add(w);
  });
  const waitFor = (step) => (step.at === undefined
    ? (minMs + rand() * (maxMs - minMs)) / speed
    : Math.max(0, (step.at * 1000) / speed - (Date.now() - began)));

  /** What `coder-room run` does for a rerun: the old log becomes `<round>-prev-HHMM.log` (same folder). */
  function rotate(file) {
    if (!fs.existsSync(file)) return;
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const stem = file.replace(/\.log$/, '');
    let dest = `${stem}-prev-${hhmm}.log`;
    for (let n = 2; fs.existsSync(dest); n++) dest = `${stem}-prev-${hhmm}-${n}.log`;
    fs.renameSync(file, dest);
  }

  function apply({ file, text, create, rotate: rot }) {
    if (!inside(root, file)) throw new Error(`appender refuses to write outside ${root}: ${file}`);
    if (rot) rotate(file);
    const body = typeof text === 'function' ? text() : text;
    if (create) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    } else fs.appendFileSync(file, body);
  }

  async function play(steps) {
    for (const step of steps) {
      await sleep(waitFor(step));
      if (stopped) return;
      for (const w of step.writes) apply(w);
    }
  }

  return {
    stop() {
      stopped = true;
      for (const w of waits) { clearTimeout(w.timer); w.resolve(); }
      waits.clear();
    },
    done: Promise.all(actors.map(play)).then(() => undefined),
  };
}
