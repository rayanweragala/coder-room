import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHash, stepProject } from '../public/route.js';
import { fitGrid } from '../public/fit.js';
import { isLong } from '../public/chat.js';
import { summaryText, failedGateText } from '../public/util.js';
import { recentItems } from '../public/recent.js';

test('routes: lobby, room and full screen round-trip through the hash', () => {
  assert.deepEqual(parseRoute(''), { project: null, focus: null, follow: true });
  assert.deepEqual(parseRoute('#/'), { project: null, focus: null, follow: true });
  assert.deepEqual(parseRoute('#/p/dwesk-crm'), { project: 'dwesk-crm', focus: null, follow: true });
  const r = { project: 'my proj', focus: 'luna@my proj', follow: false };
  assert.equal(routeHash(r), '#/p/my%20proj/focus/luna%40my%20proj?follow=0');
  assert.deepEqual(parseRoute(routeHash(r)), r);
  assert.equal(routeHash({ project: null }), '#/');
  assert.deepEqual(parseRoute('#/p/%E0%A4%A'), { project: null, focus: null, follow: true });
});

test('routes: [ and ] step through the projects and wrap', () => {
  assert.deepEqual(['a', 'b', 'c'].map((n) => stepProject(['a', 'b', 'c'], n, 1)), ['b', 'c', 'a']);
  assert.equal(stepProject(['a', 'b'], 'a', -1), 'b');
  assert.equal(stepProject(['a', 'b'], null, 1), 'a');
  assert.equal(stepProject(['a', 'b'], null, -1), 'b');
  assert.equal(stepProject([], null, 1), null);
});

test('fit: tiles never overflow at the three window sizes, from one tile to twelve', () => {
  for (const [w, h] of [[1580, 800], [1200, 520], [940, 520]]) {
    for (let n = 1; n <= 12; n++) {
      const g = fitGrid(w, h, n, { extra: 100, gap: 12 });
      assert.ok(g.cols * g.rows >= n, `${w}x${h} n=${n}`);
      assert.ok(g.cols * g.cellW + (g.cols - 1) * 12 <= w + 0.5);
      assert.ok(g.rows * g.cellH + (g.rows - 1) * 12 <= h + 0.5);
    }
  }
  assert.equal(fitGrid(1580, 800, 1).cols, 1);
  assert.equal(fitGrid(100, 100, 0).cols, 1);
  assert.ok(fitGrid(1580, 800, 6).cols >= 2);
});

test('chat: only messages over six lines get a "more" fold', () => {
  assert.equal(isLong('short'), false);
  assert.equal(isLong('1\n2\n3\n4\n5\n6'), false);
  assert.equal(isLong('1\n2\n3\n4\n5\n6\n7'), true);
  assert.equal(isLong('word '.repeat(60)), true);
});

test('tile summary: progress and files only; a failed gate is its own line', () => {
  const t = { checklist: [{ status: 'done' }, { status: 'todo' }], files: [{}], gates: [{ cmd: 'npm test', status: 'fail' }] };
  assert.equal(summaryText(t), '1/2 ✓ · 1 file');
  assert.equal(failedGateText(t), 'gate ✗ npm test');
  assert.equal(failedGateText({ gates: [{ cmd: 'x', status: 'ok' }] }), null);
});

test('recent items: thoughts and says only when fill is off', () => {
  const ev = [{ n: 1, kind: 'thought', text: 'a' }, { n: 2, kind: 'edit', file: 'f.js' }, { n: 3, kind: 'say', text: 'b' }, { n: 4, kind: 'command', text: 'ls' }];
  assert.deepEqual(recentItems(ev, 3, false).map((i) => i.n), [1, 3]);
});
