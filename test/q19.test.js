import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from '../src/room.js';
import { buildRoundList } from '../src/history.js';
import { main } from '../src/cli/main.js';
import { makeDemo } from '../demo/make-demo.js';
import { startAppender } from '../demo/appender.js';
import { ALLOWED_MODELS } from '../demo/steps.js';

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const skew = { ms: 0 };
const demoRoom = (demo) => new Room({
  roots: demo.projects.map((p) => p.dir), scanRoot: demo.dir, claudeProjects: demo.claudeProjects, home: demo.dir,
  clock: () => Date.now() + skew.ms,
});

/** Applies the timeline's writes up to `upTo` seconds in order, with no waiting (the time-free runner). */
function playUntil(demo, upTo = Infinity) {
  for (const step of demo.actors[0]) {
    if (step.at > upTo) break;
    for (const { file, text, create } of step.writes) {
      const body = typeof text === 'function' ? text() : text;
      if (create) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); } else fs.appendFileSync(file, body);
    }
  }
}

/** Reads what was just written, then looks at the room `ms` later (so the orchestrator's last work is old). */
async function snapshotLater(room, ms) {
  skew.ms = 0;
  await room.tick();
  skew.ms = ms;
  await room.tick();
  return room.snapshot();
}

test('demo data names only real models, in every place the room reads one', async () => {
  const outer = tmpDir('cr-q19-a-');
  try {
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    const play = startAppender(demo.actors, { dir: demo.dir, minMs: 0, maxMs: 0, speed: Infinity });
    await play.done;
    const all = files(demo.dir).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    let rest = all;
    for (const id of ALLOWED_MODELS) rest = rest.split(id).join('');
    assert.deepEqual(rest.match(/\bgpt-[\w.-]*|claude-(?:opus|sonnet|haiku|fable|demo)[\w.-]*|\b(?:sonnet|opus|haiku)\b/gi) ?? [], []);
    for (const id of ALLOWED_MODELS) assert.ok(all.includes(id), `${id} is used`);

    const models = new Set();
    for (const f of files(demo.dir)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = /^model:\s*(\S+)/.exec(line);
        if (m) models.add(m[1]);
        const chain = /^(?:coder|review) \S+ started \S+ on \S+ (\S+)$/.exec(line);
        if (chain) models.add(chain[1]);
        if (!line.startsWith('{')) continue;
        const j = JSON.parse(line);
        if (j.model) models.add(j.model);
        if (j.message?.model) models.add(j.message.model);
        for (const k of Object.keys(j.modelUsage ?? {})) models.add(k);
      }
    }
    assert.ok(models.size >= 4);
    for (const m of models) assert.ok(ALLOWED_MODELS.includes(m), `model ${m}`);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('timeline: two acme-shop coders run at once, the limit falls back, review and fix rounds follow', async () => {
  const outer = tmpDir('cr-q19-b-');
  try {
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    const room = demoRoom(demo);
    playUntil(demo, 100);
    const mid = await snapshotLater(room, 30_000);
    const working = mid.tiles.filter((t) => t.project === 'acme-shop' && t.kind === 'coder' && !['done', 'rate-limited'].includes(t.status));
    assert.deepEqual(working.map((t) => t.name).sort(), ['claude-api', 'codex-ui']);
    const orch = mid.tiles.find((t) => t.project === 'acme-shop' && t.kind === 'orchestrator');
    assert.match(orch.label, /^watching (claude-api|codex-ui) · q0[45] \+1$/);
    assert.ok(mid.chat.some((m) => /discount codes end to end/i.test(m.text ?? '')), 'the user message is in the chat');

    playUntil(demo);
    const chain = fs.readFileSync(path.join(demo.projects[0].dir, '.rounds', 'chain.log'), 'utf8').split('\n');
    const at = (re) => chain.findIndex((l) => re.test(l));
    const limit = at(/^coder q05 LIMIT \d\d:\d\d on codex-ui$/);
    assert.ok(limit >= 0 && /^coder q05 started \d\d:\d\d on claude-ui claude-sonnet-5-5$/.test(chain[limit + 1]));
    assert.ok(at(/^review q06 started .* on claude-review claude-haiku-5-5$/) > limit);
    assert.ok(at(/^coder q05b started .* on claude-ui /) > at(/^review q06 finished/));
    const rounds = path.join(demo.projects[0].dir, '.rounds');
    for (const f of ['q06-review.log', 'q06-report.md', 'q05b.md', 'q05b-report.md']) assert.ok(fs.existsSync(path.join(rounds, f)), f);

    const end = await snapshotLater(room, 120_000);
    const orchEnd = end.tiles.find((t) => t.project === 'acme-shop' && t.kind === 'orchestrator');
    assert.equal(orchEnd.status, 'waiting for you');
    assert.ok(end.tiles.some((t) => t.project === 'acme-shop' && t.name === 'codex-ui' && t.status === 'rate-limited'));
    assert.deepEqual(end.projects.map((p) => p.name).sort(), ['acme-shop', 'docs-site']);
    const docs = end.tiles.find((t) => t.project === 'docs-site' && t.kind === 'coder');
    assert.equal(docs.status, 'done');
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('history: q05 has two attempts and links to q05b, q06 is a review round', () => {
  const outer = tmpDir('cr-q19-e-');
  try {
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    playUntil(demo);
    const rounds = path.join(demo.projects[0].dir, '.rounds');
    const lines = fs.readFileSync(path.join(rounds, 'chain.log'), 'utf8').split('\n');
    const rows = buildRoundList(lines, Date.now(), new Set(fs.readdirSync(rounds)));
    const by = Object.fromEntries(rows.map((r) => [r.round, r]));
    assert.deepEqual(Object.keys(by).sort(), ['q01', 'q02', 'q03', 'q04', 'q05', 'q05b', 'q06']);
    assert.deepEqual(by.q05.attempts.map((a) => a.outcome), ['limit', 'done']);
    assert.equal(by.q05.fix, 'q05b');
    assert.equal(by.q06.role, 'review');
    assert.equal(by.q05b.outcome, 'done');
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('timeline: about ten minutes, events 1 to 3 s apart per coder, the parallel phase overlaps', () => {
  const outer = tmpDir('cr-q19-c-');
  try {
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    const steps = demo.actors[0];
    const end = steps.at(-1).at;
    assert.ok(end > 480 && end < 660, `ends at ${end}s`);
    for (const log of ['q04.log', 'q05.log']) {
      const mine = steps.filter((s) => s.writes.some((w) => w.file.endsWith(`/${log}`)));
      const gaps = mine.slice(1).filter((s) => !s.writes.some((w) => w.create)).map((s) => s.at - mine[mine.indexOf(s) - 1].at);
      assert.ok(Math.max(...gaps) <= 3.01 && Math.min(...gaps) >= 1, `${log} gaps ${Math.min(...gaps)}..${Math.max(...gaps)}`);
    }
    const q04 = steps.filter((s) => s.writes.some((w) => w.file.endsWith('/q04.log'))).map((s) => s.at);
    const q05 = steps.filter((s) => s.writes.some((w) => w.file.endsWith('/q05.log'))).map((s) => s.at);
    assert.ok(Math.min(...q05) < q04.at(-1) - 120 && Math.min(...q04) < q05.at(-1) - 120, 'q04 and q05 overlap for minutes');
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('appender: a step with `at` waits for that second divided by the speed', async () => {
  const outer = tmpDir('cr-q19-d-');
  try {
    const file = path.join(outer, 'a.log');
    const steps = [{ at: 0.2, writes: [{ file, text: 'one\n' }] }, { at: 0.4, writes: [{ file, text: 'two\n' }] }];
    const t0 = Date.now();
    await startAppender([steps], { dir: outer, speed: 4 }).done;
    const took = Date.now() - t0;
    assert.equal(fs.readFileSync(file, 'utf8'), 'one\ntwo\n');
    assert.ok(took >= 80 && took < 400, `took ${took} ms`);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('serve --demo documents --fast', async () => {
  const out = [];
  assert.equal(await main(['serve', '--demo', '--help'], { out: (s) => out.push(s), err: () => {} }), 0);
  assert.match(out.join('\n'), /--fast/);
});
