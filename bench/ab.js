#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommand } from '../src/cli/run.js';
import { buildRows, measureArm, toMarkdown } from './measure.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ROUND = 'ab1';

export const USAGE = 'usage: node bench/ab.js [--arms A,B] [--coder-lean on|off] [--dry]\n';

const REVIEW = `Then review \`git diff\` against the spec in .rounds/${ROUND}.md, run \`npm test\` once, and answer with exactly one final line: SHIP or FIX followed by one short reason. Do not edit code yourself.`;

const onPathIn = (bin, env) => (env.PATH ?? '').split(path.delimiter).some((d) => {
  try {
    fs.accessSync(path.join(d, bin), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

const stampOf = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

const expandHome = (p) => (p === '~' || p?.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

/** Command (cmd + args) of the orchestrator `claude -p` session for one arm. */
export function orchestratorCommand(arm, { orchModel, repo }) {
  const cli = `node ${path.join(repo, 'bin', 'coder-room.js')} run ${ROUND}`;
  const common = ['Read', 'Grep', 'Glob', 'Bash(npm test:*)', 'Bash(git diff:*)', 'Bash(git status:*)'];
  const tools = arm === 'A'
    ? [...common, 'Bash(coder-room run:*)', `Bash(${cli}:*)`]
    : [...common, 'Agent', 'Edit', 'Write', 'Bash(node:*)'];
  const prompt = arm === 'A'
    ? `You are the orchestrator of a small coding round. Run the coder with this exact command (it blocks until the coder finishes): ${cli} . Then read .rounds/${ROUND}-report.md. ${REVIEW}`
    : `You are the orchestrator of a small coding round. Delegate implementing .rounds/${ROUND}.md to exactly one subagent (Agent tool, model sonnet) and tell it to read AGENTS.md and .rounds/${ROUND}.md, implement every item with its tests, run npm test, and write .rounds/${ROUND}-report.md. Then read that report. ${REVIEW}`;
  const args = ['-p', '--model', orchModel, '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--allowedTools', ...tools, '--', prompt];
  return { cmd: 'claude', args };
}

const quote = (s) => (/^[\w@%+=:,./()*-]+$/.test(s) ? s : JSON.stringify(s));
export const formatCommand = ({ cmd, args }) => [cmd, ...args].map(quote).join(' ');

function exec(cmd, args, { cwd, env, logFile }) {
  const fd = logFile ? fs.openSync(logFile, 'w') : null;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', fd ?? 'pipe', fd ?? 'pipe'] });
    let out = '';
    if (fd === null) {
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', () => {});
    }
    child.on('error', () => resolve({ code: 127, out }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  }).finally(() => { if (fd !== null) fs.closeSync(fd); });
}

const git = (cwd, env, ...args) => exec('git', args, { cwd, env });

async function prepareCopy(fixture, dir, env, arm, { coderModel, configDir, coderLean }) {
  fs.cpSync(fixture, dir, { recursive: true });
  if (arm === 'A') {
    const file = path.join(dir, '.rounds', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.coders = [{ ...cfg.coders[0], model: coderModel, configDir: configDir ?? null, lean: coderLean }];
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  }
  const ident = ['-c', 'user.name=ab-bench', '-c', 'user.email=ab-bench@example.invalid', '-c', 'commit.gpgsign=false'];
  await git(dir, env, 'init', '-q');
  await git(dir, env, 'add', '-A');
  await git(dir, env, ...ident, 'commit', '-q', '-m', 'fixture');
}

async function finish(dir, env) {
  const testEnv = { ...env };
  delete testEnv.NODE_TEST_CONTEXT;
  const test = await exec('npm', ['test'], { cwd: dir, env: testEnv, logFile: path.join(dir, 'npm-test.log') });
  const stat = (await git(dir, env, 'diff', '--stat')).out;
  const status = (await git(dir, env, 'status', '--porcelain', '-uall')).out;
  const filesChanged = status.split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.startsWith('.rounds/') && f !== 'orchestrator.log' && f !== 'npm-test.log');
  return { testsPass: test.code === 0, diffStat: stat.trim(), filesChanged };
}

/**
 * Runs (or with dry, only prepares) the arms one after the other.
 * opts: { env, arms, dry, fixture, resultsRoot, repo, now, out }
 */
export async function runBench(opts = {}) {
  const env = opts.env ?? process.env;
  const out = opts.out ?? console.log;
  const arms = opts.arms ?? ['A', 'B'];
  const repo = opts.repo ?? REPO;
  const fixture = opts.fixture ?? path.join(HERE, 'fixture');
  const resultsRoot = opts.resultsRoot ?? path.join(HERE, 'results');
  if (!opts.dry && !onPathIn('claude', env)) throw new Error('claude is not on PATH');

  const configDir = env.AB_CONFIG_DIR ? expandHome(env.AB_CONFIG_DIR) : null;
  const orchModel = env.AB_ORCH_MODEL || 'opus';
  const coderModel = env.AB_CODER_MODEL || 'sonnet';
  const coderLean = opts.coderLean !== false;
  const childEnv = { ...env, BASH_DEFAULT_TIMEOUT_MS: '1800000', BASH_MAX_TIMEOUT_MS: '1800000' };
  if (configDir) childEnv.CLAUDE_CONFIG_DIR = configDir;

  fs.mkdirSync(resultsRoot, { recursive: true });
  const base = stampOf(opts.now ?? new Date());
  let stamp = base;
  for (let n = 2; ; n++) {
    try {
      fs.mkdirSync(path.join(resultsRoot, stamp));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      stamp = `${base}-${n}`;
    }
  }
  const root = path.join(resultsRoot, stamp);

  const summaries = {};
  for (const arm of arms) {
    const dir = path.join(root, arm);
    await prepareCopy(fixture, dir, childEnv, arm, { coderModel, configDir, coderLean });
    const command = orchestratorCommand(arm, { orchModel, repo });
    if (opts.dry) {
      out(`[${arm}] cwd ${dir}`);
      out(`[${arm}] ${configDir ? 'CLAUDE_CONFIG_DIR=<AB_CONFIG_DIR> ' : ''}${formatCommand(command)}`);
      if (arm === 'A') {
        const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.rounds', 'config.json'), 'utf8'));
        const coder = buildCommand(cfg.coders[0], ROUND, '<prompt>', dir);
        out(`[A] the coder is started by that command: coder-room run ${ROUND} (lean ${coderLean ? 'on' : 'off'}, from ${path.join(dir, '.rounds', 'config.json')})`);
        out(`[A] coder: ${formatCommand(coder)}`);
      }
      continue;
    }
    const started = Date.now();
    const orchLog = path.join(dir, 'orchestrator.log');
    await exec(command.cmd, command.args, { cwd: dir, env: childEnv, logFile: orchLog });
    const wallSeconds = (Date.now() - started) / 1000;
    const after = await finish(dir, childEnv);
    const measure = measureArm({ orchLog, coderLog: arm === 'A' ? path.join(dir, '.rounds', `${ROUND}.log`) : null });
    summaries[arm] = { arm, wallSeconds, ...after, measure };
  }
  if (opts.dry) return { root, summaries };

  const notes = [
    'Every claude process (both orchestrators and the arm A coder) ran on one account (AB_CONFIG_DIR). In real use the arm A coder can run on another account or tool, and its tokens would not count against the orchestrator session.',
    'Orchestrator session tokens: arm A counts the orchestrator only; arm B counts the orchestrator and its subagent.',
    'Costs are client-side estimates (total_cost_usd).',
    `Arm A coder lean mode: ${coderLean ? 'on' : 'off'} (--coder-lean).`,
  ];
  const rows = buildRows(summaries.A, summaries.B);
  const markdown = toMarkdown(rows, notes);
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ stamp, orchModel, coderModel, coderLean, arms: summaries, rows, notes }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'results.md'), markdown);
  out(markdown);
  return { root, summaries, rows, markdown };
}

export function parseArgs(argv) {
  const o = { arms: ['A', 'B'], dry: false, coderLean: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') o.dry = true;
    else if (argv[i] === '--coder-lean') {
      const v = argv[++i];
      if (v !== 'on' && v !== 'off') throw new Error('--coder-lean takes on or off');
      o.coderLean = v === 'on';
    }
    else if (argv[i] === '--arms') {
      const arms = (argv[++i] ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (!arms.length || arms.some((a) => a !== 'A' && a !== 'B')) throw new Error('--arms takes A, B or A,B');
      o.arms = [...new Set(arms)].sort();
    } else throw new Error(`unknown option ${argv[i]}`);
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runBench(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    process.exitCode = 2;
  }
}
