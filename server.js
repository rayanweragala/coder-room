import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './src/room.js';
import { createHttpServer } from './src/http.js';

export function parseArgs(argv) {
  const opts = { port: 4317, userName: 'You', roots: [], claudeProjects: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opts.port = Number(argv[++i]);
    else if (argv[i] === '--root') opts.roots.push(path.resolve(argv[++i]));
    else if (argv[i] === '--user-name') opts.userName = argv[++i];
    else if (argv[i] === '--claude-projects') (opts.claudeProjects ??= []).push(path.resolve(argv[++i]));
  }
  return opts;
}

/** Starts room + server on 127.0.0.1; resolves with {port, close}. */
export async function startServer(opts) {
  const room = new Room({
    roots: opts.roots,
    scanRoot: path.join(os.homedir(), 'Documents', 'projects'),
    claudeProjects: opts.claudeProjects,
    home: opts.home ?? os.homedir(),
    userName: opts.userName,
  });
  const server = createHttpServer(room, path.join(path.dirname(fileURLToPath(import.meta.url)), 'public'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', resolve);
  });
  await room.start();
  return {
    port: server.address().port,
    async close() {
      room.stop();
      await server.close_();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srv = await startServer(parseArgs(process.argv.slice(2)));
  console.log(`coder-room on http://127.0.0.1:${srv.port}`);
  const stop = async () => {
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
