import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, DIFF_LINES } from '../src/events.js';
import { createClaudeParser } from '../src/parse-claude.js';
import { Facts } from '../src/facts.js';
import { sparkBuckets, sparkTitle } from '../public/spark.js';
import {
  filterEvents, resultChip, foldEdits, editFoldText, groupEvents, atBottom, anchorOf, anchoredTop,
} from '../public/stream.js';
import { hudParts } from '../public/hud.js';
import { editView, resultFlash, cmdLine } from '../public/monitor.js';

const MIN = 60_000;
const NOW = 1_700_000_000_000;

test('sparkline: 15 per-minute buckets, oldest first, untimed and out-of-window events ignored', () => {
  const ev = [
    { kind: 'thought', at: NOW - 5_000 },
    { kind: 'edit', at: NOW - 10_000 },
    { kind: 'command', at: NOW - MIN - 1 },
    { kind: 'say', at: NOW - 14 * MIN },
    { kind: 'say', at: NOW - 15 * MIN - 1 },
    { kind: 'thought' },
    { kind: 'user', at: NOW },
    { kind: 'thought', at: NOW + MIN },
  ];
  const c = sparkBuckets(ev, NOW);
  assert.equal(c.length, 15);
  assert.equal(c[14], 2);
  assert.equal(c[13], 1);
  assert.equal(c[0], 1);
  assert.equal(c.reduce((a, b) => a + b, 0), 4);
  assert.deepEqual(sparkBuckets([], NOW), new Array(15).fill(0));
});

test('sparkline tooltip: count and time since the last activity', () => {
  const ev = [{ kind: 'edit', at: NOW - 30_000 }, { kind: 'thought', at: NOW - 3 * MIN }];
  assert.equal(sparkTitle(sparkBuckets(ev, NOW), ev, NOW), '2 events in the last 15 min · last activity 30s ago');
  assert.match(sparkTitle(new Array(15).fill(0), [], NOW), /^0 events in the last 15 min · no activity yet$/);
});

test('edit rows: consecutive edits within 60 s group, then fold into a file count with +/−', () => {
  const edits = [
    { n: 1, kind: 'edit', at: NOW, file: 'a.js', add: 10, del: 2 },
    { n: 2, kind: 'edit', at: NOW + 20_000, file: 'b.js', add: 30, del: 7 },
    { n: 3, kind: 'edit', at: NOW + 40_000, file: 'a.js', add: 1, del: 0 },
    { n: 4, kind: 'edit', at: NOW + 200_000, file: 'c.js', add: 5, del: 5 },
  ];
  const groups = groupEvents(edits);
  assert.deepEqual(groups.map((g) => g.items.length), [3, 1]);
  assert.deepEqual(foldEdits(groups[0].items), { files: 2, add: 41, del: 9 });
  assert.equal(editFoldText(groups[0].items), '✎ 2 files · +41 −9');
  assert.equal(editFoldText([edits[3]]), '✎ 1 file · +5 −5');
  assert.equal(editFoldText([{ n: 9, kind: 'edit', file: 'x' }, edits[0]]), '✎ 2 files');
});

test('command rows: result chip maps ok, exit code and running', () => {
  assert.deepEqual(resultChip({ ok: true }), { cls: 'ok', text: '✓' });
  assert.deepEqual(resultChip({ ok: false }), { cls: 'fail', text: '✗' });
  assert.deepEqual(resultChip({ ok: false, exit: 2 }), { cls: 'fail', text: '✗ 2' });
  assert.deepEqual(resultChip({}, true), { cls: 'run', text: '' });
  assert.deepEqual(resultChip({}, false), { cls: 'none', text: '' });
});

test('thought filter: case-insensitive substring over text, file and command; empty keeps all', () => {
  const ev = [
    { kind: 'thought', text: 'Reading the Parser' },
    { kind: 'edit', text: 'src/a.js', file: 'src/a.js' },
    { kind: 'command', text: 'npm test', cmd: 'npm test' },
    { kind: 'say', text: 'a.b (c)' },
  ];
  assert.equal(filterEvents(ev, '').length, 4);
  assert.equal(filterEvents(ev, '  ').length, 4);
  assert.deepEqual(filterEvents(ev, 'PARSER').map((e) => e.kind), ['thought']);
  assert.deepEqual(filterEvents(ev, 'src/a').map((e) => e.kind), ['edit']);
  assert.deepEqual(filterEvents(ev, 'npm').map((e) => e.kind), ['command']);
  assert.deepEqual(filterEvents(ev, 'a.b (').map((e) => e.kind), ['say']);
  assert.equal(filterEvents(ev, '.*').length, 0);
});

test('scroll anchoring: bottom detection and keeping the first visible block in place', () => {
  assert.equal(atBottom(975, 500, 1500), true);
  assert.equal(atBottom(970, 500, 1500), false);
  assert.equal(atBottom(400, 500, 1500), false);
  const tops = [['1', 0, 100], ['2', 100, 300], ['3', 400, 100]];
  assert.deepEqual(anchorOf(tops, 150), { key: '2', offset: -50 });
  assert.deepEqual(anchorOf(tops, 0), { key: '1', offset: 0 });
  assert.equal(anchorOf(tops, 900), null);
  assert.equal(anchoredTop(260, -50), 310);
  assert.equal(anchoredTop(10, 80), 0);
});

test('HUD: round, ticking elapsed, checklist only when present, last gate mark', () => {
  const t = {
    round: 'q07', status: 'thinking', startedAt: NOW - 12 * MIN, endedAt: null,
    checklist: [{ status: 'done' }, { status: 'doing' }], gates: [{ cmd: 'x', status: 'ok' }, { cmd: 'y', status: 'fail' }],
  };
  assert.deepEqual(hudParts(t, NOW).map((p) => [p.key, p.text, p.tab]),
    [['round', 'q07', 'goal'], ['elapsed', '12m 0s', 'goal'], ['checks', '1/2 ✓', 'checks'], ['gate', 'gate ✗', 'checks']]);
  assert.equal(hudParts({ ...t, checklist: [], gates: [] }, NOW).length, 2);
  const done = { ...t, status: 'done', endedAt: NOW - 2 * MIN };
  assert.equal(hudParts(done, NOW + 99 * MIN).find((p) => p.key === 'elapsed').text, '10m 0s');
  assert.deepEqual(hudParts({ project: 'p', status: 'watching', checklist: [], gates: [] }, NOW).map((p) => p.text), ['p']);
});

test('diff lines: at most 6, old then new, blank lines skipped, long lines cut', () => {
  assert.deepEqual(diffLines('a\nb', 'c'), ['-a', '-b', '+c']);
  assert.deepEqual(diffLines('', 'x\n\ny'), ['+x', '+y']);
  const many = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
  const d = diffLines(many, many);
  assert.equal(d.length, DIFF_LINES);
  assert.deepEqual(d.map((l) => l[0]), ['-', '-', '-', '+', '+', '+']);
  assert.deepEqual(diffLines('o1', many).map((l) => l[0]), ['-', '+', '+', '+', '+', '+']);
  assert.equal(diffLines('', 'x'.repeat(200))[0].length, 49);
  assert.deepEqual(diffLines(undefined, undefined), []);
});

test('monitor: edit view caps lines, shortens the title and shows +N −M when known', () => {
  const v = editView({ file: 'src/some/very/long/path/name.js', add: 4, del: 1, diff: ['-old', '+new', '+x'.padEnd(60, 'y')] });
  assert.equal(v.title.length, 14);
  assert.ok(v.title.startsWith('…'));
  assert.equal(v.counts, '+4 −1');
  assert.deepEqual(v.lines.map((l) => l.sign), ['-', '+', '+']);
  assert.equal(v.lines[2].text.length, 28);
  assert.equal(editView({ file: 'a.js' }).counts, '');
  assert.equal(editView(null), null);
  assert.equal(editView({ file: 'a', diff: Array(10).fill('+z') }).lines.length, 6);
  assert.equal(cmdLine('npm test\nsecond', 20), 'npm test');
  assert.equal(cmdLine('abcdefghij', 5), 'abcd…');
});

test('monitor: result flash only when a running command gets its result', () => {
  assert.equal(resultFlash({ n: 4, ok: undefined }, { n: 4, ok: true }), 'ok');
  assert.equal(resultFlash({ n: 4, ok: undefined }, { n: 4, ok: false }), 'fail');
  assert.equal(resultFlash({ n: 4, ok: undefined }, { n: 4, ok: undefined }), null);
  assert.equal(resultFlash({ n: 3, ok: undefined }, { n: 4, ok: true }), null);
  assert.equal(resultFlash(null, { n: 4, ok: true }), null);
  assert.equal(resultFlash({ n: 4, ok: true }, { n: 4, ok: true }), null);
});

test('claude parser: Edit/Write events carry diff lines', () => {
  const p = createClaudeParser({ root: '/r' });
  const line = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'i', name, input }] } });
  const [e] = p.feed(line('Edit', { file_path: '/r/a.js', old_string: 'x\ny', new_string: 'z' }));
  assert.deepEqual(e.diff, ['-x', '-y', '+z']);
  const [w] = p.feed(line('Write', { file_path: '/r/b.js', content: 'one\ntwo' }));
  assert.deepEqual(w.diff, ['+one', '+two']);
  const [m] = p.feed(line('MultiEdit', { file_path: '/r/c.js', edits: [{ old_string: 'a', new_string: 'b' }] }));
  assert.deepEqual(m.diff, ['-a', '+b']);
});

test('facts: only the newest edit keeps its diff; gate flag and exit code are set', () => {
  const f = new Facts();
  f.push({ kind: 'edit', text: 'a', file: 'a', diff: ['+1'] }, NOW);
  f.push({ kind: 'edit', text: 'b', file: 'b', diff: ['+2'] }, NOW);
  f.push({ kind: 'edit', text: 'c', file: 'c', diff: ['+3'] }, NOW);
  const edits = f.events.filter((e) => e.kind === 'edit');
  assert.deepEqual(edits.map((e) => e.diff), [undefined, undefined, ['+3']]);
  f.push({ kind: 'edit', text: 'd', file: 'd' }, NOW);
  assert.equal(f.events.filter((e) => e.kind === 'edit').every((e) => e.diff === undefined), true);
  f.push({ kind: 'command', text: 'npm test', cmd: 'npm test' }, NOW);
  f.push({ kind: 'command', text: 'ls', cmd: 'ls' }, NOW);
  f.push({ kind: 'result', ok: false, text: '2 15ms' }, NOW);
  const [gate, ls] = f.events.filter((e) => e.kind === 'command');
  assert.equal(gate.gate, true);
  assert.equal(ls.gate, undefined);
  assert.equal(ls.ok, false);
  assert.equal(ls.exit, 2);
});
