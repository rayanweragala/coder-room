import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../src/cli/main.js';
import { limitedUntil } from '../src/cli/common.js';

const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const bin = require('node:path').basename(process.argv[1]);
const mode = process.env[bin === 'claude' ? 'FAKE_CLAUDE' : 'FAKE_CODEX'] || 'ok';
if (process.env.FAKE_OUT) {
  fs.appendFileSync(process.env.FAKE_OUT, JSON.stringify({ bin, args: process.argv.slice(2), cfg: process.env.CLAUDE_CONFIG_DIR ?? null }) + '\\n');
}
if (mode === 'limit') {
  console.log(bin === 'claude' ? "You've hit your session limit" : 'ERROR: usage limit reached');
  process.exit(1);
}
if (mode === 'fail') { console.log('boom'); process.exit(4); }
if (bin === 'claude') {
  console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.5, num_turns: 3, duration_ms: 4000,
    modelUsage: { 'fake-model': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40, costUSD: 0.5 } } }));
} else {
  console.log('codex\\nhello\\ntokens used\\n224,637');
}
`;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const capture = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
};

function fakeBin(names = ['claude', 'codex']) {
  const dir = tmp('cr-bin-');
  for (const n of names) {
    fs.writeFileSync(path.join(dir, n), FAKE, { mode: 0o755 });
  }
  return dir;
}
const pathWith = (dir) => [dir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);

function project(config, { rounds = ['q01'] } = {}) {
  const dir = tmp('cr-proj-');
  fs.mkdirSync(path.join(dir, '.rounds'));
  fs.writeFileSync(path.join(dir, '.rounds', 'chain.log'), '');
  fs.writeFileSync(path.join(dir, '.rounds', 'coder-tools.txt'), 'Read\nBash(ls:*)\n');
  for (const r of rounds) fs.writeFileSync(path.join(dir, '.rounds', `${r}.md`), '# round\n');
  if (config) fs.writeFileSync(path.join(dir, '.rounds', 'config.json'), JSON.stringify(config));
  return dir;
}

const CLAUDE = { name: 'claude-main', kind: 'claude', model: 'sonnet', enabled: true, configDir: null, tools: '.rounds/coder-tools.txt' };
const CODEX = { name: 'codex', kind: 'codex', model: 'gpt-x', enabled: true, sandbox: 'workspace-write', writableRoots: ['/tmp/w'] };
const cfg = (extra = {}) => ({ coders: [CODEX, CLAUDE], order: ['codex', 'claude-main'], requireCleanTree: false, prompt: null, ...extra });

const chain = (dir) => fs.readFileSync(path.join(dir, '.rounds', 'chain.log'), 'utf8').trim().split('\n').filter(Boolean);
const runIn = async (dir, args, env = {}, bins = fakeBin()) => {
  const c = capture();
  const code = await main(['run', ...args], c.io, { project: dir, env: { ...process.env, PATH: pathWith(bins), ...env } });
  return { code, ...c };
};

test('help for each command, usage errors exit 2', async () => {
  for (const cmd of ['init', 'run', 'serve', 'status', 'tokens']) {
    const c = capture();
    assert.equal(await main([cmd, '--help'], c.io), 0);
    assert.match(c.out.join('\n'), /usage: coder-room /);
  }
  const c = capture();
  assert.equal(await main(['help'], c.io), 0);
  assert.equal(await main(['bogus'], capture().io), 2);
  assert.equal(await main(['run', '--nope'], capture().io, { project: tmp('cr-x-') }), 2);
});

test('init creates files, never overwrites, gitignore --yes and no-TTY path', async () => {
  const dir = tmp('cr-init-');
  const c = capture();
  assert.equal(await main(['init', '--dir', dir], c.io), 0);
  const r = path.join(dir, '.rounds');
  for (const f of ['HANDOFF.md', 'BACKLOG.md', 'spec-template.md', 'config.json', 'coder-tools.txt', 'chain.log']) {
    assert.ok(fs.existsSync(path.join(r, f)), f);
  }
  assert.match(c.out.join('\n'), /created: .*config\.json/);
  assert.ok(c.out.join('\n').includes('add this line to .gitignore'));
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  const tools = fs.readFileSync(path.join(r, 'coder-tools.txt'), 'utf8');
  assert.doesNotMatch(tools, /git (commit|push|checkout|reset)/);
  const conf = JSON.parse(fs.readFileSync(path.join(r, 'config.json'), 'utf8'));
  assert.ok(Array.isArray(conf.coders) && Array.isArray(conf.order));

  fs.writeFileSync(path.join(r, 'HANDOFF.md'), 'mine');
  const c2 = capture();
  assert.equal(await main(['init', '--dir', dir, '--yes'], c2.io), 0);
  assert.equal(fs.readFileSync(path.join(r, 'HANDOFF.md'), 'utf8'), 'mine');
  assert.match(c2.out.join('\n'), /kept: .*HANDOFF\.md/);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.rounds/\n');
  await main(['init', '--dir', dir, '--yes'], capture().io);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.rounds/\n');
});

test('init detects claude and codex on PATH', async () => {
  const dir = tmp('cr-init2-');
  const saved = process.env.PATH;
  process.env.PATH = pathWith(fakeBin());
  try {
    await main(['init', '--dir', dir], capture().io);
  } finally {
    process.env.PATH = saved;
  }
  const conf = JSON.parse(fs.readFileSync(path.join(dir, '.rounds', 'config.json'), 'utf8'));
  const by = Object.fromEntries(conf.coders.map((x) => [x.name, x]));
  assert.equal(by['claude-main'].enabled, true);
  assert.equal(by['claude-main'].configDir, null);
  assert.equal(by.codex.enabled, false);
  assert.equal(by.codex.model, '<set me>');
  assert.equal(by['claude-extra'].enabled, false);
});

test('run requires the round file and a config', async () => {
  const dir = project(cfg());
  assert.equal((await runIn(dir, ['nope'])).code, 2);
  assert.equal((await runIn(dir, [])).code, 2);
  const noCfg = project(null);
  assert.equal((await runIn(noCfg, ['q01'])).code, 2);
});

test('chain formats, claude command line, rotation', async () => {
  const dir = project(cfg({ order: ['claude-main'] }));
  fs.writeFileSync(path.join(dir, '.rounds', 'q01.log'), 'old');
  const out = path.join(dir, 'calls.jsonl');
  const r = await runIn(dir, ['q01', '--extra', 'be brief'], { FAKE_OUT: out, CLAUDE_CONFIG_DIR: '/should/be/removed' });
  assert.equal(r.code, 0);
  const lines = chain(dir);
  assert.match(lines[0], /^coder q01 started \d\d:\d\d on claude-main sonnet$/);
  assert.match(lines[1], /^coder q01 finished \d\d:\d\d rc=0 on claude-main$/);
  const prev = fs.readdirSync(path.join(dir, '.rounds')).filter((n) => /^q01-prev-\d{4}\.log$/.test(n));
  assert.equal(prev.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, '.rounds', prev[0]), 'utf8'), 'old');
  assert.match(fs.readFileSync(path.join(dir, '.rounds', 'q01.log'), 'utf8'), /"type":"result"/);
  const call = JSON.parse(fs.readFileSync(out, 'utf8').trim());
  assert.equal(call.bin, 'claude');
  assert.equal(call.cfg, null);
  const a = call.args;
  assert.deepEqual(a.slice(0, 9), ['-p', '--model', 'sonnet', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--allowedTools']);
  assert.deepEqual(a.slice(9, 11), ['Read', 'Bash(ls:*)']);
  assert.deepEqual(a.slice(11, 16), ['--strict-mcp-config', '--disable-slash-commands', '--no-chrome', '--tools', 'Read,Edit,Write,Glob,Grep,Bash,TodoWrite']);
  assert.equal(a[16], '--');
  assert.match(a[17], /\.rounds\/q01\.md/);
  assert.match(a[17], /q01-report\.md/);
  assert.match(a[17], /be brief$/);
});

test('codex command line and configDir expansion', async () => {
  const dir = project(cfg({ order: ['codex'] }));
  const out = path.join(dir, 'calls.jsonl');
  assert.equal((await runIn(dir, ['q01'], { FAKE_OUT: out })).code, 0);
  const call = JSON.parse(fs.readFileSync(out, 'utf8').trim());
  assert.equal(call.bin, 'codex');
  assert.deepEqual(call.args.slice(0, 7), ['exec', '-m', 'gpt-x', '-c', 'model_reasoning_summary=detailed', '-s', 'workspace-write']);
  assert.ok(call.args.includes('sandbox_workspace_write.writable_roots=["/tmp/w"]'));
  assert.ok(call.args.includes('--skip-git-repo-check'));
  assert.equal(call.args[call.args.indexOf('-o') + 1], '.rounds/q01-final.md');

  const dir2 = project(cfg({ coders: [{ ...CLAUDE, configDir: '~/.claude-zz' }], order: ['claude-main'] }));
  const out2 = path.join(dir2, 'calls.jsonl');
  await runIn(dir2, ['q01'], { FAKE_OUT: out2 });
  assert.equal(JSON.parse(fs.readFileSync(out2, 'utf8').trim()).cfg, path.join(os.homedir(), '.claude-zz'));
});

const startedOn = (dir) => chain(dir).filter((l) => l.includes(' started ')).map((l) => l.split(' on ')[1].split(' ')[0]);

test('coder choice: order, disabled, missing binary, limited, --coder', async () => {
  let dir = project(cfg());
  await runIn(dir, ['q01']);
  assert.deepEqual(startedOn(dir), ['codex']);

  dir = project(cfg({ coders: [{ ...CODEX, enabled: false }, CLAUDE] }));
  await runIn(dir, ['q01']);
  assert.deepEqual(startedOn(dir), ['claude-main']);

  dir = project(cfg());
  await runIn(dir, ['q01'], {}, fakeBin(['claude']));
  assert.deepEqual(startedOn(dir), ['claude-main']);

  dir = project(cfg());
  fs.writeFileSync(path.join(dir, '.rounds', 'coders-state.json'), JSON.stringify({ codex: { limitedAt: new Date().toISOString() } }));
  await runIn(dir, ['q01']);
  assert.deepEqual(startedOn(dir), ['claude-main']);
  fs.rmSync(path.join(dir, '.rounds', 'q01.log'));
  await runIn(dir, ['q01', '--coder', 'codex']);
  assert.deepEqual(startedOn(dir), ['claude-main', 'codex']);

  dir = project(cfg());
  const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(dir, '.rounds', 'coders-state.json'), JSON.stringify({ codex: { limitedAt: old } }));
  await runIn(dir, ['q01']);
  assert.deepEqual(startedOn(dir), ['codex']);
  assert.equal(limitedUntil({ x: { limitedAt: old } }, 'x'), null);

  dir = project(cfg());
  assert.equal((await runIn(dir, ['q01', '--coder', 'ghost'])).code, 2);
  assert.equal((await runIn(dir, ['q01'], {}, fakeBin([]))).code, 1);
});

test('LIMIT falls back to the next coder; state is marked', async () => {
  const dir = project(cfg());
  const r = await runIn(dir, ['q01'], { FAKE_CODEX: 'limit' });
  assert.equal(r.code, 0);
  const lines = chain(dir);
  assert.equal(lines.length, 3 + 1);
  assert.match(lines[0], /^coder q01 started \d\d:\d\d on codex gpt-x$/);
  assert.match(lines[1], /^coder q01 LIMIT \d\d:\d\d on codex$/);
  assert.match(lines[2], /^coder q01 started \d\d:\d\d on claude-main sonnet$/);
  assert.match(lines[3], /^coder q01 finished \d\d:\d\d rc=0 on claude-main$/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.rounds', 'coders-state.json'), 'utf8'));
  assert.ok(Date.parse(state.codex.limitedAt) > Date.now() - 60000);
  assert.ok(fs.readdirSync(path.join(dir, '.rounds')).some((n) => n.startsWith('q01-prev-')));
  assert.match(fs.readFileSync(path.join(dir, '.rounds', 'q01.log'), 'utf8'), /"type":"result"/);
});

test('--no-fallback stops at LIMIT; all limited exits 1; report suppresses LIMIT', async () => {
  let dir = project(cfg());
  assert.equal((await runIn(dir, ['q01', '--no-fallback'], { FAKE_CODEX: 'limit' })).code, 1);
  assert.deepEqual(chain(dir).map((l) => l.split(' ')[2]), ['started', 'LIMIT']);

  dir = project(cfg());
  assert.equal((await runIn(dir, ['q01'], { FAKE_CODEX: 'limit', FAKE_CLAUDE: 'limit' })).code, 1);
  assert.deepEqual(chain(dir).map((l) => l.split(' ')[2]), ['started', 'LIMIT', 'started', 'LIMIT']);

  dir = project(cfg({ order: ['codex'] }));
  fs.writeFileSync(path.join(dir, '.rounds', 'q01-report.md'), 'done');
  assert.equal((await runIn(dir, ['q01'], { FAKE_CODEX: 'limit' })).code, 1);
  assert.match(chain(dir)[1], /^coder q01 finished \d\d:\d\d rc=1 on codex$/);
});

test('failing coder writes finished with its rc and exits 1', async () => {
  const dir = project(cfg({ order: ['claude-main'] }));
  assert.equal((await runIn(dir, ['q01'], { FAKE_CLAUDE: 'fail' })).code, 1);
  assert.match(chain(dir)[1], /rc=4 on claude-main$/);
});

test('requireCleanTree refuses a dirty tree with exit 3', async () => {
  const dir = project(cfg({ requireCleanTree: true }));
  const git = spawnSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(git.status, 0);
  const r = await runIn(dir, ['q01']);
  assert.equal(r.code, 3);
  assert.deepEqual(chain(dir).length, 1);
  assert.match(chain(dir)[0], /^coder q01 REFUSED \d\d:\d\d: dirty tree$/);
});

test('--detach returns a pid and the log path, the child finishes the round', async () => {
  const dir = project(cfg({ order: ['claude-main'] }));
  const r = await runIn(dir, ['q01', '--detach']);
  assert.equal(r.code, 0);
  const pid = Number(/^pid (\d+)$/.exec(r.out[0])?.[1]);
  assert.ok(pid > 0);
  assert.equal(r.out[1], `log ${path.join(dir, '.rounds', 'q01.log')}`);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !chain(dir).some((l) => l.includes(' finished '))) await new Promise((res) => setTimeout(res, 100));
  assert.ok(chain(dir).some((l) => l.includes(' finished ')));
  try {
    process.kill(pid);
  } catch {
    /* already exited */
  }
});

const RESULT = (cost) => JSON.stringify({
  type: 'result', total_cost_usd: cost, num_turns: 5, duration_ms: 12000,
  usage: { input_tokens: 1 },
  modelUsage: { 'm-a': { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 300, cacheCreationInputTokens: 400, costUSD: cost / 2 },
    'm-b': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: cost / 2 } },
});

test('tokens parses claude and codex logs, incomplete rounds, totals and json', async () => {
  const dir = project(cfg(), { rounds: [] });
  const r = path.join(dir, '.rounds');
  fs.writeFileSync(path.join(r, 'q01.log'), `{"type":"assistant"}\n${RESULT(1)}\n`);
  fs.writeFileSync(path.join(r, 'q02.log'), 'codex\nhi\ntokens used\n224,637\nmore\n');
  fs.writeFileSync(path.join(r, 'q10.log'), '{"type":"assistant"}\n');
  fs.writeFileSync(path.join(r, 'q01-prev-1200.log'), RESULT(9));
  const c = capture();
  assert.equal(await main(['tokens', '--dir', dir], c.io), 0);
  const text = c.out.join('\n');
  assert.match(text, /q01 +m-a,m-b +101 +202 +303 +404 +1,010 +\$1\.00 +5 +12s/);
  assert.match(text, /q02 +total \(Codex\).* 224,637/);
  assert.match(text, /q10 +incomplete/);
  assert.match(text, /TOTAL .*\$1\.00/);
  assert.doesNotMatch(text, /prev/);
  assert.ok(text.indexOf('q02') < text.indexOf('q10'));

  const j = capture();
  await main(['tokens', '--dir', dir, '--json', '--round', 'q01'], j.io);
  const data = JSON.parse(j.out.join('\n'));
  assert.equal(data.rounds.length, 1);
  assert.equal(data.rounds[0].usage.models[0].cacheWrite, 400);
  assert.equal(data.rounds[0].usage.costUSD, 1);
});

test('status lists coders, recent events and running rounds', async () => {
  const dir = project(cfg());
  fs.writeFileSync(path.join(dir, '.rounds', 'coders-state.json'), JSON.stringify({ codex: { limitedAt: new Date().toISOString() } }));
  fs.writeFileSync(path.join(dir, '.rounds', 'chain.log'), [
    'coder q01 started 10:00 on codex gpt-x', 'coder q01 LIMIT 10:05 on codex', 'coder q02 started 10:06 on claude-main sonnet',
    'round q01 ready for orchestrator check 10:07', 'coder q03 started 10:08 on claude-main sonnet',
    'coder q03 finished 10:09 rc=0 on claude-main', '',
  ].join('\n'));
  const c = capture();
  const code = await main(['status'], c.io, { project: dir, env: { ...process.env, PATH: pathWith(fakeBin(['claude'])) } });
  assert.equal(code, 0);
  const text = c.out.join('\n');
  assert.match(text, /codex .*enabled, not on PATH, limited until/);
  assert.match(text, /claude-main .*enabled, on PATH, not limited/);
  assert.match(text, /coder q03 finished 10:09 rc=0 on claude-main/);
  assert.doesNotMatch(text, /ready for orchestrator/);
  assert.match(text, /running: q02$/);
});
