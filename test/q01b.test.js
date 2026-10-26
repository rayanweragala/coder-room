import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChainLines, slotOf, slotInfo, parseChainLine } from '../src/parse-chain.js';
import { ChainModel, DAY_MS } from '../src/state.js';
import { encodings, recentTranscripts, transcriptDirs } from '../src/projects.js';
import { Room } from '../src/room.js';

const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const day = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
const P = { name: 'demo', dir: '/p/demo', runsDir: '/p/demo/.codex-runs' };

test('lines are dated by walking backwards from the mtime', () => {
  const ev = parseChainLines([
    'coder q1 started 22:00 on claude2 sonnet',
    'coder q1 finished 23:30 rc=0 on claude2 sonnet',
    'coder q2 started 01:00 on claude2 sonnet',
    'coder q2 finished 02:00 rc=0 on claude2 sonnet',
    'coder q3 started 11:00 on claude2 sonnet',
    'coder q3 finished 11:50 rc=0 on claude2 sonnet',
    'coder q4 started 12:30 on claude2 sonnet',
  ], NOW);
  assert.deepEqual(ev.map((e) => e.at), [
    day(23, 22, 0), day(23, 23, 30), day(24, 1, 0), day(24, 2, 0), day(24, 11, 0), day(24, 11, 50), day(24, 12, 30),
  ]);
});

test('a line later than the one after it is a day earlier, across several days', () => {
  const ev = parseChainLines([
    'coder a started 10:00 on luna',
    'coder b started 15:00 on luna',
    'coder c started 09:00 on luna',
    'coder d started 11:00 on luna',
  ], NOW);
  assert.deepEqual(ev.map((e) => e.at), [day(24, 10, 0), day(24, 15, 0), day(25, 9, 0), day(25, 11, 0)]);
});

test('anchor lines give exact dates for themselves and the walk from there', () => {
  const ev = parseChainLines([
    'coder a started 09:00 on luna',
    'coder b started 23:00 on luna',
    '2026-10-18 16:03 q313 launched on luna',
    'coder c started 08:00 on luna',
    'coder d started 11:00 on luna',
  ], NOW);
  assert.deepEqual(ev.map((e) => e.at), [day(17, 9, 0), day(17, 23, 0), day(25, 8, 0), day(25, 11, 0)]);
});

test('a stamp later than the mtime is yesterday (first line within a minute is today)', () => {
  assert.equal(parseChainLines(['coder a started 12:00 on luna'], NOW)[0].at, NOW);
  assert.equal(parseChainLines(['coder a started 12:01 on luna'], NOW)[0].at, NOW + 60_000);
  assert.equal(parseChainLines(['coder a started 12:30 on luna'], NOW)[0].at, day(24, 12, 30));
});

test('accounts outside the list keep their own slot and a grey tile', () => {
  assert.equal(slotOf('grok'), 'grok');
  assert.equal(slotOf('Grok 4'), 'grok');
  const m = new ChainModel();
  m.apply(P, parseChainLine('coder q1 started 11:00 on grok', NOW));
  const r = m.recent(NOW)[0];
  assert.deepEqual([r.slot, r.name, r.color], ['grok', 'Grok', '#94a3b8']);
  assert.equal(slotInfo('luna').name, 'Luna');
});

test('LIMIT / REFUSED without an account use the round\'s started slot, else are dropped', () => {
  const m = new ChainModel();
  const apply = (l) => m.apply(P, parseChainLine(l, NOW));
  apply('coder q1 started 10:00 on claude3 sonnet');
  apply('coder q2 started 10:10 on codex gpt-6-luna');
  apply('coder q1 LIMIT 11:00');
  apply('coder q9 REFUSED 11:05: dirty tree');
  apply('coder q8 LIMIT 11:06');
  const recs = m.recent(NOW);
  assert.deepEqual(recs.map((r) => r.slot).sort(), ['claude3', 'luna']);
  assert.equal(recs.find((r) => r.slot === 'claude3').state, 'rate-limited');
  assert.equal(recs.find((r) => r.slot === 'luna').state, 'running');
  assert.ok(!recs.some((r) => r.slot === 'unknown'));
});

test('recent: a log mtime wins over the chain line, a missing log falls back to it', () => {
  const m = new ChainModel();
  m.apply(P, parseChainLine('coder q1 started 11:00 on luna', NOW));
  m.apply(P, parseChainLine('coder q2 started 11:00 on codex gpt-6-sol', NOW));
  m.apply(P, parseChainLine('coder q3 started 11:00 on grok', NOW));
  const mtimes = { q1: NOW - 3 * DAY_MS, q2: NOW - 3600_000 };
  assert.deepEqual(m.recent(NOW, (r) => mtimes[r.round]).map((r) => r.slot), ['sol', 'grok']);
});

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('room: stale round log hides a tile, a fresh one shows it, anchors date old lines', async () => {
  const tmp = tmpDir('cr-q01b-');
  try {
    const root = path.join(tmp, 'proj');
    const runs = path.join(root, '.codex-runs');
    fs.mkdirSync(runs, { recursive: true });
    fs.writeFileSync(path.join(runs, 'chain.log'), [
      'coder q1 started 07:50 on claude2 sonnet',
      '2026-10-20 08:00 q2 launched',
      'coder q2 started 09:00 on codex gpt-6-luna',
      'coder q4 started 10:00 on grok',
      'coder q3 started 11:30 on claude sonnet',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(runs, 'q2.log'), '');
    fs.writeFileSync(path.join(runs, 'q4.log'), '');
    const at = (f, ms) => fs.utimesSync(path.join(runs, f), ms / 1000, ms / 1000);
    at('chain.log', NOW);
    at('q2.log', NOW - 3 * DAY_MS);
    at('q4.log', NOW - 3600_000);
    const room = new Room({ roots: [root], scanRoot: tmp, claudeProjects: path.join(tmp, 'none'), home: tmp, clock: () => NOW });
    await room.tick();
    assert.deepEqual(room.snapshot().tiles.map((t) => t.id), ['grok@proj', 'main@proj']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('transcripts: ancestors below home are considered, home itself is not; cwd names the project', async () => {
  const tmp = tmpDir('cr-q01b-t-');
  try {
    const home = path.join(tmp, 'home');
    const parent = path.join(home, 'personal');
    const root = path.join(parent, 'proj');
    const runs = path.join(root, '.codex-runs');
    const claude = path.join(tmp, 'claude');
    fs.mkdirSync(runs, { recursive: true });
    fs.writeFileSync(path.join(runs, 'chain.log'), 'free text\n');
    const put = (dir, name, cwd, ageMs) => {
      const d = path.join(claude, encodings(dir)[0]);
      fs.mkdirSync(d, { recursive: true });
      const f = path.join(d, name);
      const use = { type: 'assistant', message: { content: [{ type: 'tool_use', input: { file_path: path.join(root, 'a.js') } }] } };
      fs.writeFileSync(f, [{ type: 'queue-operation' }, { type: 'user', cwd }, use].map((o) => JSON.stringify(o)).join('\n') + '\n');
      fs.utimesSync(f, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
      return f;
    };
    put(root, 'old.jsonl', root, 5 * DAY_MS);
    const mid = put(parent, 'orch.jsonl', parent, 1000);
    put(home, 'home.jsonl', home, 10);
    const proj = { name: 'proj', dir: root, runsDir: runs };
    assert.deepEqual(transcriptDirs([proj], home), [root, parent]);
    assert.deepEqual((await recentTranscripts([proj], claude, home, NOW)).map((t) => t.file), [mid]);

    const room = new Room({ roots: [root], scanRoot: tmp, claudeProjects: claude, home, clock: () => NOW });
    await room.tick();
    const tile = room.snapshot().tiles[0];
    assert.deepEqual([tile.id, tile.project], ['orchestrator@proj', 'proj']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
