import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseChainLine, slotOf, stampToMs, logName } from '../src/parse-chain.js';
import { createClaudeParser } from '../src/parse-claude.js';
import { createCodexParser } from '../src/parse-codex.js';
import { createLogParser } from '../src/parse-log.js';
import { statusOf } from '../src/events.js';

const fx = (n) => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8').split('\n');
const run = (parser, lines) => lines.flatMap((l) => parser.feed(l));
const MTIME = new Date(2026, 9, 25, 20, 0).getTime();

test('chain lines', () => {
  const lines = fx('chain.log');
  const p = (i) => parseChainLine(lines[i], MTIME);
  assert.deepEqual([p(0).type, p(0).round, p(0).slot, p(0).role], ['started', 'q314', 'luna', 'coder']);
  assert.equal(p(1), null);
  assert.deepEqual([p(2).type, p(2).rc], ['finished', 0]);
  assert.deepEqual([p(3).type, p(3).round], ['ready', 'q314']);
  assert.deepEqual([p(4).type, p(4).slot], ['limit', 'claude3']);
  assert.deepEqual([p(5).type, p(5).round, p(5).reason], ['refused', 'q315', 'dirty tree']);
  assert.deepEqual([p(6).role, p(6).slot], ['review', 'sol']);
  assert.deepEqual([p(7).role, p(7).slot], ['investigate', 'claude2']);
  assert.equal(parseChainLine('some free text', MTIME), null);
});

test('slots, stamps and log names', () => {
  assert.equal(slotOf('codex gpt-6-sol'), 'sol');
  assert.equal(slotOf('claude sonnet'), 'main');
  assert.equal(slotOf('whatever'), 'whatever');
  assert.equal(slotOf(undefined), null);
  assert.equal(stampToMs('19', '14', MTIME), new Date(2026, 9, 25, 19, 14).getTime());
  assert.equal(stampToMs('23', '29', MTIME), new Date(2026, 9, 24, 23, 29).getTime());
  assert.equal(logName('review', 'q83'), 'q83-review.log');
  assert.equal(logName('investigate', 'q84'), 'q84-investigate.log');
  assert.equal(logName('coder', 'q1'), 'q1.log');
});

test('claude stream-json events', () => {
  const ev = run(createClaudeParser({ root: '/work/demo' }), fx('claude.jsonl'));
  assert.deepEqual(ev.map((e) => e.kind), ['say', 'thought', 'edit', 'command', 'command', 'done']);
  assert.equal(ev[0].text, 'Reading the spec in spec.md');
  assert.equal(ev[2].file, 'src/a.js');
  assert.equal(ev[3].cmd, 'cd . && npm test');
  assert.equal(ev[4].cmd, 'searching TODO');
  assert.equal(ev[5].text, 'All done.');
  assert.deepEqual(ev.map(statusOf), ['thinking', 'thinking', 'editing', 'running a gate', 'running a command', null]);
});

test('codex text events', () => {
  const ev = run(createCodexParser({ root: '/work/demo' }), fx('codex.log'));
  assert.deepEqual(ev.map((e) => e.kind), [
    'thought', 'say', 'say', 'command', 'result', 'command', 'result', 'edit', 'edit', 'error', 'usage']);
  assert.equal(ev[3].cmd, 'cd . && node --test');
  assert.deepEqual([ev[4].ok, ev[4].text], [true, '12ms']);
  assert.deepEqual([ev[6].ok, ev[6].text], [false, '1 3ms']);
  assert.equal(ev[7].file, 'src/a.js');
  assert.match(ev[9].text, /^ERROR/);
  assert.equal(statusOf(ev[3]), 'running a gate');
  assert.equal(statusOf(ev[5]), 'running a command');
});

test('root stripping leaves sibling worktree names alone', () => {
  const ev = createClaudeParser({ root: '/work/demo' }).feed(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cd /work/demo-q1; ls /work/demo' } }] },
  }));
  assert.equal(ev[0].cmd, 'cd /work/demo-q1; ls .');
});

test('format detection', () => {
  const claude = run(createLogParser({ root: '' }), fx('claude.jsonl'));
  const codex = run(createLogParser({ root: '' }), fx('codex.log'));
  assert.equal(claude[0].kind, 'say');
  assert.equal(codex[0].kind, 'thought');
});
