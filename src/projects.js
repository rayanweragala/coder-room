import fs from 'node:fs/promises';
import path from 'node:path';
import { isRunsDir, runsDirOf } from './runs-dir.js';

const SKIP = new Set(['node_modules', '.git']);

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
 * Every `*.jsonl` transcript modified within `maxAgeMs` for the watched projects and their ancestors below `home`.
 * @returns {Promise<{file:string, mtimeMs:number}[]>} newest first
 */
export async function recentTranscripts(projects, claudeProjects, home, now, maxAgeMs = 86_400_000) {
  const out = new Map();
  for (const dir of transcriptDirs(projects, home)) {
    for (const enc of encodings(dir)) {
      const d = path.join(claudeProjects, enc);
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
          if (now - st.mtimeMs <= maxAgeMs) out.set(file, { file, mtimeMs: st.mtimeMs });
        } catch { /* vanished */ }
      }
    }
  }
  return [...out.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}
