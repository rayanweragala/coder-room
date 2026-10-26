import { identityOf, lookByKey } from './looks.js';

// Original drawings, "in the style of" only. Each character returns the parts the scene stacks:
// body (awake pose), sleep (asleep pose), hands (typing), wave (raised hand), front (drawn over the hands).
const r = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
const SKIN = '#f6d3ae';
const DARK = '#2a1a14';
const ORANGE = '#d97757';
const ORANGE_D = '#b85f42';
const ACCESSORIES = {
  scarf: (c) => r(42, 96, 36, 5, c) + r(70, 100, 6, 12, c),
  headphones: (c) => r(44, 62, 32, 3, c) + r(42, 64, 3, 14, c) + r(75, 64, 3, 14, c) + r(38, 74, 7, 12, c) + r(75, 74, 7, 12, c),
  cap: (c) => r(48, 58, 24, 5, c) + r(44, 63, 32, 5, c) + r(72, 66, 16, 3, c),
  glasses: (c) => r(47, 78, 11, 11, c) + r(62, 78, 11, 11, c) + r(58, 82, 4, 2, c),
  antenna: (c) => r(59, 56, 2, 10, c) + r(56, 52, 8, 5, c),
  orchestrator: (c) => r(44, 64, 32, 3, c) + r(38, 74, 7, 12, c) + r(75, 74, 7, 12, c) + r(40, 86, 2, 8, c) + r(40, 92, 10, 2, c),
};
const CLIPBOARD = r(22, 84, 18, 24, '#e2e8f0') + r(27, 81, 8, 5, '#94a3b8') + [90, 95, 100].map((y) => r(25, y, 12, 2, '#64748b')).join('');

function mascot(id, sleeping, look) {
  const eyes = sleeping ? r(50, 84, 6, 2, DARK) + r(65, 84, 6, 2, DARK) : `<g class="pupil">${r(50, 80, 5, 7, DARK)}${r(66, 80, 5, 7, DARK)}</g>`;
  const legs = sleeping ? '' : r(48, 100, 8, 10, ORANGE_D) + r(64, 100, 8, 10, ORANGE_D);
  const acc = id === 'orchestrator' ? ACCESSORIES.orchestrator('#14b8a6') : ACCESSORIES[look.acc](look.accColor);
  const clip = id === 'orchestrator' && !sleeping ? CLIPBOARD : '';
  return `<g shape-rendering="crispEdges">${legs}${r(46, 66, 28, 4, ORANGE)}${r(42, 70, 36, 30, ORANGE)}${r(42, 94, 36, 6, ORANGE_D)}`
    + `${r(36, 86, 6, 12, ORANGE)}${r(78, 86, 6, 12, ORANGE)}${eyes}`
    + `<rect class="mouth" x="56" y="90" width="8" height="2" fill="${DARK}"/>${acc}${clip}</g>`;
}

function mascotParts(id, look) {
  const big = id === 'orchestrator' ? 'translate(60 112) scale(1.12) translate(-60 -112)' : '';
  const wrap = (s) => (big ? `<g transform="${big}">${s}</g>` : s);
  return {
    body: wrap(mascot(id, false, look)),
    sleep: `<g transform="translate(0 20)">${mascot(id, true, look)}</g>`,
    hands: `<g shape-rendering="crispEdges">${r(84, 94, 14, 5, ORANGE)}${r(98, 92, 6, 9, ORANGE_D)}</g>`,
    wave: `<g shape-rendering="crispEdges">${r(82, 62, 6, 26, ORANGE)}${r(80, 56, 10, 8, ORANGE_D)}</g>`,
    front: '',
  };
}

const CLOUD = '<circle cx="52" cy="105" r="4" fill="#f8fafc"/><circle cx="59" cy="102" r="5.5" fill="#f8fafc"/>'
  + '<circle cx="66" cy="105" r="4" fill="#f8fafc"/><rect x="52" y="104" width="14" height="5" fill="#f8fafc"/>'
  + '<text x="59" y="108" text-anchor="middle" font-size="7" font-weight="700" font-family="monospace" fill="#1e293b">&gt;_</text>';
const LAPTOP = `<rect x="38" y="96" width="44" height="18" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>${CLOUD}`;

function human({ hairBack, hairFront, torso, deco, cheeks, halo = '' }, closed) {
  const eyes = closed
    ? '<path d="M50 64 q4 3 8 0 M62 64 q4 3 8 0" stroke="#1e1b4b" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
    : '<g class="pupil"><circle cx="54" cy="63" r="2.4" fill="#1e1b4b"/><circle cx="66" cy="63" r="2.4" fill="#1e1b4b"/></g>';
  return `${halo}${hairBack}${closed ? '' : torso}<circle cx="60" cy="62" r="15" fill="${SKIN}"/>${hairFront}${eyes}${cheeks}`
    + `<ellipse class="mouth" cx="60" cy="71" rx="3" ry="1" fill="#9d174d"/>${closed ? '' : deco}`;
}

const moonLook = ({ color, dark, light }) => ({
  hairBack: `<path d="M42 60 Q34 92 44 114 L76 114 Q86 92 78 60 Z" fill="${color}"/><path d="M40 84 q-6 14 0 26 q6 -6 4 -18z M80 84 q6 14 0 26 q-6 -6 -4 -18z" fill="${dark}"/>`,
  hairFront: `<path d="M44 62 a16 16 0 0 1 32 0 q-6 -7 -16 -5 q-9 -2 -16 5z" fill="${dark}"/><path d="M44 62 q-2 12 2 20 q2 -10 3 -18z M76 62 q2 12 -2 20 q-2 -10 -3 -18z" fill="${color}"/>`,
  torso: `<rect x="44" y="77" width="32" height="38" rx="10" fill="${light}"/><path d="M52 77 l8 8 l8 -8z" fill="#f472b6"/>`,
  deco: '<path d="M74 52 l-10 -7 v14z M74 52 l10 -7 v14z" fill="#f472b6"/><circle cx="74" cy="52" r="3" fill="#ec4899"/>'
    + '<path d="M47 47 a6.5 6.5 0 1 0 4.5 11 a5.2 5.2 0 1 1 -4.5 -11z" fill="#fde68a"/>',
  cheeks: '<circle cx="50" cy="69" r="3.2" fill="#f472b6" opacity=".55"/><circle cx="70" cy="69" r="3.2" fill="#f472b6" opacity=".55"/>',
});

const RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const p = (d) => `${(60 + Math.cos(a) * d).toFixed(1)} ${(62 + Math.sin(a) * d).toFixed(1)}`;
  return `M${p(23)} L${p(31)}`;
}).join(' ');
const sunLook = ({ color, light }) => ({
  halo: `<circle cx="60" cy="62" r="22" fill="${light}" opacity=".55"/><path d="${RAYS}" stroke="${color}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  hairBack: '',
  hairFront: `<path d="M44 62 a16 16 0 0 1 32 0 l-4 -6 l-4 4 l-4 -7 l-4 7 l-4 -7 l-4 7 l-4 -4z" fill="${color}"/>`,
  torso: `<rect x="44" y="77" width="32" height="38" rx="10" fill="${color}"/><circle cx="60" cy="90" r="5" fill="#fde047"/>`,
  deco: '',
  cheeks: '<circle cx="50" cy="69" r="2.6" fill="#fb923c" opacity=".5"/><circle cx="70" cy="69" r="2.6" fill="#fb923c" opacity=".5"/>',
});

function codexParts(look, sleeveColor) {
  return {
    body: human(look, false),
    sleep: `<g transform="translate(0 30)">${human({ ...look, halo: '', torso: '' }, true)}</g>`,
    hands: `<circle cx="52" cy="94" r="4.5" fill="${SKIN}"/><circle cx="68" cy="94" r="4.5" fill="${SKIN}"/>`,
    wave: `<rect x="80" y="64" width="6" height="26" rx="3" fill="${sleeveColor}" transform="rotate(20 83 90)"/><circle cx="90" cy="64" r="5" fill="${SKIN}"/>`,
    front: LAPTOP,
  };
}

function robotParts() {
  const grey = '#94a3b8';
  const legs = r(48, 102, 8, 10, '#475569') + r(64, 102, 8, 10, '#475569');
  const body = (eyes) => `<g shape-rendering="crispEdges">${legs}${r(46, 82, 28, 22, '#64748b')}${r(38, 86, 8, 14, grey)}${r(74, 86, 8, 14, grey)}`
    + `${r(44, 56, 32, 26, grey)}${r(58, 48, 4, 8, '#64748b')}${r(56, 44, 8, 5, '#f43f5e')}${eyes}`
    + `<rect class="mouth" x="54" y="74" width="12" height="2" fill="#0f172a"/></g>`;
  return {
    body: body(`<g class="pupil">${r(51, 64, 6, 6, '#0f172a')}${r(63, 64, 6, 6, '#0f172a')}</g>`),
    sleep: `<g transform="translate(0 20)">${body(r(51, 68, 6, 2, '#0f172a') + r(63, 68, 6, 2, '#0f172a'))}</g>`,
    hands: `<g shape-rendering="crispEdges">${r(82, 94, 14, 5, grey)}${r(96, 92, 6, 9, '#64748b')}</g>`,
    wave: `<g shape-rendering="crispEdges">${r(82, 60, 6, 26, grey)}${r(80, 54, 10, 8, '#64748b')}</g>`,
    front: '',
  };
}

/** Parts of the character for a look key (`moon-violet`, `cap-sky`, ...), a coder id (`luna`, `claude-main`), or `orchestrator`. */
export function characterFor(id) {
  if (id === 'orchestrator') return mascotParts('orchestrator', null);
  let look = lookByKey(id);
  if (look.key !== id) look = lookByKey(identityOf(id)?.look);
  if (look.style) return codexParts(look.style === 'sun' ? sunLook(look) : moonLook(look), look.color);
  if (look.acc) return mascotParts(look.key, look);
  return robotParts();
}
