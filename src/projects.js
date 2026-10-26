import fs from 'node:fs/promises';
import path from 'node:path';
import { isRunsDir, runsDirOf } from './runs-dir.js';

const SKIP = new Set(['node_modules', '.git']);
const HEAD_BYTES = 32 * 1024;

const warnedBoth = new Set();

async function scan(dir, depth, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => isRunsDir(e.name))) out.push(dir);
  for (const e of entries) {
    if (depth < 2 && e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) {
      await scan(path.join(dir, e.name), depth + 1, out);
    }
  }
}

function warnOnce(msg) {
  if (warnedBoth.has(msg)) return;
  warnedBoth.add(msg);
  console.log(msg);
}

/**
 * Watched projects: dirs whose `.rounds/chain.log` (else the legacy folder's) exists, deduped by
 * realpath (worktrees symlink the runs folder to the main repo). `runsName` is the folder name in use.
 * @param {{roots?: string[], scanRoot: string}} opts
 * @returns {Promise<{name:string, dir:string, runsDir:string, runsName:string}[]>}
 */
export async function discoverProjects({ roots, scanRoot }) {
  const candidates = [];
  if (roots && roots.length) candidates.push(...roots);
  else await scan(scanRoot, 0, candidates);
  const seen = new Map();
  for (const c of candidates) {
    const used = await runsDirOf(c, warnOnce);
    if (!used) continue;
    let real;
    try {
      real = await fs.realpath(used);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    const dir = path.dirname(real);
    seen.set(real, { name: path.basename(dir), dir, runsDir: real, runsName: path.basename(used) });
  }
  return [...seen.values()];
}

/** Candidate `~/.claude/projects/<enc>` names for a project dir (`/` replaced; also all non-alphanumerics). */
export function encodings(dir) {
  return [...new Set([dir.replace(/\//g, '-'), dir.replace(/[^a-zA-Z0-9]/g, '-')])];
}

/** Each project dir plus its ancestors below `home` (not `home` itself), deduped. */
export function transcriptDirs(projects, home) {
  const out = new Set();
  const base = path.resolve(home);
  for (const p of projects) {
    out.add(p.dir);
    for (let d = path.dirname(p.dir); d.startsWith(base + path.sep); d = path.dirname(d)) out.add(d);
  }
  return [...out];
}

/** `cwd` recorded in the first lines of a transcript, or null. */
export async function transcriptCwd(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(32 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (line[0] !== '{') continue;
      try {
        const cwd = JSON.parse(line).cwd;
        if (typeof cwd === 'string' && cwd) return cwd;
      } catch { /* partial or bad line */ }
    }
  } catch { /* unreadable */ } finally {
    await fh?.close();
  }
  return null;
}

/**
 * Transcript roots: `~/.claude/projects` plus `projects/` of every `~/.claude*` directory (other Claude
 * config dirs), when they exist.
 */
export async function defaultClaudeProjects(home) {
  const out = [path.join(home, '.claude', 'projects')];
  let entries = [];
  try {
    entries = await fs.readdir(home, { withFileTypes: true });
  } catch { /* unreadable home */ }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory() || !e.name.startsWith('.claude')) continue;
    const d = path.join(home, e.name, 'projects');
    if (out.includes(d)) continue;
    try {
      if ((await fs.stat(d)).isDirectory()) out.push(d);
    } catch { /* no projects dir */ }
  }
  return out;
}

/** `entrypoint` recorded in the first lines of a transcript (`cli`, `sdk-cli`, ...), or null when absent. */
export async function transcriptEntrypoint(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (line[0] !== '{') continue;
      try {
        const ep = JSON.parse(line).entrypoint;
        if (typeof ep === 'string' && ep) return ep;
      } catch { /* partial or bad line */ }
    }
  } catch { /* unreadable */ } finally {
    await fh?.close();
  }
  return null;
}

/**
 * Every interactive `*.jsonl` transcript modified within `maxAgeMs` for the watched projects and their ancestors
 * below `home`, across all `claudeProjects` roots. Print-mode (`sdk-cli`) transcripts are skipped; the verdict is
 * cached in `printMode` per file and inode.
 * @param {string|string[]} claudeProjects
 * @returns {Promise<{file:string, mtimeMs:number}[]>} newest first
 */
export async function recentTranscripts(projects, claudeProjects, home, now, maxAgeMs = 86_400_000, printMode = new Map()) {
  const out = new Map();
  const seen = new Set();
  for (const root of [claudeProjects].flat()) {
    for (const dir of transcriptDirs(projects, home)) {
      for (const enc of encodings(dir)) {
        const d = path.join(root, enc);
        let names;
        try {
          names = await fs.readdir(d);
        } catch {
          continue;
        }
        for (const n of names) {
          if (!n.endsWith('.jsonl')) continue;
          try {
            const file = path.join(d, n);
            const st = await fs.stat(file);
            if (now - st.mtimeMs > maxAgeMs) continue;
            seen.add(file);
            let verdict = printMode.get(file);
            const young = verdict && !verdict.known && verdict.size !== st.size && verdict.size < HEAD_BYTES;
            if (!verdict || verdict.ino !== st.ino || young) {
              const ep = await transcriptEntrypoint(file);
              verdict = { ino: st.ino, size: st.size, known: ep !== null, print: ep === 'sdk-cli' };
              printMode.set(file, verdict);
            }
            if (!verdict.print) out.set(file, { file, mtimeMs: st.mtimeMs });
          } catch { /* vanished */ }
        }
      }
    }
  }
  for (const f of printMode.keys()) if (!seen.has(f)) printMode.delete(f);
  return [...out.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}
