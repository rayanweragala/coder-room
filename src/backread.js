import fs from 'node:fs/promises';
import { withScratch } from './scratch.js';

export const CHUNK_BYTES = 256 * 1024;
export const MAX_BACK_BYTES = 4 * 1024 * 1024;

/**
 * Calls `fn(lineBuffer)` for the file's lines from the last to the first, reading backwards in chunks and at most
 * `maxBytes` in total. Stops when `fn` returns true. A line cut off by the byte limit is dropped; a line over
 * `maxLine` bytes is skipped without being joined or passed to `fn`. Resolves with the file size the read started
 * from (null when unreadable).
 */
export async function backLines(file, fn, maxBytes = MAX_BACK_BYTES, maxLine = Infinity) {
  let fh;
  let size = null;
  try {
    fh = await fs.open(file, 'r');
    size = (await fh.stat()).size;
    let pos = size;
    let budget = maxBytes;
    let carry = [];
    let carried = 0;
    const take = (head) => {
      const len = head.length + carried;
      const line = len > maxLine ? null : Buffer.concat([head, ...carry]);
      carry = [];
      carried = 0;
      return line;
    };
    await withScratch(CHUNK_BYTES, async (scratch) => {
      while (pos > 0 && budget > 0) {
        const n = Math.min(CHUNK_BYTES, pos, budget);
        const chunk = scratch.subarray(0, n);
        pos -= n;
        budget -= n;
        await fh.read(chunk, 0, n, pos);
        let end = n;
        while (end > 0) {
          const i = chunk.lastIndexOf(10, end - 1);
          if (i < 0) break;
          const line = take(chunk.subarray(i + 1, end));
          end = i;
          if (line?.length && fn(line)) return;
        }
        if (end > 0) {
          carried += end;
          if (carried > maxLine) carry = []; else carry.unshift(Buffer.from(chunk.subarray(0, end)));
        }
      }
      if (pos === 0 && carried > 0) {
        const line = take(Buffer.alloc(0));
        if (line?.length) fn(line);
      }
    });
  } catch { /* unreadable */ } finally {
    await fh?.close();
  }
  return size;
}
