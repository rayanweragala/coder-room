import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Facts, KEEP_EVENTS } from '../src/facts.js';
import { coderTile, SHOWN_EVENTS } from '../src/tiles.js';
import { Tail } from '../src/tail.js';
import { backLines } from '../src/backread.js';
import { LogFollower, tailBytesFor, TAIL_ACTIVE, TAIL_OLD, ACTIVE_MS } from '../src/follow.js';
import { Room } from '../src/room.js';
import { fadeState } from '../public/scroll.js';

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const say = (text, i) => JSON.stringify({ type: 'assistant', timestamp: 1_000 + i, message: { content: [{ type: 'text', text }] } });

test('events: 120 are kept per tile and a tile sends the last 80', () => {
  assert.equal(KEEP_EVENTS, 120);
  assert.equal(SHOWN_EVENTS, 80);
  const facts = new Facts();
  for (let i = 0; i < 150; i++) facts.push({ kind: 'say', text: `s${i}` }, i);
  assert.equal(facts.events.length, 120);
  assert.equal(facts.events[0].text, 's30');
  const rec = { slot: 'luna', name: 'Luna', color: '#fff', project: 'p', round: 'q1', role: 'code' };
  const tile = coderTile(rec, { facts, current: null, grewAt: 0 }, { spec: null, report: null }, { status: 'thinking', quiet: null });
  assert.equal(tile.events.length, 80);
  assert.equal(tile.events.at(-1).text, 's149');
  assert.equal(tile.events[0].text, 's70');
});

test('events: text is stored once, capped at 2,000 chars', () => {
  const facts = new Facts();
  facts.push({ kind: 'command', text: 'x'.repeat(10), cmd: 'x'.repeat(10) }, 1);
  facts.push({ kind: 'say', text: 'y'.repeat(5000) }, 2);
  assert.ok(facts.events.every((e) => !('plain' in e) && !('strip' in e)));
});

test('initial tail: 384 KB while working or ended within 2 h, 96 KB for older', () => {
  const now = 10 * ACTIVE_MS;
  assert.equal(TAIL_ACTIVE, 384 * 1024);
  assert.equal(TAIL_OLD, 96 * 1024);
  assert.equal(tailBytesFor({ state: 'running', at: 0, endedAt: null }, now), TAIL_ACTIVE);
  assert.equal(tailBytesFor({ state: 'done', endedAt: now - ACTIVE_MS + 1000 }, now), TAIL_ACTIVE);
  assert.equal(tailBytesFor({ state: 'done', endedAt: now - ACTIVE_MS - 1000 }, now), TAIL_OLD);
  assert.equal(tailBytesFor({ state: 'rate-limited', at: now - 3 * ACTIVE_MS }, now), TAIL_OLD);
});

test('tail: stepped reads give the same lines as one read, and keep multi-byte text whole', async () => {
  const dir = tmpDir('cr-q07-a-');
  try {
    const f = path.join(dir, 'a.log');
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} héllo ✓ ${'x'.repeat(i % 40)}`);
    fs.writeFileSync(f, lines.join('\n') + '\n');
    const whole = new Tail(f, 8000);
    const stepped = new Tail(f, 8000);
    stepped.stepBytes = 101;
    const a = (await whole.poll()).lines;
    const b = [];
    do { b.push(...(await stepped.poll()).lines); } while (stepped.more);
    assert.deepEqual(b, a);
    assert.equal(b.at(-1), lines.at(-1));
    assert.ok(b.every((l) => /^line \d+ héllo ✓ x*$/.test(l)));
  } finally {
    rm(dir);
  }
});

test('backLines: skips lines over the line limit and reports the starting size', async () => {
  const dir = tmpDir('cr-q07-b-');
  try {
    const f = path.join(dir, 'a.jsonl');
    const body = `{"a":1}\n{"big":"${'z'.repeat(600_000)}"}\n{"a":3}\n`;
    fs.writeFileSync(f, body);
    const seen = [];
    const size = await backLines(f, (b) => { seen.push(b.toString()); return false; }, 4 * 1024 * 1024, 256 * 1024);
    assert.deepEqual(seen, ['{"a":3}', '{"a":1}']);
    assert.equal(size, Buffer.byteLength(body));
    assert.equal(await backLines(path.join(dir, 'missing'), () => false), null);
  } finally {
    rm(dir);
  }
});

test('orchestrator transcript: read backwards, stops at 120 events, skips huge lines', async () => {
  const dir = tmpDir('cr-q07-c-');
  try {
    const f = path.join(dir, 's.jsonl');
    const rows = Array.from({ length: 300 }, (_, i) => say(`m${i}`, i));
    rows.splice(250, 0, JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'p'.repeat(400_000) }] } }));
    fs.writeFileSync(f, rows.join('\n') + '\n');
    const fol = new LogFollower(f, '/nowhere', { orchestrator: true });
    assert.equal(await fol.poll(), true);
    const ev = fol.facts.events;
    assert.equal(ev.length, 120);
    assert.equal(ev.at(-1).text, 'm299');
    assert.equal(ev[0].text, 'm180');
    fs.appendFileSync(f, say('later', 400) + '\n');
    assert.equal(await fol.poll(), true);
    assert.equal(fol.facts.events.at(-1).text, 'later');
    assert.equal(fol.facts.events.length, 120);
  } finally {
    rm(dir);
  }
});

test('orchestrator transcript: the byte limit stops the backwards read', async () => {
  const dir = tmpDir('cr-q07-d-');
  try {
    const f = path.join(dir, 's.jsonl');
    fs.writeFileSync(f, Array.from({ length: 400 }, (_, i) => say(`m${i}`, i)).join('\n') + '\n');
    const fol = new LogFollower(f, '/nowhere', { orchestrator: true, backBytes: 6000 });
    await fol.poll();
    const n = fol.facts.events.length;
    assert.ok(n > 5 && n <= Math.floor(6000 / say('m0', 0).length), `got ${n}`);
    assert.equal(fol.facts.events.at(-1).text, 'm399');
  } finally {
    rm(dir);
  }
});

function oneProject(tmp) {
  const root = path.join(tmp, 'proj');
  const runs = path.join(root, '.codex-runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, 'chain.log'), 'coder q9 started 19:00 on codex gpt-6-luna\n');
  fs.writeFileSync(path.join(runs, 'q9.md'), '# q9 — Round\n\n## Goal\nGoal nine.\n');
  fs.writeFileSync(path.join(runs, 'q9.log'), 'codex\nworking on it\n');
  fs.writeFileSync(path.join(root, 'HANDOFF.md'), '# P\n\n## What this is\nA demo project.\n');
  const room = new Room({ roots: [root], scanRoot: tmp, claudeProjects: path.join(tmp, 'none'), home: tmp, clock: () => Date.now() });
  return { root, runs, room };
}

test('quiet project: no tile in 24 h drops cached round heads and the handoff goal, then rebuilds', async () => {
  const tmp = tmpDir('cr-q07-e-');
  try {
    const { runs, room } = oneProject(tmp);
    await room.tick();
    assert.equal(room.snapshot().tiles.length, 1);
    assert.ok(room.goalOf.size === 1 && room.goals.cache.size === 1 && room.rounds.cache.size === 1);

    const old = new Date(Date.now() - 3 * 86_400_000);
    fs.utimesSync(path.join(runs, 'q9.log'), old, old);
    room.lastRounds = -Infinity;
    room.lastScan = -Infinity;
    await room.tick();
    assert.equal(room.snapshot().tiles.length, 0);
    assert.equal(room.goalOf.size, 0);
    assert.equal(room.goals.cache.size, 0);
    assert.equal(room.rounds.cache.size, 0);
    assert.ok(room.chains.size === 1, 'the chain.log follower stays');

    const now = new Date();
    fs.utimesSync(path.join(runs, 'q9.log'), now, now);
    room.lastRounds = -Infinity;
    await room.tick();
    assert.equal(room.snapshot().tiles.length, 1);
    assert.equal(room.goalOf.get(path.dirname(runs))?.goal, 'A demo project.');
  } finally {
    rm(tmp);
  }
});

test('tile JSON cache: reused while nothing changed, rebuilt only for the tile that changed', async () => {
  const tmp = tmpDir('cr-q07-f-');
  try {
    const { runs, room } = oneProject(tmp);
    const sent = [];
    room.on('tile', (t) => sent.push(t));
    await room.tick();
    const first = room.tiles.get('luna@proj');
    const json = room.cache.get('luna@proj').json;
    await room.tick();
    assert.equal(room.tiles.get('luna@proj'), first, 'same tile object when unchanged');
    assert.equal(room.cache.get('luna@proj').json, json);
    assert.equal(sent.length, 1);
    assert.equal(room.snapshotJson(), JSON.stringify(room.snapshot()));

    fs.appendFileSync(path.join(runs, 'q9.log'), 'more narration\n');
    await room.tick();
    assert.notEqual(room.tiles.get('luna@proj'), first);
    assert.equal(sent.length, 2);
    assert.equal(room.snapshotJson(), JSON.stringify(room.snapshot()));
    assert.match(room.snapshotJson(), /more narration/);
  } finally {
    rm(tmp);
  }
});

test('scroll fades: top when scrolled down, bottom when more is below', () => {
  assert.deepEqual(fadeState(0, 100, 300), { top: false, bottom: true });
  assert.deepEqual(fadeState(100, 100, 300), { top: true, bottom: true });
  assert.deepEqual(fadeState(200, 100, 300), { top: true, bottom: false });
  assert.deepEqual(fadeState(0, 100, 100), { top: false, bottom: false });
});
