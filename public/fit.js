/**
 * Columns and rows for `n` tiles in a `w`×`h` box so that nothing overflows. A tile is a feed with the given
 * `aspect` (width / height) plus `extra` px of text below it; the layout giving the biggest feed wins. Pure.
 * @returns {{cols: number, rows: number, cellW: number, cellH: number}}
 */
export function fitGrid(w, h, n, { aspect = 1.6, extra = 90, gap = 12 } = {}) {
  if (n <= 0) return { cols: 1, rows: 1, cellW: Math.max(0, w), cellH: Math.max(0, h) };
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    const feedH = Math.max(0, cellH - extra);
    const area = Math.min(cellW, feedH * aspect) * Math.min(feedH, cellW / aspect);
    if (!best || area > best.area + 1) best = { cols, rows, cellW, cellH, area };
  }
  const { cols, rows, cellW, cellH } = best;
  return { cols, rows, cellW, cellH };
}
