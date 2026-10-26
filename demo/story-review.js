// The acme-shop timeline, part 2: the review round on the Haiku coder, the one-finding fix round and the wrap-up.
import { specText } from './content.js';
import { COSTS, NAMES } from './names.js';
import { MODELS, claudeLog } from './steps.js';
import { Lane, text } from './timeline.js';

const REVIEW = {
  id: 'q06', title: 'Review of q04 and q05', goal: 'Read the q04 and q05 changes and report problems. Change no files.',
  items: [{ title: 'Read the q04 diff' }, { title: 'Read the q05 diff' }, { title: 'Report findings with file and line' }],
};
const FIX = {
  id: 'q05b', title: 'FIX: empty cart with a code', goal: 'Cover the empty-cart case from the q06 review with tests in the API and the checkout UI.',
  items: [{ title: 'Test: empty cart with a code applied' }, { title: 'Test: Apply does nothing for an empty cart' }],
};

function reviewLog({ dir }) {
  const log = claudeLog({ model: MODELS.haiku, dir, round: 'q06' });
  log.init();
  log.say('Reading the review brief first. I will not change any files.');
  log.call('Read', { file_path: `${dir}/.rounds/q06.md` });
  log.call('Bash', { command: 'git diff --stat', description: 'List the changed files' }, true, ' 9 files changed, 214 insertions(+), 12 deletions(-)');
  log.call('Read', { file_path: `${dir}/src/discounts.js` });
  log.call('Read', { file_path: `${dir}/test/discounts.test.js` });
  log.call('Read', { file_path: `${dir}/web/checkout.js` });
  log.call('Read', { file_path: `${dir}/test/checkout-ui.test.js` });
  log.call('Read', { file_path: `${dir}/src/cart.js` });
  log.call('Grep', { pattern: 'empty|length === 0', path: `${dir}/test` }, true, 'test/cart.test.js:31');
  log.call('Read', { file_path: `${dir}/web/summary.js` });
  log.think('applyCode on an empty cart returns 0 for a percent code, and the Apply button still sends the request. Both are fine, but no test says so.');
  log.say('One finding: nothing tests an empty cart with a code applied, in the API or in the checkout UI. The code handles it, so this is a missing test, not a bug.');
  log.result('One finding: no test for an empty cart with a code applied (test/discounts.test.js, test/checkout-ui.test.js).', { ...COSTS.q06, turns: 12 });
  return log.steps;
}

function fixLog({ dir, gate }) {
  const log = claudeLog({ model: MODELS.sonnet, dir, round: 'q05b' });
  log.init();
  log.say('Reading the fix round first, then the two test files.');
  log.call('Read', { file_path: `${dir}/.rounds/q05b.md` });
  log.call('Read', { file_path: `${dir}/test/discounts.test.js` });
  log.call('Bash', { command: gate, description: 'Baseline test run' }, true, '19 passing');
  log.call('Read', { file_path: `${dir}/src/discounts.js` });
  log.think('An empty cart has no line items, so the total is 0 and the discount must stay 0 instead of going negative.');
  log.call('Edit', { file_path: `${dir}/test/discounts.test.js`, old_string: 'assert.equal(percentOff(100, 10), 90);', new_string: 'assert.equal(percentOff(100, 10), 90);\n  assert.equal(percentOff(0, 10), 0);' });
  log.call('Read', { file_path: `${dir}/test/checkout-ui.test.js` });
  log.call('Edit', { file_path: `${dir}/test/checkout-ui.test.js`, old_string: 'assert.match(render({ discount: 5 }), /Discount -5.00/);', new_string: 'assert.match(render({ discount: 5 }), /Discount -5.00/);\n  assert.doesNotMatch(render({ items: [], discount: 0 }), /Discount/);' });
  log.call('Bash', { command: gate, description: 'Run the tests' }, true, '21 passing');
  log.result('Both empty-cart tests are added and the gate passes.', { ...COSTS.q05b, turns: 14 });
  return log.steps;
}

const reportOf = (id, lines) => `# ${id} report\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;

/** Appends the review, fix and wrap-up to the orchestrator lane `O`; returns the review lane. */
export function reviewAndFix({ dir, rdir, gate, o, tr, chain, O, A, U }) {
  const R = new Lane(0, 2);
  const file = (name, body) => ({ file: `${rdir}/${name}`, text: body, create: true });
  const review = reviewLog({ dir });
  const fix = fixLog({ dir, gate });

  O.sync(Math.max(A.t, U.t)).add(tr(o.say('Both rounds are in, so I am starting the review round q06 on claude-review. It reads both diffs and changes nothing.'), o.write(`${rdir}/q06.md`, specText(REVIEW))), 4);
  O.add([file('q06.md', specText(REVIEW)), tr(o.run(`cd ${dir} && coder-room run q06 --coder claude-review --extra "Review only." --detach`))], 3);
  R.sync(O.t).add([chain('q06', 'started', NAMES.review, 'review'), { file: `${rdir}/q06-review.log`, text: text(review[0]), create: true }], 2);
  R.log(`${rdir}/q06-review.log`, review.slice(1));
  R.add([chain('q06', 'finished', NAMES.review, 'review'), chain('q06', 'ready'),
    file('q06-report.md', reportOf('q06', ['One finding: no test for an empty cart with a code applied.', 'No bugs found in src/discounts.js or web/checkout.js.']))], 2);
  O.add(tr(o.say('Review q06 is running.'), o.end()), 2);

  O.sync(R.t).add(tr(o.notify('Background command "coder-room run q06" completed'), o.say('The review found one gap, a missing test for an empty cart with a code applied. Reading the report.'), o.read(`${rdir}/q06-report.md`)), 4);
  O.add([tr(o.say('I am writing q05b as a small fix round and giving it to claude-ui, which already knows the checkout code.'), o.write(`${rdir}/q05b.md`, specText(FIX))), file('q05b.md', specText(FIX))], 4);
  O.add(tr(o.run(`cd ${dir} && coder-room run q05b --coder claude-ui --detach`), o.end()), 3);
  U.sync(O.t).add([chain('q05b', 'started', NAMES.fallback), { file: `${rdir}/q05b.log`, text: text(fix[0]), create: true }], 2);
  U.log(`${rdir}/q05b.log`, fix.slice(1));
  U.add([chain('q05b', 'finished', NAMES.fallback), chain('q05b', 'ready'),
    file('q05b-report.md', reportOf('q05b', ['Added the empty-cart test for the API and for the checkout UI.', `Gate \`${gate}\` passes with 21 tests.`]))], 2);

  const total = Object.values(COSTS);
  const out = Math.round(total.reduce((n, c) => n + c.out, 0) / 1000);
  const cost = total.reduce((n, c) => n + c.cost, 0).toFixed(2);
  O.sync(U.t).add(tr(o.notify('Background command "coder-room run q05b" completed'), o.say('q05b is done. Running the gate once more myself.'), o.run(`cd ${dir} && ${gate}`)), 4);
  O.add(tr(o.say(`Discount codes work end to end. The API (q04) applies percent and fixed codes with expiry and usage limits, and checkout (q05) has a code field, an error message and a remove link. The review found one missing test, and q05b added it. The gate passes with 21 tests. The Claude coders used about ${out}k output tokens and $${cost} across q04, q05, q05b and the review. codex-ui hit its usage limit during q05, so claude-ui finished it. Nothing is committed yet. Want me to commit this?`), o.end()), 4);
  return R;
}
