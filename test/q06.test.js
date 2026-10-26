import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEvents, isLong, newCount } from '../public/stream.js';
import { plainText } from '../public/markdown.js';

const e = (n, kind, at) => ({ n, kind, at, text: `t${n}` });

test('stream groups consecutive same-kind items within 60 s', () => {
  const g = groupEvents([e(1, 'thought', 1000), e(2, 'thought', 50_000), e(3, 'thought', 120_000), e(4, 'say', 121_000), e(5, 'intent', 122_000)]);
  assert.deepEqual(g.map((x) => [x.kind, x.items.length]), [['thought', 2], ['thought', 1], ['said', 2]]);
  assert.equal(g[0].at, 1000);
});

test('stream groups items of unknown time by kind alone; other kinds split blocks', () => {
  const g = groupEvents([e(1, 'thought', null), e(2, 'thought', 5), e(3, 'command', 6), e(4, 'thought', 7)]);
  assert.deepEqual(g.map((x) => x.kind), ['thought', 'command', 'thought']);
  assert.deepEqual(groupEvents([]), []);
});

test('items over 6 lines fold', () => {
  assert.equal(isLong('short'), false);
  assert.equal(isLong(Array(6).fill('x').join('\n')), false);
  assert.equal(isLong(Array(7).fill('x').join('\n')), true);
  assert.equal(isLong('x'.repeat(75 * 6)), false);
  assert.equal(isLong('x'.repeat(75 * 6 + 1)), true);
});

test('new-since-scrolled-up counter', () => {
  assert.equal(newCount(10, null), 0);
  assert.equal(newCount(10, 10), 0);
  assert.equal(newCount(13, 10), 3);
  assert.equal(newCount(8, 10), 0);
});

test('grid preview text is one plain line', () => {
  assert.equal(plainText('**Checking** `src/a.js`'), 'Checking src/a.js');
});
