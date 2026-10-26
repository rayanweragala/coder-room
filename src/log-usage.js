import fs from 'node:fs/promises';
import { backLines } from './backread.js';
import { createClaudeParser } from './parse-claude.js';
import { UsageMeter } from './usage.js';

export const USAGE_TAIL_BYTES = 256 * 1024;
const MAX_LINE = 256 * 1024;
const KEEP_CACHE = 400;
const cache = new Map();

const NONE = { in: null, out: null, cr: null, cw: null, ctx: null, cost: null, total: null, turns: null, incomplete: true };
const RESULT_MARK = Buffer.from('"type":"result"');
const CODEX_TOTAL = /^tokens used\D+(\d[\d,._]*)\s*$/;
const NUMBER_ONLY = /^\s*(\d[\d,._]*)\s*$/;
const digits = (s) => Number(s.replace(/\D/g, ''));

/**
 * Finds a log's last usage line by looking at lines from the end of the file backwards: a Claude `result` object
 * (the cheap byte check skips every other line without decoding it) or a Codex `tokens used` total.
 */
class BackScan {
  constructor() {
    this.claude = createClaudeParser();
    this.final = null;
    this.turns = null;
    this.number = null;
  }

  /** @returns {boolean} true when the usage was found (stop reading) */
  push(buf) {
    if (buf[0] === 0x7b) {
      if (!buf.includes(RESULT_MARK)) { this.number = null; return false; }
      const line = buf.toString('utf8');
      const u = this.claude.feed(line).find((e) => e.kind === 'usage' && e.final);
      if (!u) return false;
      this.final = u;
      try { this.turns = JSON.parse(line).num_turns ?? null; } catch { /* keep null */ }
      return true;
    }
    if (buf.length > 200) { this.number = null; return false; }
    const line = buf.toString('utf8');
    const num = NUMBER_ONLY.exec(line);
    if (num) { this.number = digits(num[1]); return false; }
    if (/^tokens used\s*$/.test(line) && this.number !== null) {
      this.final = { kind: 'usage', final: true, total: this.number };
      return true;
    }
    const same = CODEX_TOTAL.exec(line);
    this.number = null;
    if (!same) return false;
    this.final = { kind: 'usage', final: true, total: digits(same[1]) };
    return true;
  }

  result() {
    if (!this.final) return { ...NONE };
    const meter = new UsageMeter();
    meter.add(this.final);
    const v = meter.view();
    return {
      in: v.in ?? null, out: v.out ?? null, cr: v.cr ?? null, cw: v.cw ?? null, ctx: v.ctx ?? null,
      cost: v.cost ?? null, total: v.total ?? null, turns: this.turns, incomplete: false,
    };
  }
}

/** Tokens, cost and turns from the lines of a log tail (file order); `incomplete` when no result/total line is there. */
export function usageFromLines(lines) {
  const scan = new BackScan();
  for (let i = lines.length - 1; i >= 0; i--) if (scan.push(Buffer.from(lines[i]))) break;
  return scan.result();
}

/** Usage of one round log from its last 256 KB; cached by (path, size, mtime). Missing file → incomplete. */
export async function logUsage(file) {
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    cache.delete(file);
    return { ...NONE };
  }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file);
  if (hit?.key === key) return hit.value;
  const scan = new BackScan();
  await backLines(file, (buf) => scan.push(buf), USAGE_TAIL_BYTES, MAX_LINE);
  const usage = scan.result();
  cache.delete(file);
  cache.set(file, { key, value: usage });
  if (cache.size > KEEP_CACHE) cache.delete(cache.keys().next().value);
  return usage;
}

export const usageCacheSize = () => cache.size;
export const clearUsageCache = () => cache.clear();
