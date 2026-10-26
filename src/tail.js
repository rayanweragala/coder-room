import fs from 'node:fs/promises';
import { withScratch } from './scratch.js';

const TAIL_BYTES = 64 * 1024;

/**
 * Follows one file by byte offset. `poll()` returns the new complete lines since the last call.
 * First call reads only the last 64 KB (dropping a partial first line). With `stepBytes` set, a call reads at most
 * that many bytes and sets `more` while unread bytes remain, so a big first read can be fed in small pieces.
 */
export class Tail {
  constructor(file, tailBytes = TAIL_BYTES) {
    this.file = file;
    this.tailBytes = tailBytes;
    this.offset = 0;
    this.ino = null;
    this.buffer = '';
    this.decoder = new TextDecoder();
    this.skipPartial = false;
    this.stepBytes = Infinity;
    this.more = false;
    this.started = false;
    this.fromTail = false;
    this.mtimeMs = 0;
    this.size = 0;
  }

  /** Starts following at `offset` of the file's current inode, so the first `poll()` returns only later lines. */
  async seek(offset) {
    try {
      this.ino = (await fs.stat(this.file)).ino;
    } catch {
      return;
    }
    this.offset = offset;
    this.started = true;
  }

  async poll() {
    let st;
    try {
      st = await fs.stat(this.file);
    } catch {
      return { lines: [], reset: false };
    }
    this.mtimeMs = st.mtimeMs;
    this.size = st.size;
    let reset = false;
    let from = this.offset;
    if (!this.started || st.ino !== this.ino || st.size < this.offset) {
      reset = this.started;
      this.started = true;
      this.ino = st.ino;
      this.buffer = '';
      this.decoder = new TextDecoder();
      from = Math.max(0, st.size - this.tailBytes);
      this.skipPartial = from > 0;
      this.fromTail = from > 0;
    }
    this.more = false;
    if (st.size === from) {
      this.offset = from;
      return { lines: [], reset };
    }
    const fh = await fs.open(this.file, 'r');
    let text;
    try {
      const len = Math.min(st.size - from, this.stepBytes);
      this.more = from + len < st.size;
      text = await withScratch(len, async (buf) => {
        const { bytesRead } = await fh.read(buf, 0, len, from);
        this.offset = from + bytesRead;
        return this.decoder.decode(buf.subarray(0, bytesRead), { stream: true });
      });
    } finally {
      await fh.close();
    }
    if (this.skipPartial) {
      const nl = text.indexOf('\n');
      if (nl < 0) return { lines: [], reset };
      text = text.slice(nl + 1);
      this.skipPartial = false;
    }
    const parts = (this.buffer ? this.buffer + text : text).split('\n');
    this.buffer = parts.pop();
    for (let i = 0; i < parts.length; i++) if (parts[i].endsWith('\r')) parts[i] = parts[i].slice(0, -1);
    return { lines: parts, reset };
  }
}
