import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { orchestratorCommand, parseArgs, runBench } from '../bench/ab.js';
import { buildRows, difference, readResults, toMarkdown } from '../bench/measure.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'fixture');

const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const prompt = args.at(-1);
const arm = path.basename(process.cwd());
const note = (ev, kind) => fs.appendFileSync(process.env.FAKE_OUT, JSON.stringify({ ev, kind, arm, t: Date.now(), args, cfg: process.env.CLAUDE_CONFIG_DIR ?? null }) + '\\n');
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const model = (i, o, r, w, c) => ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: r, cacheCreationInputTokens: w, costUSD: c });
const result = (extra) => console.log(JSON.stringify({ type: 'result', subtype: 'success', ...extra }));

if (prompt.startsWith('Read AGENTS.md')) {
  note('start', 'coder'); wait(30);
  fs.writeFileSync('.rounds/ab1-report.md', 'done\\n');
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  result({ result: 'ok', total_cost_usd: 0.25, usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 300, cache_creation_input_tokens: 400 }, modelUsage: { sonnet: model(100, 200, 300, 400, 0.25) } });
  note('end', 'coder');
} else if (prompt.includes('exact command')) {
  note('start', 'orch'); wait(30);
  const m = prompt.match(/finishes\\): (.+?) \\. Then/);
  const [cmd, ...rest] = m[1].split(' ');
  cp.spawnSync(cmd === 'node' ? process.execPath : cmd, rest, { stdio: 'ignore', env: process.env, cwd: process.cwd() });
  console.log('not json');
  result({ result: 'Reviewed.\\nSHIP looks right', total_cost_usd: 0.5, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 }, modelUsage: { opus: model(10, 20, 30, 40, 0.5) } });
  note('end', 'orch');
} else {
  note('start', 'orch'); wait(30);
  result({ result: 'FIX missing test', total_cost_usd: 0.4, usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 8 }, modelUsage: { opus: model(5, 6, 7, 8, 0.3), sonnet: model(50, 60, 70, 80, 0.1) } });
  note('end', 'orch');
}
`;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function setup({ withClaude = true, system = withClaude } = {}) {
  const bin = tmp('ab-bin-');
  if (withClaude) fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const work = tmp('ab-out-');
  const fakeOut = path.join(work, 'fake.jsonl');
  const nodeDir = path.dirname(process.execPath);
  const env = {
    PATH: system ? [bin, nodeDir, '/usr/bin', '/bin'].join(path.delimiter) : bin,
    HOME: work,
    FAKE_OUT: fakeOut,
    AB_CONFIG_DIR: path.join(work, 'cfg-secret-account'),
  };
  const lines = [];
  const events = () => (fs.existsSync(fakeOut) ? fs.readFileSync(fakeOut, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { env, work, resultsRoot: path.join(work, 'results'), lines, out: (s) => lines.push(s), events };
}

const listing = (dir) => spawnSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).stdout.split('\n').sort().join('\n');

test('a full run creates committed copies, runs arms in order and measures each metric', async () => {
  const s = setup();
  const before = listing(FIXTURE);
  const r = await runBench({ env: s.env, resultsRoot: s.resultsRoot, out: s.out, now: new Date(2026, 9, 25, 14, 5) });
  assert.equal(listing(FIXTURE), before);
  assert.equal(path.basename(r.root), '20261025-1405');

  for (const arm of ['A', 'B']) {
    const dir = path.join(r.root, arm);
    const count = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    assert.equal(count, '1');
    assert.ok(fs.existsSync(path.join(dir, 'orchestrator.log')));
    assert.ok(fs.existsSync(path.join(dir, 'src', 'text.js')));
  }
  const cfgA = JSON.parse(fs.readFileSync(path.join(r.root, 'A', '.rounds', 'config.json'), 'utf8'));
  assert.equal(cfgA.coders[0].model, 'sonnet');
  assert.equal(cfgA.coders[0].configDir, s.env.AB_CONFIG_DIR);
  assert.ok(fs.existsSync(path.join(r.root, 'A', '.rounds', 'ab1-report.md')));
  assert.ok(!fs.existsSync(path.join(r.root, 'B', '.rounds', 'ab1-report.md')));

  const ev = s.events();
  const t = (arm, f) => f(...ev.filter((e) => e.arm === arm).map((e) => e.t));
  assert.ok(t('A', Math.max) <= t('B', Math.min), 'arm A finished before arm B started');
  assert.deepEqual(ev.filter((e) => e.kind === 'coder').map((e) => e.arm), ['A', 'A']);
  assert.ok(ev.every((e) => e.cfg === s.env.AB_CONFIG_DIR), 'every claude process got CLAUDE_CONFIG_DIR');
  const orchArgs = ev.find((e) => e.kind === 'orch' && e.arm === 'B').args;
  assert.equal(orchArgs[orchArgs.indexOf('--model') + 1], 'opus');

  const { A, B } = r.summaries;
  assert.deepEqual(A.measure.orchestratorMainLoop, { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
  assert.deepEqual(B.measure.orchestratorMainLoop, { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 });
  assert.equal(A.measure.orchestratorSessionTokens, 100);
  assert.equal(B.measure.orchestratorSessionTokens, 26 + 260);
  assert.equal(A.measure.totalTokens, 100 + 1000);
  assert.equal(B.measure.totalTokens, 286);
  assert.equal(A.measure.models.sonnet.output, 200);
  assert.ok(Math.abs(A.measure.costUsd - 0.75) < 1e-9);
  assert.ok(Math.abs(A.measure.orchestratorCostUsd - 0.5) < 1e-9);
  assert.ok(Math.abs(B.measure.costUsd - 0.4) < 1e-9);
  assert.equal(A.measure.verdict, 'SHIP looks right');
  assert.equal(B.measure.verdict, 'FIX missing test');
  assert.equal(A.testsPass, true);
  assert.equal(B.testsPass, true);
  assert.ok(A.wallSeconds >= 0);
  assert.deepEqual(A.filesChanged, []);

  const md = fs.readFileSync(path.join(r.root, 'results.md'), 'utf8');
  assert.match(md, /\| metric \| A \(coder-room\) \| B \(subagent\) \| difference \(B − A\) \|/);
  assert.match(md, /\| tokens on the orchestrator session .* \| 100 \| 286 \| \+186 \(\+186\.0%\) \|/);
  assert.match(md, /\| total cost \(USD\) \| \$0\.7500 \| \$0\.4000 \| -\$0\.3500 \(-46\.7%\) \|/);
  assert.match(md, /one account/);
  const json = JSON.parse(fs.readFileSync(path.join(r.root, 'results.json'), 'utf8'));
  assert.equal(json.arms.A.measure.totalTokens, 1100);
  assert.equal(json.coderLean, true);
  assert.match(md, /Arm A coder lean mode: on/);
  assert.equal(cfgA.coders[0].lean, true);
  assert.ok(s.lines.join('\n').includes('| metric |'));
  assert.ok(!s.lines.join('\n').includes('cfg-secret-account'));
});

test('--dry builds the copies, prints both commands and runs nothing', async () => {
  const s = setup({ withClaude: false, system: true });
  const r = await runBench({ env: s.env, dry: true, resultsRoot: s.resultsRoot, out: s.out });
  const text = s.lines.join('\n');
  assert.match(text, /\[A\] .*claude -p --model opus --permission-mode acceptEdits --output-format stream-json --verbose --allowedTools/);
  assert.match(text, /\[B\] .*claude -p --model opus/);
  assert.match(text, /bin\/coder-room\.js run ab1/);
  assert.match(text, /Agent/);
  assert.ok(!text.includes('cfg-secret-account'));
  assert.ok(fs.existsSync(path.join(r.root, 'A', '.git')));
  assert.ok(fs.existsSync(path.join(r.root, 'B', '.git')));
  assert.ok(!fs.existsSync(path.join(r.root, 'results.json')));
  assert.ok(!fs.existsSync(path.join(r.root, 'A', 'orchestrator.log')));
  assert.deepEqual(s.events(), []);
});

test('it refuses to start without claude on PATH', async () => {
  const s = setup({ withClaude: false });
  await assert.rejects(runBench({ env: s.env, resultsRoot: s.resultsRoot, out: s.out }), /claude is not on PATH/);
  assert.ok(!fs.existsSync(s.resultsRoot));
});

test('--arms runs a single arm and the table shows a dash for the other', async () => {
  const s = setup();
  const r = await runBench({ env: s.env, arms: ['B'], resultsRoot: s.resultsRoot, out: s.out });
  assert.deepEqual(Object.keys(r.summaries), ['B']);
  assert.ok(!fs.existsSync(path.join(r.root, 'A')));
  assert.match(fs.readFileSync(path.join(r.root, 'results.md'), 'utf8'), /\| total cost \(USD\) \| — \| \$0\.4000 \| — \|/);
});

test('the orchestrator commands differ only in delegation and tools', () => {
  const a = orchestratorCommand('A', { orchModel: 'opus', repo: '/r' });
  const b = orchestratorCommand('B', { orchModel: 'haiku', repo: '/r' });
  const tools = (c) => c.args.slice(c.args.indexOf('--allowedTools') + 1, c.args.indexOf('--'));
  assert.ok(tools(a).includes('Bash(node /r/bin/coder-room.js run ab1:*)'));
  assert.ok(tools(a).includes('Bash(coder-room run:*)'));
  assert.ok(!tools(a).includes('Agent') && !tools(a).includes('Edit'));
  assert.ok(tools(b).includes('Agent') && tools(b).includes('Edit') && tools(b).includes('Bash(node:*)'));
  assert.equal(b.args[b.args.indexOf('--model') + 1], 'haiku');
  const review = (c) => c.args.at(-1).match(/Then review.*$/)[0];
  assert.equal(review(a), review(b));
  assert.match(a.args.at(-1), /node \/r\/bin\/coder-room\.js run ab1 \./);
  assert.match(b.args.at(-1), /exactly one subagent \(Agent tool, model sonnet\)/);
});

test('difference and table math', () => {
  assert.equal(difference(100, 286, 'tokens'), '+186 (+186.0%)');
  assert.equal(difference(0.75, 0.4, 'usd'), '-$0.3500 (-46.7%)');
  assert.equal(difference(0, 5, 'tokens'), '+5');
  assert.equal(difference(10, 10, 'sec'), '0.0s (+0.0%)');
  assert.equal(difference('yes', 'no', 'text'), '—');
  assert.equal(difference(null, 3, 'tokens'), '—');
  const arm = (n) => ({ wallSeconds: n, testsPass: true, filesChanged: ['src/text.js'], measure: {
    orchestratorMainLoop: { input: n, output: 0, cacheRead: 0, cacheWrite: 0 }, orchestratorSessionTokens: n, totalTokens: n,
    models: { m: { input: n, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } }, orchestratorCostUsd: 0, costUsd: 0, verdict: null } });
  const rows = buildRows(arm(2), arm(4));
  assert.equal(rows.find((r) => r.metric === 'model m tokens').b, 4);
  assert.match(toMarkdown(rows), /\| orchestrator verdict \| \(none\) \| \(none\) \| — \|/);
});

test('readResults tolerates broken lines and a missing file', () => {
  const dir = tmp('ab-log-');
  const file = path.join(dir, 'x.log');
  fs.writeFileSync(file, 'junk\n{"type":"assistant"}\n{"type":"result","total_cost_usd":1}\n{"type":"res');
  assert.equal(readResults(file).length, 1);
  assert.deepEqual(readResults(path.join(dir, 'none.log')), []);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs([]), { arms: ['A', 'B'], dry: false, coderLean: true });
  assert.deepEqual(parseArgs(['--arms', 'b', '--dry']), { arms: ['B'], dry: true, coderLean: true });
  assert.throws(() => parseArgs(['--arms', 'C']), /--arms/);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
});
