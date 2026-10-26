import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripRoundId } from '../public/history.js';
import { thoughtsHeading, footerState } from '../public/stream.js';

test('stripRoundId drops a leading round id and its separator', () => {
  assert.equal(stripRoundId('q16 — Round history and replay', 'q16'), 'Round history and replay');
  assert.equal(stripRoundId('q05b: Y', 'q05b'), 'Y');
  assert.equal(stripRoundId('q05b - Y', 'q05b'), 'Y');
  assert.equal(stripRoundId('Q16 — Case', 'q16'), 'Case');
});

test('stripRoundId leaves titles without the round id alone', () => {
  assert.equal(stripRoundId('Round history', 'q16'), 'Round history');
  assert.equal(stripRoundId('q160 — Other', 'q16'), 'q160 — Other');
  assert.equal(stripRoundId('q16', 'q16'), 'q16');
  assert.equal(stripRoundId('Project goal', null), 'Project goal');
  assert.equal(stripRoundId('', 'q16'), '');
  assert.equal(stripRoundId(undefined, 'q16'), '');
});

test('replay thoughts panel: round heading, no live indicator, no new pill', () => {
  assert.equal(thoughtsHeading({ replay: true, round: 'q16' }), 'Thoughts · q16');
  assert.equal(thoughtsHeading({ round: 'q16' }), 'Live thoughts');
  assert.equal(thoughtsHeading(null), 'Live thoughts');
  assert.deepEqual(footerState({ replay: true, round: 'q16' }, false, 50, 10), { label: '', live: false, pill: 0 });
  assert.deepEqual(footerState({ replay: true, round: 'q16' }, true, 50, 10), { label: '', live: false, pill: 0 });
});

test('live thoughts panel keeps the live and paused footer', () => {
  assert.deepEqual(footerState({}, true, 5, 5), { label: '● Live', live: true, pill: 0 });
  assert.deepEqual(footerState({}, false, 9, 5), { label: '❚❚ Paused', live: false, pill: 4 });
});
