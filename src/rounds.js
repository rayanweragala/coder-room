import fs from 'node:fs/promises';
import path from 'node:path';
import { oneLine } from './events.js';

const READ_BYTES = 64 * 1024;
const REPORT_LINES = 3;

export async function readHead(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const st = await fh.stat();
    const buf = Buffer.alloc(Math.min(st.size, READ_BYTES));
    await fh.read(buf, 0, buf.length, 0);
    return { text: buf.toString('utf8'), key: `${st.mtimeMs}:${st.size}` };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/** Title, goal summary and `### ` item headings of a round spec. */
export function parseSpec(text) {
  const lines = text.split('\n');
  const title = oneLine((lines.find((l) => l.startsWith('# ')) || '').slice(2), 160);
  const items = lines.filter((l) => l.startsWith('### ')).map((l) => oneLine(l.slice(4), 120));
  const g = lines.findIndex((l) => /^##\s+Goal\b/.test(l));
  let goal = '';
  if (g >= 0) {
    const para = [];
    for (const l of lines.slice(g + 1)) {
      if (l.startsWith('#')) break;
      if (!l.trim()) { if (para.length) break; continue; }
      para.push(l.trim());
    }
    goal = oneLine(para.join(' '), 600);
  }
  return { title, goal, items };
}

/** First `# ` heading and the next few non-empty lines of a round report. */
export function parseReport(text) {
  const lines = text.split('\n');
  const h = lines.findIndex((l) => l.startsWith('# '));
  const rest = (h >= 0 ? lines.slice(h + 1) : lines).filter((l) => l.trim() && !l.startsWith('#'));
  return {
    title: h >= 0 ? oneLine(lines[h].slice(2), 160) : '',
    lines: rest.slice(0, REPORT_LINES).map((l) => oneLine(l.replace(/^\s*[-*]\s+/, ''), 200)),
  };
}

/** Reads `<round>.md` and `<round>-report.md` next to the logs; re-parses only when a file changed. */
export class RoundInfo {
  constructor() {
    this.cache = new Map();
  }

  async #load(file, parse) {
    const got = await readHead(file);
    if (!got) { this.cache.delete(file); return null; }
    const hit = this.cache.get(file);
    if (hit?.key === got.key) return hit.value;
    const parsed = parse(got.text);
    this.cache.set(file, { key: got.key, value: parsed });
    return parsed;
  }

  /** Drops cached heads for every round not in `keep` (`<runsDir>\0<round>` keys). */
  retain(keep) {
    const files = new Set();
    for (const k of keep) {
      const [runsDir, round] = k.split('\0');
      files.add(path.join(runsDir, `${round}.md`)).add(path.join(runsDir, `${round}-report.md`));
    }
    for (const f of this.cache.keys()) if (!files.has(f)) this.cache.delete(f);
  }

  /** @returns {Promise<{spec: object|null, report: object|null}>} */
  async get(runsDir, round) {
    const spec = await this.#load(path.join(runsDir, `${round}.md`), parseSpec);
    const reportFile = path.join(runsDir, `${round}-report.md`);
    const report = await this.#load(reportFile, parseReport);
    return { spec, report: report && { ...report, path: `${path.basename(runsDir)}/${round}-report.md` } };
  }
}
