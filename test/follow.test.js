import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNext, finishText, userBusy } from '../public/follow.js';
import { createFollowMode } from '../public/focus.js';

const t = (id, status, lastActivity = 0, extra = {}) => ({ id, kind: id === 'orchestrator' ? 'orchestrator' : 'coder', name: id, status, lastActivity, ...extra });

test('pickNext: stays on the current agent while it is working', () => {
  for (const s of ['thinking', 'editing', 'running a gate', 'running a command']) {
    const tiles = [t('orchestrator', 'waiting for you'), t('luna', s, 1), t('claude2', 'thinking', 999)];
    assert.equal(pickNext(tiles, 'luna'), 'luna');
  }
});

test('pickNext: a finished agent hands over to the working coder whose log grew most recently', () => {
  const tiles = [t('orchestrator', 'thinking', 500), t('luna', 'done', 900), t('claude2', 'editing', 100), t('claude3', 'thinking', 300)];
  assert.equal(pickNext(tiles, 'luna'), 'claude3');
});

test('pickNext: ties on lastActivity keep list order; missing lastActivity counts as oldest', () => {
  const tied = [t('a', 'done'), t('b', 'thinking', 50), t('c', 'thinking', 50)];
  assert.equal(pickNext(tied, 'a'), 'b');
  const missing = [t('a', 'done'), t('b', 'thinking', null), t('c', 'thinking', 1)];
  assert.equal(pickNext(missing, 'a'), 'c');
});

test('pickNext: the Orchestrator is the fallback when no coder works, also for limits and refusals', () => {
  for (const s of ['done', 'rate-limited', 'refused']) {
    const tiles = [t('orchestrator', 'thinking', 1), t('luna', s, 5), t('claude2', 'done', 9)];
    assert.equal(pickNext(tiles, 'luna'), 'orchestrator');
  }
  const idle = [t('orchestrator', 'waiting for you'), t('luna', 'done')];
  assert.equal(pickNext(idle, 'orchestrator'), 'orchestrator');
});

test('pickNext: a waiting Orchestrator switches to a coder that starts working', () => {
  const tiles = [t('orchestrator', 'waiting for you', 1), t('luna', 'running a gate', 7)];
  assert.equal(pickNext(tiles, 'orchestrator'), 'luna');
  assert.equal(pickNext([t('orchestrator', 'thinking', 1), t('luna', 'thinking', 7)], 'orchestrator'), 'orchestrator');
});

test('pickNext: unknown current id and empty list are safe', () => {
  assert.equal(pickNext([t('orchestrator', 'thinking'), t('luna', 'thinking', 3)], 'gone'), 'luna');
  assert.equal(pickNext([t('luna', 'done')], 'luna'), 'luna');
  assert.equal(pickNext([], 'x'), 'x');
});

test('finishText: finished, failed, limit and still-working cases', () => {
  const base = { name: 'Sonnet · claude3', round: 'q02' };
  assert.equal(finishText({ ...base, status: 'done', rc: 0 }), 'Sonnet · claude3 finished q02 ✓');
  assert.equal(finishText({ ...base, status: 'done', rc: 1 }), 'Sonnet · claude3 failed q02 ✗ rc 1');
  assert.equal(finishText({ ...base, status: 'rate-limited' }), 'Sonnet · claude3 hit its limit');
  assert.equal(finishText({ ...base, status: 'thinking' }), null);
});

test('userBusy: busy for 10 s after the last touch', () => {
  assert.equal(userBusy(null, 100_000), false);
  assert.equal(userBusy(95_000, 100_000), true);
  assert.equal(userBusy(80_000, 100_000), false);
});

function harness(tiles, current) {
  const log = { banner: [], toast: [], switched: [] };
  const state = { tiles, current };
  const mode = createFollowMode({
    getTiles: () => state.tiles, getCurrent: () => state.current, isActive: () => true,
    switchTo: (id) => { log.switched.push(id); state.current = id; },
    setBanner: (x) => log.banner.push(x), setToast: (x) => log.toast.push(x),
  });
  return { mode, log, state };
}

test('follow mode: banner for 4 s, then toast, then the switch', () => {
  const { mode, log } = harness([t('orchestrator', 'thinking'), t('luna', 'done', 1, { round: 'q02', rc: 0 })], 'luna');
  mode.check(0);
  assert.equal(log.banner.at(-1), 'luna finished q02 ✓');
  mode.check(3999);
  assert.deepEqual(log.switched, []);
  assert.equal(log.toast.filter(Boolean).length, 0);
  mode.check(4000);
  assert.equal(log.toast.at(-1), 'Switching to orchestrator…');
  mode.check(6000);
  assert.deepEqual(log.switched, []);
  mode.check(6500);
  assert.deepEqual(log.switched, ['orchestrator']);
});

test('follow mode: Stay (pin) cancels the switch', () => {
  const { mode, log } = harness([t('orchestrator', 'thinking'), t('luna', 'done')], 'luna');
  mode.check(0);
  mode.check(4500);
  mode.setFollowing(false);
  mode.check(9000);
  assert.deepEqual(log.switched, []);
  assert.equal(log.toast.at(-1), null);
});

test('follow mode: the agent working again cancels the pending switch', () => {
  const { mode, log, state } = harness([t('orchestrator', 'thinking'), t('luna', 'done')], 'luna');
  mode.check(0);
  state.tiles = [t('orchestrator', 'thinking'), t('luna', 'thinking')];
  mode.check(5000);
  assert.deepEqual(log.switched, []);
  assert.equal(log.banner.at(-1), null);
});

test('follow mode: waits while the user is busy, then switches', () => {
  const { mode, log } = harness([t('orchestrator', 'thinking'), t('luna', 'done')], 'luna');
  mode.check(0);
  mode.touch(6000);
  mode.check(7000);
  assert.deepEqual(log.switched, []);
  mode.check(16_001);
  assert.deepEqual(log.switched, ['orchestrator']);
});

test('follow mode: a waiting Orchestrator switches at once (no finish banner)', () => {
  const { mode, log } = harness([t('orchestrator', 'waiting for you'), t('luna', 'thinking', 5)], 'orchestrator');
  mode.check(0);
  assert.deepEqual(log.switched, ['luna']);
});
