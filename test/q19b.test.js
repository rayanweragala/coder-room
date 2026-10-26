import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from '../src/room.js';
import { roundDetails } from '../src/history.js';
import { findRotated } from '../src/attempts.js';
import { makeDemo } from '../demo/make-demo.js';
import { startAppender } from '../demo/appender.js';
import { MODELS, claudeLog } from '../demo/steps.js';
import { chainLine } from '../demo/timeline.js';
import { createLobbyOrder } from '../public/lobby-order.js';

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const CODEX = 'codex-ui gpt-6-luna';
const CLAUDE = 'claude-ui claude-sonnet-5-5';

function workspace() {
  const tmp = tmpDir('cr-q19b-');
  const dir = path.join(tmp, 'acme');
  const rdir = path.join(dir, '.rounds');
  fs.mkdirSync(rdir, { recursive: true });
  const chain = (type, on) => fs.appendFileSync(path.join(rdir, 'chain.log'), `${chainLine('q05', type, on)}\n`);
  const log = (name, lines) => fs.appendFileSync(path.join(rdir, name), `${lines.join('\n')}\n`);
  const room = () => new Room({ roots: [dir], scanRoot: tmp, claudeProjects: path.join(tmp, 'cp'), home: tmp });
  const project = { name: 'acme', dir, runsDir: rdir };
  return { tmp, dir, rdir, chain, log, room, project };
}

const codexLines = (...says) => ['OpenAI Codex (demo)', 'model: gpt-6-luna', 'user', 'Implement q05.', ...says.flatMap((s) => ['codex', s])];
const claudeLines = (dir, ...says) => {
  const l = claudeLog({ model: MODELS.sonnet, dir, round: 'q05' });
  l.init();
  for (const s of says) l.say(s);
  return l.steps.flat();
};
const tileOf = async (room, name) => {
  await room.tick();
  return room.snapshot().tiles.find((t) => t.name === name);
};
const texts = (tile) => JSON.stringify(tile.events);

async function ticks(room, n = 4) {
  for (let i = 0; i < n; i++) await room.tick();
}

test('rotation after the limit: the ended tile keeps its work, the new tile follows the new file, a fresh room reads -prev-', async () => {
  const w = workspace();
  try {
    w.chain('started', CODEX);
    w.log('q05.log', codexLines('codex first words', 'codex second words'));
    const room = w.room();
    await ticks(room, 2);
    w.chain('LIMIT', 'codex-ui');
    await ticks(room, 2);
    const before = await tileOf(room, 'codex-ui');
    assert.equal(before.status, 'rate-limited');

    fs.renameSync(path.join(w.rdir, 'q05.log'), path.join(w.rdir, 'q05-prev-0101.log'));
    w.log('q05.log', claudeLines(w.dir, 'claude words one'));
    w.chain('started', CLAUDE);
    await ticks(room, 4);
    w.log('q05.log', claudeLines(w.dir, 'claude words two').slice(1));
    await ticks(room, 3);

    const check = async (r) => {
      const codex = await tileOf(r, 'codex-ui');
      const claude = await tileOf(r, 'claude-ui');
      assert.equal(codex.status, 'rate-limited');
      assert.equal(codex.model, 'gpt-6-luna');
      assert.match(texts(codex), /codex second words/);
      assert.doesNotMatch(texts(codex), /claude words/);
      assert.equal(claude.model, 'claude-sonnet-5-5');
      assert.match(texts(claude), /claude words one/);
      assert.doesNotMatch(texts(claude), /codex/);
      return { codex, claude };
    };
    const live = await check(room);
    assert.equal(live.codex.seq, before.seq, 'no new events on the ended tile');
    assert.ok(live.claude.seq > 0);
    await check(w.room());
  } finally {
    fs.rmSync(w.tmp, { recursive: true, force: true });
  }
});

test('rotation while the old attempt has no end line: a newer attempt on another coder takes the new file only', async () => {
  const w = workspace();
  try {
    w.chain('started', CODEX);
    w.log('q05.log', codexLines('only codex line'));
    const room = w.room();
    await ticks(room, 2);
    const before = await tileOf(room, 'codex-ui');
    assert.equal(before.status !== 'rate-limited', true);

    fs.renameSync(path.join(w.rdir, 'q05.log'), path.join(w.rdir, 'q05-prev-0102.log'));
    w.log('q05.log', claudeLines(w.dir, 'claude only line'));
    w.chain('started', CLAUDE);
    await ticks(room, 4);
    const codex = await tileOf(room, 'codex-ui');
    const claude = await tileOf(room, 'claude-ui');
    assert.equal(codex.seq, before.seq);
    assert.match(texts(codex), /only codex line/);
    assert.doesNotMatch(texts(codex), /claude only/);
    assert.equal(codex.model, 'gpt-6-luna');
    assert.match(texts(claude), /claude only line/);
    assert.doesNotMatch(texts(claude), /codex/);

    const fresh = w.room();
    const f = await tileOf(fresh, 'codex-ui');
    assert.match(texts(f), /only codex line/);
    assert.doesNotMatch(texts(f), /claude only/);
  } finally {
    fs.rmSync(w.tmp, { recursive: true, force: true });
  }
});

test('findRotated: the inode wins, else the newest -prev- log written before the newer attempt starts', async () => {
  const w = workspace();
  try {
    const a = path.join(w.rdir, 'q05-prev-0100.log');
    const b = path.join(w.rdir, 'q05-prev-0200.log');
    fs.writeFileSync(a, 'a\n');
    fs.writeFileSync(b, 'b\n');
    fs.utimesSync(a, new Date(1_000_000), new Date(1_000_000));
    fs.utimesSync(b, new Date(2_000_000), new Date(2_000_000));
    const r = { runsDir: w.rdir, role: 'coder', round: 'q05' };
    assert.equal(await findRotated(r, { ino: fs.statSync(a).ino, before: 3_000_000 }), a);
    assert.equal(await findRotated(r, { ino: 424242, before: 3_000_000 }), b);
    assert.equal(await findRotated(r, { before: 1_500_000 }), a);
    assert.equal(await findRotated(r, { before: 500_000 }), null);
    assert.equal(await findRotated(r, {}), null);
  } finally {
    fs.rmSync(w.tmp, { recursive: true, force: true });
  }
});

test('history: attempt 1 reads the -prev- log, attempt 2 reads q05.log', async () => {
  const w = workspace();
  try {
    w.chain('started', CODEX);
    w.log('q05.log', codexLines('history codex work'));
    w.chain('LIMIT', 'codex-ui');
    fs.renameSync(path.join(w.rdir, 'q05.log'), path.join(w.rdir, 'q05-prev-0103.log'));
    w.chain('started', CLAUDE);
    w.log('q05.log', claudeLines(w.dir, 'history claude work'));
    w.chain('finished', CLAUDE);

    const first = await roundDetails(w.project, 'q05', Date.now(), 0);
    const second = await roundDetails(w.project, 'q05', Date.now(), 1);
    const latest = await roundDetails(w.project, 'q05');
    assert.equal(first.attempt, 0);
    assert.equal(first.tile.name, 'codex-ui');
    assert.equal(first.tile.status, 'rate-limited');
    assert.equal(first.tile.model, 'gpt-6-luna');
    assert.match(texts(first.tile), /history codex work/);
    assert.doesNotMatch(texts(first.tile), /history claude work/);
    assert.equal(second.tile.name, 'claude-ui');
    assert.match(texts(second.tile), /history claude work/);
    assert.doesNotMatch(texts(second.tile), /history codex work/);
    assert.equal(latest.attempt, 1);
    assert.equal(latest.tile.name, 'claude-ui');
    assert.deepEqual(latest.row.attempts.map((a) => a.coder), ['codex-ui', 'claude-ui']);
  } finally {
    fs.rmSync(w.tmp, { recursive: true, force: true });
  }
});

test('demo: the fallback rotates q05.log like run, and the limited codex tile stays still', async () => {
  const tmp = tmpDir('cr-q19b-demo-');
  try {
    const demo = makeDemo({ out: path.join(tmp, 'demo') });
    const room = new Room({
      roots: demo.projects.map((p) => p.dir), scanRoot: demo.dir, claudeProjects: demo.claudeProjects, home: demo.dir,
    });
    const steps = demo.actors[0];
    const k = steps.findIndex((s) => s.writes.some((x) => x.rotate));
    assert.ok(k > 0, 'a step rotates the log');
    const play = (list) => startAppender([list], { dir: demo.dir, minMs: 0, maxMs: 0, speed: Infinity }).done;
    await play(steps.slice(0, k + 3));
    await ticks(room, 3);
    const rdir = path.join(demo.projects.find((p) => p.name === 'acme-shop').dir, '.rounds');
    const prev = fs.readdirSync(rdir).filter((n) => /^q05-prev-\d{4}(-\d+)?\.log$/.test(n));
    assert.equal(prev.length, 1);
    const old = fs.readFileSync(path.join(rdir, prev[0]), 'utf8');
    const now = fs.readFileSync(path.join(rdir, 'q05.log'), 'utf8');
    assert.match(old, /^OpenAI Codex.*\nmodel: gpt-6-luna\n/);
    assert.ok(old.includes('usage limit'));
    assert.ok(!now.includes('gpt-6-luna') && now.startsWith('{'), 'q05.log holds only the fallback');

    const codex1 = await tileOf(room, 'codex-ui');
    const claude1 = await tileOf(room, 'claude-ui');
    assert.equal(codex1.status, 'rate-limited');
    assert.equal(codex1.model, 'gpt-6-luna');
    await play(steps.slice(k + 3, k + 14));
    await ticks(room, 3);
    const codex2 = await tileOf(room, 'codex-ui');
    const claude2 = await tileOf(room, 'claude-ui');
    assert.equal(codex2.seq, codex1.seq);
    assert.equal(codex2.model, 'gpt-6-luna');
    assert.ok(claude2.seq > claude1.seq, 'claude-ui keeps working');
    assert.equal(claude2.model, 'claude-sonnet-5-5');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const card = (name, working, last = 0) => ({ name, working, last });
const names = (list) => list.map((c) => c.name);

test('lobby order: sorted once, stable under activity, moves on working/idle with a 30 s throttle, never while hovered', () => {
  const o = createLobbyOrder(30_000);
  assert.deepEqual(names(o.order([card('a', 0, 5), card('b', 1, 1), card('c', 0, 9)], false, 0)), ['b', 'c', 'a']);
  assert.deepEqual(names(o.order([card('a', 0, 50), card('b', 2, 1), card('c', 0, 3)], false, 1_000)), ['b', 'c', 'a'], 'activity alone does not move');
  assert.deepEqual(names(o.order([card('a', 1, 50), card('b', 1, 1), card('c', 0, 3)], false, 5_000)), ['b', 'c', 'a'], 'throttled');
  assert.deepEqual(names(o.order([card('a', 1, 50), card('b', 1, 1), card('c', 0, 3)], true, 40_000)), ['b', 'c', 'a'], 'hovered');
  assert.deepEqual(names(o.order([card('a', 1, 50), card('b', 1, 1), card('c', 0, 3)], false, 41_000)), ['b', 'a', 'c'], 'moves once allowed');
  assert.deepEqual(names(o.order([card('a', 1, 90), card('b', 0, 1), card('c', 0, 3)], false, 42_000)), ['b', 'a', 'c'], 'throttled again');
  assert.deepEqual(names(o.order([card('a', 1, 90), card('b', 0, 1), card('c', 0, 3)], false, 80_000)), ['a', 'b', 'c']);
  assert.deepEqual(names(o.order([card('a', 1, 90), card('c', 0, 3), card('d', 0, 4)], false, 81_000)), ['a', 'c', 'd'], 'a removed card goes, a new one is appended');
});
