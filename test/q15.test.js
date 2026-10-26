import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaudeParser } from '../src/parse-claude.js';
import { createCodexParser } from '../src/parse-codex.js';
import { createLogParser } from '../src/parse-log.js';
import { Facts } from '../src/facts.js';
import { LogFollower } from '../src/follow.js';
import { coderTile } from '../src/tiles.js';
import { agentRows, moreText } from '../public/lobby-rows.js';
import { buildCards } from '../public/lobby.js';
import { hudParts } from '../public/hud.js';
import { fmtTokens, fmtCost, hudMeterText, tileMeterText, meterTitle, dayTotalsText } from '../public/tokens.js';

const j = (o) => JSON.stringify(o);
const use = (name, input, id = 'u1') => ({ type: 'tool_use', name, input, id });
const usage = (i, o, cr = 0, cw = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
const asst = (content, id, u) => j({ type: 'assistant', message: { ...(id ? { id } : {}), content: [].concat(content), ...(u ? { usage: u } : {}) } });
const text = (t) => ({ type: 'text', text: t });
const feedAll = (lines, opts) => {
  const p = createClaudeParser(opts);
  const f = new Facts();
  lines.forEach((l, i) => { for (const e of p.feed(l)) f.push(e, i + 1); });
  return f;
};
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'q15-'));

// ---- item 1a: final message once ----

test('final message: the result drops the identical say and keeps the done block', () => {
  const f = feedAll([asst(text('All done.\n\nGates pass.')), j({ type: 'result', result: 'All done.\n\nGates pass.\n' })]);
  assert.deepEqual(f.events.map((e) => e.kind), ['done']);
  assert.equal(f.ended, 'All done. Gates pass.');
  assert.ok(!('dup' in f.events[0]));
  assert.equal(f.caption, 'All done.\n\nGates pass.'.replace(/\s+/g, ' '));
});

test('final message: different texts both stay; a say before other work is not dropped', () => {
  const diff = feedAll([asst(text('Almost there.')), j({ type: 'result', result: 'Finished.' })]);
  assert.deepEqual(diff.events.map((e) => e.kind), ['say', 'done']);
  const busy = feedAll([asst(text('Same.')), asst(use('Bash', { command: 'ls' })), j({ type: 'result', result: 'Same.' })]);
  assert.deepEqual(busy.events.map((e) => e.kind), ['say', 'command', 'done']);
});

// ---- item 1b: checklist ----

test('checklist: Task* calls are no rows; one "☑ checklist 3/5" row per change; status untouched', () => {
  const lines = [asst(use('Bash', { command: 'ls' }, 'b1'))];
  for (const s of ['a', 'b', 'c', 'd', 'e']) lines.push(asst(use('TaskCreate', { subject: s })));
  const f = feedAll(lines);
  assert.equal(f.activity, 'running a command');
  assert.deepEqual(f.events.filter((e) => e.kind === 'todo').map((e) => e.text), ['☑ checklist 0/1', '☑ checklist 0/2', '☑ checklist 0/3', '☑ checklist 0/4', '☑ checklist 0/5']);
  assert.ok(!f.events.some((e) => e.kind === 'command' && /checklist/.test(e.text)));
  const g = feedAll([
    ...['a', 'b', 'c'].map((s) => asst(use('TaskCreate', { subject: s }))),
    asst(use('TaskUpdate', { taskId: '1', status: 'in_progress' })),
    asst(use('TaskUpdate', { taskId: '1', status: 'completed' })),
    asst(use('TaskUpdate', { taskId: '1', status: 'completed' })),
    asst(use('TaskUpdate', { taskId: '2', status: 'completed' })),
  ]);
  assert.deepEqual(g.events.map((e) => e.text).slice(-2), ['☑ checklist 1/3', '☑ checklist 2/3']);
  assert.equal(g.events.filter((e) => e.text === '☑ checklist 1/3').length, 1);
  assert.equal(g.activity, null);
  assert.deepEqual(g.checklist().map((c) => c.status), ['done', 'done', 'todo']);
});

test('checklist: TodoWrite gives a row only when the counts change, status stays as before', () => {
  const todo = (...st) => asst(use('TodoWrite', { todos: st.map((s, i) => ({ content: `t${i}`, status: s })) }));
  const f = feedAll([
    asst(text('hi')), todo('in_progress', 'pending'), todo('pending', 'in_progress'), todo('completed', 'pending'),
  ]);
  assert.deepEqual(f.events.filter((e) => e.kind === 'todo').map((e) => e.text), ['☑ checklist 0/2', '☑ checklist 1/2']);
  assert.equal(f.activity, 'thinking');
});

// ---- item 1c: lobby rows ----

const agent = (id, status, extra = {}) => ({ id, name: id, color: '#fff', status, startedAt: 1000, current: `${id}.js`, ...extra });

test('lobby rows: up to 4, working first, "+N more", pure', () => {
  const now = 1000 + 7 * 60_000;
  const six = [agent('a', 'done', { endedAt: 61_000 }), agent('b', 'thinking'), agent('c', 'done', { endedAt: 5000 }), agent('d', 'editing', { lastActivity: 9 }),
    agent('e', 'done', { endedAt: 90_000 }), agent('f', 'refused', { endedAt: 3000 })];
  const copy = JSON.stringify(six);
  const { rows, more } = agentRows(six, now);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id).sort(), ['b', 'd']);
  assert.equal(more, 2);
  assert.equal(moreText(more), '+2 more');
  assert.equal(moreText(0), '');
  assert.equal(JSON.stringify(six), copy);
  assert.equal(rows.find((r) => r.id === 'b').elapsed, '7m');
  assert.equal(rows.find((r) => r.id === 'b').line, 'b.js');
  assert.deepEqual(agentRows([agent('x', 'thinking')], now).more, 0);
});

// ---- item 2: formatters ----

test('formatters: 950, 12.3k, 210k, 1.2M and $0.84', () => {
  assert.deepEqual([950, 12_300, 210_000, 1_200_000, 0, 999_999, 1000].map(fmtTokens), ['950', '12.3k', '210k', '1.2M', '0', '1M', '1k']);
  assert.equal(fmtCost(0.84), '$0.84');
  assert.equal(fmtCost(3.1), '$3.10');
  assert.equal(fmtCost(null), null);
  assert.equal(fmtCost(0.001), '<$0.01');
});

test('meters: HUD, tile, tooltip, lobby totals', () => {
  const u = { in: 900, out: 12_300, cr: 1_100_000, cw: 100_000, ctx: 1_200_900, cost: 0.84, final: true, partial: false, models: [{ name: 'm1', in: 900, out: 12_300, cr: 1_100_000, cw: 100_000, cost: 0.84 }] };
  assert.equal(hudMeterText(u), '↑ 12.3k out · 1.2M ctx · $0.84');
  assert.equal(tileMeterText(u), '↑12.3k · $0.84');
  assert.match(meterTitle(u), /^m1: input 900 · output 12\.3k · cache read 1\.1M · cache write 100k · \$0\.84$/);
  const run = { ...u, cost: null, final: false, partial: true, models: [] };
  assert.equal(hudMeterText(run), '↑ ≥12.3k out · ≥1.2M ctx');
  assert.equal(tileMeterText(run), '↑≥12.3k');
  assert.equal(tileMeterText(null, true), '—');
  assert.equal(tileMeterText(null, false), '');
  assert.equal(tileMeterText({ total: 4821, final: true }), '4.8k tok');
  const tiles = [
    { kind: 'coder', startedAt: 100, status: 'done', usage: { out: 100_000, cost: 1.5 } },
    { kind: 'coder', startedAt: 200, status: 'done', usage: { out: 110_000, cost: 1.6 } },
    { kind: 'coder', startedAt: 300, status: 'thinking', usage: { out: 1000, cost: null } },
    { kind: 'coder', startedAt: 5, status: 'done', usage: { out: 9_000_000, cost: 9 } },
    { kind: 'orchestrator', status: 'thinking', usage: { out: 50_000 } },
  ];
  assert.equal(dayTotalsText(3, tiles, 50), '3 rounds · 211k out · $3.10');
  assert.equal(dayTotalsText(0, [], 0), '0 rounds');
  const { cards } = buildCards([{ name: 'p' }], tiles.map((t) => ({ ...t, project: 'p' })), new Set(), 50);
  assert.equal(cards[0].totals, '3 rounds · 211k out · $3.10');
  const parts = hudParts({ project: 'p', status: 'thinking', checklist: [], gates: [], usage: u }, 0);
  assert.equal(parts.find((p) => p.key === 'tokens').text, '↑ 12.3k out · 1.2M ctx · $0.84');
});

// ---- item 2: usage on the server side ----

test('usage: a message id is counted once across streamed parts; running sum', () => {
  const f = feedAll([
    asst(text('one'), 'm1', usage(10, 5, 1000, 200)),
    asst(use('Bash', { command: 'ls' }), 'm1', usage(10, 5, 1000, 200)),
    asst(text('two'), 'm2', usage(20, 7, 500, 0)),
  ]);
  assert.deepEqual(f.usage(), { in: 30, out: 12, cr: 1500, cw: 200, ctx: 1730, cost: null, models: [], final: false, partial: false });
  assert.equal(feedAll([asst(text('x'))]).usage(), null);
});

test('usage: the result replaces the sum with modelUsage totals and takes the cost', () => {
  const f = feedAll([
    asst(text('one'), 'm1', usage(10, 5, 1000, 200)),
    j({
      type: 'result', result: 'ok', total_cost_usd: 0.84,
      modelUsage: {
        a: { inputTokens: 100, outputTokens: 2000, cacheReadInputTokens: 5000, cacheCreationInputTokens: 300, costUSD: 0.8 },
        b: { inputTokens: 1, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.04 },
      },
    }),
    asst(text('late'), 'm9', usage(999, 999)),
  ]);
  const u = f.usage();
  assert.deepEqual([u.in, u.out, u.cr, u.cw, u.ctx, u.cost, u.final], [101, 2020, 5000, 300, 5401, 0.84, true]);
  assert.deepEqual(u.models.map((m) => [m.name, m.out, m.cost]), [['a', 2000, 0.8], ['b', 20, 0.04]]);
});

test('usage: a log read from a tail start is partial until the result; a full read is exact', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'r.log');
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(asst(text(`step ${i} ${'x'.repeat(200)}`), `m${i}`, usage(1, 10)));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const tail = new LogFollower(file, dir, { tailBytes: 4096 });
  await tail.poll();
  const part = tail.facts.usage();
  assert.equal(part.partial, true);
  assert.ok(part.out > 0 && part.out < 2000);
  const whole = new LogFollower(file, dir);
  await whole.poll();
  assert.equal(whole.facts.usage().partial, false);
  assert.equal(whole.facts.usage().out, 2000);
  fs.appendFileSync(file, `${j({ type: 'result', result: 'x', total_cost_usd: 1.25, modelUsage: { m: { inputTokens: 1, outputTokens: 4000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`);
  await tail.poll();
  const fin = tail.facts.usage();
  assert.deepEqual([fin.out, fin.cost, fin.final, fin.partial], [4000, 1.25, true, false]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('usage: Codex "tokens used" gives the total, none while running', () => {
  const p = createLogParser({});
  const f = new Facts();
  const feed = (l) => { for (const e of p.feed(l)) f.push(e, 1); };
  for (const l of ['codex', 'Working on it.', 'exec', '/bin/bash -lc "ls" in /w']) feed(l);
  assert.equal(f.usage(), null);
  for (const l of ['tokens used', '12,345']) feed(l);
  assert.deepEqual(f.usage(), { total: 12_345, final: true, partial: false });
  assert.deepEqual(createCodexParser().feed('tokens used'), []);
  const same = createCodexParser().feed('tokens used: 999');
  assert.equal(same[0].total, 999);
});

test('usage: orchestrator transcripts give tokens only, never a cost', () => {
  const f = feedAll([
    j({ type: 'user', message: { content: 'go' } }),
    asst(text('on it'), 'o1', usage(5, 50, 2000, 100)),
    asst(text('again'), 'o2', usage(5, 30, 2100, 0)),
  ], { orchestrator: true });
  const u = f.usage();
  assert.deepEqual([u.out, u.ctx, u.cost], [80, 4210, null]);
  assert.equal(hudMeterText(u), '↑ 80 out · 4.2k ctx');
});

test('usage: the tile carries usage and the chain stays JSON-clean', () => {
  const f = feedAll([asst(text('one'), 'm1', usage(1, 2))]);
  const r = { slot: 's', id: 's@p', name: 'N', color: '#fff', project: 'p', round: 'q1', role: 'coder', startedAt: 1, endedAt: null };
  const tile = coderTile(r, { facts: f, current: null, grewAt: 1 }, { spec: null, report: null }, { status: 'thinking', quiet: null });
  assert.equal(tile.usage.out, 2);
  assert.equal(JSON.parse(JSON.stringify(tile)).usage.ctx, 1);
});
