import { EXIT, UsageError } from './common.js';
import { INIT_HELP, init } from './init.js';
import { RUN_HELP, run } from './run.js';
import { SERVE_HELP, serve } from './serve.js';
import { STATUS_HELP, status } from './status.js';
import { TOKENS_HELP, tokens } from './tokens.js';

export const HELP = `coder-room: a live room for your coder rounds

usage: coder-room <command> [options]
  init     set up .rounds/ in a project
  run      run a round with a coder (with fallback)
  serve    start the read-only room server
  status   coders, recent events, running rounds
  tokens   per-round token usage and cost
  help     this text   (coder-room <command> --help for details)
`;

const COMMANDS = {
  init: [init, INIT_HELP],
  run: [run, RUN_HELP],
  serve: [serve, SERVE_HELP],
  status: [status, STATUS_HELP],
  tokens: [tokens, TOKENS_HELP],
};

/** Runs the CLI; resolves with an exit code, or null when a server keeps the process alive. */
export async function main(argv, io = { out: console.log, err: console.error }, ctx = {}) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    io.out(HELP);
    return EXIT.ok;
  }
  const entry = COMMANDS[cmd];
  if (!entry) {
    io.err(`unknown command ${cmd}\n${HELP}`);
    return EXIT.usage;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(entry[1]);
    return EXIT.ok;
  }
  try {
    return await entry[0](rest, io, ctx);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\n${entry[1]}`);
      return EXIT.usage;
    }
    throw e;
  }
}
