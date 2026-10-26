import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli/main.js';
import { coderOutput, isLimited } from '../src/cli/limit.js';
import { formatTable } from '../src/cli/tokens.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugins', 'coder-room');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const capture = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
};
const SAFE_PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'];

// ---- item 0a: legacy folders ----

function legacyProject() {
  const dir = tmp('cr-legacy-');
  const runs = path.join(dir, '.codex-runs');
  fs.mkdirSync(runs);
  fs.writeFileSync(path.join(runs, 'chain.log'), 'coder q01 started 10:00 on x\ncoder q01 finished 10:05 rc=0 on x\ncoder q02 started 10:06 on x\n');
  fs.writeFileSync(path.join(runs, 'q01.log'), `${JSON.stringify({
    type: 'result', total_cost_usd: 1, num_turns: 2, duration_ms: 3000,
    modelUsage: { m: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 1 } },
  })}\n`);
  return dir;
}

test('status and tokens work in a project with only .codex-runs/', async () => {
  const dir = legacyProject();
  const s = capture();
  assert.equal(await main(['status'], s.io, { project: dir, env: { PATH: SAFE_PATH.join(path.delimiter) } }), 0);
  assert.match(s.out.join('\n'), /running: q02$/);
  assert.match(s.out.join('\n'), /coder q01 finished 10:05/);
  const t = capture();
  assert.equal(await main(['tokens', '--dir', dir], t.io), 0);
  assert.match(t.out.join('\n'), /q01 +m +1 +2 +3 +4 +10 +\$1\.00 +2 +3s/);
  const none = capture();
  assert.equal(await main(['tokens', '--dir', tmp('cr-none-')], none.io), 2);
  const none2 = capture();
  assert.equal(await main(['status'], none2.io, { project: tmp('cr-none-'), env: {} }), 2);
});

// ---- item 0b: token table ----

test('token table has a total column, aligned rows and a summed TOTAL row', () => {
  const claude = (n) => ({ kind: 'claude', models: [{ model: 'm', input: n, output: n, cacheRead: n, cacheWrite: n, costUSD: 1 }], costUSD: 1, turns: 2, durationMs: 1000 });
  const text = formatTable([
    { round: 'q01', usage: claude(10) },
    { round: 'q02', usage: { kind: 'codex', total: 224637 } },
    { round: 'q03', usage: { kind: 'incomplete' } },
  ]);
  const lines = text.split('\n');
  assert.match(lines[0], /cache write +total +cost +turns +time$/);
  const widths = new Set(lines.filter((l) => !l.startsWith('---')).map((l) => l.length));
  assert.equal(widths.size, 1, `rows differ in width:\n${text}`);
  assert.equal(lines.find((l) => l.startsWith('---')).length, lines[0].length);
  assert.match(lines[1], /q01 +m +10 +10 +10 +10 +40 +\$1\.00/);
  assert.match(lines[2], /q02 +total \(Codex\) .* 224,637 +- +- +-$/);
  assert.match(lines.at(-1), /^TOTAL .* 224,677 +\$1\.00 +2 +1s$/);
});

// ---- item 0c: false LIMIT ----

test('coderOutput keeps only coder-level text', () => {
  const claudeLog = [
    'stderr: oops',
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'spec says usage limit' }] } }),
    JSON.stringify({ type: 'result', is_error: true, result: 'You hit your limit', errors: ['e1'] }),
  ].join('\n');
  const out = coderOutput('claude', claudeLog);
  assert.match(out, /stderr: oops/);
  assert.match(out, /hit your limit/);
  assert.match(out, /e1/);
  assert.doesNotMatch(out, /spec says/);

  const codexLog = ['exec', 'cat .rounds/q.md in /x', ' succeeded in 5ms:', 'the usage limit text from the spec', 'codex', 'working on it', 'ERROR: rate limit hit'].join('\n');
  const cx = coderOutput('codex', codexLog);
  assert.match(cx, /ERROR: rate limit hit/);
  assert.match(cx, /working on it/);
  assert.doesNotMatch(cx, /from the spec/);
  assert.equal(isLimited('codex', codexLog, ['rate limit']), true);
  assert.equal(isLimited('codex', codexLog, ['usage limit']), false);
});

const FAKE_CLAUDE = `#!/usr/bin/env node
const mode = process.env.FAKE_MODE;
const user = { type: 'user', message: { content: [{ type: 'tool_result', content: 'the spec mentions a usage limit' }] } };
console.log(JSON.stringify(user));
if (mode === 'limit') {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: "You've hit your session limit" }));
  process.exit(1);
}
process.exit(1);
`;

async function runClaude(mode) {
  const bin = tmp('cr-bin-');
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  const dir = tmp('cr-proj-');
  const runs = path.join(dir, '.rounds');
  fs.mkdirSync(runs);
  fs.writeFileSync(path.join(runs, 'chain.log'), '');
  fs.writeFileSync(path.join(runs, 'q01.md'), '# round\n');
  fs.writeFileSync(path.join(runs, 'config.json'), JSON.stringify({
    coders: [{ name: 'c', kind: 'claude', model: 'sonnet', enabled: true }], order: ['c'], requireCleanTree: false, prompt: null,
  }));
  const env = { PATH: [bin, ...SAFE_PATH].join(path.delimiter), FAKE_MODE: mode };
  const code = await main(['run', 'q01'], capture().io, { project: dir, env });
  const chain = fs.readFileSync(path.join(runs, 'chain.log'), 'utf8').trim().split('\n');
  return { code, chain };
}

test('a crash whose tool output mentions "usage limit" is not a LIMIT', async () => {
  const { code, chain } = await runClaude('crash');
  assert.equal(code, 1);
  assert.deepEqual(chain.map((l) => l.split(' ')[2]), ['started', 'finished']);
  assert.match(chain[1], /finished \d\d:\d\d rc=1 on c$/);
});

test('a real limit result event is a LIMIT', async () => {
  const { code, chain } = await runClaude('limit');
  assert.equal(code, 1);
  assert.deepEqual(chain.map((l) => l.split(' ')[2]), ['started', 'LIMIT']);
});

// ---- items 1: manifests ----

test('marketplace.json and plugin.json are valid and agree with package.json', () => {
  const market = readJson(ROOT, '.claude-plugin', 'marketplace.json');
  const plugin = readJson(PLUGIN, '.claude-plugin', 'plugin.json');
  assert.equal(market.name, 'coder-room');
  assert.equal(market.owner.name, 'Rayan');
  assert.equal(market.plugins.length, 1);
  const entry = market.plugins[0];
  assert.equal(entry.name, plugin.name);
  assert.equal(plugin.name, 'coder-room');
  assert.equal(entry.source, './plugins/coder-room');
  assert.ok(fs.existsSync(path.join(ROOT, entry.source, '.claude-plugin', 'plugin.json')));
  assert.ok(entry.description);
  assert.equal(plugin.version, pkg.version);
  assert.ok(plugin.description);
  assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.length > 0);
  if (market.version !== undefined) assert.equal(market.version, pkg.version);
});

test('package.json files ship docs/why.md but not docs/img', () => {
  assert.ok(pkg.files.includes('docs/why.md'));
  assert.ok(!pkg.files.some((f) => f === 'docs' || f.startsWith('docs/img')));
});

function frontmatter(file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(m, `${file} has frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const k = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (k) fm[k[1]] = k[2];
  }
  return fm;
}

test('every SKILL.md has a short description and stays under the line limit', () => {
  const dirs = fs.readdirSync(path.join(PLUGIN, 'skills'));
  assert.deepEqual(dirs.sort(), ['handoff', 'new-round', 'orchestrate', 'review-round', 'run-round']);
  for (const d of dirs) {
    const file = path.join(PLUGIN, 'skills', d, 'SKILL.md');
    const fm = frontmatter(file);
    assert.equal(fm.name, d);
    assert.ok(fm.description, `${d} description`);
    assert.ok((fm.description + (fm.when_to_use ?? '')).length < 1536, `${d} listing text length`);
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    assert.ok(lines < (d === 'orchestrate' ? 300 : 500), `${d} has ${lines} lines`);
  }
  const body = fs.readFileSync(path.join(PLUGIN, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  assert.match(body, /separate processes/);
  assert.match(body, /coder-room run <round> --detach/);
});

test('template files in the skill match src/cli/templates.js', async () => {
  const { HANDOFF, SPEC_TEMPLATE } = await import('../src/cli/templates.js');
  const dir = path.join(PLUGIN, 'skills', 'orchestrate');
  assert.equal(fs.readFileSync(path.join(dir, 'spec-template.md'), 'utf8'), SPEC_TEMPLATE);
  assert.equal(fs.readFileSync(path.join(dir, 'handoff-template.md'), 'utf8'), HANDOFF);
  assert.ok(fs.existsSync(path.join(dir, 'review-checklist.md')));
});

test('the skills hold no personal names or model codenames', () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(path.join(PLUGIN, 'skills'));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /rayan|luna|\bsol\b|claude3/i, f);
});

// ---- item 3: SessionStart hook ----

const HOOK = path.join(PLUGIN, 'hooks', 'session-start.js');
const runHook = (project, env = {}) => spawnSync(process.execPath, [HOOK], {
  cwd: project, encoding: 'utf8', env: { CLAUDE_PROJECT_DIR: project, PATH: SAFE_PATH.join(path.delimiter), ...env },
});

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}:${fs.statSync(p).size}:${fs.statSync(p).mtimeMs}`);
    }
  };
  walk(dir);
  return out.sort();
}

test('hooks.json runs the script on the documented SessionStart matchers', () => {
  const h = readJson(PLUGIN, 'hooks', 'hooks.json');
  const group = h.hooks.SessionStart[0];
  assert.equal(group.matcher, 'startup|resume|clear|compact');
  assert.equal(group.hooks[0].type, 'command');
  assert.equal(group.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"');
});

test('session-start prints nothing without a rounds folder', () => {
  const dir = tmp('cr-hook-');
  const r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  fs.mkdirSync(path.join(dir, '.rounds'));
  assert.equal(runHook(dir).stdout, '');
});

test('session-start points at the handoff and lists running rounds; never writes; is fast', () => {
  const dir = tmp('cr-hook-');
  const runs = path.join(dir, '.rounds');
  fs.mkdirSync(runs);
  fs.writeFileSync(path.join(runs, 'HANDOFF.md'), '# Handoff\n');
  fs.writeFileSync(path.join(runs, 'chain.log'), [
    'coder q01 started 10:00 on a', 'coder q01 finished 10:05 rc=0 on a', 'coder q02 started 10:06 on a',
    'coder q03 started 10:07 on a', 'coder q03 LIMIT 10:08 on a', '',
  ].join('\n'));
  const bin = tmp('cr-bin-');
  fs.writeFileSync(path.join(bin, 'coder-room'), '#!/bin/sh\n', { mode: 0o755 });
  const before = snapshot(dir);
  const t0 = performance.now();
  const r = runHook(dir, { PATH: [bin, ...SAFE_PATH].join(path.delimiter) });
  const elapsed = performance.now() - t0;
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.length >= 2 && lines.length <= 4, r.stdout);
  assert.match(lines[0], /coder-room rounds.*\.rounds\/HANDOFF\.md/);
  assert.match(r.stdout, /Running rounds.*: q02\./);
  assert.doesNotMatch(r.stdout, /q01|q03/);
  assert.doesNotMatch(r.stdout, /npm i -g/);
  assert.ok(elapsed < 300, `took ${elapsed}ms`);
  assert.deepEqual(snapshot(dir), before);

  const noCli = runHook(dir);
  assert.match(noCli.stdout, /npm i -g coder-room/);
});

test('session-start reads the legacy folder and falls back to cwd', () => {
  const dir = tmp('cr-hook-');
  fs.mkdirSync(path.join(dir, '.codex-runs'));
  fs.writeFileSync(path.join(dir, '.codex-runs', 'HANDOFF.md'), '# Handoff\n');
  const r = spawnSync(process.execPath, [HOOK], { cwd: dir, encoding: 'utf8', env: { PATH: SAFE_PATH.join(path.delimiter) } });
  assert.match(r.stdout, /\.codex-runs\/HANDOFF\.md/);
  assert.doesNotMatch(r.stdout, /Running rounds/);
});

test('the hook uses no child_process and no fs writes', () => {
  const src = fs.readFileSync(HOOK, 'utf8');
  assert.doesNotMatch(src, /child_process|writeFile|appendFile|mkdir|rmSync|unlink|rename|createWriteStream|\.listen\(/);
});

// ---- item 4: wrapper ----

function wrapperEnv() {
  const own = tmp('cr-wrap-');
  const wrapper = path.join(own, 'coder-room');
  fs.copyFileSync(path.join(PLUGIN, 'bin', 'coder-room'), wrapper);
  fs.chmodSync(wrapper, 0o755);
  return { own, wrapper };
}
const runWrapper = (wrapper, pathDirs, env = {}) => spawnSync('/bin/sh', [wrapper, '--help'], {
  encoding: 'utf8', env: { PATH: [...pathDirs, ...SAFE_PATH].join(path.delimiter), ...env },
});

test('wrapper execs a coder-room found earlier on PATH', () => {
  const { own, wrapper } = wrapperEnv();
  const fake = tmp('cr-fake-');
  fs.writeFileSync(path.join(fake, 'coder-room'), '#!/bin/sh\necho "fake cli $*"\n', { mode: 0o755 });
  const r = runWrapper(wrapper, [own, fake]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'fake cli --help');
});

test('wrapper falls back to CODER_ROOM_HOME', () => {
  const { wrapper } = wrapperEnv();
  const r = runWrapper(wrapper, [], { CODER_ROOM_HOME: ROOT });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage: coder-room/);
});

test('wrapper exits 127 with the install hint and does not loop on itself', () => {
  const { own, wrapper } = wrapperEnv();
  const r = runWrapper(wrapper, [own]);
  assert.equal(r.status, 127);
  assert.match(r.stderr, /npm i -g coder-room/);
  assert.equal(r.stdout, '');
  const viaSymlink = tmp('cr-link-');
  fs.symlinkSync(wrapper, path.join(viaSymlink, 'coder-room'));
  const r2 = runWrapper(wrapper, [viaSymlink]);
  assert.equal(r2.status, 127);
});

test('README documents the plugin install', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /## Install\n/);
  assert.match(readme, /\/plugin marketplace add rayanweragala\/coder-room/);
  assert.match(readme, /claude --plugin-dir \.\/plugins\/coder-room/);
});
