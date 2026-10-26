import fs from 'node:fs/promises';
import { createLogParser } from './parse-log.js';

const HEAD_BYTES = 16 * 1024;

/** The model named in the first 16 KB of a round log (Claude init line or Codex `model:` header), or null. */
export async function logModel(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    const parser = createLogParser({});
    for (const line of buf.toString('utf8', 0, bytesRead).split('\n')) {
      const hit = parser.feed(line.replace(/\r$/, '')).find((e) => e.kind === 'model');
      if (hit) return hit.model;
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}
