import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChainLine } from '../src/parse-chain.js';
import { ChainModel, coderStatus, orchestratorStatus, DAY_MS } from '../src/state.js';

const NOW = new Date(2026, 9, 25, 20, 0).getTime();
const P = { name: 'demo', dir: '/p/demo', runsDir: '/p/demo/.codex-runs' };

function model(...lines) {
  const m = new ChainModel();
  for (const l of lines) m.apply(P, parseChainLine(l, NOW));
  return m;
}
const only = (m) => m.recent(NOW)[0];

test('running statuses come from the latest log activity', () => {
  const r = only(model('coder q1 started 19:55 on codex gpt-6-luna'));
  for (const a of ['editing', 'running a gate', 'running a command', 'thinking']) {
    assert.equal(coderStatus(r, a, NOW - 1000, NOW).status, a);
  }
  assert.equal(coderStatus(r, null, NOW - 1000, NOW).status, 'thinking');
});

test('quiet badge after 3 minutes without log growth', () => {
  const r = only(model('coder q1 started 19:00 on claude2 sonnet'));
  assert.equal(coderStatus(r, 'editing', NOW - 2 * 60_000, NOW).quiet, null);
  const q = coderStatus(r, 'editing', NOW - 7 * 60_000, NOW);
  assert.deepEqual([q.status, q.quiet], ['editing', 7]);
});

test('finished is done with rc; ready also means done', () => {
  const f = only(model('coder q1 started 19:00 on codex gpt-6-luna', 'coder q1 finished 19:30 rc=2 on codex gpt-6-luna'));
  assert.equal(coderStatus(f, 'editing', NOW, NOW).status, 'done');
  assert.equal(f.rc, 2);
  const r = only(model('coder q1 started 19:00 on codex gpt-6-luna', 'round q1 ready for orchestrator check 19:20'));
  assert.equal(coderStatus(r, 'editing', NOW, NOW).status, 'done');
});

test('LIMIT after started is rate-limited', () => {
  const r = only(model('coder q1 started 19:00 on claude3 sonnet', 'coder q1 LIMIT 19:10 on claude3'));
  assert.equal(r.slot, 'claude3');
  assert.equal(coderStatus(r, 'editing', NOW, NOW).status, 'rate-limited');
});

test('REFUSED shows refused on the round\'s started slot and keeps the reason', () => {
  const r = only(model('coder q2 started 18:00 on codex gpt-6-luna', 'coder q2 REFUSED 19:00: dirty tree'));
  assert.equal(r.slot, 'luna');
  assert.equal(r.reason, 'dirty tree');
  assert.equal(coderStatus(r, 'editing', NOW, NOW).status, 'refused');
});

test('a new start on the same slot replaces the old round', () => {
  const m = model('coder q1 started 18:00 on codex gpt-6-luna', 'coder q1 finished 18:30 rc=0 on codex gpt-6-luna',
    'coder q2 started 19:00 on codex gpt-6-luna');
  assert.equal(m.recent(NOW).length, 1);
  assert.equal(only(m).round, 'q2');
  assert.equal(only(m).state, 'running');
});

test('one tile per slot and rounds older than 24 h drop out', () => {
  const m = model('coder q1 started 19:00 on codex gpt-6-luna', 'coder q2 started 19:01 on codex gpt-6-sol',
    'coder q3 started 19:02 on claude2 sonnet');
  assert.deepEqual(m.recent(NOW).map((r) => r.slot).sort(), ['claude2', 'luna', 'sol']);
  assert.equal(m.recent(NOW + DAY_MS + 3 * 3600_000).length, 0);
});

test('orchestrator without a turn-end line waits after 2 minutes of silence', () => {
  const turn = { seen: false, open: true, workAt: null };
  assert.equal(orchestratorStatus({ turn, activity: 'editing', grewAt: NOW - 30_000 }, [], NOW).status, 'editing');
  assert.equal(orchestratorStatus({ turn, activity: 'editing', grewAt: NOW - 3 * 60_000 }, [], NOW).status, 'waiting for you');
  assert.equal(orchestratorStatus({ turn, activity: null, grewAt: 0 }, [], NOW).status, 'waiting for you');
});
