import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogParser } from '../src/parse-log.js';
import { Facts } from '../src/facts.js';
import { ChainModel } from '../src/state.js';
import { parseChainLine } from '../src/parse-chain.js';
import { coderTile, orchestratorTile } from '../src/tiles.js';
import { listRounds } from '../src/history.js';
import { logModel } from '../src/log-model.js';
import { identityOf } from '../public/looks.js';
import { bestModel, modelShown } from '../public/model.js';
import { hudParts } from '../public/hud.js';
import { agentRows } from '../public/lobby-rows.js';
import { SPLIT_DEFAULT, clampSplit, splitVars, splitFromPointer, drawerLayout } from '../public/split.js';

const J = JSON.stringify;
const modelOf = (lines, opts) => {
  const p = createLogParser(opts);
  const f = new Facts();
  for (const l of lines) for (const ev of p.feed(l)) f.push(ev, null);
  return f.model;
};

test('Claude init model is read, and orchestrator transcripts follow the latest assistant model', () => {
  const init = J({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' });
  const asst = (model) => J({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'hi' }] } });
  assert.equal(modelOf([init, asst('claude-sonnet-5-6')]), 'claude-sonnet-5-5');
  assert.equal(modelOf([asst('claude-opus-5-5'), asst('claude-opus-5-6')], { orchestrator: true }), 'claude-opus-5-6');
  assert.equal(modelOf([asst('<synthetic>')]), null);
});

test('Codex header model is read once, and only from the header', () => {
  assert.equal(modelOf(['OpenAI Codex', 'model: gpt-6-luna', 'user', 'do it']), 'gpt-6-luna');
  assert.equal(modelOf(['OpenAI Codex', 'user', 'model: gpt-x']), null);
});

test('chain line gives an alias model and the log model beats it', () => {
  assert.equal(identityOf('claude3 sonnet').model, 'sonnet');
  assert.equal(identityOf('codex gpt-6-luna').model, 'gpt-6-luna');
  assert.equal(identityOf('main').model, null);
  assert.equal(bestModel('claude-sonnet-5-5', 'sonnet'), 'claude-sonnet-5-5');
  assert.equal(bestModel(null, 'sonnet'), 'sonnet');
  assert.equal(bestModel('gpt-6-luna', null), 'gpt-6-luna');
  assert.equal(bestModel('sonnet', 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
});

test('coder tile: log model beats the chain alias; chain model is the fallback', () => {
  const chain = new ChainModel();
  const project = { name: 'p', dir: '/p', runsDir: '/p/.rounds' };
  chain.apply(project, parseChainLine('coder q01 started 10:00 on claude3 sonnet', Date.now()));
  const rec = chain.all()[0];
  assert.equal(rec.model, 'sonnet');
  const st = { status: 'thinking', quiet: null };
  assert.equal(coderTile(rec, null, { spec: null, report: null }, st).model, 'sonnet');
  const facts = new Facts();
  facts.push({ kind: 'model', model: 'claude-sonnet-5-5' }, null);
  assert.equal(coderTile(rec, { facts }, { spec: null, report: null }, st).model, 'claude-sonnet-5-5');
});

test('orchestrator tile carries the transcript model', () => {
  const facts = new Facts();
  facts.push({ kind: 'model', model: 'claude-opus-5-5', latest: true }, null);
  const orch = { project: 'p', follower: { facts, current: null, grewAt: 0 } };
  assert.equal(orchestratorTile(orch, 'thinking').model, 'claude-opus-5-5');
});

test('the model is not shown twice when the name already is the model', () => {
  assert.equal(modelShown('Luna', 'gpt-6-luna'), 'gpt-6-luna');
  assert.equal(modelShown('gpt-7', 'gpt-7'), '');
  assert.equal(modelShown('GPT-7', 'gpt-7'), '');
  assert.equal(modelShown('codex-2', null), '');
  assert.equal(identityOf('gpt-6-luna').name, 'Luna');
});

test('HUD leads with a model pill and lobby rows carry the shown model', () => {
  const t = { name: 'codex-2', model: 'gpt-7', round: 'q02', status: 'thinking', checklist: [], files: [], gates: [], events: [] };
  const parts = hudParts(t, 0);
  assert.deepEqual(parts.slice(0, 2).map((p) => p.key), ['model', 'round']);
  assert.equal(parts[0].text, 'gpt-7');
  const rows = agentRows([{ ...t, id: 'a', color: '#fff', rc: null }, { ...t, id: 'b', name: 'gpt-7', color: '#fff' }], 0).rows;
  assert.deepEqual(rows.map((r) => r.model), ['gpt-7', '']);
});

test('history rows carry the model from the round log, falling back to the chain line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q18-'));
  const runs = path.join(dir, '.rounds');
  fs.mkdirSync(runs);
  const now = new Date();
  const hm = (m) => new Date(now.getTime() - m * 60_000).toTimeString().slice(0, 5);
  fs.writeFileSync(path.join(runs, 'chain.log'), [
    `coder q01 started ${hm(30)} on claude3 sonnet`, `coder q01 finished ${hm(20)} rc=0 on claude3 sonnet`,
    `coder q02 started ${hm(10)} on codex-2 gpt-7`, `coder q02 finished ${hm(5)} rc=0 on codex-2 gpt-7`, '',
  ].join('\n'));
  fs.writeFileSync(path.join(runs, 'q01.log'), `${J({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' })}\n`);
  fs.writeFileSync(path.join(runs, 'q02.log'), 'OpenAI Codex\nuser\nhi\n');
  const rows = await listRounds({ name: 'p', dir, runsDir: runs });
  const by = Object.fromEntries(rows.map((r) => [r.round, r.model]));
  assert.deepEqual(by, { q01: 'claude-sonnet-5-5', q02: 'gpt-7' });
  assert.equal(await logModel(path.join(runs, 'q01.log')), 'claude-sonnet-5-5');
  assert.equal(await logModel(path.join(runs, 'missing.log')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('split helper clamps to 35-75, defaults to 55 and maps pointer positions', () => {
  assert.equal(SPLIT_DEFAULT, 55);
  assert.equal(clampSplit(10), 35);
  assert.equal(clampSplit(99), 75);
  assert.equal(clampSplit('60'), 60);
  assert.equal(clampSplit(null), 55);
  assert.equal(clampSplit('abc'), 55);
  assert.deepEqual(splitVars(60), { '--feed-fr': '60fr', '--drawer-fr': '40fr' });
  assert.deepEqual(splitVars(undefined), { '--feed-fr': '55fr', '--drawer-fr': '45fr' });
  assert.equal(splitFromPointer(300, 0, 600), 50);
  assert.equal(splitFromPointer(0, 0, 600), 35);
  assert.equal(splitFromPointer(600, 0, 600), 75);
  assert.equal(splitFromPointer(5, 0, 0), 55);
});

test('drawer layout state: only an open drawer on an open agent takes rows', () => {
  assert.deepEqual(drawerLayout(true, 'a'), { on: true, className: 'drawer-open' });
  assert.deepEqual(drawerLayout(false, 'a'), { on: false, className: '' });
  assert.deepEqual(drawerLayout(true, null), { on: false, className: '' });
});

test('spec headings with no todo data and no report are a plain list without counts', () => {
  const rec = { slot: 'x', name: 'X', state: 'done', round: 'q01' };
  const st = { status: 'done', quiet: null };
  const spec = { title: 't', goal: '', items: ['A', 'B'] };
  const plain = coderTile(rec, null, { spec, report: null }, st);
  assert.equal(plain.checklistMode, 'spec');
  assert.equal(plain.checklist.length, 2);
  assert.equal(hudParts({ ...plain, events: [] }, 0).some((p) => p.key === 'checks'), false);
  const reported = coderTile(rec, null, { spec, report: { title: 'r', lines: [] } }, st);
  assert.equal(reported.checklistMode, null);
  assert.ok(reported.checklist.every((c) => c.status === 'done'));
  const facts = new Facts();
  facts.push({ kind: 'todo', todos: [{ text: 'A', status: 'completed' }] }, null);
  assert.equal(coderTile(rec, { facts }, { spec, report: null }, st).checklistMode, null);
});
