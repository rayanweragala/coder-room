import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverProjects } from '../src/projects.js';
import { RUNS_DIRS, isRunsDir, runsDirOf } from '../src/runs-dir.js';
import { HandoffGoals } from '../src/goal.js';

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cr-q09-'));
const mkRuns = (proj, name, extra = {}) => {
  const d = path.join(proj, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'chain.log'), '');
  for (const [f, text] of Object.entries(extra)) fs.writeFileSync(path.join(d, f), text);
  return d;
};

test('runs-dir: names and isRunsDir', () => {
  assert.deepEqual(RUNS_DIRS, ['.rounds', '.codex-runs']);
  assert.ok(isRunsDir('.rounds') && isRunsDir('.codex-runs'));
  assert.ok(!isRunsDir('rounds') && !isRunsDir('.git'));
});

test('runsDirOf: .rounds wins when both exist and the warning fires', async () => {
  const root = tmpdir();
  try {
    mkRuns(root, '.rounds');
    mkRuns(root, '.codex-runs');
    const msgs = [];
    assert.equal(await runsDirOf(root, (m) => msgs.push(m)), path.join(root, '.rounds'));
    assert.equal(msgs.length, 1);
    assert.equal(await runsDirOf(path.join(root, 'nothing')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discover: scan finds .rounds, legacy and both (.rounds wins)', async () => {
  const root = tmpdir();
  try {
    mkRuns(path.join(root, 'new'), '.rounds');
    mkRuns(path.join(root, 'old'), '.codex-runs');
    mkRuns(path.join(root, 'both'), '.rounds');
    mkRuns(path.join(root, 'both'), '.codex-runs');
    fs.mkdirSync(path.join(root, 'empty', '.rounds'), { recursive: true });
    const got = await discoverProjects({ scanRoot: root });
    const by = Object.fromEntries(got.map((p) => [p.name, p]));
    assert.deepEqual(Object.keys(by).sort(), ['both', 'new', 'old']);
    assert.equal(by.new.runsName, '.rounds');
    assert.equal(by.old.runsName, '.codex-runs');
    assert.equal(by.both.runsName, '.rounds');
    assert.equal(path.basename(by.both.runsDir), '.rounds');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discover: explicit roots work for both folder names', async () => {
  const root = tmpdir();
  try {
    mkRuns(path.join(root, 'a'), '.rounds');
    mkRuns(path.join(root, 'b'), '.codex-runs');
    const got = await discoverProjects({ roots: [path.join(root, 'a'), path.join(root, 'b'), path.join(root, 'c')], scanRoot: '/nonexistent' });
    assert.deepEqual(got.map((p) => [p.name, p.runsName]), [['a', '.rounds'], ['b', '.codex-runs']]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discover: a symlinked .rounds in a worktree is deduped', async () => {
  const root = tmpdir();
  try {
    const main = path.join(root, 'main');
    const real = mkRuns(main, '.rounds');
    const wt = path.join(root, 'wt');
    fs.mkdirSync(wt);
    fs.symlinkSync(real, path.join(wt, '.rounds'));
    const got = await discoverProjects({ scanRoot: root });
    assert.equal(got.length, 1);
    assert.equal(got[0].name, 'main');
    assert.equal(got[0].runsDir, fs.realpathSync(real));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('handoff: root HANDOFF.md first, then the runs folder, for .rounds too', async () => {
  const root = tmpdir();
  try {
    const runs = mkRuns(root, '.rounds', { 'HANDOFF.md': '# T\n\n## What this is\nInside the rounds folder.\n' });
    const project = { name: 'p', dir: root, runsDir: runs };
    const goals = new HandoffGoals();
    assert.equal((await goals.get(project)).short, 'Inside the rounds folder.');
    fs.writeFileSync(path.join(root, 'HANDOFF.md'), '# T\n\n## What this is\nAt the root.\n');
    goals.drop(project);
    assert.equal((await goals.get(project)).short, 'At the root.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
