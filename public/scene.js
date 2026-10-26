import { characterFor } from './characters.js';

const CODE_ROWS = [40, 62, 30, 50].map((w, i) => `<rect x="6" y="${4 + i * 6}" width="${w}" height="3" rx="1.5" fill="#67e8f9"/>`);
const code = [0, 1, 2, 3].map((k) => `<g transform="translate(0 ${k * 24})">${CODE_ROWS.join('')}</g>`).join('');

const DIFF_ROWS = Array.from({ length: 6 }, (_, i) => `<text class="dl" x="3" y="${16 + i * 7.2}" font-size="5.2" font-family="monospace"></text>`).join('');

const BURST = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return `<circle cx="30" cy="28" r="2.5" fill="var(--c)" style="--x:${Math.round(Math.cos(a) * 24)}px;--y:${Math.round(Math.sin(a) * 24)}px"/>`;
}).join('');

const MONITOR = `
    <rect x="-40" y="112" width="320" height="8" fill="#1a2140"/>
    <rect x="164" y="102" width="12" height="12" fill="#2a3560"/>
    <rect x="120" y="36" width="100" height="66" rx="5" fill="#0b1020" stroke="#3a4777" stroke-width="2"/>
    <svg x="124" y="40" width="92" height="58">
      <rect width="92" height="58" fill="#0e1630"/>
      <g class="only o-edit"><g class="nodiff"><g class="code">${code}</g>
        <rect y="44" width="92" height="14" fill="#0b1020"/><text class="fname" x="4" y="54" font-size="8" fill="#e879f9" font-family="monospace"></text></g>
        <g class="diffg"><text class="difftitle" x="3" y="8" font-size="6" font-weight="700" fill="#e879f9" font-family="monospace"></text>
          <text class="diffcnt" x="89" y="8" font-size="5" text-anchor="end" fill="#94a3b8" font-family="monospace"></text>${DIFF_ROWS}</g></g>
      <g class="only o-gate"><text x="6" y="14" font-size="8" fill="#facc15" font-family="monospace">running gate</text>
        <text class="gatecmd" x="6" y="24" font-size="5.5" fill="#cbd5e1" font-family="monospace"></text>
        <rect x="6" y="32" width="80" height="8" rx="4" fill="#1f2a50"/><rect class="bar-fill" x="6" y="32" width="80" height="8" rx="4" fill="#4ade80"/>
        <text class="gateres" x="46" y="54" text-anchor="middle" font-size="14" font-weight="700" font-family="monospace"></text></g>
      <g class="only o-cmd"><text class="cmdtext" x="5" y="22" font-size="8" fill="#4ade80" font-family="monospace">$</text>
        <rect class="cursor" x="10" y="30" width="6" height="9" fill="#4ade80"/>
        <text class="cmdres" x="46" y="54" text-anchor="middle" font-size="14" font-weight="700" font-family="monospace"></text></g>
      <g class="only o-refused"><rect x="10" y="14" width="72" height="28" rx="4" fill="#dc2626"/>
        <text x="46" y="33" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="sans-serif">blocked</text></g>
      <g class="only o-done"><text class="donetext" x="46" y="34" text-anchor="middle" font-size="13" fill="#64748b" font-family="monospace"></text></g>
      <g class="only o-off"><rect width="92" height="58" fill="#05070d"/><text x="46" y="52" text-anchor="middle" font-size="7" fill="#334155" font-family="monospace">limit</text></g>
      <g class="only o-think"><text x="6" y="30" font-size="9" fill="#94a3b8" font-family="monospace">thinking…</text></g>
      <g class="only o-watch"><text class="watchtitle" x="4" y="22" font-size="8" font-weight="700" fill="#93c5fd" font-family="monospace"></text>
        <text class="watchcap" x="4" y="38" font-size="7" fill="#93c5fd" font-family="monospace"></text></g>
    </svg>
    <g class="only o-gate" transform="translate(106 62)"><g class="gear">
      <circle r="9" fill="none" stroke="#f59e0b" stroke-width="5" stroke-dasharray="4.5 4.5"/><circle r="6" fill="#f59e0b"/><circle r="2.5" fill="#1a2140"/></g></g>`;

const EFFECTS = `
    <g class="only o-think"><ellipse cx="96" cy="22" rx="28" ry="14" fill="#f1f5f9"/><circle cx="78" cy="40" r="4" fill="#f1f5f9"/><circle cx="84" cy="34" r="2.5" fill="#f1f5f9"/>
      <g><circle class="dot" cx="86" cy="22" r="3.2" fill="#475569"/><circle class="dot" cx="96" cy="22" r="3.2" fill="#475569"/><circle class="dot" cx="106" cy="22" r="3.2" fill="#475569"/></g></g>
    <g class="only o-limit">
      <g class="zs"><text x="82" y="66" font-size="11" font-weight="700" fill="#cbd5e1" font-family="sans-serif">z z z</text></g>
      <rect x="104" y="100" width="14" height="12" rx="3" fill="#e2e8f0"/><path d="M118 103 q6 0 0 6" stroke="#e2e8f0" stroke-width="2" fill="none"/>
      <rect class="steam" x="110" y="90" width="2" height="7" rx="1" fill="#cbd5e1"/>
    </g>
    <g class="only o-ok"><g class="burst">${BURST}</g>
      <g class="check"><circle cx="30" cy="28" r="13" fill="#22c55e"/><path d="M23 28 l5 5 l10 -11" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g class="only o-fail"><g class="check"><circle cx="30" cy="28" r="13" fill="#ef4444"/><path d="M24 22 l12 12 M36 22 l-12 12" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></g></g>`;

/** Static SVG markup of one agent's desk; CSS classes on the tile pick what shows and moves. */
export function sceneFor(id) {
  const c = characterFor(id);
  return `
<svg viewBox="-40 2 320 120" role="img" aria-hidden="true">
  <g class="scene">${MONITOR}
    <g class="agent">
      <g class="awake"><g class="head">${c.body}</g></g>
      <g class="hands">${c.hands}</g>
      <g class="only o-wait"><g class="wave">${c.wave}</g></g>
      <g class="only o-limit">${c.sleep}</g>
      ${c.front}
    </g>${EFFECTS}
  </g>
</svg>`;
}
