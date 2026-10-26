import fs from 'node:fs/promises';
import path from 'node:path';
import { logName } from './parse-chain.js';

/** Chain stamps are whole minutes, so a rotated log may be written up to a minute after the next attempt's stamp. */
const STAMP_SLACK_MS = 60_000;

/** Key of one attempt: a coder slot running a round from `startedAt`. A new start is a new attempt. */
export const attemptKey = (r) => `${r.id}\0${r.role}\0${r.round}\0${r.startedAt}`;

export const hasEnded = (r) => r.state !== 'running';

/** Order of two starts: stamps are whole minutes, so the chain order (`startSeq`) breaks ties. */
const after = (o, r) => o.startedAt > r.startedAt || (o.startedAt === r.startedAt && (o.startSeq ?? 0) > (r.startSeq ?? 0));

/** Start of the next attempt of the same round and role (any coder) after `r`, or null when `r` is the latest. */
export function newerStart(r, all) {
  let best = null;
  for (const o of all) {
    if (o === r || o.runsDir !== r.runsDir || o.round !== r.round || o.role !== r.role || !after(o, r)) continue;
    if (best === null || o.startedAt < best) best = o.startedAt;
  }
  return best;
}

/** Rotated logs of a round (`<round>-prev-HHMM.log`), oldest first, with inode and mtime. */
export async function rotatedLogs(r) {
  const stem = logName(r.role, r.round).replace(/\.log$/, '');
  let names;
  try {
    names = await fs.readdir(r.runsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.startsWith(`${stem}-prev-`) || !n.endsWith('.log')) continue;
    const file = path.join(r.runsDir, n);
    try {
      const st = await fs.stat(file);
      out.push({ file, ino: st.ino, mtimeMs: st.mtimeMs });
    } catch { /* gone meanwhile */ }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * The rotated file holding an ended attempt's log: the one with inode `ino` when known, else the newest rotated
 * log last written no later than the next attempt's start. Null when none fits.
 */
export async function findRotated(r, { ino = null, before = null, after = null } = {}) {
  const list = await rotatedLogs(r);
  if (ino != null) {
    const hit = list.find((l) => l.ino === ino);
    if (hit) return hit.file;
  }
  if (before == null) return null;
  return list.findLast((l) => l.mtimeMs <= before + STAMP_SLACK_MS && (after == null || l.mtimeMs >= after - STAMP_SLACK_MS))?.file ?? null;
}

/**
 * Log file of attempt `i` of a round's chain attempts ({role, startedAt}[] in file order): `<round>.log` for the
 * latest attempt of its role, else the rotated log written between its start and the next attempt's start.
 */
export async function logForAttempt(runsDir, round, attempts, i) {
  const a = attempts[i];
  const next = attempts.slice(i + 1).find((o) => o.role === a.role);
  if (!next) return path.join(runsDir, logName(a.role, round));
  return findRotated({ runsDir, role: a.role, round }, { before: next.startedAt, after: a.startedAt });
}
