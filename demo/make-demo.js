// Writes a synthetic workspace for the demo room: two projects with finished rounds, coder logs and orchestrator
// transcripts, plus the timeline (steps with `at` seconds) the appender plays to make it live. Only writes inside
// the demo dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECTS, handoffText, reportText, specText } from './content.js';
import { orch } from './orch.js';
import { stepsFor } from './steps.js';
import { acmeTimeline } from './story.js';
import { Lane, chainLine, text } from './timeline.js';

const START_STEPS = 6;
const MIN = 60_000;
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const encode = (dir) => dir.replace(/\//g, '-');
const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const stamped = (round, type, ms, on) => `coder ${round.id} ${type} ${hhmm(ms)}${type === 'finished' ? ' rc=0' : ''} on ${on}`;

/** Finished rounds go to disk now; the running one (if any) gets its first lines. Returns the open round's pieces. */
function writeHistory(spec, dir, now) {
  const rdir = path.join(dir, '.rounds');
  write(path.join(rdir, 'HANDOFF.md'), handoffText(spec));
  const chain = [];
  const done = spec.rounds.filter((r) => r.done);
  let at = now - (done.length * 45 + 6) * MIN;
  for (const round of done) {
    write(path.join(rdir, `${round.id}.md`), specText(round));
    write(path.join(rdir, `${round.id}.log`), stepsFor(round, dir, spec.gate).map(text).join(''));
    write(path.join(rdir, `${round.id}-report.md`), reportText(round, spec.gate));
    chain.push(stamped(round, 'started', at, round.coder));
    at += 25 * MIN;
    chain.push(stamped(round, 'finished', at, round.coder), `round ${round.id} ready for orchestrator check ${hhmm(at)}`);
    at += 20 * MIN;
  }
  const open = spec.rounds.find((r) => !r.done);
  if (open) {
    const steps = stepsFor(open, dir, spec.gate);
    write(path.join(rdir, `${open.id}.md`), specText(open));
    write(path.join(rdir, `${open.id}.log`), steps.slice(0, START_STEPS).map(text).join(''));
    chain.push(stamped(open, 'started', now - 3 * MIN, open.coder));
  }
  write(path.join(rdir, 'chain.log'), `${chain.join('\n')}\n`);
  return { rdir, open, openSteps: open ? stepsFor(open, dir, spec.gate).slice(START_STEPS) : [] };
}

/** docs-site: the open round runs to its end early on, then the orchestrator reviews it and goes idle. */
function docsTimeline({ spec, dir, rdir, transcript, open, openSteps, o }) {
  const L = new Lane(0, 4);
  const O = new Lane(0, 1);
  const log = path.join(rdir, `${open.id}.log`);
  L.log(log, openSteps);
  L.add([
    { file: path.join(rdir, 'chain.log'), text: () => `${chainLine(open.id, 'finished', open.coder)}\n${chainLine(open.id, 'ready')}\n` },
    { file: path.join(rdir, `${open.id}-report.md`), text: reportText(open, spec.gate), create: true },
  ], 2);
  const tr = (...lines) => ({ file: transcript, text: () => text(lines.map((l) => l())) });
  O.sync(L.t).add(tr(o.notify(`Background command "coder-room run ${open.id}" completed`), o.say(`${open.id} finished. Reading the report and checking the gate output.`), o.run(`cd ${dir} && ${spec.gate}`)), 4);
  O.add(tr(o.say(`${open.id} looks good: every item is covered by a test and the gate passes.`), o.end()), 4);
  return [...L.steps, ...O.steps];
}

function setupProject(root, claudeProjects, spec, now) {
  const dir = path.join(root, spec.name);
  const transcript = path.join(claudeProjects, encode(dir), 'session-demo.jsonl');
  const { rdir, open, openSteps } = writeHistory(spec, dir, now);
  const o = orch(dir);
  const first = open
    ? [o.user(`Please run ${open.id} (${open.title}) with ${open.coder.split(' ')[0]} and tell me when it is done.`), o.run(`cd ${dir} && coder-room run ${open.id} --detach`),
      o.say(`Started ${open.id} on ${open.coder.split(' ')[0]}. I will review it when it finishes.`), o.end()]
    : [o.user('q03 looks good, thanks. I will be back with the next task.'), o.say('q03 is committed and the tree is clean. Ready for the next task.'), o.end()];
  write(transcript, text(first.map((l) => l())));
  const ctx = { spec, dir, rdir, transcript, open, openSteps, o, gate: spec.gate };
  const steps = open ? docsTimeline(ctx) : acmeTimeline(ctx);
  return { name: spec.name, dir, transcript, steps };
}

/**
 * Creates the demo workspace in `out` (a fresh temp dir by default). `actors` is one list of timed steps
 * (`{at, writes}`, `at` in seconds from the start), sorted by time, for `startAppender`.
 * @returns {{dir:string, projects:{name:string,dir:string,transcript:string}[], claudeProjects:string, actors:object[][]}}
 */
export function makeDemo({ out, now = Date.now() } = {}) {
  const dir = out ? path.resolve(out) : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coder-room-demo-')));
  const claudeProjects = path.join(dir, 'claude-projects');
  fs.mkdirSync(claudeProjects, { recursive: true });
  const made = PROJECTS.map((spec) => setupProject(dir, claudeProjects, spec, now));
  const steps = made.flatMap((m) => m.steps).sort((a, b) => a.at - b.at);
  return {
    dir, claudeProjects,
    projects: made.map(({ name, dir: d, transcript }) => ({ name, dir: d, transcript })),
    actors: [steps],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const demo = makeDemo({ out: i > 0 ? process.argv[i + 1] : undefined });
  console.log(demo.dir);
}
