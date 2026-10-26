import fs from 'node:fs';

const num = (v) => (Number.isFinite(v) ? v : 0);

/** The `result` events of a stream-json log; other and broken lines are skipped. */
export function readResults(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev?.type === 'result') out.push(ev);
    } catch {
      /* partial line */
    }
  }
  return out;
}

export const mainLoop = (usage = {}) => ({
  input: num(usage.input_tokens),
  output: num(usage.output_tokens),
  cacheRead: num(usage.cache_read_input_tokens),
  cacheWrite: num(usage.cache_creation_input_tokens),
});

const modelTokens = (m) => ({
  input: num(m.inputTokens),
  output: num(m.outputTokens),
  cacheRead: num(m.cacheReadInputTokens),
  cacheWrite: num(m.cacheCreationInputTokens),
});

export const sumTokens = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** Adds each result's modelUsage into `models` (name -> tokens + cost). */
function addModels(models, events) {
  for (const ev of events) {
    for (const [name, m] of Object.entries(ev.modelUsage ?? {})) {
      const cur = models[name] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      const t = modelTokens(m);
      for (const k of Object.keys(t)) cur[k] += t[k];
      cur.cost += num(m.costUSD);
      models[name] = cur;
    }
  }
}

const tokensOfModels = (models) => Object.values(models).reduce((n, m) => n + sumTokens(m), 0);

/** The SHIP or FIX line of the orchestrator's final answer, or null. */
export function verdictOf(ev) {
  const lines = String(ev?.result ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return [...lines].reverse().find((l) => /\b(SHIP|FIX)\b/.test(l)) ?? null;
}

/**
 * Measures one arm from its orchestrator log and (arm A) its coder log.
 * usage is the main loop only; modelUsage and total_cost_usd include subagents.
 */
export function measureArm({ orchLog, coderLog }) {
  const orch = readResults(orchLog);
  const last = orch.at(-1);
  const orchModels = {};
  addModels(orchModels, orch);
  const allModels = {};
  addModels(allModels, [...orch, ...(coderLog ? readResults(coderLog) : [])]);
  const coder = coderLog ? readResults(coderLog) : [];
  return {
    orchestratorMainLoop: mainLoop(last?.usage),
    orchestratorSessionTokens: tokensOfModels(orchModels) || sumTokens(mainLoop(last?.usage)),
    totalTokens: tokensOfModels(allModels),
    models: allModels,
    orchestratorCostUsd: orch.reduce((n, e) => n + num(e.total_cost_usd), 0),
    costUsd: [...orch, ...coder].reduce((n, e) => n + num(e.total_cost_usd), 0),
    verdict: verdictOf(last),
    resultEvents: orch.length + coder.length,
  };
}

const int = (v) => Math.round(v).toLocaleString('en-US');
const FORMAT = {
  tokens: int,
  usd: (v) => `$${v.toFixed(4)}`,
  sec: (v) => `${v.toFixed(1)}s`,
  text: (v) => String(v),
};

/** B minus A, with the percent of A when A is not zero. */
export function difference(a, b, kind) {
  if (a == null || b == null || kind === 'text') return '—';
  const d = b - a;
  const sign = d > 0 ? '+' : d < 0 ? '-' : '';
  const body = kind === 'usd' ? `$${Math.abs(d).toFixed(4)}` : kind === 'sec' ? `${Math.abs(d).toFixed(1)}s` : int(Math.abs(d));
  const pct = a !== 0 ? ` (${d >= 0 ? '+' : '-'}${Math.abs((d / a) * 100).toFixed(1)}%)` : '';
  return `${sign}${body}${pct}`;
}

/** Rows {metric, kind, a, b} from the per-arm summaries (null when an arm did not run). */
export function buildRows(A, B) {
  const get = (arm, f) => (arm ? f(arm) : null);
  const rows = [];
  const add = (metric, kind, f) => rows.push({ metric, kind, a: get(A, f), b: get(B, f) });
  const main = (key) => (arm) => arm.measure.orchestratorMainLoop[key];
  add('orchestrator main-loop input tokens', 'tokens', main('input'));
  add('orchestrator main-loop output tokens', 'tokens', main('output'));
  add('orchestrator main-loop cache read tokens', 'tokens', main('cacheRead'));
  add('orchestrator main-loop cache write tokens', 'tokens', main('cacheWrite'));
  add('tokens on the orchestrator session (all models, incl. subagent)', 'tokens', (arm) => arm.measure.orchestratorSessionTokens);
  add('tokens across every process in the arm', 'tokens', (arm) => arm.measure.totalTokens);
  const names = [...new Set([A, B].flatMap((arm) => Object.keys(arm?.measure.models ?? {})))].sort();
  for (const n of names) add(`model ${n} tokens`, 'tokens', (arm) => (arm.measure.models[n] ? sumTokens(arm.measure.models[n]) : 0));
  add('orchestrator cost (USD)', 'usd', (arm) => arm.measure.orchestratorCostUsd);
  add('total cost (USD)', 'usd', (arm) => arm.measure.costUsd);
  add('wall time', 'sec', (arm) => arm.wallSeconds);
  add('npm test passes afterwards', 'text', (arm) => (arm.testsPass ? 'yes' : 'no'));
  add('orchestrator verdict', 'text', (arm) => arm.measure.verdict ?? '(none)');
  add('files changed', 'text', (arm) => (arm.filesChanged.length ? arm.filesChanged.join(', ') : '(none)'));
  return rows;
}

export function toMarkdown(rows, notes = []) {
  const cell = (v, kind) => (v == null ? '—' : FORMAT[kind](v)).replaceAll('|', '/');
  const lines = ['| metric | A (coder-room) | B (subagent) | difference (B − A) |', '|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.metric} | ${cell(r.a, r.kind)} | ${cell(r.b, r.kind)} | ${difference(r.a, r.b, r.kind)} |`);
  return [...lines, '', ...notes.map((n) => `- ${n}`)].join('\n') + '\n';
}
