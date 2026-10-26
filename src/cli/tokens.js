import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { runsDirOf } from '../runs-dir.js';
import { EXIT, parseFlags } from './common.js';

export const TOKENS_HELP = `usage: coder-room tokens [--round <r>] [--json] [--dir <project>]
  Per-round usage from .rounds/<round>.log: Claude stream-json result (modelUsage, cost, turns, duration)
  or Codex "tokens used". Rounds without a result show "incomplete".
`;

/** Reads one log line by line; keeps only the result event or the Codex token count. */
export async function readUsage(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let resultEvent = null;
  let codexTotal = null;
  let afterLabel = false;
  for await (const line of rl) {
    if (afterLabel) {
      const n = Number(line.trim().replaceAll(',', ''));
      if (Number.isFinite(n) && line.trim() !== '') codexTotal = n;
      afterLabel = false;
    } else if (line.trim() === 'tokens used') afterLabel = true;
    else if (line.startsWith('{') && line.includes('"type":"result"')) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'result') resultEvent = ev;
      } catch {
        /* partial line */
      }
    }
  }
  if (resultEvent) {
    const models = Object.entries(resultEvent.modelUsage ?? {}).map(([model, u]) => ({
      model,
      input: u.inputTokens ?? 0,
      output: u.outputTokens ?? 0,
      cacheRead: u.cacheReadInputTokens ?? 0,
      cacheWrite: u.cacheCreationInputTokens ?? 0,
      costUSD: u.costUSD ?? 0,
    }));
    return { kind: 'claude', models, costUSD: resultEvent.total_cost_usd ?? 0, turns: resultEvent.num_turns ?? null, durationMs: resultEvent.duration_ms ?? null };
  }
  if (codexTotal !== null) return { kind: 'codex', total: codexTotal };
  return { kind: 'incomplete' };
}

const roundKey = (n) => n.replace(/\d+/g, (d) => d.padStart(6, '0'));

export function listRoundLogs(dir) {
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.log') && n !== 'chain.log' && !n.includes('-prev-'))
    .map((n) => n.slice(0, -4))
    .sort((a, b) => (roundKey(a) < roundKey(b) ? -1 : 1));
}

const num = (n) => n.toLocaleString('en-US');
const usd = (n) => `$${n.toFixed(2)}`;
const secs = (ms) => (ms == null ? '-' : `${Math.round(ms / 1000)}s`);

const claudeTotal = (u) => u.models.reduce((a, m) => a + m.input + m.output + m.cacheRead + m.cacheWrite, 0);
const totalOf = (u) => (u.kind === 'claude' ? claudeTotal(u) : u.kind === 'codex' ? u.total : 0);

function rowsOf(rounds) {
  return rounds.map((r) => {
    const u = r.usage;
    if (u.kind === 'claude') {
      const sum = (k) => u.models.reduce((a, m) => a + m[k], 0);
      return [r.round, u.models.map((m) => m.model).join(','), num(sum('input')), num(sum('output')), num(sum('cacheRead')), num(sum('cacheWrite')), num(claudeTotal(u)), usd(u.costUSD), String(u.turns ?? '-'), secs(u.durationMs)];
    }
    if (u.kind === 'codex') return [r.round, 'total (Codex)', '-', '-', '-', '-', num(u.total), '-', '-', '-'];
    return [r.round, 'incomplete', '-', '-', '-', '-', '-', '-', '-', '-'];
  });
}

export function formatTable(rounds) {
  const head = ['round', 'model', 'input', 'output', 'cache read', 'cache write', 'total', 'cost', 'turns', 'time'];
  const claude = rounds.filter((r) => r.usage.kind === 'claude');
  const sum = (k) => num(claude.reduce((a, r) => a + r.usage.models.reduce((b, m) => b + m[k], 0), 0));
  const totalRow = [
    'TOTAL', '', sum('input'), sum('output'), sum('cacheRead'), sum('cacheWrite'),
    num(rounds.reduce((a, r) => a + totalOf(r.usage), 0)),
    usd(claude.reduce((a, r) => a + r.usage.costUSD, 0)), String(claude.reduce((a, r) => a + (r.usage.turns ?? 0), 0)),
    secs(claude.reduce((a, r) => a + (r.usage.durationMs ?? 0), 0)),
  ];
  const all = [head, ...rowsOf(rounds), totalRow];
  const widths = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [fmt(head), ...all.slice(1, -1).map(fmt), '-'.repeat(fmt(head).length), fmt(totalRow)].join('\n');
}

export async function tokens(argv, io = { out: console.log, err: console.error }, ctx = {}) {
  const f = parseFlags(argv, { round: 'value', json: 'bool', dir: 'value' });
  const project = path.resolve(f.dir ?? ctx.project ?? process.cwd());
  const dir = await runsDirOf(project);
  if (!dir) { io.err('no .rounds/ here (run: coder-room init)'); return EXIT.usage; }
  let names = listRoundLogs(dir);
  if (f.round) names = names.filter((n) => n === f.round);
  const rounds = [];
  for (const round of names) rounds.push({ round, usage: await readUsage(path.join(dir, `${round}.log`)) });
  io.out(f.json ? JSON.stringify({ rounds }, null, 2) : formatTable(rounds));
  return EXIT.ok;
}
