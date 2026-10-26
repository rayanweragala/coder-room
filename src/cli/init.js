import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { EXIT, onPath, parseFlags, roundsDir } from './common.js';
import { BACKLOG, CODER_TOOLS, HANDOFF, SPEC_TEMPLATE, defaultConfig } from './templates.js';

export const INIT_HELP = `usage: coder-room init [--yes] [--dir <project>]
  Creates .rounds/ (HANDOFF.md, BACKLOG.md, spec-template.md, config.json, coder-tools.txt, chain.log).
  Never overwrites existing files. --yes adds .rounds/ to .gitignore without asking.
`;

function ignored(project) {
  try {
    const text = fs.readFileSync(path.join(project, '.gitignore'), 'utf8');
    return text.split('\n').some((l) => /^\/?\.rounds\/?$/.test(l.trim()));
  } catch {
    return false;
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

export async function init(argv, io = { out: console.log }) {
  const f = parseFlags(argv, { yes: 'bool', dir: 'value' });
  const project = path.resolve(f.dir ?? process.cwd());
  const dir = roundsDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const config = JSON.stringify(defaultConfig({ claude: onPath('claude'), codex: onPath('codex') }), null, 2) + '\n';
  const files = {
    'HANDOFF.md': HANDOFF,
    'BACKLOG.md': BACKLOG,
    'spec-template.md': SPEC_TEMPLATE,
    'config.json': config,
    'coder-tools.txt': CODER_TOOLS,
    'chain.log': '',
  };
  const created = [];
  const kept = [];
  for (const [name, text] of Object.entries(files)) {
    try {
      fs.writeFileSync(path.join(dir, name), text, { flag: 'wx' });
      created.push(name);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      kept.push(name);
    }
  }
  io.out(`created: ${created.join(', ') || '(none)'}`);
  io.out(`kept: ${kept.join(', ') || '(none)'}`);

  if (!ignored(project)) {
    let add = f.yes === true;
    if (!add && process.stdin.isTTY && process.stdout.isTTY) {
      add = !/^n/i.test((await ask('Add .rounds/ to .gitignore? [Y/n] ')).trim());
    } else if (!add) io.out('add this line to .gitignore:\n.rounds/');
    if (add) {
      const file = path.join(project, '.gitignore');
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      fs.appendFileSync(file, `${old && !old.endsWith('\n') ? '\n' : ''}.rounds/\n`);
      io.out('.gitignore: added .rounds/');
    }
  }
  return EXIT.ok;
}
