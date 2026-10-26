import fs from 'node:fs';
import path from 'node:path';
import { runsDirOf } from '../runs-dir.js';
import { EXIT, limitedUntil, loadConfig, loadState, onPath, parseFlags } from './common.js';

export const STATUS_HELP = `usage: coder-room status [--dir <project>]
  Shows each configured coder (enabled, on PATH, limited until), the last 10 coder events and running rounds.
`;

const RE_EVENT = /^coder (\S+)(?: .*?)? (started|finished|LIMIT|REFUSED|STOPPED)\b/;

export async function chainEvents(project) {
  try {
    const dir = await runsDirOf(project);
    if (!dir) return [];
    return fs.readFileSync(path.join(dir, 'chain.log'), 'utf8')
      .split('\n')
      .map((l) => ({ line: l, m: RE_EVENT.exec(l) }))
      .filter((e) => e.m);
  } catch {
    return [];
  }
}

export async function status(argv, io = { out: console.log, err: console.error }, ctx = {}) {
  const f = parseFlags(argv, { dir: 'value' });
  const project = path.resolve(f.dir ?? ctx.project ?? process.cwd());
  const env = ctx.env ?? process.env;
  const cfg = loadConfig(project);
  const events = await chainEvents(project);
  if (!cfg && !(await runsDirOf(project))) { io.err('missing or invalid .rounds/config.json (run: coder-room init)'); return EXIT.usage; }
  const state = loadState(project);
  io.out('coders:');
  if (!cfg) io.out('  (no .rounds/config.json; run: coder-room init)');
  for (const c of cfg?.coders ?? []) {
    const until = limitedUntil(state, c.name);
    const parts = [
      c.enabled === false ? 'disabled' : 'enabled',
      onPath(c.kind, env) ? 'on PATH' : 'not on PATH',
      until ? `limited until ${until.toISOString()}` : 'not limited',
    ];
    io.out(`  ${c.name} (${c.kind} ${c.model}): ${parts.join(', ')}`);
  }
  io.out('recent events:');
  for (const e of events.slice(-10)) io.out(`  ${e.line}`);
  if (!events.length) io.out('  (none)');
  const last = new Map();
  for (const e of events) last.set(e.m[1], e.m[2]);
  const running = [...last].filter(([, ev]) => ev === 'started').map(([r]) => r);
  io.out(`running: ${running.join(', ') || '(none)'}`);
  return EXIT.ok;
}
