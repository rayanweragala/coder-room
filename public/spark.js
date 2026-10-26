import { elapsedText } from './util.js';

export const BARS = 15;
const MINUTE = 60_000;
const COUNTED = new Set(['thought', 'say', 'intent', 'message', 'edit', 'command']);
const NS = 'http://www.w3.org/2000/svg';
const W = 3;
const GAP = 1;
const H = 14;

/** Events per minute for the last 15 minutes (oldest first); events without a time or outside the window are ignored. */
export function sparkBuckets(events, now = Date.now(), bars = BARS) {
  const counts = new Array(bars).fill(0);
  for (const e of events || []) {
    if (e.at == null || !COUNTED.has(e.kind)) continue;
    const ago = Math.floor((now - e.at) / MINUTE);
    if (ago >= 0 && ago < bars) counts[bars - 1 - ago]++;
  }
  return counts;
}

/** Tooltip: "N events in the last 15 min · last activity Xs ago". */
export function sparkTitle(counts, events, now = Date.now()) {
  const n = counts.reduce((a, b) => a + b, 0);
  const times = (events || []).filter((e) => e.at != null && COUNTED.has(e.kind)).map((e) => e.at);
  const last = times.length ? Math.max(...times) : null;
  const when = last === null ? 'no activity yet' : `last activity ${elapsedText(now - last)} ago`;
  return `${n} event${n === 1 ? '' : 's'} in the last ${BARS} min · ${when}`;
}

/** An empty inline SVG bar chart of 15 bars (drawn by `drawSpark`), coloured by the tile's `--c`. */
export function createSpark() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${BARS * (W + GAP)} ${H}`);
  svg.setAttribute('width', String(BARS * (W + GAP)));
  svg.setAttribute('height', String(H));
  svg.setAttribute('role', 'img');
  for (let i = 0; i < BARS; i++) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(i * (W + GAP)));
    r.setAttribute('width', String(W));
    r.setAttribute('rx', '1');
    svg.append(r);
  }
  svg.append(document.createElementNS(NS, 'title'));
  return svg;
}

/** Redraws the bars (scaled to the busiest minute) and the tooltip. */
export function drawSpark(svg, events, now = Date.now()) {
  const counts = sparkBuckets(events, now);
  const max = Math.max(1, ...counts);
  svg.querySelectorAll('rect').forEach((r, i) => {
    const h = counts[i] ? Math.max(2, Math.round((counts[i] / max) * H)) : 1;
    r.setAttribute('height', String(h));
    r.setAttribute('y', String(H - h));
    r.setAttribute('opacity', counts[i] ? '1' : '.25');
  });
  svg.querySelector('title').textContent = sparkTitle(counts, events, now);
}
