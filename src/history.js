import fs from 'node:fs/promises';
import path from 'node:path';
import { parseChainLines, logName } from './parse-chain.js';
import { parseSpec, readHead } from './rounds.js';
import { logUsage } from './log-usage.js';
import { logModel } from './log-model.js';
import { bestModel } from '../public/model.js';
import { Tail } from './tail.js';
import { createLogParser } from './parse-log.js';
import { Facts } from './facts.js';
import { logForAttempt } from './attempts.js';
import { coderTile } from './tiles.js';
import { coderStatus } from './state.js';

export const MAX_CHAIN_BYTES = 2 * 1024 * 1024;
export const MAX_ROUNDS = 200;
export const DETAIL_TAIL_BYTES = 1024 * 1024;
const STEP_BYTES = 64 * 1024;
export const DETAIL_EVENTS = 300;
export const REPORT_HEAD_LINES = 40;
export const ROUND_ID = /^[A-Za-z0-9._-]{1,40}$/;

/** Whole chain.log text (the last 2 MB when larger, starting at a line boundary) and its mtime; null when unreadable. */
export async function readChain(runsDir) {
  let fh;
  try {
    fh = await fs.open(path.join(runsDir, 'chain.log'), 'r');
    const st = await fh.stat();
    const len = Math.min(st.size, MAX_CHAIN_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.size - len);
    let text = buf.toString('utf8');
    if (st.size > len) text = text.slice(text.indexOf('\n') + 1);
    return { lines: text.split('\n').map((l) => l.replace(/\r$/, '')), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/**
 * Groups dated chain events (file order) into one entry per round. A `started` opens an attempt; finished / limit /
 * refused close the open one (or make a start-less one). An attempt still open when another starts is `interrupted`.
 * @returns {Map<string, object[]>} round → attempts in file order
 */
export function groupAttempts(events) {
  const rounds = new Map();
  const open = new Map();
  for (const ev of events) {
    if (ev.type === 'ready' || !ev.role) continue;
    const key = `${ev.role}\0${ev.round}`;
    const list = rounds.get(ev.round) ?? [];
    rounds.set(ev.round, list);
    let a = open.get(key);
    if (ev.type === 'started') {
      if (a) { a.outcome = 'interrupted'; }
      a = { role: ev.role, round: ev.round, startedAt: ev.at, endedAt: null, outcome: 'running', rc: null, reason: null, who: ev.who ?? null };
      list.push(a);
      open.set(key, a);
      continue;
    }
    if (!a) {
      a = { role: ev.role, round: ev.round, startedAt: null, endedAt: null, outcome: 'running', rc: null, reason: null, who: null };
      list.push(a);
    }
    a.who ??= ev.who ?? null;
    a.endedAt = ev.at;
    open.delete(key);
    if (ev.type === 'finished') Object.assign(a, { outcome: ev.rc === 0 || ev.rc === null ? 'done' : 'failed', rc: ev.rc });
    else if (ev.type === 'limit') a.outcome = 'limit';
    else if (ev.type === 'refused') Object.assign(a, { outcome: 'refused', reason: ev.reason || null });
  }
  return rounds;
}

const letters = 'bcdefghijklmnopqrstuvwxyz';

/** Next follow-up spec of a round that exists (`q05` → `q05b`, `q05b` → `q05c`), judged from the folder's file names. */
export function fixRoundOf(round, names) {
  const m = /^(.*\d)([a-z])$/.exec(round);
  const base = m ? m[1] : round;
  const from = m ? letters.indexOf(m[2]) + 1 : 0;
  for (const l of letters.slice(from)) if (names.has(`${base}${l}.md`)) return `${base}${l}`;
  return null;
}

function summarize(round, attempts, names, now) {
  const coders = attempts.filter((a) => a.role === 'coder');
  const main = coders.length ? coders : attempts;
  const last = main.at(-1);
  const first = main[0];
  const startedAt = first.startedAt ?? first.endedAt;
  const endedAt = last.outcome === 'running' ? null : last.endedAt;
  const startedLast = last.startedAt ?? last.endedAt;
  const duration = last.startedAt == null ? null : (endedAt ?? now) - last.startedAt;
  return {
    round, role: last.role, who: main.findLast((a) => a.who)?.who ?? null, startedAt, lastStartedAt: startedLast, endedAt,
    durationMs: duration === null ? null : Math.max(0, duration),
    outcome: last.outcome, rc: last.rc, reason: last.reason,
    attempts: attempts.map(({ role, startedAt: s, endedAt: e, outcome, rc, who }) => ({ role, startedAt: s, endedAt: e, outcome, rc, coder: who?.name ?? null })),
    fix: fixRoundOf(round, names), hasSpec: names.has(`${round}.md`), hasReport: names.has(`${round}-report.md`),
  };
}

/** Pure part of the list: rounds from chain lines, newest first, capped. */
export function buildRoundList(lines, mtimeMs, names, now = Date.now()) {
  const events = parseChainLines(lines, mtimeMs);
  const rows = [...groupAttempts(events)].filter(([, a]) => a.length).map(([round, attempts]) => summarize(round, attempts, names, now));
  rows.sort((a, b) => (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0));
  return rows.slice(0, MAX_ROUNDS);
}

async function namesIn(runsDir) {
  try {
    return new Set(await fs.readdir(runsDir));
  } catch {
    return new Set();
  }
}

async function titleOf(runsDir, round) {
  const got = await readHead(path.join(runsDir, `${round}.md`));
  return got ? parseSpec(got.text) : null;
}

/** The project's rounds (newest first) with spec title and tokens/cost. */
export async function listRounds(project, now = Date.now()) {
  const chain = await readChain(project.runsDir);
  if (!chain) return [];
  const rows = buildRoundList(chain.lines, chain.mtimeMs, await namesIn(project.runsDir), now);
  for (const r of rows) {
    r.title = (await titleOf(project.runsDir, r.round))?.title || '';
    const file = path.join(project.runsDir, logName(r.role, r.round));
    r.tokens = await logUsage(file);
    r.model = bestModel(await logModel(file), r.who?.model);
  }
  return rows;
}

async function reportHead(runsDir, round) {
  const got = await readHead(path.join(runsDir, `${round}-report.md`));
  if (!got) return null;
  const lines = got.text.split('\n');
  return { markdown: lines.slice(0, REPORT_HEAD_LINES).join('\n'), more: lines.length > REPORT_HEAD_LINES };
}

/**
 * Details of one round, computed per request: spec, report head, the last 300 timeline events of its log (a
 * bounded 1 MB tail read), and a tile-shaped object the replay view renders. Null when the round is unknown.
 * `attempt` is an index into `row.attempts` (default: the latest attempt of the row's role). Each attempt reads its
 * own log: `<round>.log` for the latest one, the rotated `-prev-` file for earlier ones.
 */
export async function roundDetails(project, round, now = Date.now(), attempt = null) {
  const rows = await listRounds(project, now);
  const i = rows.findIndex((r) => r.round === round);
  if (i < 0) return null;
  const row = rows[i];
  const chain = await readChain(project.runsDir);
  const all = groupAttempts(parseChainLines(chain.lines, chain.mtimeMs)).get(round) ?? [];
  const index = attempt != null && attempt >= 0 && attempt < all.length ? attempt : all.findLastIndex((a) => a.role === row.role);
  const at = all[index] ?? null;
  const live = path.join(project.runsDir, logName(row.role, round));
  const file = at ? await logForAttempt(project.runsDir, round, all, index) : live;
  const latest = !at || file === path.join(project.runsDir, logName(at.role, round));
  const parser = createLogParser({ root: project.dir });
  const facts = new Facts({ keep: DETAIL_EVENTS });
  const tail = new Tail(file ?? '', DETAIL_TAIL_BYTES);
  tail.stepBytes = STEP_BYTES;
  do {
    const { lines } = await tail.poll();
    for (const line of lines) for (const ev of parser.feed(line)) facts.push(ev, null);
  } while (tail.more);
  const partial = tail.fromTail;
  const spec = await titleOf(project.runsDir, round);
  const report = await reportHead(project.runsDir, round);
  const shown = at ?? row;
  const who = at?.who ?? row.who;
  const tokens = latest ? row.tokens : await logUsage(file ?? '');
  const model = latest ? row.model : bestModel(await logModel(file ?? ''), who?.model);
  const state = { done: 'done', failed: 'done', limit: 'rate-limited', refused: 'refused' }[shown.outcome] ?? 'running';
  const rec = {
    slot: who?.id ?? 'coder', id: `replay:${round}`, name: who?.name ?? 'Coder', color: who?.color ?? '#94a3b8',
    char: who?.kind ?? null, look: who?.look ?? null, project: project.name, round, role: shown.role, rc: shown.rc,
    reason: shown.reason, startedAt: shown.startedAt, endedAt: shown.endedAt, state,
  };
  const follower = { facts, current: null, grewAt: null };
  const tile = {
    ...coderTile(rec, follower, { spec, report: null }, coderStatus(rec, null, 0, now)),
    model: model ?? null, events: facts.events, replay: true, lastActivity: null,
    usage: tokens.incomplete ? facts.usage() : { ...(facts.usage() ?? {}), ...usageView(tokens) },
    reportMd: report,
  };
  return {
    project: project.name, round, row, attempt: index, partial, title: spec?.title || '', goal: spec?.goal || '', tile,
    prev: rows[i + 1]?.round ?? null, next: rows[i - 1]?.round ?? null,
  };
}

function usageView(t) {
  if (t.total !== null) return { total: t.total, final: true, partial: false };
  return { in: t.in, out: t.out, cr: t.cr, cw: t.cw, ctx: t.ctx, cost: t.cost, models: [], final: true, partial: false };
}
