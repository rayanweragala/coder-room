import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from '../src/room.js';
import { parseArgs } from '../server.js';
import { defaultClaudeProjects, encodings, recentTranscripts } from '../src/projects.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cr-q21-'));

function setup(tmp) {
  const home = path.join(tmp, 'home');
  const dir = path.join(home, 'work', 'acme');
  fs.mkdirSync(path.join(dir, '.rounds'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.rounds', 'chain.log'), 'coder q1 started 19:00 on codex gpt-6-luna\n');
  const rootA = path.join(tmp, 'rootA');
  const rootB = path.join(tmp, 'rootB');
  const enc = encodings(dir)[0];
  return { home, dir, rootA, rootB, encA: path.join(rootA, enc), encB: path.join(rootB, enc) };
}

function writeTranscript(file, cwd, entrypoint, mtime) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const base = { cwd, ...(entrypoint ? { entrypoint } : {}) };
  const lines = [
    { type: 'user', ...base, message: { role: 'user', content: 'hello' } },
    { type: 'assistant', ...base, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000);
}

const room = (s, claudeProjects) => new Room({ roots: [s.dir], scanRoot: s.home, claudeProjects, home: s.home });
const orchestrators = (r) => r.snapshot().tiles.filter((t) => t.kind === 'orchestrator');

test('the orchestrator transcript in the second root gives an orchestrator tile', async () => {
  const tmp = tmpDir();
  try {
    const s = setup(tmp);
    fs.mkdirSync(s.rootA, { recursive: true });
    writeTranscript(path.join(s.encB, 'one.jsonl'), s.dir, 'cli');
    const r = room(s, [s.rootA, s.rootB]);
    await r.tick();
    assert.deepEqual(orchestrators(r).map((t) => t.id), ['orchestrator@acme']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a newer sdk-cli transcript in another root is ignored; the cli one is used', async () => {
  const tmp = tmpDir();
  try {
    const s = setup(tmp);
    const now = Date.now();
    writeTranscript(path.join(s.encA, 'print.jsonl'), s.dir, 'sdk-cli', now - 1000);
    writeTranscript(path.join(s.encB, 'inter.jsonl'), s.dir, 'cli', now - 60_000);
    const found = await recentTranscripts([{ dir: s.dir }], [s.rootA, s.rootB], s.home, now, undefined, new Map());
    assert.deepEqual(found.map((f) => path.basename(f.file)), ['inter.jsonl']);
    const r = room(s, [s.rootA, s.rootB]);
    await r.tick();
    assert.equal(orchestrators(r).length, 1);
    assert.equal([...r.orchs.values()][0].file, path.join(s.encB, 'inter.jsonl'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a transcript with only print-mode sessions gives no orchestrator tile', async () => {
  const tmp = tmpDir();
  try {
    const s = setup(tmp);
    writeTranscript(path.join(s.encA, 'print.jsonl'), s.dir, 'sdk-cli');
    const r = room(s, [s.rootA]);
    await r.tick();
    assert.equal(orchestrators(r).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a transcript without an entrypoint field stays a candidate', async () => {
  const tmp = tmpDir();
  try {
    const s = setup(tmp);
    writeTranscript(path.join(s.encA, 'old.jsonl'), s.dir, null);
    const found = await recentTranscripts([{ dir: s.dir }], [s.rootA], s.home, Date.now(), undefined, new Map());
    assert.equal(found.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the print-mode verdict is cached per file and inode, and dropped when the file goes', async () => {
  const tmp = tmpDir();
  try {
    const s = setup(tmp);
    const file = path.join(s.encA, 'print.jsonl');
    writeTranscript(file, s.dir, 'sdk-cli');
    const cache = new Map();
    const call = () => recentTranscripts([{ dir: s.dir }], [s.rootA], s.home, Date.now(), undefined, cache);
    await call();
    const first = cache.get(file);
    assert.equal(first.print, true);
    await call();
    assert.equal(cache.get(file), first, 'not re-read');
    fs.rmSync(file);
    await call();
    assert.equal(cache.size, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('default roots: ~/.claude/projects and every ~/.claude*/projects directory, not files', async () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, '.claude', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-x', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-nodir'));
    fs.writeFileSync(path.join(tmp, '.clauderc'), '{}');
    assert.deepEqual(await defaultClaudeProjects(tmp), [path.join(tmp, '.claude', 'projects'), path.join(tmp, '.claude-x', 'projects')]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--claude-projects is repeatable and replaces the default list', () => {
  assert.equal(parseArgs([]).claudeProjects, null);
  assert.deepEqual(parseArgs(['--claude-projects', '/a', '--claude-projects', '/b']).claudeProjects, ['/a', '/b']);
});

test('a room without explicit roots finds a transcript under a ~/.claude* dir of its home', async () => {
  const tmp = tmpDir();
  try {
    const s = setup(tmp);
    writeTranscript(path.join(s.home, '.claude-x', 'projects', encodings(s.dir)[0], 'one.jsonl'), s.dir, 'cli');
    const r = room(s, undefined);
    await r.tick();
    assert.equal(orchestrators(r).length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
