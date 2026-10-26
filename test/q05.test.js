import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mentions, projectOfCwd, projectByInputs, assignTranscript, orchestratorFiles } from '../src/orchestra.js';
import { parseHandoff, HandoffGoals } from '../src/goal.js';
import { buildChat } from '../src/chat.js';
import { encodings } from '../src/projects.js';
import { Room } from '../src/room.js';
import { buildCards, orderCards } from '../public/lobby.js';

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const proj = (root, name) => ({ name, dir: path.join(root, name), runsDir: path.join(root, name, '.codex-runs') });
const line = (o) => JSON.stringify(o);
const use = (input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', input }] } });

function transcript(file, cwd, inputs = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [line({ type: 'user', cwd }), ...inputs.map(use)].join('\n') + '\n');
}

test('assignment: cwd inside a project wins; the deepest project is used', () => {
  const ps = [{ dir: '/h/p/a' }, { dir: '/h/p/a/sub' }, { dir: '/h/p/b' }];
  assert.equal(projectOfCwd('/h/p/b', ps).dir, '/h/p/b');
  assert.equal(projectOfCwd('/h/p/a/sub/x', ps).dir, '/h/p/a/sub');
  assert.equal(projectOfCwd('/h/p/ab', ps), null);
  assert.equal(projectOfCwd('/h/p', ps), null);
});

test('assignment: a path counts as a mention only at a path boundary', () => {
  assert.ok(mentions('cd /h/p/a && ls', '/h/p/a'));
  assert.ok(mentions('/h/p/a/src/x.js', '/h/p/a'));
  assert.ok(!mentions('/h/p/a-b/src/x.js', '/h/p/a'));
  assert.ok(mentions('/h/p/a-b/x /h/p/a', '/h/p/a'));
});

test('assignment: ancestor cwd goes by tool-input counts, ties by the most recent, none is dropped', async () => {
  const tmp = tmpDir('cr-q05-a-');
  try {
    const parent = path.join(tmp, 'personal');
    const [cr, dw] = [proj(parent, 'coder-room'), proj(parent, 'dwesk-crm')];
    const ps = [cr, dw];
    const f = (n) => path.join(tmp, `${n}.jsonl`);
    transcript(f('many'), parent, [
      { file_path: `${dw.dir}/a.js` }, { file_path: `${cr.dir}/b.js` }, { command: `cd ${cr.dir} && npm test` }, { file_path: `${cr.dir}/c.js` },
    ]);
    assert.equal((await assignTranscript(f('many'), ps)).name, 'coder-room');
    transcript(f('tie'), parent, [{ file_path: `${cr.dir}/b.js` }, { file_path: `${dw.dir}/a.js` }]);
    assert.equal((await assignTranscript(f('tie'), ps)).name, 'dwesk-crm');
    transcript(f('none'), parent, [{ file_path: '/elsewhere/x.js' }, { command: 'ls' }]);
    assert.equal(await assignTranscript(f('none'), ps), null);
    transcript(f('cwd'), dw.dir, [{ file_path: `${cr.dir}/b.js` }]);
    assert.equal((await assignTranscript(f('cwd'), ps)).name, 'dwesk-crm');
    fs.writeFileSync(f('nocwd'), `${use({ file_path: `${cr.dir}/b.js` })}\n`);
    assert.equal(await assignTranscript(f('nocwd'), ps), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assignment: only the last 200 tool inputs count, and the newest transcript per project wins', async () => {
  const tmp = tmpDir('cr-q05-b-');
  try {
    const parent = path.join(tmp, 'personal');
    const [cr, dw] = [proj(parent, 'coder-room'), proj(parent, 'dwesk-crm')];
    const old = Array.from({ length: 300 }, () => ({ file_path: `${dw.dir}/a.js` }));
    const recent = Array.from({ length: 200 }, () => ({ file_path: `${cr.dir}/b.js` }));
    const a = path.join(tmp, 'a.jsonl');
    transcript(a, parent, [...old, ...recent]);
    assert.equal((await assignTranscript(a, [cr, dw])).name, 'coder-room');
    const b = path.join(tmp, 'b.jsonl');
    const c = path.join(tmp, 'c.jsonl');
    transcript(b, cr.dir);
    transcript(c, cr.dir);
    const best = await orchestratorFiles([{ file: a, mtimeMs: 5 }, { file: b, mtimeMs: 9 }, { file: c, mtimeMs: 7 }], [cr, dw]);
    assert.deepEqual([...best].map(([d, t]) => [path.basename(d), path.basename(t.file)]), [['coder-room', 'b.jsonl']]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function twoProjectRoom(tmp, extra = () => {}) {
  const home = path.join(tmp, 'home');
  const parent = path.join(home, 'personal');
  const [cr, dw] = [proj(parent, 'coder-room'), proj(parent, 'dwesk-crm')];
  for (const p of [cr, dw]) fs.mkdirSync(p.runsDir, { recursive: true });
  fs.writeFileSync(path.join(cr.runsDir, 'chain.log'), 'coder q5 started 19:00 on claude3 sonnet\n');
  fs.writeFileSync(path.join(dw.runsDir, 'chain.log'), 'coder q314 started 19:00 on codex gpt-6-luna\n');
  const claude = path.join(tmp, 'claude');
  transcript(path.join(claude, encodings(parent)[0], 's.jsonl'), parent, [
    { file_path: `${cr.dir}/src/a.js` }, { command: `cd ${cr.dir} && git status` },
  ]);
  extra({ cr, dw, claude });
  return new Room({ roots: [cr.dir, dw.dir], scanRoot: tmp, claudeProjects: claude, home, clock: () => Date.now() });
}

test('room: a session in the ancestor dir lands in coder-room; Luna stays under dwesk-crm', async () => {
  const tmp = tmpDir('cr-q05-c-');
  try {
    const room = twoProjectRoom(tmp);
    await room.tick();
    const snap = room.snapshot();
    const byProject = {};
    for (const t of snap.tiles) (byProject[t.project] ??= []).push(t.id);
    assert.deepEqual(byProject, { 'coder-room': ['orchestrator@coder-room', 'claude3@coder-room'], 'dwesk-crm': ['luna@dwesk-crm'] });
    assert.deepEqual(snap.projects.map((p) => p.name), ['coder-room', 'dwesk-crm']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('room: each project keeps its own orchestrator and chat holds only Rayan and orchestrator lines', async () => {
  const tmp = tmpDir('cr-q05-d-');
  try {
    const room = twoProjectRoom(tmp, ({ cr, dw, claude }) => {
      const msg = (role, text) => line({ type: role === 'user' ? 'user' : 'assistant', cwd: cr.dir, message: { role, content: [{ type: 'text', text }] } });
      const file = path.join(claude, encodings(cr.dir)[0], 'cr.jsonl');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, [msg('user', 'hello orchestrator'), msg('assistant', 'hello Rayan')].join('\n') + '\n');
      transcript(path.join(claude, encodings(dw.dir)[0], 'dw.jsonl'), dw.dir);
    });
    await room.tick();
    const snap = room.snapshot();
    assert.deepEqual(snap.tiles.filter((t) => t.kind === 'orchestrator').map((t) => t.id).sort(), ['orchestrator@coder-room', 'orchestrator@dwesk-crm']);
    assert.ok(snap.chat.length > 0);
    assert.ok(snap.chat.every((m) => ['You', 'Orchestrator'].includes(m.from.name) && m.project));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('goal: a new round replaces the coder goal at once; a spec edit refreshes it', async () => {
  const tmp = tmpDir('cr-q05-e-');
  try {
    const root = path.join(tmp, 'proj');
    const runs = path.join(root, '.codex-runs');
    fs.mkdirSync(runs, { recursive: true });
    const chain = path.join(runs, 'chain.log');
    fs.writeFileSync(chain, 'coder q9 started 19:00 on codex gpt-6-luna\n');
    fs.writeFileSync(path.join(runs, 'q9.md'), '# q9 — First\n\n## Goal\nGoal nine.\n');
    const room = new Room({ roots: [root], scanRoot: tmp, claudeProjects: path.join(tmp, 'none'), home: tmp, clock: () => Date.now() });
    await room.tick();
    const goal = () => room.snapshot().tiles.find((t) => t.slot === 'luna').goal;
    assert.deepEqual(goal(), { title: 'q9 — First', summary: 'Goal nine.' });

    fs.writeFileSync(path.join(runs, 'q9.md'), '# q9 — First, edited\n\n## Goal\nGoal nine, rewritten.\n');
    room.lastRounds = Date.now();
    await room.tick();
    assert.equal(goal().summary, 'Goal nine.', 'not re-read before the poll interval');
    room.lastRounds = -Infinity;
    await room.tick();
    assert.deepEqual(goal(), { title: 'q9 — First, edited', summary: 'Goal nine, rewritten.' });

    fs.writeFileSync(path.join(runs, 'q10.md'), '# q10 — Second\n\n## Goal\nGoal ten.\n');
    fs.appendFileSync(chain, 'coder q10 started 19:30 on codex gpt-6-luna\n');
    await room.tick();
    assert.deepEqual(goal(), { title: 'q10 — Second', summary: 'Goal ten.' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('handoff: goal from "What this is", else the first paragraph after the title; first "Next step" line', () => {
  const full = parseHandoff('# T — HANDOFF\n\nIgnored intro.\n\n## What this is\nA local view of rounds.\nSecond line. More words.\n\n## Next step\n\n- **Ship** q05 first.\n- later\n');
  assert.deepEqual(full, { goal: 'A local view of rounds. Second line. More words.', short: 'A local view of rounds.', toward: 'Ship q05 first.' });
  const plain = parseHandoff('# Proj\n\nFirst paragraph here.\nStill it.\n\nSecond paragraph.\n');
  assert.equal(plain.goal, 'First paragraph here. Still it.');
  assert.equal(plain.toward, '');
  assert.equal(parseHandoff('no headings at all').goal, 'no headings at all');
  assert.equal(parseHandoff('').goal, '');
  assert.equal(parseHandoff('# T\n\n- Spec `q1.md`: one page.\n- more\n').short, 'Spec `q1.md`: one page.');
  assert.equal(parseHandoff('# T\n## Next step\n1. Do it\n').toward, 'Do it');
});

test('handoff: root HANDOFF.md beats .codex-runs, the fallback is used, and edits are picked up', async () => {
  const tmp = tmpDir('cr-q05-f-');
  try {
    const p = proj(tmp, 'p');
    fs.mkdirSync(p.runsDir, { recursive: true });
    const goals = new HandoffGoals();
    assert.equal(await goals.get(p), null);
    fs.writeFileSync(path.join(p.runsDir, 'HANDOFF.md'), '# H\n\n## What this is\nFrom runs.\n');
    assert.equal((await goals.get(p)).goal, 'From runs.');
    fs.writeFileSync(path.join(p.dir, 'HANDOFF.md'), '# H\n\n## What this is\nFrom root.\n');
    assert.equal((await goals.get(p)).goal, 'From root.');
    fs.writeFileSync(path.join(p.dir, 'HANDOFF.md'), `# H\n\n## What this is\nEdited root.\n\n${'x'.repeat(40_000)}\n`);
    const again = await goals.get(p);
    assert.equal(again.goal, 'Edited root.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('room: the orchestrator tile and lobby project carry the handoff goal', async () => {
  const tmp = tmpDir('cr-q05-g-');
  try {
    const room = twoProjectRoom(tmp, ({ cr }) => {
      fs.writeFileSync(path.join(cr.dir, 'HANDOFF.md'), '# H\n\n## What this is\nA room for coders. Extra.\n\n## Next step\n- Finish q05\n');
    });
    await room.tick();
    const snap = room.snapshot();
    const orch = snap.tiles.find((t) => t.id === 'orchestrator@coder-room');
    assert.deepEqual(orch.goal, { title: 'Project goal', summary: 'A room for coders. Extra.', toward: 'Finish q05' });
    assert.deepEqual(snap.projects[0], { name: 'coder-room', runsDir: '.codex-runs', goal: 'A room for coders.', toward: 'Finish q05' });
    assert.equal(snap.projects[1].goal, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('chat filter: a room shows only its own project orchestrator conversation', () => {
  const e = (kind, text, at, n) => ({ kind, text, at, n });
  const now = 1_000_000;
  const chat = buildChat({ now, orchs: [
    { project: 'a', events: [e('user', 'to a', now - 3, 1), e('say', 'coder noise', now - 2, 2)] },
    { project: 'b', events: [e('message', 'reply in b', now - 1, 3)] },
  ] });
  const room = (name) => chat.filter((m) => m.project === name).map((m) => m.text);
  assert.deepEqual(room('a'), ['to a']);
  assert.deepEqual(room('b'), ['reply in b']);
});

test('lobby: working projects first, then last activity, and projects without tiles are quiet', () => {
  const t = (project, status, over = {}) => ({ id: `${status}@${project}`, project, kind: 'coder', status, startedAt: 100, ...over });
  const projects = [{ name: 'idle', goal: 'g' }, { name: 'old' }, { name: 'busy' }, { name: 'newer' }, { name: 'gone' }];
  const tiles = [
    t('idle', 'done', { endedAt: 900 }), t('old', 'done', { endedAt: 300 }),
    t('busy', 'editing', { lastActivity: 200 }), t('busy', 'thinking', { id: 'x', lastActivity: 250 }),
    t('newer', 'done', { endedAt: 800 }),
  ];
  const { cards, quiet } = buildCards(projects, tiles, new Set(['x']), 50);
  assert.deepEqual(cards.map((c) => c.name), ['busy', 'idle', 'newer', 'old']);
  assert.deepEqual(quiet.map((p) => p.name), ['gone']);
  const busy = cards[0];
  assert.deepEqual([busy.working, busy.rounds, busy.hands, busy.last], [2, 2, 1, 250]);
  assert.deepEqual(orderCards([{ name: 'b', working: 0, last: 5 }, { name: 'a', working: 0, last: 5 }]).map((c) => c.name), ['a', 'b']);
  assert.equal(buildCards(projects, tiles, new Set(), 500).cards.find((c) => c.name === 'busy').rounds, 0);
});
