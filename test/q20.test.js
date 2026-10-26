import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseChainLine, parseChainLines, logName } from '../src/parse-chain.js';
import { ChainModel, coderStatus, DAY_MS } from '../src/state.js';
import { buildRoundList } from '../src/history.js';
import { status } from '../src/cli/status.js';
import { Room } from '../src/room.js';
import { outcomeChip } from '../public/history.js';

const NOW = new Date(2026, 9, 26, 15, 30).getTime();
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const P = { name: 'acme', dir: '/p/acme', runsDir: '/p/acme/.rounds' };
const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('dated shapes parse with role, round, verb, rc, coder and the exact date', () => {
  const cases = [
    ['coder b6 started 2026-10-26 14:34 on codex gpt-6-luna', { type: 'started', role: 'coder', round: 'b6', rc: null, slot: 'luna' }, at(2026, 10, 26, 14, 34)],
    ['coder b5b finished 2026-10-26 10:50 rc=0 on codex gpt-6-luna', { type: 'finished', round: 'b5b', rc: 0, slot: 'luna' }, at(2026, 10, 26, 10, 50)],
    ['coder q301 LIMIT 2026-10-25 09:12 on codex gpt-6-luna', { type: 'limit', round: 'q301', slot: 'luna' }, at(2026, 10, 25, 9, 12)],
    ['coder q302 REFUSED 2026-10-25 09:12: dirty tree', { type: 'refused', round: 'q302', reason: 'dirty tree' }, at(2026, 10, 25, 9, 12)],
    ['round q303 ready for orchestrator check 2026-10-24 08:05', { type: 'ready', round: 'q303' }, at(2026, 10, 24, 8, 5)],
    ['research r1-demo started 2026-10-20 18:25 on codex gpt-6-luna', { type: 'started', role: 'research', round: 'r1-demo', slot: 'luna' }, at(2026, 10, 20, 18, 25)],
    ['research r1-demo finished 2026-10-20 18:40 rc=0', { type: 'finished', role: 'research', rc: 0, slot: null }, at(2026, 10, 20, 18, 40)],
  ];
  for (const [line, want, when] of cases) {
    const ev = parseChainLine(line, NOW);
    assert.ok(ev, line);
    assert.equal(ev.at, when, line);
    for (const [k, v] of Object.entries(want)) assert.equal(ev[k], v, `${line} ${k}`);
  }
});

test('undated lines keep the backward dating from the file mtime', () => {
  assert.equal(parseChainLine('coder q1 started 14:00 on codex gpt-6-luna', NOW).at, at(2026, 10, 26, 14, 0));
  assert.equal(parseChainLine('coder q1 started 23:00 on codex gpt-6-luna', NOW).at, at(2026, 10, 25, 23, 0));
});

test('finished with " on" but no rc is finished with rc unknown', () => {
  const ev = parseChainLine('coder q90 finished 15:10 on codex gpt-6-luna', NOW);
  assert.equal(ev.type, 'finished');
  assert.equal(ev.rc, null);
  assert.equal(ev.slot, 'luna');
});

test('STOPPED parses with free text, part2, a date and an optional reason', () => {
  const a = parseChainLine('coder q184 STOPPED by orchestrator 15:02: reason text here', NOW);
  assert.deepEqual([a.type, a.role, a.round, a.reason, a.at], ['stopped', 'coder', 'q184', 'reason text here', at(2026, 10, 26, 15, 2)]);
  const b = parseChainLine('coder q90 part2 STOPPED by user request 15:02', NOW);
  assert.deepEqual([b.type, b.round, b.reason, b.at], ['stopped', 'q90', null, at(2026, 10, 26, 15, 2)]);
  const c = parseChainLine('coder q91 STOPPED by user 2026-10-24 11:20: other', NOW);
  assert.deepEqual([c.type, c.reason, c.at], ['stopped', 'other', at(2026, 10, 24, 11, 20)]);
  assert.equal(parseChainLine('coder q92 STOPPED without any time', NOW), null);
});

test('a dated started 3 days ago is not shown as working today; a dated started today is running', () => {
  const old = new ChainModel();
  old.apply(P, parseChainLine('coder q1 started 2026-10-23 10:00 on codex gpt-6-luna', NOW));
  assert.equal(old.recent(NOW).length, 0);
  const fresh = new ChainModel();
  fresh.apply(P, parseChainLine('coder q2 started 2026-10-26 14:34 on codex gpt-6-luna', NOW));
  const [rec] = fresh.recent(NOW);
  assert.equal(rec.state, 'running');
  assert.equal(rec.startedAt, at(2026, 10, 26, 14, 34));
  assert.ok(NOW - rec.at < DAY_MS);
});

test('a mixed log keeps order and dates, and a dated line anchors the undated lines before it', () => {
  const lines = [
    'coder a1 started 23:50 on codex gpt-6-luna',
    'coder a1 finished 23:55 rc=0 on codex gpt-6-luna',
    'coder a2 started 2026-10-26 00:10 on codex gpt-6-luna',
    'free text',
    'coder a2 finished 00:30 rc=1 on codex gpt-6-luna',
    'coder a3 started 2026-10-26 14:34 on codex gpt-6-luna',
  ];
  const evs = parseChainLines(lines, NOW);
  assert.deepEqual(evs.map((e) => `${e.round} ${e.type}`), ['a1 started', 'a1 finished', 'a2 started', 'a2 finished', 'a3 started']);
  assert.deepEqual(evs.map((e) => e.at), [
    at(2026, 10, 25, 23, 50), at(2026, 10, 25, 23, 55), at(2026, 10, 26, 0, 10), at(2026, 10, 26, 0, 30), at(2026, 10, 26, 14, 34),
  ]);
});

test('STOPPED ends the attempt as stopped, not rate-limited or waiting; history shows it', () => {
  const m = new ChainModel();
  const lines = ['coder q184 started 15:00 on codex gpt-6-luna', 'coder q184 STOPPED by orchestrator 15:02: changed plan'];
  for (const e of parseChainLines(lines, NOW)) m.apply(P, e);
  const [rec] = m.recent(NOW);
  assert.equal(rec.state, 'stopped');
  assert.equal(rec.reason, 'changed plan');
  const s = coderStatus(rec, 'editing', NOW, NOW).status;
  assert.equal(s, 'stopped');

  const rows = buildRoundList(lines, NOW, new Set(), NOW);
  assert.equal(rows[0].outcome, 'stopped');
  assert.equal(rows[0].attempts[0].outcome, 'stopped');
  assert.equal(outcomeChip(rows[0]).text, 'stopped');
});

test('research rounds write <round>.log like coder rounds', () => {
  assert.equal(logName('research', 'r1'), 'r1.log');
  assert.equal(logName('investigate', 'r1'), 'r1-investigate.log');
});

test('the room lists a project with one dated event from today', async () => {
  const tmp = tmpDir('cr-q20-');
  const dir = path.join(tmp, 'acme');
  fs.mkdirSync(path.join(dir, '.rounds'), { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  fs.writeFileSync(path.join(dir, '.rounds', 'chain.log'), `coder b6 started ${stamp} on codex gpt-6-luna\n`);
  const room = new Room({ roots: [dir], scanRoot: tmp, claudeProjects: path.join(tmp, 'cp'), home: tmp });
  await room.tick();
  const snap = room.snapshot();
  assert.ok(snap.tiles.some((t) => t.kind === 'coder' && t.round === 'b6' && t.project === 'acme'), JSON.stringify(snap.tiles.map((t) => t.name)));
});

test('status CLI counts dated lines, part2 and STOPPED', async () => {
  const dir = tmpDir('cr-q20-st-');
  fs.mkdirSync(path.join(dir, '.rounds'));
  fs.writeFileSync(path.join(dir, '.rounds', 'chain.log'), [
    'coder q1 started 2026-10-26 14:00 on a', 'coder q1 finished 2026-10-26 14:05 rc=0 on a',
    'coder q2 started 2026-10-26 14:10 on a', 'coder q3 started 2026-10-26 14:11 on a',
    'coder q3 part2 STOPPED by user 14:20', '',
  ].join('\n'));
  const out = [];
  await status(['--dir', dir], { out: (l) => out.push(l), err: (l) => out.push(l) });
  assert.ok(out.includes('running: q2'), out.join('\n'));
  assert.ok(out.some((l) => l.includes('STOPPED')));
});

test('SessionStart hook counts dated lines and STOPPED', () => {
  const dir = tmpDir('cr-q20-hook-');
  const runs = path.join(dir, '.rounds');
  fs.mkdirSync(runs);
  fs.writeFileSync(path.join(runs, 'HANDOFF.md'), '# Handoff\n');
  fs.writeFileSync(path.join(runs, 'chain.log'), [
    'coder q1 started 2026-10-26 14:00 on a', 'coder q1 finished 2026-10-26 14:05 rc=0 on a',
    'coder q2 started 2026-10-26 14:10 on a', 'coder q3 started 2026-10-26 14:11 on a',
    'coder q3 STOPPED by user 14:20', '',
  ].join('\n'));
  const hook = path.join(import.meta.dirname, '..', 'plugins', 'coder-room', 'hooks', 'session-start.js');
  const r = spawnSync(process.execPath, [hook], { cwd: dir, encoding: 'utf8', env: { CLAUDE_PROJECT_DIR: dir, PATH: '/nonexistent' } });
  assert.match(r.stdout, /Running rounds.*: q2\./);
  assert.doesNotMatch(r.stdout, /q3/);
});
