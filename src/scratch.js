const CAP = 512 * 1024;
let shared = null;
let busy = false;

/**
 * Runs `fn(buf)` with a buffer of at least `size` bytes. Reads share one reused buffer (fresh large buffers
 * fragment the heap and keep RSS high); `buf` is only valid until `fn` settles.
 */
export async function withScratch(size, fn) {
  if (busy || size > CAP) return fn(Buffer.allocUnsafe(size));
  busy = true;
  try {
    shared ??= Buffer.allocUnsafeSlow(CAP);
    return await fn(shared);
  } finally {
    busy = false;
  }
}
