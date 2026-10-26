import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLimited } from './limit.js';
import { CORE_TOOLS } from './templates.js';
import {
  EXIT, appendChain, expandHome, hhmm, limitedUntil, loadConfig, loadState, onPath, parseFlags, roundsDir, stateFile,
} from './common.js';

export const RUN_HELP = `usage: coder-room run <round> [--coder <name>] [--no-fallback] [--extra "<text>"] [--detach]
  Runs .rounds/<round>.md with a coder as a separate process; stdout+stderr go to .rounds/<round>.log.
  Without --coder, the first enabled coder in config "order" that is on PATH and not limited runs the round.
  A LIMIT marks that coder limited for 1 hour and the run falls back to the next one.
  Exit: 0 ok, 1 coder failed/limited with no fallback, 2 usage, 3 refused (dirty tree).
`;

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'coder-room.js');

export function defaultPrompt(round, extra) {
  return [
    `Read AGENTS.md or CLAUDE.md and .rounds/${round}.md and implement every item with its tests, only where the round file allows.`,
    'No git commands that change the tree.',
    'One heavy command at a time, never in background or parallel. Stop every server you start (by its PID) before you finish.',
    'Narrate as you work: before each step write one short plain sentence saying what you are doing and why.',
    "Keep a TodoWrite checklist of the round's items (Claude) and update it as items start and finish.",
    'Run the gates in the round file.',
    `Write .rounds/${round}-report.md at the end.`,
    extra ?? '',
  ].join(' ').trim();
}

export function buildCommand(coder, round, prompt, project) {
  if (coder.kind === 'claude') {
    const toolsFile = path.resolve(project, coder.tools ?? '.rounds/coder-tools.txt');
    let tools = [];
    try {
      tools = fs.readFileSync(toolsFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      /* no tools file: the permission mode alone applies */
    }
    const args = ['-p', '--model', coder.model, '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose'];
    if (tools.length) args.push('--allowedTools', ...tools);
    if (coder.lean !== false) {
      const core = Array.isArray(coder.coreTools) && coder.coreTools.length ? coder.coreTools : CORE_TOOLS;
      args.push('--strict-mcp-config', '--disable-slash-commands', '--no-chrome', '--tools', core.join(','));
    }
    return { cmd: 'claude', args: [...args, '--', prompt] };
  }
  const args = ['exec', '-m', coder.model, '-c', 'model_reasoning_summary=detailed', '-s', coder.sandbox ?? 'workspace-write'];
  if (coder.writableRoots?.length) args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(coder.writableRoots)}`);
  args.push('--skip-git-repo-check', '-o', `.rounds/${round}-final.md`, prompt);
  return { cmd: 'codex', args };
}

function rotateLog(project, round) {
  const dir = roundsDir(project);
  const log = path.join(dir, `${round}.log`);
  if (!fs.existsSync(log)) return;
  let dest = path.join(dir, `${round}-prev-${hhmm().replace(':', '')}.log`);
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${round}-prev-${hhmm().replace(':', '')}-${n}.log`);
  fs.renameSync(log, dest);
}

function readTail(file, max = 4 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function collect(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(out));
  });
}

function runCoder(project, coder, round, prompt, env) {
  const { cmd, args } = buildCommand(coder, round, prompt, project);
  const childEnv = { ...env };
  if (coder.configDir) childEnv.CLAUDE_CONFIG_DIR = expandHome(coder.configDir);
  else if (coder.kind === 'claude') delete childEnv.CLAUDE_CONFIG_DIR;
  const nice = onPath('nice', env);
  const logFd = fs.openSync(path.join(roundsDir(project), `${round}.log`), 'w');
  return new Promise((resolve) => {
    const child = spawn(nice ? 'nice' : cmd, nice ? ['-n', '10', cmd, ...args] : args, {
      cwd: project, env: childEnv, stdio: ['ignore', logFd, logFd],
    });
    child.on('error', () => resolve(127));
    child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  }).finally(() => fs.closeSync(logFd));
}

function eligible(cfg, env, state) {
  return cfg.order
    .map((n) => cfg.coders.find((c) => c.name === n))
    .filter((c) => c && c.enabled !== false && onPath(c.kind, env) && !limitedUntil(state, c.name));
}

export async function run(argv, io = { out: console.log, err: console.error }, ctx = {}) {
  const flags = parseFlags(argv, { coder: 'value', 'no-fallback': 'bool', extra: 'value', detach: 'bool' });
  const project = path.resolve(ctx.project ?? process.cwd());
  const env = ctx.env ?? process.env;
  const round = flags._[0];
  if (!round) { io.err('missing <round>\n' + RUN_HELP); return EXIT.usage; }
  if (!fs.existsSync(path.join(roundsDir(project), `${round}.md`))) {
    io.err(`missing .rounds/${round}.md`);
    return EXIT.usage;
  }
  const cfg = loadConfig(project);
  if (!cfg) { io.err('missing or invalid .rounds/config.json (run: coder-room init)'); return EXIT.usage; }

  if (flags.detach) {
    const rest = argv.filter((a) => a !== '--detach');
    const child = spawn(process.execPath, [BIN, 'run', ...rest], { cwd: project, env, detached: true, stdio: 'ignore' });
    child.unref();
    io.out(`pid ${child.pid}`);
    io.out(`log ${path.join(roundsDir(project), `${round}.log`)}`);
    return EXIT.ok;
  }

  let queue = eligible(cfg, env, loadState(project));
  if (flags.coder) {
    const forced = cfg.coders.find((c) => c.name === flags.coder);
    if (!forced) { io.err(`unknown coder ${flags.coder}`); return EXIT.usage; }
    queue = [forced, ...queue.filter((c) => c !== forced)];
  }
  if (!queue.length) { io.err('no coder available (enabled, on PATH, not limited)'); return EXIT.failed; }

  if (cfg.requireCleanTree) {
    const dirty = await collect('git', ['status', '--porcelain'], project);
    if (dirty === null || dirty.trim() !== '') {
      appendChain(project, `coder ${round} REFUSED ${hhmm()}: dirty tree`);
      io.err('refused: dirty tree');
      return EXIT.refused;
    }
  }

  const prompt = cfg.prompt ? cfg.prompt.replaceAll('{round}', round) : defaultPrompt(round, flags.extra);
  const fullPrompt = cfg.prompt && flags.extra ? `${prompt} ${flags.extra}` : prompt;
  for (let i = 0; i < queue.length; i++) {
    const coder = queue[i];
    rotateLog(project, round);
    appendChain(project, `coder ${round} started ${hhmm()} on ${coder.name} ${coder.model}`);
    const rc = await runCoder(project, coder, round, fullPrompt, env);
    const log = readTail(path.join(roundsDir(project), `${round}.log`));
    const hasReport = fs.existsSync(path.join(roundsDir(project), `${round}-report.md`));
    const limited = isLimited(coder.kind, log, cfg.limitPatterns[coder.kind] ?? []);
    if (limited && !hasReport) {
      appendChain(project, `coder ${round} LIMIT ${hhmm()} on ${coder.name}`);
      const state = loadState(project);
      state[coder.name] = { limitedAt: new Date().toISOString() };
      fs.writeFileSync(stateFile(project), JSON.stringify(state, null, 2) + '\n');
      if (flags['no-fallback'] || i === queue.length - 1) return EXIT.failed;
      continue;
    }
    appendChain(project, `coder ${round} finished ${hhmm()} rc=${rc} on ${coder.name}`);
    return rc === 0 ? EXIT.ok : EXIT.failed;
  }
  return EXIT.failed;
}
