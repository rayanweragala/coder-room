import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mentions, assignTranscript, lastToolInputs, latestCwd, orchestratorFiles } from '../src/orchestra.js';
import { backLines } from '../src/backread.js';
import { createClaudeParser } from '../src/parse-claude.js';
import { LogFollower } from '../src/follow.js';
import { buildChat } from '../src/chat.js';
import { buildCards } from '../public/lobby.js';
import { dayTimeText, timeText } from '../public/util.js';

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const line = (o) => JSON.stringify(o);
const use = (input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', input }] } });
const proj = (root, name) => ({ name, dir: path.join(root, name), runsDir: path.join(root, name, '.codex-runs') });

test('backLines: yields lines last to first across chunk boundaries and respects the byte limit', async () => {
  const tmp = tmpDir('cr-q05b-a-');
  try {
    const file = path.join(tmp, 'f.txt');
    const lines = Array.from({ length: 40 }, (_, i) => `line-${i}-${'é'.repeat(20_000)}`);
    fs.writeFileSync(file, lines.join('\n'));
    const seen = [];
    await backLines(file, (b) => { seen.push(b.toString('utf8')); });
    assert.deepEqual(seen, [...lines].reverse());
    const limited = [];
    await backLines(file, (b) => { limited.push(b.toString('utf8')); }, 300_000);
    assert.ok(limited.length > 0 && limited.length < 40);
    assert.deepEqual(limited, [...lines].reverse().slice(0, limited.length), 'whole lines only, newest first');
    let calls = 0;
    await backLines(file, () => ++calls === 3);
    assert.equal(calls, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cwd: the latest cwd wins over an ancestor first cwd, even past a huge line', async () => {
  const tmp = tmpDir('cr-q05b-b-');
  try {
    const parent = path.join(tmp, 'personal');
    const [cr, dw] = [proj(parent, 'coder-room'), proj(parent, 'dwesk-crm')];
    const file = path.join(tmp, 's.jsonl');
    const huge = line({ type: 'user', cwd: cr.dir, message: { content: [{ type: 'tool_result', content: 'x'.repeat(900_000) }] } });
    fs.writeFileSync(file, [
      line({ type: 'user', cwd: parent }), use({ file_path: `${dw.dir}/a.js` }), line({ type: 'user', cwd: dw.dir }),
      line({ type: 'user', cwd: parent }), huge, line({ type: 'system' }),
    ].join('\n') + '\n');
    assert.equal(await latestCwd(file), cr.dir);
    assert.equal((await assignTranscript(file, [cr, dw])).name, 'coder-room');
    fs.writeFileSync(file, [line({ type: 'user', cwd: parent }), line({ type: 'user', cwd: cr.dir }), line({ type: 'system' })].join('\n') + '\n');
    assert.equal((await assignTranscript(file, [cr, dw])).name, 'coder-room');
    fs.writeFileSync(file, [line({ type: 'user', cwd: cr.dir }), line({ type: 'user', cwd: parent })].join('\n') + '\n');
    assert.equal((await assignTranscript(file, [cr, dw])), null, 'latest cwd is an ancestor and nothing else points anywhere');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mentions: the ~/ form of a project dir matches under home, with the same boundary rule', async () => {
  const home = '/h/rayan';
  assert.ok(mentions('cd ~/Documents/projects/personal/coder-room && ls', '/h/rayan/Documents/projects/personal/coder-room', home));
  assert.ok(!mentions('~/Documents/projects/personal/coder-room-x/a', '/h/rayan/Documents/projects/personal/coder-room', home));
  assert.ok(!mentions('~/elsewhere', '/other/place/p', home));

  const tmp = tmpDir('cr-q05b-c-');
  try {
    const parent = path.join(tmp, 'home', 'personal');
    const [cr, dw] = [proj(parent, 'coder-room'), proj(parent, 'dwesk-crm')];
    const file = path.join(tmp, 't.jsonl');
    fs.writeFileSync(file, [
      line({ type: 'user', cwd: parent }),
      use({ command: 'cd ~/personal/coder-room && npm test' }), use({ file_path: '~/personal/coder-room/src/a.js' }),
      use({ file_path: `${dw.dir}/a.js` }),
    ].join('\n') + '\n');
    assert.equal((await assignTranscript(file, [cr, dw], path.join(tmp, 'home'))).name, 'coder-room');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('lastToolInputs: reads back past non-tool lines, skips huge lines unparsed, stops at max', async () => {
  const tmp = tmpDir('cr-q05b-d-');
  try {
    const file = path.join(tmp, 't.jsonl');
    const filler = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'y'.repeat(100_000) }] } });
    const hugeUse = use({ command: `ECHO-HUGE ${'z'.repeat(300_000)}` });
    const body = [use({ command: 'first' }), filler, filler, filler, use({ command: 'second' }), hugeUse, filler, use({ command: 'third' })];
    fs.writeFileSync(file, body.join('\n') + '\n');
    assert.deepEqual(await lastToolInputs(file), ['first', 'second', 'third']);
    assert.deepEqual(await lastToolInputs(file, 2), ['second', 'third']);
    assert.deepEqual(await lastToolInputs(path.join(tmp, 'missing.jsonl')), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('re-assign: a grown transcript is re-read at most every 30 s', async () => {
  const tmp = tmpDir('cr-q05b-e-');
  try {
    const parent = path.join(tmp, 'personal');
    const [cr, dw] = [proj(parent, 'coder-room'), proj(parent, 'dwesk-crm')];
    const file = path.join(tmp, 's.jsonl');
    fs.writeFileSync(file, line({ type: 'user', cwd: dw.dir }) + '\n');
    const assigned = new Map();
    const pick = async (mtimeMs, now) => [...(await orchestratorFiles([{ file, mtimeMs }], [cr, dw], assigned, now, tmp))].map(([d]) => path.basename(d));
    assert.deepEqual(await pick(1, 1000), ['dwesk-crm']);
    fs.appendFileSync(file, line({ type: 'user', cwd: cr.dir }) + '\n');
    assert.deepEqual(await pick(2, 20_000), ['dwesk-crm'], 'too soon');
    assert.deepEqual(await pick(2, 31_500), ['coder-room']);
    assert.deepEqual(await pick(2, 90_000), ['coder-room']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('times: Claude lines carry their own timestamp; Codex lines read at load get none, live ones the poll time', async () => {
  const when = '2026-10-24T08:15:30.000Z';
  const ev = createClaudeParser({ orchestrator: true }).feed(line({ type: 'assistant', timestamp: when, message: { content: [{ type: 'text', text: 'hi' }] } }));
  assert.equal(ev[0].ts, Date.parse(when));
  assert.equal(createClaudeParser().feed(line({ type: 'result', result: 'ok' }))[0].ts, undefined);

  const tmp = tmpDir('cr-q05b-f-');
  try {
    const claudeFile = path.join(tmp, 'c.jsonl');
    fs.writeFileSync(claudeFile, line({ type: 'assistant', timestamp: when, message: { content: [{ type: 'thinking', thinking: 'old thought' }] } }) + '\n');
    const cf = new LogFollower(claudeFile, tmp, { clock: () => 5_000_000_000_000 });
    await cf.poll();
    assert.equal(cf.facts.events[0].at, Date.parse(when));

    const codexFile = path.join(tmp, 'x.log');
    fs.writeFileSync(codexFile, 'thinking\nEarlier thought\ncodex\nEarlier words\n');
    const xf = new LogFollower(codexFile, tmp, { clock: () => 1234 });
    await xf.poll();
    assert.ok(xf.facts.events.length > 0);
    assert.ok(xf.facts.events.every((e) => e.at === null));
    fs.appendFileSync(codexFile, 'thinking\nLive thought\ncodex\nLive words\n');
    await xf.poll();
    assert.ok(xf.facts.events.some((e) => e.at === 1234 && /Live/.test(e.text)));
    assert.ok(xf.facts.events.filter((e) => /Earlier/.test(e.text)).every((e) => e.at === null));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('times: chat keeps untimed lines and the client shows nothing for them', () => {
  const chat = buildChat({ now: 10 ** 12, orchs: [{ project: 'a', events: [
    { kind: 'user', text: 'early', at: null, n: 1 }, { kind: 'message', text: 'later', at: 10 ** 12 - 5, n: 2 },
  ] }] });
  assert.deepEqual(chat.map((m) => m.text), ['early', 'later']);
  assert.equal(chat[0].at, null);
  assert.equal(timeText(null), '');
  assert.equal(timeText(undefined), '');
});

test('lobby time: HH:MM today, "yesterday HH:MM", else "Mon D HH:MM"', () => {
  const now = new Date(2026, 9, 25, 12, 0).getTime();
  const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
  assert.equal(dayTimeText(at(25, 9, 5), now), '09:05');
  assert.equal(dayTimeText(at(24, 22, 23), now), 'yesterday 22:23');
  assert.equal(dayTimeText(at(24, 0, 1), new Date(2026, 9, 25, 0, 5).getTime()), 'yesterday 00:01');
  assert.equal(dayTimeText(at(22, 7, 30), now), 'Oct 22 07:30');
  assert.equal(dayTimeText(null, now), '');
});

test('lobby card: the caption of the most recently active agent that has one, with its initial', () => {
  const t = (id, name, over) => ({ id, name, project: 'p', kind: 'coder', status: 'done', startedAt: 1, ...over });
  const tiles = [
    t('luna', 'Luna', { caption: 'Implemented Q314 frontend', lastActivity: 500 }),
    t('s', 'Sonnet · Claude 3', { caption: 'older words', lastActivity: 100 }),
    t('o', 'Orchestrator', { kind: 'orchestrator', caption: null, lastActivity: 900 }),
  ];
  const { cards } = buildCards([{ name: 'p' }], tiles);
  assert.deepEqual(cards[0].caption, { initial: 'L', text: 'Implemented Q314 frontend' });
  tiles[1].lastActivity = 700;
  assert.deepEqual(buildCards([{ name: 'p' }], tiles).cards[0].caption, { initial: 'C', text: 'older words' });
  assert.equal(buildCards([{ name: 'p' }], [t('o', 'Orchestrator', {})]).cards[0].caption, null);
});
