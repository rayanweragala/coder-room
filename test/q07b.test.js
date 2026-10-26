import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeParser } from '../src/parse-claude.js';
import { Facts } from '../src/facts.js';
import { orchestratorStatus } from '../src/state.js';
import { orchestratorTile } from '../src/tiles.js';
import { buildChat } from '../src/chat.js';

const NOW = 10_000_000;
const j = (o) => JSON.stringify(o);
const asst = (ts, item) => j({ type: 'assistant', timestamp: ts, message: { content: [item] } });
const talk = (ts) => asst(ts, { type: 'text', text: 'on it' });
const tool = (ts) => asst(ts, { type: 'tool_use', id: `t${ts}`, name: 'Bash', input: { command: 'ls' } });
const turnEnd = (ts) => j({ type: 'system', subtype: 'turn_duration', timestamp: ts, durationMs: 5 });
const rayan = (ts, text = 'hello') => j({ type: 'user', timestamp: ts, message: { content: text } });
const rayanItems = (ts, text) => j({ type: 'user', timestamp: ts, message: { content: [{ type: 'text', text }] } });
const toolResult = (ts) => j({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const notify = (ts) => j({ type: 'user', timestamp: ts, message: { content: '<task-notification>\n<task-id>b1</task-id>\n</task-notification>' } });

function read(lines) {
  const parser = createClaudeParser({ orchestrator: true });
  const facts = new Facts();
  for (const l of lines) for (const ev of parser.feed(l)) facts.push(ev, null);
  return facts;
}

const coder = (over = {}) => ({
  kind: 'coder', name: 'Luna', color: '#8b5cf6', project: 'p', round: 'q07', status: 'thinking', lastActivity: NOW - 5000, caption: 'writing tests', ...over,
});

function statusOf(facts, tiles, { grewAt = NOW - 1000, now = NOW } = {}) {
  return orchestratorStatus({ turn: facts.turn, activity: facts.activity, grewAt }, tiles, now);
}

test('turn end + a working coder: watching, with the coder name and round', () => {
  const facts = read([rayan(1000), tool(2000), talk(NOW - 60_000), turnEnd(NOW - 59_000)]);
  const st = statusOf(facts, [coder()]);
  assert.equal(st.status, 'watching');
  assert.equal(st.label, 'watching Luna · q07');
  assert.deepEqual([st.watching.name, st.watching.round, st.watching.color, st.watching.caption], ['Luna', 'q07', '#8b5cf6', 'writing tests']);
});

test('turn end and no working coder: waiting for you', () => {
  const facts = read([tool(2000), turnEnd(NOW - 59_000)]);
  assert.equal(statusOf(facts, []).status, 'waiting for you');
  assert.equal(statusOf(facts, [coder({ status: 'done' }), coder({ status: 'rate-limited' })]).status, 'waiting for you');
  assert.equal(statusOf(facts, [coder({ project: 'p', kind: 'orchestrator' })]).status, 'waiting for you');
});

test('assistant work after the last turn end is working, not watching', () => {
  const facts = read([talk(1000), turnEnd(2000), rayan(3000, 'next please'), tool(4000)]);
  const st = statusOf(facts, [coder()]);
  assert.equal(st.status, 'running a command');
  assert.equal(st.label, null);
});

test('Rayan text after a turn end opens a new turn; a tool result alone does not', () => {
  const ended = [talk(1000), turnEnd(2000)];
  assert.equal(statusOf(read([...ended, rayan(3000)]), []).status, 'thinking');
  assert.equal(statusOf(read([...ended, rayanItems(3000, 'again')]), []).status, 'thinking');
  assert.equal(statusOf(read([...ended, toolResult(3000)]), []).status, 'waiting for you');
});

test('a task-notification user line wakes the orchestrator and is not Rayan', () => {
  const parser = createClaudeParser({ orchestrator: true });
  assert.deepEqual(parser.feed(notify(5)).map((e) => e.kind), ['wake']);
  assert.deepEqual(parser.feed(rayanItems(6, `ok\n${'<task-notification>x</task-notification>'}`)).map((e) => e.kind), ['wake']);
  assert.deepEqual(parser.feed(rayan(7, 'plain words')).map((e) => e.kind), ['user']);
  const facts = read([talk(1000), turnEnd(2000), notify(3000)]);
  assert.equal(statusOf(facts, [coder()]).status, 'thinking');
  assert.equal(facts.events.some((e) => e.kind === 'user' || e.kind === 'wake'), false);
});

test('work within the last 20 s counts as working even after a turn end', () => {
  const facts = read([talk(NOW - 10_000), turnEnd(NOW - 9_000)]);
  assert.equal(statusOf(facts, [coder()]).status, 'thinking');
  assert.equal(statusOf(facts, [coder()], { now: NOW + 15_000 }).status, 'watching');
});

test('an old transcript without turn-end lines falls back to quiet time', () => {
  const facts = read([rayan(1000), tool(2000)]);
  assert.equal(facts.turn.seen, false);
  assert.equal(statusOf(facts, [coder()], { grewAt: NOW - 30_000 }).status, 'running a command');
  assert.equal(statusOf(facts, [coder()], { grewAt: NOW - 3 * 60_000 }).status, 'watching');
  assert.equal(statusOf(facts, [], { grewAt: NOW - 3 * 60_000 }).status, 'waiting for you');
});

test('several working coders: the most recent one, "+1" for the rest', () => {
  const facts = read([talk(1000), turnEnd(2000)]);
  const tiles = [coder({ name: 'Sol', lastActivity: NOW - 9000 }), coder({ name: 'Luna', lastActivity: NOW - 1000 }),
    coder({ name: 'Sonnet · claude2', status: 'done', lastActivity: NOW })];
  assert.equal(statusOf(facts, tiles).label, 'watching Luna · q07 +1');
  const three = [...tiles, coder({ name: 'Sonnet · main', lastActivity: NOW - 20_000 })];
  assert.equal(statusOf(facts, three).label, 'watching Luna · q07 +2');
});

test('the raised hand belongs to waiting for you only', async () => {
  const { handsFor } = await import('../public/hands.js');
  const mk = (status) => ({ id: 'orchestrator@p', kind: 'orchestrator', status, lastActivity: NOW });
  const acks = { base: 0, visit: NOW, keys: {} };
  assert.equal(handsFor([mk('waiting for you')], acks, NOW).length, 1);
  assert.equal(handsFor([mk('watching')], acks, NOW).length, 0);
});

test('orchestrator tile carries label and watching; plain string status still works', () => {
  const facts = read([talk(1000), turnEnd(2000)]);
  const st = statusOf(facts, [coder()]);
  const tile = orchestratorTile(null, st);
  assert.equal(tile.status, 'watching');
  assert.equal(tile.label, 'watching Luna · q07');
  assert.equal(tile.watching.caption, 'writing tests');
  const plain = orchestratorTile(null, 'waiting for you');
  assert.equal(plain.status, 'waiting for you');
  assert.equal(plain.label, null);
});

test('chat excludes task-notification lines and keeps Rayan text', () => {
  const facts = read([rayan(1000, 'hi there'), notify(1100), rayanItems(1200, '<task-notification>y</task-notification>'), talk(1300)]);
  const chat = buildChat({ orchs: [{ project: 'p', events: facts.events }], now: 2000 });
  assert.deepEqual(chat.map((m) => [m.from.id, m.text]), [['user', 'hi there'], ['orchestrator', 'on it']]);
});
