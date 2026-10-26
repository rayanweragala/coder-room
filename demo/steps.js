// Log lines for one round, as steps (each step = lines appended together), in the two coder log formats.

export const MODELS = { codex: 'gpt-6-luna', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', opus: 'claude-opus-5-5' };
export const ALLOWED_MODELS = Object.values(MODELS);

const toJson = JSON.stringify;
let messages = 0;

/** Builder for a Claude stream-json log: every call pushes one step (a list of lines) onto `steps`. */
export function claudeLog({ model, dir, round }) {
  const steps = [];
  let calls = 0;
  const asst = (content) => {
    const n = ++messages;
    const usage = { input_tokens: 40 + (n % 7), output_tokens: 180 + (n % 11) * 35, cache_read_input_tokens: 9000 + n * 420, cache_creation_input_tokens: 300 + (n % 5) * 90 };
    return toJson({ type: 'assistant', message: { id: `msg_demo_${n}`, model, content, usage } });
  };
  const log = {
    steps,
    init: () => steps.push([toJson({ type: 'system', subtype: 'init', cwd: dir, model })]),
    say: (text) => steps.push([asst([{ type: 'text', text }])]),
    think: (thinking) => steps.push([asst([{ type: 'thinking', thinking }])]),
    call(name, input, ok = true, out = 'ok') {
      const id = `toolu_${round}_${++calls}`;
      steps.push([asst([{ type: 'tool_use', id, name, input }])]);
      steps.push([toJson({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: !ok }] } })]);
    },
    todo: (titles, done) => log.call('TodoWrite', {
      todos: titles.map((t, i) => ({ content: t, activeForm: `Working on ${t.toLowerCase()}`, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' })),
    }),
    result(text, { cost, out, turns = 40 }) {
      const modelUsage = { [model]: { inputTokens: 900, outputTokens: out, cacheReadInputTokens: 1_100_000 + out * 20, cacheCreationInputTokens: 30_000, costUSD: cost } };
      steps.push([toJson({ type: 'result', result: text, total_cost_usd: cost, num_turns: turns, modelUsage })]);
    },
  };
  return log;
}

/** Builder for a Codex text log (what `codex exec` prints). */
export function codexLog({ model, dir, prompt }) {
  const steps = [['OpenAI Codex (demo)', `model: ${model}`, 'user', prompt]];
  const log = {
    steps,
    think: (headline, body) => steps.push(['thinking', `**${headline}**`, body]),
    say: (text) => steps.push(['codex', text]),
    exec(cmd, ok = true, out = 'ok') {
      steps.push(['exec', `/bin/bash -lc '${cmd}' in ${dir}`]);
      steps.push([ok ? ' succeeded in 0.4s:' : ' exited 1 in 0.4s:', out]);
    },
    patch: (file, before, after) => steps.push(['apply patch', 'patch: completed', `${dir}/${file}`, `diff --git a/${file} b/${file}`, `-${before}`, `+${after}`]),
    error: (text) => steps.push([`ERROR: ${text}`]),
    tokens: (n) => steps.push(['tokens used', n.toLocaleString('en-US')]),
  };
  return log;
}

const THOUGHTS = [
  (t) => `${t}: keep it small and obvious, then cover it with one test.`,
  (t) => `Checking how ${t.toLowerCase()} fits with the code around it before touching anything.`,
  (t) => `${t} next. The existing helpers already do most of the work.`,
];
const SAYS = [
  (t) => `Working on "${t}" now.`,
  (t) => `Next item: ${t.toLowerCase()}.`,
  (t) => `Moving on to ${t.toLowerCase()}.`,
];
export const pick = (list, i, t) => list[i % list.length](t);
export const thoughtFor = (i, t) => pick(THOUGHTS, i, t);
export const sayFor = (i, t) => pick(SAYS, i, t);

/** Claude stream-json steps for a whole round (used for the finished history rounds). */
export function claudeSteps(round, dir, gate, model = MODELS.sonnet) {
  const log = claudeLog({ model, dir, round: round.id });
  const titles = round.items.map((it) => it.title);
  log.init();
  log.say(`Reading AGENTS.md and ${round.id}.md first, then I will work through the items in order.`);
  log.call('Read', { file_path: `${dir}/${round.id}.md` });
  log.todo(titles, 0);
  round.items.forEach((it, i) => {
    log.think(thoughtFor(i, it.title));
    log.say(sayFor(i, it.title));
    log.call('Read', { file_path: `${dir}/${it.file}` });
    log.call('Edit', { file_path: `${dir}/${it.file}`, old_string: it.before, new_string: it.after });
    log.todo(titles, i + 1);
    if (i === 3) log.call('Bash', { command: gate, description: 'Run the tests' }, false, '1 failing: expected 2 to equal 3');
    if (i % 3 === 2 || i === 3) log.call('Bash', { command: gate, description: 'Run the tests' }, true, 'all tests pass');
  });
  log.call('Bash', { command: gate, description: 'Final gate run' }, true, 'all tests pass');
  log.result(`All ${round.items.length} items of ${round.id} are done and the gate passes.`, { cost: +(0.3 + round.items.length * 0.07).toFixed(2), out: round.items.length * 3400 });
  return log.steps;
}

/** Codex text-log steps for a whole round (used for the finished history rounds). */
export function codexSteps(round, dir, gate, model = MODELS.codex) {
  const log = codexLog({ model, dir, prompt: `Implement ${round.id}: ${round.title}.` });
  round.items.forEach((it, i) => {
    log.think(it.title, thoughtFor(i, it.title));
    log.say(sayFor(i, it.title));
    log.exec(`cat ${it.file}`, true, it.before);
    log.patch(it.file, it.before, it.after);
    if (i === 3) log.exec(gate, false, '1 failing: expected 2 to equal 3');
    if (i % 3 === 2 || i === 3) log.exec(gate, true, 'all tests pass');
  });
  log.exec(gate, true, 'all tests pass');
  log.say(`All ${round.items.length} items of ${round.id} are done and the gate passes.`);
  log.tokens(round.items.length * 7500);
  return log.steps;
}

export const stepsFor = (round, dir, gate) => (round.style === 'claude' ? claudeSteps : codexSteps)(round, dir, gate);
