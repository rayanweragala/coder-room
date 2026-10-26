'use strict';
// SessionStart hook: read-only. Prints a short pointer when the project uses coder-room rounds.
const fs = require('node:fs');
const path = require('node:path');

const DIRS = ['.rounds', '.codex-runs'];
const TAIL_BYTES = 64 * 1024;
const RE_EVENT = /^coder (\S+) (started|finished|LIMIT|REFUSED)\b/;

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function tailOf(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function runningRounds(chainFile) {
  const last = new Map();
  for (const line of tailOf(chainFile).split('\n')) {
    const m = RE_EVENT.exec(line);
    if (m) last.set(m[1], m[2]);
  }
  return [...last].filter(([, ev]) => ev === 'started').map(([round]) => round);
}

function onPath(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

function main() {
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = DIRS.find((d) => exists(path.join(project, d, 'HANDOFF.md')));
  if (!dir) return;
  const lines = [`This project uses coder-room rounds. Read ${dir}/HANDOFF.md first (and the backlog it points to).`];
  const running = runningRounds(path.join(project, dir, 'chain.log'));
  if (running.length) lines.push(`Running rounds (started, not finished): ${running.join(', ')}. Check ${dir}/chain.log.`);
  lines.push(onPath('coder-room')
    ? 'Coding goes to separate coders: use `coder-room run <round>` (see the coder-room:orchestrate skill).'
    : 'The `coder-room` CLI is not on PATH: install it with `npm i -g coder-room`.');
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
