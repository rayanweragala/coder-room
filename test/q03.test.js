import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeParser } from '../src/parse-claude.js';
import { Facts } from '../src/facts.js';
import { isGate, statusOf } from '../src/events.js';
import { coderTile, orchestratorTile } from '../src/tiles.js';
import { needsPlace } from '../public/chat-order.js';
import { recentItems } from '../public/recent.js';

const j = (o) => JSON.stringify(o);
const asst = (...content) => j({ type: 'assistant', message: { content } });
const use = (name, input, id = 'x1') => ({ type: 'tool_use', name, input, id });
const cmdOf = (name, input) => createClaudeParser({ root: '/w' }).feed(asst(use(name, input))).find((e) => e.kind === 'command');

test('chat order: the first message and any detached row get inserted, a correct neighbour is left alone', () => {
  assert.equal(needsPlace(false, null, null), true);
  assert.equal(needsPlace(false, null, { id: 'prev' }), true);
  const prev = { id: 'prev' };
  assert.equal(needsPlace(true, prev, prev), false);
  assert.equal(needsPlace(true, null, prev), true);
  assert.equal(needsPlace(true, null, null), false);
});

test('gate: matches a command word on the first line only', () => {
  for (const c of ['npm test', 'cd . && node --test --test-concurrency=1', 'x; vitest run', 'a | tsc', 'FOO=1 npm run build',
    './locked-mvn verify', 'npx eslint src', 'false || mvn -q test']) assert.equal(isGate(c), true, c);
  for (const c of ['ls', 'grep -rn tsc src', 'echo "run npm test"', 'cat notes-tsc.md', 'git commit -m "eslint fix"']) assert.equal(isGate(c), false, c);
});

test('gate: a heredoc body that contains test code is not a gate', () => {
  const cmd = "cat >> test/q02.test.js <<'EOF'\nimport { test } from 'node:test';\nnode --test\nnpm test\nEOF";
  assert.equal(isGate(cmd), false);
  assert.equal(statusOf({ kind: 'command', cmd }), 'running a command');
  const f = new Facts();
  f.push({ kind: 'command', text: cmd, cmd, id: 'a' }, 1);
  assert.deepEqual(f.gatesList(), []);
  f.push({ kind: 'command', text: 'npm test', cmd: 'npm test', id: 'b' }, 2);
  assert.equal(f.gatesList().length, 1);
});

test('working-on labels for tools with no file or command', () => {
  assert.equal(cmdOf('TaskUpdate', { taskId: '1' }), undefined);
  assert.equal(cmdOf('TaskCreate', { subject: 's' }), undefined);
  assert.equal(cmdOf('Read', { file_path: '/w/src/a.js' }).cmd, 'reading src/a.js');
  assert.equal(cmdOf('Grep', { pattern: 'foo' }).cmd, 'searching foo');
  assert.equal(cmdOf('Glob', { pattern: '**/*.js' }).cmd, 'searching **/*.js');
  assert.equal(cmdOf('mcp__claude-in-chrome__screenshot', {}).cmd, 'chrome: screenshot');
  assert.equal(cmdOf('Bash', { command: 'ls' }).cmd, 'ls');
});

test('files outside the project come last and are marked', () => {
  const f = new Facts();
  const edit = (file) => f.push({ kind: 'edit', text: file, file, add: 1, del: 0 }, 1);
  edit('/tmp/cr-live-check.mjs');
  edit('src/a.js');
  edit('src/b.js');
  const list = f.filesList();
  assert.deepEqual(list.map((x) => x.file), ['src/b.js', 'src/a.js', '/tmp/cr-live-check.mjs']);
  assert.deepEqual(list.map((x) => !!x.outside), [false, false, true]);
});

test('recent items: last 4, thoughts and says first, one line each', () => {
  const ev = [
    { n: 1, kind: 'thought', text: 'a\nmore' }, { n: 2, kind: 'command', text: 'ls' }, { n: 3, kind: 'say', text: 'b' },
    { n: 4, kind: 'edit', file: 'src/x.js', text: 'src/x.js' }, { n: 5, kind: 'thought', text: 'c' }, { n: 6, kind: 'say', text: 'd' },
    { n: 7, kind: 'command', text: 'pwd' }, { n: 8, kind: 'thought', text: 'e' },
  ];
  assert.deepEqual(recentItems(ev).map((i) => i.n), [3, 5, 6, 8]);
  assert.deepEqual(recentItems(ev.slice(0, 3)).map((i) => i.text), ['a', 'ls', 'b']);
  assert.deepEqual(recentItems([ev[3], ev[6], ev[5]], 2).map((i) => i.n), [7, 6]);
  assert.deepEqual(recentItems([ev[3], ev[2]]).map((i) => i.text), ['src/x.js', 'b']);
  assert.deepEqual(recentItems([]), []);
});

test('tiles carry lastActivity from the log mtime', () => {
  const r = { slot: 'luna', name: 'Codex Luna', color: '#fff', project: 'p', round: 'q1', role: 'code', startedAt: 1, endedAt: null };
  const info = { spec: null, report: null };
  const st = { status: 'thinking', quiet: null };
  assert.equal(coderTile(r, { grewAt: 1234, current: null, facts: new Facts() }, info, st).lastActivity, 1234);
  assert.equal(coderTile(r, undefined, info, st).lastActivity, null);
  const orch = { project: 'p', follower: { grewAt: 99, current: null, facts: new Facts() } };
  assert.equal(orchestratorTile(orch, 'thinking').lastActivity, 99);
  assert.equal(orchestratorTile(null, 'waiting for you').lastActivity, null);
});
