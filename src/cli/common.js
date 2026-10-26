import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXIT = { ok: 0, failed: 1, usage: 2, refused: 3 };

export class UsageError extends Error {}

/** Splits argv into positionals and flags (kinds: bool, value, list); unknown flags are usage errors. */
export function parseFlags(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const kind = spec[key];
    if (kind === 'bool') out[key] = true;
    else if (kind === 'value' || kind === 'list') {
      if (i + 1 >= argv.length) throw new UsageError(`--${key} needs a value`);
      if (kind === 'list') (out[key] ??= []).push(argv[++i]);
      else out[key] = argv[++i];
    } else throw new UsageError(`unknown option --${key}`);
  }
  return out;
}

export const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const expandHome = (p) => (p === '~' || p?.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

export function onPath(bin, env = process.env) {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
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

export const roundsDir = (project) => path.join(project, '.rounds');

export function appendChain(project, line) {
  fs.appendFileSync(path.join(roundsDir(project), 'chain.log'), `${line}\n`);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const DEFAULT_LIMITS = {
  claude: ['hit your session limit', 'usage limit', 'hit your limit'],
  codex: ['usage limit', 'rate limit', 'hit your limit'],
};

export function loadConfig(project) {
  const cfg = readJson(path.join(roundsDir(project), 'config.json'), null);
  if (!cfg || !Array.isArray(cfg.coders)) return null;
  cfg.order ??= cfg.coders.map((c) => c.name);
  cfg.limitPatterns = { ...DEFAULT_LIMITS, ...cfg.limitPatterns };
  return cfg;
}

export const stateFile = (project) => path.join(roundsDir(project), 'coders-state.json');
export const loadState = (project) => readJson(stateFile(project), {});

export const LIMITED_MS = 60 * 60 * 1000;

/** Date until which the coder counts as limited, or null. */
export function limitedUntil(state, name, now = Date.now()) {
  const at = Date.parse(state[name]?.limitedAt ?? '');
  return Number.isFinite(at) && at + LIMITED_MS > now ? new Date(at + LIMITED_MS) : null;
}
