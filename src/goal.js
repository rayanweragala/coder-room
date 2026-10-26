import fs from 'node:fs/promises';
import path from 'node:path';
import { oneLine } from './events.js';

const READ_BYTES = 16 * 1024;

function paragraphAfter(lines, from) {
  const para = [];
  for (const l of lines.slice(from)) {
    if (!l.trim() || l.startsWith('#')) { if (para.length) break; continue; }
    para.push(l.trim());
  }
  return para.join(' ');
}

function firstSentence(s, max) {
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return oneLine(m ? m[0] : s, max);
}

/** Project goal ("What this is", else the first paragraph after the title) and the first "Next step" line. */
export function parseHandoff(text) {
  const lines = text.split('\n');
  const what = lines.findIndex((l) => /^#{1,6}\s+What this is\b/i.test(l));
  const title = lines.findIndex((l) => l.startsWith('# '));
  const raw = paragraphAfter(lines, what >= 0 ? what + 1 : title + 1).replace(/^([-*]|\d+[.)])\s+/, '');
  const next = lines.findIndex((l) => /^#{1,6}\s+Next step\b/i.test(l));
  let toward = '';
  if (next >= 0) {
    for (const l of lines.slice(next + 1)) {
      if (l.startsWith('#')) break;
      if (l.trim()) { toward = l.trim().replace(/^([-*]|\d+[.)])\s+/, '').replace(/\*\*/g, ''); break; }
    }
  }
  return { goal: oneLine(raw, 600), short: firstSentence(raw, 180), toward: oneLine(toward, 240) };
}

/** Reads each project's handoff file (root `HANDOFF.md`, else `HANDOFF.md` in its rounds folder); re-parses only on change. */
export class HandoffGoals {
  constructor() {
    this.cache = new Map();
  }

  /** Forgets the cached goal of a quiet project; the next `get` re-reads it. */
  drop(project) {
    this.cache.delete(path.join(project.dir, 'HANDOFF.md'));
    this.cache.delete(path.join(project.runsDir, 'HANDOFF.md'));
  }

  /** @returns {Promise<{goal:string, short:string, toward:string}|null>} */
  async get(project) {
    for (const file of [path.join(project.dir, 'HANDOFF.md'), path.join(project.runsDir, 'HANDOFF.md')]) {
      let fh;
      try {
        fh = await fs.open(file, 'r');
        const st = await fh.stat();
        const key = `${st.mtimeMs}:${st.size}`;
        const hit = this.cache.get(file);
        if (hit?.key === key) return hit.value;
        const buf = Buffer.alloc(Math.min(st.size, READ_BYTES));
        await fh.read(buf, 0, buf.length, 0);
        const goal = parseHandoff(buf.toString('utf8'));
        this.cache.set(file, { key, value: goal });
        return goal;
      } catch { /* try the next location */ } finally {
        await fh?.close();
      }
    }
    return null;
  }
}
