// The acme-shop timeline: one orchestrator and three coders on discount codes, played by the appender in time order.
// Part 1 (this file): kick-off, two rounds in parallel, a failing gate, a usage limit and the fallback coder.
import { CHECKOUT_UI, DISCOUNTS, specText } from './content.js';
import { MODELS, claudeLog, codexLog, sayFor, thoughtFor } from './steps.js';
import { Lane, chainLine, text } from './timeline.js';
import { COSTS, NAMES } from './names.js';
import { reviewAndFix } from './story-review.js';

const ROUNDS = {
  q04: { id: 'q04', title: 'Discount code API', goal: 'Let shoppers apply one discount code to a cart: percent or fixed amount, with expiry and usage limits.', items: DISCOUNTS },
  q05: { id: 'q05', title: 'Checkout discount UI', goal: 'Add a code field to checkout that applies a code through the API and shows the discount in the order summary.', items: CHECKOUT_UI },
};

const NOTES = {
  'Percent discounts': 'Percent discounts first. Prices are plain numbers here, so I will start with one multiplication and see what the first test says.',
  'Expiry check': 'A coupon with no expiry date never expires. I need that case to pass before anything else.',
  'One coupon per cart': 'The cart keeps a list of codes today. Replacing it with a single code is smaller than adding a rule on top.',
  'Show discount in summary': 'The summary endpoint already returns the total. Adding the discount next to it keeps the UI round independent.',
};
const note = (i, title) => NOTES[title] ?? thoughtFor(i, title);

const check = (log, it) => it.file.endsWith('.js')
  && log.call('Bash', { command: `node --check ${it.file}`, description: 'Check the syntax' }, true, '');

/** Claude coder log for q04: all items, with one failing gate (percent rounding) fixed and rerun. */
function apiLog({ dir, gate }) {
  const round = ROUNDS.q04;
  const log = claudeLog({ model: MODELS.sonnet, dir, round: 'q04' });
  const titles = round.items.map((it) => it.title);
  log.init();
  log.say('Reading AGENTS.md and q04.md first, then I will work through the items in order.');
  log.call('Read', { file_path: `${dir}/AGENTS.md` });
  log.call('Read', { file_path: `${dir}/.rounds/q04.md` });
  log.todo(titles, 0);
  round.items.forEach((it, i) => {
    log.think(note(i, it.title));
    log.say(sayFor(i, it.title));
    log.call('Read', { file_path: `${dir}/${it.file}` });
    log.call('Read', { file_path: `${dir}/${i % 2 ? 'src/cart.js' : 'src/money.js'}` });
    log.call('Grep', { pattern: it.title.split(' ')[0].toLowerCase(), path: `${dir}/src` }, true, `${it.file}:12`);
    log.call('Edit', { file_path: `${dir}/${it.file}`, old_string: it.before, new_string: it.after });
    check(log, it);
    log.todo(titles, i + 1);
    if (i === 5) log.call('Bash', { command: gate, description: 'Run the tests' }, true, '12 passing');
    if (it.title !== 'Percent discounts') return;
    log.call('Bash', { command: gate, description: 'Run the tests' }, false, 'not ok 1 - percent discount rounds to cents\n  expected: 50.99\n  actual: 50.9915\n1 failing');
    log.think('The percent discount returns the raw product, 59.99 * 0.85 = 50.9915. Every other amount in the cart is rounded to cents, so the rounding belongs in discounts.js and not in the endpoint.');
    log.call('Read', { file_path: `${dir}/src/discounts.js` });
    log.call('Edit', { file_path: `${dir}/src/discounts.js`, old_string: it.after, new_string: 'return Math.round(total * (1 - coupon.percent / 100) * 100) / 100;' });
    log.call('Bash', { command: gate, description: 'Run the tests again' }, true, 'ok 1 - percent discount rounds to cents\n1 passing');
  });
  log.call('Bash', { command: gate, description: 'Final gate run' }, true, '14 passing');
  log.result('All 10 items of q04 are done and the gate passes.', { ...COSTS.q04, turns: 61 });
  return log.steps;
}

/** Codex coder log for q05 up to the limit: `upTo` items done, the next one half written. */
function uiLog({ dir }) {
  const round = ROUNDS.q05;
  const log = codexLog({ model: MODELS.codex, dir, prompt: 'Implement q05: Checkout discount UI.' });
  const done = 4;
  round.items.slice(0, done + 1).forEach((it, i) => {
    log.think(it.title, `${thoughtFor(i, it.title)} The page code is plain DOM, so no framework changes.`);
    log.say(sayFor(i, it.title));
    log.exec(`sed -n 1,60p ${it.file}`, true, it.before);
    log.exec('git diff --stat', true, ' 1 file changed');
    log.patch(it.file, it.before, it.after);
    if (i === 1 || i === 3) log.exec('npm test', true, '9 passing');
  });
  log.think('Remove-code link', 'The link needs the applied code in the summary state, so I am reading how summary.js builds its html.');
  log.error("You've hit your usage limit. Try again later.");
  return log.steps;
}

/** Claude fallback log for q05: picks up after the first four items and finishes the rest. */
function fallbackLog({ dir, gate }) {
  const round = ROUNDS.q05;
  const log = claudeLog({ model: MODELS.sonnet, dir, round: 'q05' });
  const titles = round.items.map((it) => it.title);
  log.init();
  log.say('The previous coder stopped partway through q05. I will read the working tree before changing anything.');
  log.call('Read', { file_path: `${dir}/.rounds/q05.md` });
  log.call('Bash', { command: 'git diff --stat', description: 'See what is already done' }, true, ' web/checkout.html | 3 +++\n web/checkout.js   | 21 +++++++++\n web/summary.js    | 9 ++++');
  log.think('Items 1 to 4 are in the tree and web/summary.js has the start of the remove-code link. I will finish that one and continue from item 6.');
  log.todo(titles, 4);
  round.items.slice(4).forEach((it, k) => {
    const i = k + 4;
    log.think(note(i, it.title));
    log.say(sayFor(i, it.title));
    log.call('Read', { file_path: `${dir}/${it.file}` });
    log.call('Read', { file_path: `${dir}/web/checkout.js` });
    log.call('Grep', { pattern: it.title.split(' ')[0].toLowerCase(), path: `${dir}/web` }, true, `${it.file}:8`);
    log.call('Edit', { file_path: `${dir}/${it.file}`, old_string: it.before, new_string: it.after });
    check(log, it);
    log.todo(titles, i + 1);
    if (i === 5) log.call('Bash', { command: gate, description: 'Run the tests' }, true, '16 passing');
  });
  log.call('Bash', { command: gate, description: 'Final gate run' }, true, '19 passing');
  log.result('All 9 items of q05 are done and the gate passes.', { ...COSTS.q05, turns: 38 });
  return log.steps;
}

/** The acme-shop timeline (steps with `at` seconds) for a project at `dir`. */
export function acmeTimeline({ dir, rdir, transcript, gate, o }) {
  const tr = (...lines) => ({ file: transcript, text: () => text(lines.map((l) => l())) });
  const chain = (round, type, on, role) => ({ file: `${rdir}/chain.log`, text: () => `${chainLine(round, type, on, role)}\n` });
  const spec = (id) => ({ file: `${rdir}/${id}.md`, text: specText(ROUNDS[id]), create: true });
  const O = new Lane(0, 3);
  const A = new Lane(0, 0);
  const C = new Lane(0, 5);
  const U = new Lane(0, 7);
  const api = apiLog({ dir, gate });
  const ui = uiLog({ dir });
  const fb = fallbackLog({ dir, gate });
  const play = (lane, file, logSteps) => lane.log(file, logSteps);

  O.add(tr(o.user('Add discount codes end to end: API, checkout UI, tests')), 3);
  O.add(tr(o.say('Two rounds can run at the same time here: q04 for the discount API and q05 for the checkout UI. They touch different folders. A review round follows once both are done.')));
  O.add([tr(o.write(`${rdir}/q04.md`, specText(ROUNDS.q04))), spec('q04')], 4);
  O.add([tr(o.write(`${rdir}/q05.md`, specText(ROUNDS.q05))), spec('q05')], 3);
  O.add(tr(o.say('Handing q04 to claude-api.'), o.run(`cd ${dir} && coder-room run q04 --coder claude-api --detach`)), 3);
  A.sync(O.t).add([chain('q04', 'started', NAMES.api), { file: `${rdir}/q04.log`, text: text(api[0]), create: true }], 2);
  O.add(tr(o.say('Handing q05 to codex-ui.'), o.run(`cd ${dir} && coder-room run q05 --coder codex-ui --detach`)), 4);
  C.sync(O.t).add([chain('q05', 'started', NAMES.ui), { file: `${rdir}/q05.log`, text: text(ui[0]), create: true }], 2);
  O.add(tr(o.say('Both rounds are running, q04 on claude-api and q05 on codex-ui. I will check each gate when they finish.'), o.end()), 3);

  play(A, `${rdir}/q04.log`, api.slice(1));
  play(C, `${rdir}/q05.log`, ui.slice(1));
  C.add(chain('q05', 'LIMIT', 'codex-ui'), 2);
  O.sync(C.t).add(tr(o.notify('codex-ui hit its usage limit on q05'), o.say('codex-ui reached its usage limit partway through q05. The run script falls back to claude-ui, which continues from the files already written.'), o.end()), 3);
  U.sync(C.t).add([{ file: `${rdir}/q05.log`, text: text(fb[0]), create: true, rotate: true }, chain('q05', 'started', NAMES.fallback)], 4);
  play(U, `${rdir}/q05.log`, fb.slice(1));

  const finish = (lane, round, who) => lane.add([
    chain(round, 'finished', who), chain(round, 'ready'),
    { file: `${rdir}/${round}-report.md`, text: `# ${round} report\n\n- All ${ROUNDS[round].items.length} items are implemented and the gate passes.\n- Only files named in ${round}.md were touched.\n`, create: true },
  ], 2);
  finish(A, 'q04', NAMES.api);
  finish(U, 'q05', NAMES.fallback);
  O.sync(U.t).add(tr(o.notify('Background command "coder-room run q05" completed'), o.say('q05 finished. Reading its report. q04 is still running, so the review waits.'), o.read(`${rdir}/q05-report.md`)), 4);
  O.add(tr(o.say('The report matches the spec: all nine items, gate green. The first coder hit its limit and claude-ui finished the rest.'), o.end()), 4);
  O.sync(A.t).add(tr(o.notify('Background command "coder-room run q04" completed'), o.say('q04 finished. Reading the report and the gate output.'), o.read(`${rdir}/q04-report.md`)), 4);
  O.add(tr(o.say('q04 is fine. The percent rounding failure was caught by its own test and fixed.'), o.run(`cd ${dir} && ${gate}`)), 4);
  const R = reviewAndFix({ dir, rdir, gate, o, tr, chain, O, A, U });
  return [A, C, U, O, R].flatMap((l) => l.steps);
}
