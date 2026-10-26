import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, startServer } from '../../server.js';
import { startAppender } from '../../demo/appender.js';
import { makeDemo } from '../../demo/make-demo.js';
import { parseFlags } from './common.js';

export const SERVE_HELP = `usage: coder-room serve [--port 4317] [--root <dir> ...] [--claude-projects <dir>] [--user-name <name>] [--open]
       coder-room serve --demo [--fast] [--out <dir>] [--port 4317]
  Starts the read-only room on 127.0.0.1. --open prints the URL (no browser is launched).
  --user-name  name shown for your chat messages (default "You").
  --demo       builds a synthetic workspace (two projects, coder logs, orchestrator transcripts), keeps writing
               new lines into it for about 10 minutes, and shows the room on it. Nothing real is read or written.
               It is made in a temp dir (removed on exit) or in --out.
  --fast       with --demo, plays the same story 3 times faster (about 3 minutes).
`;

const FAST_SPEED = 3;
const isOwnTemp = (dir) => path.dirname(dir) === fs.realpathSync(os.tmpdir()) && path.basename(dir).startsWith('coder-room-demo-');

export async function serve(argv, io = { out: console.log }) {
  const f = parseFlags(argv, {
    port: 'value', root: 'list', 'claude-projects': 'value', 'user-name': 'value', out: 'value', open: 'bool', demo: 'bool', fast: 'bool',
  });
  const args = [];
  if (f.port) args.push('--port', f.port);
  if (f['user-name']) args.push('--user-name', f['user-name']);
  let demo = null;
  let appender = null;
  if (f.demo) {
    demo = makeDemo({ out: f.out });
    appender = startAppender(demo.actors, { dir: demo.dir, speed: f.fast ? FAST_SPEED : 1 });
    for (const p of demo.projects) args.push('--root', p.dir);
    args.push('--claude-projects', demo.claudeProjects);
    io.out(`demo workspace in ${demo.dir}`);
  } else {
    for (const r of f.root ?? []) args.push('--root', path.resolve(r));
    if (f['claude-projects']) args.push('--claude-projects', f['claude-projects']);
  }
  const srv = await startServer(parseArgs(args));
  const url = `http://127.0.0.1:${srv.port}`;
  io.out(`coder-room on ${url}`);
  if (f.open) io.out(`open ${url} in your browser`);
  const stop = async () => {
    appender?.stop();
    await srv.close();
    if (demo && !f.out && isOwnTemp(demo.dir)) fs.rmSync(demo.dir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null; // keep running
}
