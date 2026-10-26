import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.js';
import { buildRoundList, fixRoundOf, groupAttempts, MAX_ROUNDS } from '../src/history.js';
import { parseChainLines } from '../src/parse-chain.js';
import { usageFromLines, logUsage, clearUsageCache, usageCacheSize, USAGE_TAIL_BYTES } from '../src/log-usage.js';
import { parseRoute, routeHash } from '../public/route.js';
import {
  barWidths, totals, totalsText, filterRows, codersOf, moveIndex, outcomeChip, rowStats,
} from '../public/history.js';

const j = (o) => JSON.stringify(o);
const MTIME = new Date(2026, 9, 26, 0, 30).getTime();
const NOW = MTIME + 60_000;
const result = (cost, out, turns = 7) => j({
  type: 'result', result: 'ok', total_cost_usd: cost, num_turns: turns,
  modelUsage: { 'claude-sonnet-5-5': { inputTokens: 10, outputTokens: out, cacheReadInputTokens: 500, cacheCreationInputTokens: 20, costUSD: cost } },
});
const asst = (text) => j({ type: 'assistant', message: { id: `m${Math.random()}`, content: [{ type: 'text', text }] } });
const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

// ---- round list ----

const CHAIN = [
  'coder q01 started 22:00 on claude3 sonnet',
  'coder q01 LIMIT 22:05 on claude3',
  'coder q01 started 23:00 on claude3 sonnet',
  'coder q01 finished 23:30 rc=0 on claude3',
  'review q01 started 23:35 on claude3 sonnet',
  'review q01 finished 23:36 rc=0 on claude3',
  'coder q02 started 23:40 on claude3 sonnet',
  'coder q02 finished 00:10 rc=1 on claude3',
  'some free text line',
  'coder q03 started 00:20 on claude3 sonnet',
  'coder q04 started 00:25 on claude3 sonnet',
  'coder q04 REFUSED 00:26: no quota left',
];

test('round list: attempts, outcomes, fix round, dates across midnight, newest first', () => {
  const names = new Set(['q01.md', 'q01-report.md', 'q02.md', 'q02b.md']);
  const rows = buildRoundList(CHAIN, MTIME, names, NOW);
  assert.deepEqual(rows.map((r) => r.round), ['q04', 'q03', 'q02', 'q01']);
  const by = Object.fromEntries(rows.map((r) => [r.round, r]));
  assert.deepEqual(by.q01.attempts.map((a) => [a.role, a.outcome]), [['coder', 'limit'], ['coder', 'done'], ['review', 'done']]);
  assert.equal(by.q01.outcome, 'done');
  assert.equal(by.q01.role, 'coder');
  assert.equal(by.q01.durationMs, 30 * 60_000);
  assert.equal(by.q01.hasReport, true);
  assert.equal(by.q01.fix, null);
  assert.equal(new Date(by.q01.startedAt).getDate(), 25);
  assert.equal(new Date(by.q01.endedAt).getDate(), 25);
  assert.equal(by.q02.outcome, 'failed');
  assert.equal(by.q02.rc, 1);
  assert.equal(by.q02.fix, 'q02b');
  assert.equal(by.q02.durationMs, 30 * 60_000);
  assert.equal(new Date(by.q02.startedAt).getDate(), 25);
  assert.equal(new Date(by.q02.endedAt).getDate(), 26);
  assert.equal(by.q03.outcome, 'running');
  assert.equal(by.q03.endedAt, null);
  assert.equal(by.q03.durationMs, NOW - by.q03.startedAt);
  assert.equal(by.q04.outcome, 'refused');
  assert.equal(by.q04.reason, 'no quota left');
  assert.equal(by.q04.who.id, 'claude3');
});

test('round list: a LIMIT then rerun is two attempts; an unfinished start before a rerun is interrupted', () => {
  const ev = parseChainLines([
    'coder q07 started 10:00 on claude3 sonnet',
    'coder q07 started 10:10 on claude3 sonnet',
    'coder q07 finished 10:20 rc=0 on claude3',
  ], new Date(2026, 9, 26, 11, 0).getTime());
  const a = groupAttempts(ev).get('q07');
  assert.deepEqual(a.map((x) => x.outcome), ['interrupted', 'done']);
});

test('round list: capped at 200, newest first', () => {
  const lines = [];
  for (let i = 0; i < 250; i++) {
    const n = String(i).padStart(3, '0');
    lines.push(`coder r${n} started 10:00 on claude3 sonnet`, `coder r${n} finished 10:01 rc=0 on claude3`);
  }
  const rows = buildRoundList(lines, MTIME, new Set(), NOW);
  assert.equal(rows.length, MAX_ROUNDS);
  assert.equal(rows[0].round, 'r249');
  assert.equal(rows.at(-1).round, 'r050');
});

test('fix round: first existing letter after the round id', () => {
  assert.equal(fixRoundOf('q05', new Set(['q05b.md', 'q05c.md'])), 'q05b');
  assert.equal(fixRoundOf('q05b', new Set(['q05b.md', 'q05c.md'])), 'q05c');
  assert.equal(fixRoundOf('q06', new Set(['q06.md'])), null);
});

// ---- tokens / cost ----

test('usage from a log tail: Claude result, Codex totals, nothing', () => {
  const c = usageFromLines([asst('hi'), result(0.5, 1234, 9)]);
  assert.deepEqual([c.out, c.cost, c.turns, c.incomplete, c.ctx], [1234, 0.5, 9, false, 530]);
  const x = usageFromLines(['codex', 'working', 'tokens used', '12,345', 'done']);
  assert.deepEqual([x.total, x.incomplete, x.out], [12345, false, null]);
  const same = usageFromLines(['tokens used: 777']);
  assert.equal(same.total, 777);
  const none = usageFromLines([asst('still working')]);
  assert.deepEqual([none.incomplete, none.out, none.cost], [true, null, null]);
  assert.equal(usageFromLines([]).incomplete, true);
});

test('usage of a log file: only the last 256 KB is read, and the result is cached by size and mtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q16-u-'));
  const file = path.join(dir, 'a.log');
  const filler = asst('x'.repeat(900));
  const head = Array(Math.ceil((USAGE_TAIL_BYTES * 3) / filler.length)).fill(filler);
  fs.writeFileSync(file, [result(9, 9999), ...head].join('\n') + '\n');
  clearUsageCache();
  assert.equal((await logUsage(file)).incomplete, true);
  fs.writeFileSync(file, [...head, result(0.25, 321)].join('\n') + '\n');
  const a = await logUsage(file);
  assert.deepEqual([a.out, a.cost, a.incomplete], [321, 0.25, false]);
  assert.equal(await logUsage(file), a);
  assert.equal(usageCacheSize(), 1);
  fs.appendFileSync(file, result(0.75, 654) + '\n');
  const b = await logUsage(file);
  assert.notEqual(b, a);
  assert.equal(b.out, 654);
  assert.equal((await logUsage(path.join(dir, 'missing.log'))).incomplete, true);
  fs.rmSync(dir, { recursive: true });
});

// ---- endpoints ----

function makeProject() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q16-p-'));
  const dir = path.join(base, 'histproj');
  const runs = path.join(dir, '.rounds');
  fs.mkdirSync(runs, { recursive: true });
  const day = new Date();
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const t0 = new Date(day.getTime() - 3 * 3_600_000);
  const t1 = new Date(day.getTime() - 2 * 3_600_000);
  const t2 = new Date(day.getTime() - 1 * 3_600_000);
  fs.writeFileSync(path.join(runs, 'chain.log'), [
    `coder q01 started ${hm(t0)} on claude3 sonnet`, `coder q01 finished ${hm(t1)} rc=0 on claude3`,
    `coder q02 started ${hm(t1)} on claude3 sonnet`, `coder q02 finished ${hm(t2)} rc=0 on claude3`,
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(runs, 'q01.md'), '# q01 — first round\n\n## Goal\nDo the first thing.\n\n## Items\n### One\n### Two\n');
  fs.writeFileSync(path.join(runs, 'q01b.md'), '# q01b — fix\n');
  fs.writeFileSync(path.join(runs, 'q01-report.md'), ['# Report', ...Array.from({ length: 60 }, (_, i) => `line ${i}`)].join('\n'));
  fs.writeFileSync(path.join(runs, 'q01.log'), [asst('start'), result(1.5, 4321)].join('\n') + '\n');
  const filler = asst('y'.repeat(800));
  const lines = Array.from({ length: 5000 }, (_, i) => asst(`say ${i} ${'y'.repeat(700)}`));
  fs.writeFileSync(path.join(runs, 'q02.log'), [...lines, filler, result(0.5, 100)].join('\n') + '\n');
  return { base, dir };
}

test('/api/rounds and /api/round: list, validation, bounded details', async () => {
  const { base, dir } = makeProject();
  const srv = await startServer({ port: 0, roots: [dir], claudeProjects: path.join(base, 'cp'), home: base });
  try {
    const list = JSON.parse((await get(srv.port, '/api/rounds?project=histproj')).body);
    assert.deepEqual(list.rounds.map((r) => r.round), ['q02', 'q01']);
    const q1 = list.rounds[1];
    assert.equal(q1.title, 'q01 — first round');
    assert.equal(q1.fix, 'q01b');
    assert.equal(q1.hasReport, true);
    assert.deepEqual([q1.tokens.out, q1.tokens.cost, q1.tokens.turns], [4321, 1.5, 7]);
    assert.equal(list.rounds[0].tokens.out, 100);

    assert.equal((await get(srv.port, '/api/rounds?project=nope')).status, 404);
    assert.equal((await get(srv.port, '/api/rounds')).status, 404);
    assert.equal((await get(srv.port, '/api/round?project=histproj&round=' + encodeURIComponent('../x'))).status, 400);
    assert.equal((await get(srv.port, '/api/round?project=histproj&round=')).status, 400);
    assert.equal((await get(srv.port, '/api/round?project=histproj&round=' + 'a'.repeat(41))).status, 400);
    assert.equal((await get(srv.port, '/api/round?project=histproj&round=q99')).status, 404);
    assert.equal((await get(srv.port, '/api/round?project=nope&round=q01')).status, 404);

    const one = JSON.parse((await get(srv.port, '/api/round?project=histproj&round=q01')).body);
    assert.equal(one.goal, 'Do the first thing.');
    assert.equal(one.partial, false);
    assert.equal(one.prev, null);
    assert.equal(one.next, 'q02');
    assert.equal(one.tile.replay, true);
    assert.equal(one.tile.id, 'replay:q01');
    assert.equal(one.tile.status, 'done');
    assert.equal(one.tile.usage.out, 4321);
    assert.equal(one.tile.reportMd.markdown.split('\n').length, 40);
    assert.equal(one.tile.reportMd.more, true);
    assert.deepEqual(one.tile.checklist.map((c) => c.text), ['One', 'Two']);
    assert.ok(one.tile.events.some((e) => e.kind === 'say'));

    const big = JSON.parse((await get(srv.port, '/api/round?project=histproj&round=q02')).body);
    assert.equal(big.partial, true);
    assert.equal(big.prev, 'q01');
    assert.equal(big.next, null);
    assert.ok(big.tile.events.length <= 300 && big.tile.events.length > 100);
    assert.ok(!big.tile.events.some((e) => e.text.startsWith('say 0 ')));
    assert.ok(big.tile.events.some((e) => e.text.startsWith('say 4999 ')));
    assert.equal(big.tile.reportMd, null);
    assert.equal((await get(srv.port, '/api/state')).body.includes('replay:'), false);
  } finally {
    await srv.close();
    fs.rmSync(base, { recursive: true });
  }
});

// ---- UI helpers ----

test('history helpers: bar scaling, totals, filters, outcome chips, selection', () => {
  const rows = [
    { round: 'a', durationMs: 600_000, outcome: 'done', rc: 0, who: { id: 'luna', name: 'Luna' }, fix: 'ab', tokens: { out: 1000, cost: 0.5 } },
    { round: 'b', durationMs: 300_000, outcome: 'failed', rc: 2, who: { id: 'sol', name: 'Sol' }, fix: null, tokens: { out: 500, cost: 0.25 } },
    { round: 'c', durationMs: null, outcome: 'running', rc: null, who: { id: 'luna', name: 'Luna' }, fix: null, tokens: { incomplete: true } },
    { round: 'd', durationMs: 1000, outcome: 'limit', rc: null, who: { id: 'sol', name: 'Sol' }, fix: null, tokens: null },
    { round: 'e', durationMs: 60_000, outcome: 'interrupted', rc: null, who: null, fix: null, tokens: null },
  ];
  assert.deepEqual(barWidths(rows), [100, 50, 0, 4, 10]);
  assert.deepEqual(barWidths([]), []);
  const t = totals(rows);
  assert.deepEqual([t.rounds, t.done, t.fix, t.limit, t.out, t.cost], [5, 1, 1, 1, 1500, 0.75]);
  assert.equal(totalsText(t), '5 rounds · 1 done · 1 fix · 1 limit · 1.5k out · $0.75');
  assert.deepEqual(filterRows(rows, { coders: new Set(['sol']) }).map((r) => r.round), ['b', 'd']);
  assert.deepEqual(filterRows(rows, { outcome: 'failed' }).map((r) => r.round), ['b', 'e']);
  assert.deepEqual(filterRows(rows, { coders: new Set(['luna']), outcome: 'running' }).map((r) => r.round), ['c']);
  assert.deepEqual(filterRows(rows).length, 5);
  assert.deepEqual(codersOf(rows).map((w) => w.id), ['luna', 'sol']);
  assert.deepEqual(outcomeChip(rows[1]), { cls: 'fail', text: '✗ rc 2' });
  assert.equal(outcomeChip(rows[0]).text, '✓');
  assert.equal(outcomeChip(rows[2]).cls, 'run');
  assert.deepEqual(rowStats(rows[0]), { duration: '10m 0s', tokens: '1k out', cost: '$0.50' });
  assert.deepEqual(rowStats(rows[2]), { duration: '', tokens: '', cost: '' });
  assert.equal(moveIndex(-1, 1, 3), 0);
  assert.equal(moveIndex(-1, -1, 3), 2);
  assert.equal(moveIndex(2, 1, 3), 2);
  assert.equal(moveIndex(0, -1, 3), 0);
  assert.equal(moveIndex(0, 1, 0), -1);
});

test('replay and history routes', () => {
  assert.deepEqual(parseRoute('#/p/web/round/q05'), { project: 'web', focus: null, follow: false, round: 'q05' });
  assert.deepEqual(parseRoute('#/p/web?history=1'), { project: 'web', focus: null, follow: true, history: true });
  assert.equal(routeHash({ project: 'web', round: 'q05' }), '#/p/web/round/q05');
  assert.equal(routeHash({ project: 'web', history: true }), '#/p/web?history=1');
  assert.equal(routeHash({ project: 'web', focus: 'luna@web', follow: false, history: true }), '#/p/web/focus/luna%40web?follow=0&history=1');
  const r = { project: 'web', focus: null, follow: false, round: 'q05', history: true };
  assert.deepEqual(parseRoute(routeHash(r)), r);
});
