import os from 'node:os';
import path from 'node:path';
import { transcriptCwd } from './projects.js';
import { backLines } from './backread.js';

const MAX_LINE_BYTES = 256 * 1024;
const REASSIGN_MS = 30_000;
const LAST_INPUTS = 200;
const NAME_CHAR = /[A-Za-z0-9_.-]/;

/** The watched project whose dir is `cwd` or contains it (deepest wins), or null. */
export function projectOfCwd(cwd, projects) {
  let best = null;
  for (const p of projects) {
    if ((cwd === p.dir || cwd.startsWith(p.dir + path.sep)) && (!best || p.dir.length > best.dir.length)) best = p;
  }
  return best;
}

function hasPrefix(text, dir) {
  for (let i = text.indexOf(dir); i >= 0; i = text.indexOf(dir, i + 1)) {
    if (!NAME_CHAR.test(text[i + dir.length] ?? '/')) return true;
  }
  return false;
}

/**
 * True when `text` contains `dir` (or its `~/…` form under `home`) as a whole path prefix
 * (`/a/foo` does not match `/a/foo-bar`).
 */
export function mentions(text, dir, home = os.homedir()) {
  if (hasPrefix(text, dir)) return true;
  return !!home && dir.startsWith(home + path.sep) && hasPrefix(text, '~' + dir.slice(home.length));
}

/** The latest top-level `"cwd"` in the transcript (scanning back, 4 MB max), or null. */
export async function latestCwd(file) {
  let cwd = null;
  await backLines(file, (buf) => {
    if (buf[0] !== 0x7b) return false;
    const i = buf.indexOf('"cwd":"');
    if (i < 0) return false;
    const m = /^"cwd":("(?:[^"\\]|\\.)*")/.exec(buf.subarray(i, i + 4096).toString('utf8'));
    try { cwd = m ? JSON.parse(m[1]) : null; } catch { cwd = null; }
    return !!cwd;
  });
  return cwd;
}

/**
 * The project mentioned by the most tool inputs (each input counts once per project); ties go to the one
 * mentioned last. `inputs` are the strings of each tool call, oldest first.
 */
export function projectByInputs(inputs, projects, home = os.homedir()) {
  const score = new Map();
  inputs.forEach((text, i) => {
    for (const p of projects) if (mentions(text, p.dir, home)) score.set(p, { n: (score.get(p)?.n ?? 0) + 1, last: i });
  });
  let best = null;
  for (const [p, s] of score) {
    const b = score.get(best);
    if (!best || s.n > b.n || (s.n === b.n && s.last > b.last)) best = p;
  }
  return best;
}

/**
 * One string per `tool_use` input, oldest first, read backwards until `max` are found or 4 MB are read.
 * Lines over 256 KB are skipped unparsed.
 */
export async function lastToolInputs(file, max = LAST_INPUTS) {
  const out = [];
  await backLines(file, (buf) => {
    if (buf.length > MAX_LINE_BYTES || buf[0] !== 0x7b || !buf.includes('"tool_use"')) return false;
    let record;
    try { record = JSON.parse(buf.toString('utf8')); } catch { return false; }
    const found = [];
    for (const c of Array.isArray(record.message?.content) ? record.message.content : []) {
      if (c?.type !== 'tool_use' || !c.input || typeof c.input !== 'object') continue;
      found.push(Object.values(c.input).filter((v) => typeof v === 'string').join('\n'));
    }
    out.unshift(...found);
    return out.length >= max;
  });
  return out.slice(-max);
}

/** Which watched project a transcript belongs to: its latest cwd, else the tool inputs; null drops it. */
export async function assignTranscript(file, projects, home = os.homedir()) {
  const cwd = await latestCwd(file) ?? await transcriptCwd(file);
  if (!cwd) return null;
  return projectOfCwd(cwd, projects) ?? projectByInputs(await lastToolInputs(file), projects, home);
}

/**
 * Newest transcript per project. `assigned` caches `file` -> {key, dir} so unchanged files are read once.
 * @param {{file:string, mtimeMs:number}[]} candidates
 * @returns {Promise<Map<string, {file:string, mtimeMs:number}>>} project dir -> transcript
 */
export async function orchestratorFiles(candidates, projects, assigned = new Map(), now = Date.now(), home = os.homedir()) {
  const dirs = new Set(projects.map((p) => p.dir));
  const out = new Map();
  for (const c of candidates) {
    const key = String(c.mtimeMs);
    let hit = assigned.get(c.file);
    if (!hit || (hit.key !== key && now - hit.at >= REASSIGN_MS)) {
      hit = { key, at: now, dir: (await assignTranscript(c.file, projects, home))?.dir ?? null };
      assigned.set(c.file, hit);
    }
    if (!hit.dir || !dirs.has(hit.dir)) continue;
    if ((out.get(hit.dir)?.mtimeMs ?? -1) < c.mtimeMs) out.set(hit.dir, c);
  }
  const live = new Set(candidates.map((c) => c.file));
  for (const f of assigned.keys()) if (!live.has(f)) assigned.delete(f);
  return out;
}
