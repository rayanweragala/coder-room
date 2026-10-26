import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexParser } from '../src/parse-codex.js';
import { createClaudeParser } from '../src/parse-claude.js';
import { Facts } from '../src/facts.js';
import { parseSpec, parseReport } from '../src/rounds.js';
import { buildChat } from '../src/chat.js';
import { Room } from '../src/room.js';

const run = (parser, lines) => lines.flatMap((l) => parser.feed(l));
const j = (o) => JSON.stringify(o);
const asst = (...content) => j({ type: 'assistant', message: { content } });
const tool = (name, input, id) => ({ type: 'tool_use', name, input, id });

test('codex: **headline** lines are thoughts, narration lines merge into one say', () => {
  const lines = ['**Adding live label deletion**', 'codex', 'First sentence.', 'Second sentence.', 'exec',
    "/bin/bash -lc 'npm test' in /w", ' succeeded in 5ms:', 'output', '**Wiring the tests**'];
  const ev = run(createCodexParser({ root: '/w' }), lines);
  assert.deepEqual(ev.map((e) => e.kind), ['thought', 'say', 'say', 'command', 'result', 'thought']);
  assert.equal(ev[0].text, 'Adding live label deletion');
  assert.equal(ev[2].cont, true);
  const f = new Facts();
  for (const e of ev) f.push(e, 1000);
  assert.deepEqual(f.events.map((e) => e.kind), ['thought', 'say', 'command', 'thought']);
  assert.equal(f.events[1].text, 'First sentence.\nSecond sentence.');
  assert.equal(f.events[2].ok, true);
  assert.equal(f.caption, 'Wiring the tests');
  assert.deepEqual(f.gatesList(), [{ cmd: 'npm test', status: 'ok' }]);
});

test('claude: edit counts, todos, bash description, text and empty thinking', () => {
  const p = createClaudeParser({ root: '/w' });
  const ev = run(p, [
    asst({ type: 'thinking', thinking: '' }, { type: 'text', text: 'Reading /w/spec.md first' }),
    asst(tool('Edit', { file_path: '/w/src/a.js', old_string: 'a\nb', new_string: 'a\nb\nc\nd' }, 't1')),
    asst(tool('Write', { file_path: '/w/src/n.js', content: '1\n2\n3' }, 't2')),
    asst(tool('TodoWrite', { todos: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }, { content: 'three', status: 'pending' }] }, 't3')),
    asst(tool('Bash', { command: 'node --test', description: 'Run the tests' }, 't4')),
    j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', is_error: true, content: 'boom' }] } }),
  ]);
  assert.deepEqual(ev.map((e) => e.kind), ['say', 'edit', 'edit', 'todo', 'intent', 'command', 'result']);
  assert.equal(ev[0].text, 'Reading spec.md first');
  assert.deepEqual([ev[1].add, ev[1].del], [4, 2]);
  assert.deepEqual([ev[2].add, ev[2].del], [3, 0]);
  assert.equal(ev[4].text, 'Run the tests');
  const f = new Facts();
  for (const e of ev) f.push(e, 1);
  assert.deepEqual(f.checklist().map((t) => t.status), ['done', 'doing', 'todo']);
  assert.deepEqual(f.filesList().map((x) => [x.file, x.edits, x.add, x.del]), [['src/n.js', 1, 3, 0], ['src/a.js', 1, 4, 2]]);
  assert.deepEqual(f.gatesList(), [{ cmd: 'node --test', status: 'fail' }]);
  assert.equal(f.caption, 'Run the tests');
});

test('claude: non-empty thinking is a thought; full text is kept up to 2000 chars', () => {
  const ev = run(createClaudeParser(), [asst({ type: 'thinking', thinking: 'x'.repeat(2500) })]);
  assert.equal(ev[0].kind, 'thought');
  assert.equal(ev[0].text.length, 2000);
});

test('orchestrator transcript: user text is rayan, tool results and system text are not, text is message', () => {
  const p = createClaudeParser({ orchestrator: true });
  const ev = run(p, [
    j({ type: 'user', message: { role: 'user', content: 'please start q02 '.repeat(40) } }),
    j({ type: 'user', message: { content: [{ type: 'text', text: 'second one' }] } }),
    j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'out' }] } }),
    j({ type: 'user', message: { content: '<system-reminder>skip</system-reminder>' } }),
    asst({ type: 'text', text: 'Round is running.' }, tool('Bash', { command: 'ls', description: 'List files' }, 'b1')),
  ]);
  assert.deepEqual(ev.map((e) => e.kind), ['user', 'user', 'message', 'intent', 'command']);
  assert.equal(ev[0].text.length, 300);
  assert.equal(ev[1].text, 'second one');
});

test('spec and report heads', () => {
  const spec = parseSpec('# q02 — A living room\n\n## Goal\nFirst line\nsecond line.\n\nOther para.\n\n### 1. One\n### 2. Two\n');
  assert.equal(spec.title, 'q02 — A living room');
  assert.equal(spec.goal, 'First line second line.');
  assert.deepEqual(spec.items, ['1. One', '2. Two']);
  const rep = parseReport('# q02 report\n\n## Files\n- a.js changed\n- b.js changed\nplain line\n- fourth\n');
  assert.equal(rep.title, 'q02 report');
  assert.deepEqual(rep.lines, ['a.js changed', 'b.js changed', 'plain line']);
});

const BOT = { slot: 'luna', name: 'Luna', color: '#8b5cf6', round: 'q9' };
const NOW = Date.parse('2026-10-25T20:00:00');

test('chat: only Rayan and orchestrator messages, per project, long ones keep their full text', () => {
  const ev = (kind, text, at, n) => ({ kind, text, at, n });
  const chat = buildChat({
    now: NOW,
    orchs: [{ project: 'proj', events: [
      ev('thought', 'hmm', NOW - 50_000, 1), ev('say', 'coder talk', NOW - 49_000, 2), ev('edit', 'a.js', NOW - 48_000, 3),
      ev('message', 'Round q9 looks good. '.repeat(30), NOW - 30_000, 5), ev('user', 'thanks', NOW - 20_000, 6)] }],
  });
  assert.deepEqual(chat.map((m) => `${m.from.name}${m.to ? '>' + m.to.name : ''}`), ['Orchestrator>You', 'You']);
  assert.ok(chat.every((m) => m.project === 'proj'));
  assert.equal(chat[0].text.length, 400);
  assert.ok(chat[0].full.length > 400);
  assert.equal(chat[1].text, 'thanks');
});

test('chat: old messages drop, the 300 cap applies per project', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'user', text: `m${i}`, at: NOW - 400 + i, n: i }));
  const old = [{ kind: 'user', text: 'ancient', at: NOW - 3 * 86_400_000, n: 0 }];
  const chat = buildChat({ now: NOW, orchs: [{ project: 'a', events: [...old, ...many(400)] }, { project: 'b', events: many(5) }] });
  assert.equal(chat.filter((m) => m.project === 'a').length, 300);
  assert.equal(chat.filter((m) => m.project === 'b').length, 5);
  assert.ok(!chat.some((m) => m.text === 'ancient'));
  assert.equal(chat.filter((m) => m.project === 'a').at(-1).text, 'm399');
});

test('room: tile carries caption, checklist from spec, goal, report head; handoff is live-only', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-q02-'));
  try {
    const root = path.join(tmp, 'proj');
    const runs = path.join(root, '.codex-runs');
    fs.mkdirSync(runs, { recursive: true });
    const chain = path.join(runs, 'chain.log');
    fs.writeFileSync(chain, 'coder q9 started 19:00 on codex gpt-6-luna\n');
    fs.writeFileSync(path.join(runs, 'q9.log'), `**Adding the thing**\nexec\n/bin/bash -lc 'node --test' in ${root}\n succeeded in 4ms:\n`);
    fs.writeFileSync(path.join(runs, 'q9.md'), '# q9 — Spec\n\n## Goal\nMake things.\n\n### 1. First\n### 2. Second\n');
    const room = new Room({ roots: [root], scanRoot: tmp, claudeProjects: path.join(tmp, 'none'), home: tmp, clock: () => Date.now() });
    const seen = [];
    room.on('handoff', (h) => seen.push(h));
    await room.tick();
    const t = room.snapshot().tiles.find((x) => x.id === 'luna@proj');
    assert.equal(t.slot, 'luna');
    assert.equal(t.caption, 'Adding the thing');
    assert.deepEqual(t.checklist, [{ text: '1. First', status: 'todo' }, { text: '2. Second', status: 'todo' }]);
    assert.deepEqual(t.goal, { title: 'q9 — Spec', summary: 'Make things.' });
    assert.deepEqual(t.gates, [{ cmd: 'node --test', status: 'ok' }]);
    assert.equal(t.reportHead, null);
    assert.deepEqual(seen, []);
    assert.deepEqual(room.snapshot().chat, []);

    fs.writeFileSync(path.join(runs, 'q9-report.md'), '# q9 report\n- done\n');
    fs.appendFileSync(chain, 'coder q9 finished 19:10 rc=0 on codex gpt-6-luna\n');
    room.lastRounds = -Infinity;
    await room.tick();
    const d = room.snapshot().tiles.find((x) => x.id === 'luna@proj');
    assert.deepEqual(d.reportHead, { title: 'q9 report', lines: ['done'], path: '.codex-runs/q9-report.md' });
    assert.ok(d.checklist.every((c) => c.status === 'done'));
    assert.deepEqual(seen, [{ type: 'report', from: 'luna@proj', project: 'proj' }]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('character scenes are balanced SVG for every agent kind', async () => {
  const { sceneFor } = await import('../public/scene.js');
  for (const id of ['luna', 'sol', 'claude2', 'claude3', 'main', 'orchestrator', 'grok']) {
    const svg = sceneFor(id);
    const stack = [];
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      if (m[4] === '/') continue;
      if (m[1]) assert.equal(stack.pop(), m[2], `${id}: closing ${m[2]}`);
      else stack.push(m[2]);
    }
    assert.deepEqual(stack, [], id);
    assert.match(svg, /class="mouth"/, id);
    assert.match(svg, /class="pupil"/, id);
  }
});
