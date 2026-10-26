import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCommand } from '../src/cli/run.js';
import { CORE_TOOLS, defaultConfig } from '../src/cli/templates.js';
import { main } from '../src/cli/main.js';
import { parseArgs, runBench } from '../bench/ab.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const LEAN_FLAGS = ['--strict-mcp-config', '--disable-slash-commands', '--no-chrome', '--tools'];

function project(tools = 'Read\nBash(ls:*)\n') {
  const dir = tmp('cr-lean-');
  fs.mkdirSync(path.join(dir, '.rounds'));
  fs.writeFileSync(path.join(dir, '.rounds', 'coder-tools.txt'), tools);
  return dir;
}
const claude = (extra = {}) => ({ name: 'c', kind: 'claude', model: 'sonnet', enabled: true, ...extra });

test('lean adds the flags after --allowedTools and before --', () => {
  const { args } = buildCommand(claude({ lean: true }), 'q01', 'PROMPT', project());
  const i = args.indexOf('--strict-mcp-config');
  assert.deepEqual(args.slice(i, i + 5), [...LEAN_FLAGS, CORE_TOOLS.join(',')]);
  assert.equal(args[i + 5], '--');
  assert.equal(args[i + 6], 'PROMPT');
  assert.deepEqual(args.slice(args.indexOf('--allowedTools'), i), ['--allowedTools', 'Read', 'Bash(ls:*)']);
});

test('coreTools overrides the tool list', () => {
  const { args } = buildCommand(claude({ coreTools: ['Read', 'Grep'] }), 'q01', 'P', project());
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep');
});

test('a config without lean is lean', () => {
  const { args } = buildCommand(claude(), 'q01', 'P', project());
  assert.ok(LEAN_FLAGS.every((f) => args.includes(f)));
});

test('lean false keeps the old command exactly', () => {
  const { args } = buildCommand(claude({ lean: false }), 'q01', 'P', project());
  assert.deepEqual(args, ['-p', '--model', 'sonnet', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose',
    '--allowedTools', 'Read', 'Bash(ls:*)', '--', 'P']);
});

test('lean without a tools file puts the flags right before --', () => {
  const dir = tmp('cr-lean-none-');
  const { args } = buildCommand(claude(), 'q01', 'P', dir);
  assert.deepEqual(args.slice(-7, -2), [...LEAN_FLAGS, CORE_TOOLS.join(',')]);
  assert.equal(args.at(-2), '--');
  assert.ok(!args.includes('--allowedTools'));
});

test('codex commands carry no lean flags', () => {
  const { args } = buildCommand({ name: 'x', kind: 'codex', model: 'm' }, 'q01', 'P', project());
  assert.ok(!args.includes('--strict-mcp-config'));
});

test('defaultConfig and init write lean and coreTools', async () => {
  for (const c of defaultConfig({ claude: true, codex: false }).coders) {
    assert.equal(c.lean, true);
    assert.deepEqual(c.coreTools, ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'TodoWrite']);
  }
  const dir = tmp('cr-lean-init-');
  await main(['init', '--dir', dir, '--yes'], { out: () => {}, err: () => {} });
  const conf = JSON.parse(fs.readFileSync(path.join(dir, '.rounds', 'config.json'), 'utf8'));
  for (const c of conf.coders.filter((x) => x.kind === 'claude')) assert.equal(c.lean, true);
});

test('bench parseArgs reads --coder-lean', () => {
  assert.equal(parseArgs([]).coderLean, true);
  assert.equal(parseArgs(['--coder-lean', 'off']).coderLean, false);
  assert.equal(parseArgs(['--coder-lean', 'on']).coderLean, true);
  assert.throws(() => parseArgs(['--coder-lean', 'maybe']), /--coder-lean/);
  assert.throws(() => parseArgs(['--coder-lean']), /--coder-lean/);
});

test('bench passes lean off into the fixture config and --dry reports it', async () => {
  const work = tmp('ab-lean-');
  const lines = [];
  const env = { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), HOME: work };
  for (const [coderLean, want] of [[false, false], [undefined, true]]) {
    const r = await runBench({ env, dry: true, arms: ['A'], coderLean, resultsRoot: path.join(work, `r${want}`), out: (s) => lines.push(s) });
    const cfg = JSON.parse(fs.readFileSync(path.join(r.root, 'A', '.rounds', 'config.json'), 'utf8'));
    assert.equal(cfg.coders[0].lean, want);
  }
  assert.ok(lines.some((l) => l.includes('lean off')));
  assert.ok(lines.some((l) => l.includes('lean on')));
  const coderLines = lines.filter((l) => l.startsWith('[A] coder: '));
  assert.equal(coderLines.length, 2);
  assert.ok(!coderLines[0].includes('--strict-mcp-config'));
  assert.match(coderLines[1], /--strict-mcp-config --disable-slash-commands --no-chrome --tools Read,Edit,Write,Glob,Grep,Bash,TodoWrite -- /);
});
