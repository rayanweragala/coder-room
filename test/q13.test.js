import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identityOf, CODEX_LOOKS, CLAUDE_LOOKS } from '../public/looks.js';
import { characterFor } from '../public/characters.js';
import { parseChainLines, slotOf } from '../src/parse-chain.js';
import { ChainModel } from '../src/state.js';
import { buildChat } from '../src/chat.js';
import { createClaudeParser } from '../src/parse-claude.js';
import { parseArgs } from '../server.js';
import { main } from '../src/cli/main.js';
import { Room } from '../src/room.js';
import { makeDemo } from '../demo/make-demo.js';
import { startAppender } from '../demo/appender.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NOW = Date.parse('2026-10-26T12:00:00');

// ---- item 1: the user, not a person ----

test('user kind end to end: orchestrator parser -> chat, speaker defaults to "You"', () => {
  const parser = createClaudeParser({ orchestrator: true });
  const ev = parser.feed(JSON.stringify({ type: 'user', message: { content: 'please start q1' } }));
  assert.deepEqual(ev.map((e) => e.kind), ['user']);
  const events = [{ ...ev[0], at: NOW - 5000, n: 1 }, { kind: 'message', text: 'on it', at: NOW - 4000, n: 2 }];
  const chat = buildChat({ orchs: [{ project: 'p', events }], now: NOW });
  assert.deepEqual(chat.map((m) => [m.from.id, m.from.name]), [['user', 'You'], ['orchestrator', 'Orchestrator']]);
  assert.equal(chat[1].to.name, 'You');
});

test('--user-name changes the chat speaker: server args, serve CLI and Room', async () => {
  assert.equal(parseArgs([]).userName, 'You');
  assert.equal(parseArgs(['--user-name', 'Sam']).userName, 'Sam');
  const events = [{ kind: 'user', text: 'hi', at: NOW - 1000, n: 1 }];
  assert.equal(buildChat({ orchs: [{ project: 'p', events }], now: NOW, userName: 'Sam' })[0].from.name, 'Sam');
  const out = [];
  await main(['serve', '--help'], { out: (s) => out.push(s), err: () => {} });
  assert.match(out.join('\n'), /--user-name/);
  assert.match(out.join('\n'), /--demo/);
});

test('no personal name remains in the shipped code or docs text', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'results'].includes(e.name)) walk(f); } else if (e.name !== 'plugin.json' && /rayan/i.test(fs.readFileSync(f, 'utf8'))) hits.push(f);
    }
  };
  for (const d of ['src', 'public', 'bin', 'plugins', 'bench', 'demo']) walk(path.join(ROOT, d));
  if (/rayan/i.test(fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8'))) hits.push('AGENTS.md');
  assert.deepEqual(hits, []);
});

// ---- item 2: coder identity from the chain line ----

test('identity: legacy lines keep their names and looks', () => {
  const pick = (on) => { const i = identityOf(on); return [i.id, i.name, i.kind, i.look, i.color]; };
  assert.deepEqual(pick('codex gpt-6-luna'), ['luna', 'Luna', 'codex', 'moon-violet', '#8b5cf6']);
  assert.deepEqual(pick('codex gpt-6.1-sol'), ['sol', 'Sol', 'codex', 'sun-orange', '#f97316']);
  assert.deepEqual(pick('claude3 sonnet'), ['claude3', 'claude3', 'claude', 'headphones-amber', '#f59e0b']);
  assert.deepEqual(pick('claude2 sonnet'), ['claude2', 'claude2', 'claude', 'scarf-coral', '#f43f5e']);
  assert.deepEqual(pick('main'), ['main', 'main', 'claude', 'cap-sky', '#0ea5e9']);
  assert.deepEqual(pick('claude sonnet'), ['main', 'main', 'claude', 'cap-sky', '#0ea5e9']);
  assert.deepEqual(pick('grok'), ['grok', 'Grok', 'robot', 'robot', '#94a3b8']);
  assert.deepEqual(pick('Grok 4'), ['grok', 'Grok', 'robot', 'robot', '#94a3b8']);
  assert.equal(slotOf('codex gpt-6-sol'), 'sol');
  assert.equal(identityOf(''), null);
});

test('identity: CLI lines give the coder name, its kind and a stable look', () => {
  const a = identityOf('claude-main sonnet');
  assert.deepEqual([a.id, a.name, a.kind], ['claude-main', 'claude-main', 'claude']);
  assert.ok(CLAUDE_LOOKS.some((l) => l.key === a.look));
  const b = identityOf('codex gpt-7');
  assert.deepEqual([b.id, b.name, b.kind], ['gpt-7', 'gpt-7', 'codex']);
  assert.ok(CODEX_LOOKS.some((l) => l.key === b.look));
  const c = identityOf('codex-2 gpt-7');
  assert.deepEqual([c.id, c.name, c.kind], ['codex-2', 'codex-2', 'codex']);
  assert.equal(identityOf('codex').kind, 'codex');
  for (const on of ['opus', 'haiku x', 'claude-review opus']) assert.equal(identityOf(on).kind, 'claude', on);
  assert.equal(identityOf('mystery model-9').kind, 'robot');
  // same name -> same look, every call, whatever the model text
  for (const on of ['claude-main sonnet', 'claude-main opus', 'CLAUDE-MAIN']) assert.equal(identityOf(on).look, a.look);
  assert.equal(identityOf('codex-2 gpt-8').look, c.look);
});

test('identity: names spread over the look lists and every look draws a balanced character', () => {
  const looks = new Set(Array.from({ length: 40 }, (_, i) => identityOf(`claude-bot${i} sonnet`).look));
  assert.ok(looks.size >= 4, `only ${looks.size} claude looks used`);
  const codex = new Set(Array.from({ length: 40 }, (_, i) => identityOf(`codex-${i} gpt-7`).look));
  assert.ok(codex.size >= 4, `only ${codex.size} codex looks used`);
  for (const key of [...CODEX_LOOKS, ...CLAUDE_LOOKS, { key: 'robot' }, { key: 'orchestrator' }].map((l) => l.key)) {
    const c = characterFor(key);
    for (const part of ['body', 'sleep', 'hands', 'wave']) assert.ok(c[part], `${key} ${part}`);
    const svg = c.body + c.sleep;
    assert.equal((svg.match(/<g\b[^>]*>/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, key);
  }
});

test('chain model: the tile carries the identity, and a finish without "on" keeps it', () => {
  const lines = [
    'coder q1 started 10:00 on claude-main sonnet',
    'coder q1 finished 10:20 rc=0',
    'coder q2 started 10:30 on codex gpt-6-luna',
  ];
  const model = new ChainModel();
  const project = { name: 'p', dir: '/w/p', runsDir: '/w/p/.rounds' };
  for (const ev of parseChainLines(lines, Date.parse('2026-10-26T11:00:00'))) model.apply(project, ev);
  const recs = Object.fromEntries(model.all().map((r) => [r.slot, r]));
  assert.deepEqual([recs['claude-main'].name, recs['claude-main'].char, recs['claude-main'].state], ['claude-main', 'claude', 'done']);
  assert.deepEqual([recs.luna.name, recs.luna.char, recs.luna.look, recs.luna.state], ['Luna', 'codex', 'moon-violet', 'running']);
  assert.equal(recs['claude-main'].id, 'claude-main@p');
});

// ---- item 3: the demo room ----

test('make-demo: two projects with rounds, coder logs, handoff and an orchestrator transcript', () => {
  const outer = tmpDir('cr-q13-a-');
  try {
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    assert.deepEqual(demo.projects.map((p) => p.name), ['acme-shop', 'docs-site']);
    for (const p of demo.projects) {
      const rounds = path.join(p.dir, '.rounds');
      for (const f of ['HANDOFF.md', 'chain.log', 'q01.md', 'q01.log', 'q01-report.md', 'q02.md', 'q02.log']) assert.ok(fs.existsSync(path.join(rounds, f)), `${p.name} ${f}`);
      assert.ok(fs.existsSync(p.transcript));
      assert.ok(p.transcript.startsWith(demo.claudeProjects));
      assert.ok(fs.readFileSync(p.transcript, 'utf8').includes('turn_duration'));
    }
    const logs = demo.projects.flatMap((p) => ['q01', 'q02'].map((q) => fs.readFileSync(path.join(p.dir, '.rounds', `${q}.log`), 'utf8')));
    assert.ok(logs.some((l) => l.startsWith('{') && l.includes('"TodoWrite"')), 'a Claude stream-json log with a checklist');
    assert.ok(logs.some((l) => l.includes('\ncodex\n') && l.includes('\nexec\n') && l.includes('apply patch')), 'a Codex-style log');
    assert.doesNotMatch(logs.join('\n'), /\/home\/|rayan/i);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

const demoRoom = (demo) => new Room({
  roots: demo.projects.map((p) => p.dir), scanRoot: demo.dir, claudeProjects: demo.claudeProjects, home: demo.dir,
});

test('a Room on the demo dir shows tiles for both projects and an orchestrator each', async () => {
  const outer = tmpDir('cr-q13-b-');
  try {
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    const room = demoRoom(demo);
    await room.tick();
    const snap = room.snapshot();
    assert.deepEqual(snap.projects.map((p) => p.name).sort(), ['acme-shop', 'docs-site']);
    for (const name of ['acme-shop', 'docs-site']) {
      const mine = snap.tiles.filter((t) => t.project === name);
      assert.ok(mine.some((t) => t.kind === 'orchestrator'), `${name} orchestrator`);
      if (name === 'docs-site') assert.ok(mine.some((t) => t.kind === 'coder' && t.status !== 'done'), `${name} running coder`);
      if (name === 'acme-shop') assert.ok(mine.some((t) => t.kind === 'coder' && t.status === 'done'), `${name} finished coder`);
    }
    const coders = snap.tiles.filter((t) => t.kind === 'coder');
    assert.deepEqual([...new Set(coders.map((t) => `${t.name}:${t.char}`))].sort(), ['claude-api:claude', 'codex-docs:codex', 'codex-ui:codex']);
    assert.ok(coders.every((t) => t.look && t.color));
    assert.ok(snap.chat.some((m) => m.from.name === 'You'));
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('appender: plays the whole plan (hand-off to a second round), writing only inside the demo dir', async () => {
  const outer = tmpDir('cr-q13-c-');
  try {
    fs.writeFileSync(path.join(outer, 'sentinel.txt'), 'keep');
    const demo = makeDemo({ out: path.join(outer, 'demo') });
    const docs = path.join(demo.projects[1].dir, '.rounds');
    const before = fs.readFileSync(path.join(docs, 'q02.log'), 'utf8').length;
    const play = startAppender(demo.actors, { dir: demo.dir, minMs: 0, maxMs: 0, speed: Infinity });
    await play.done;
    assert.deepEqual(fs.readdirSync(outer).sort(), ['demo', 'sentinel.txt']);
    assert.equal(fs.readFileSync(path.join(outer, 'sentinel.txt'), 'utf8'), 'keep');
    const acme = path.join(demo.projects[0].dir, '.rounds');
    assert.ok(fs.readFileSync(path.join(docs, 'q02.log'), 'utf8').length > before);
    for (const q of ['q04', 'q05', 'q05b']) assert.ok(fs.existsSync(path.join(acme, `${q}.md`)) && fs.existsSync(path.join(acme, `${q}.log`)) && fs.existsSync(path.join(acme, `${q}-report.md`)), q);
    assert.match(fs.readFileSync(path.join(acme, 'chain.log'), 'utf8'), /coder q04 started \d\d:\d\d on claude-api claude-sonnet-5-5/);
    const room = demoRoom(demo);
    await room.tick();
    const tiles = room.snapshot().tiles.filter((t) => t.kind === 'coder');
    assert.ok(tiles.length >= 5 && tiles.every((t) => ['done', 'rate-limited'].includes(t.status)), tiles.map((t) => `${t.id}:${t.status}`).join(' '));
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('appender: refuses paths outside the demo dir and stops when told', async () => {
  const outer = tmpDir('cr-q13-d-');
  try {
    const dir = path.join(outer, 'demo');
    fs.mkdirSync(dir);
    const outside = path.join(outer, 'escape.txt');
    const bad = startAppender([[{ writes: [{ file: outside, text: 'x' }] }]], { dir, minMs: 0, maxMs: 0 });
    await assert.rejects(bad.done, /outside/);
    assert.ok(!fs.existsSync(outside));
    assert.ok(!fs.existsSync(path.join(outer, '..', 'x')));

    const file = path.join(dir, 'a.log');
    const steps = Array.from({ length: 50 }, () => ({ writes: [{ file, text: 'line\n' }] }));
    const slow = startAppender([steps], { dir, minMs: 40, maxMs: 40 });
    await new Promise((r) => setTimeout(r, 130));
    slow.stop();
    await slow.done;
    const n = fs.readFileSync(file, 'utf8').split('\n').length - 1;
    assert.ok(n >= 1 && n < 10, `wrote ${n} lines`);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').length - 1, n, 'nothing written after stop');
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('serve --demo is documented in the serve help', async () => {
  const out = [];
  assert.equal(await main(['serve', '--demo', '--help'], { out: (s) => out.push(s), err: () => {} }), 0);
  assert.match(out.join('\n'), /serve --demo/);
  assert.match(out.join('\n'), /10 minutes/);
});

test('npm run demo starts the demo through the CLI', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.demo, 'node bin/coder-room.js serve --demo');
  assert.ok(pkg.files.includes('demo'));
});
