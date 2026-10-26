import fs from 'node:fs/promises';
import path from 'node:path';

/** Per-project folder names, preferred first; the second is the legacy name. */
export const RUNS_DIRS = ['.rounds', '.codex-runs'];

export const isRunsDir = (name) => RUNS_DIRS.includes(name);

async function hasChain(dir) {
  try {
    return (await fs.stat(path.join(dir, 'chain.log'))).isFile();
  } catch {
    return false;
  }
}

/**
 * The runs folder a project uses: the first of `RUNS_DIRS` holding a `chain.log`, else null.
 * @param {string} projectDir
 * @param {(msg:string)=>void} [onBoth] called when both folders have a chain.log
 * @returns {Promise<string|null>} absolute path (not realpath'd)
 */
export async function runsDirOf(projectDir, onBoth) {
  const found = [];
  for (const n of RUNS_DIRS) {
    const d = path.join(projectDir, n);
    if (await hasChain(d)) found.push(d);
  }
  if (found.length > 1) onBoth?.(`${projectDir}: both ${RUNS_DIRS.join(' and ')} exist; using ${RUNS_DIRS[0]}`);
  return found[0] ?? null;
}
