// Coder identity: who a chain-line coder is (name, kind) and how it looks. Pure data, shared by server and page.

/** Codex-style characters: `style` is the drawing (moon + long hair, or sun halo); c/d/l are main, dark, light shades. */
export const CODEX_LOOKS = [
  { key: 'moon-violet', style: 'moon', color: '#8b5cf6', dark: '#7c3aed', light: '#a78bfa' },
  { key: 'sun-orange', style: 'sun', color: '#f97316', dark: '#ea580c', light: '#fdba74' },
  { key: 'moon-teal', style: 'moon', color: '#14b8a6', dark: '#0d9488', light: '#5eead4' },
  { key: 'sun-yellow', style: 'sun', color: '#eab308', dark: '#ca8a04', light: '#facc15' },
  { key: 'moon-blue', style: 'moon', color: '#3b82f6', dark: '#2563eb', light: '#93c5fd' },
  { key: 'sun-red', style: 'sun', color: '#ef4444', dark: '#dc2626', light: '#f87171' },
  { key: 'moon-green', style: 'moon', color: '#22c55e', dark: '#16a34a', light: '#86efac' },
];

/** Claude-style pixel mascots: an accessory (`acc`) in `accColor`; `color` is the tile colour. */
export const CLAUDE_LOOKS = [
  { key: 'scarf-coral', acc: 'scarf', color: '#f43f5e', accColor: '#fb7185' },
  { key: 'headphones-amber', acc: 'headphones', color: '#f59e0b', accColor: '#f59e0b' },
  { key: 'cap-sky', acc: 'cap', color: '#0ea5e9', accColor: '#38bdf8' },
  { key: 'glasses-lime', acc: 'glasses', color: '#84cc16', accColor: '#a3e635' },
  { key: 'antenna-pink', acc: 'antenna', color: '#ec4899', accColor: '#f472b6' },
  { key: 'scarf-teal', acc: 'scarf', color: '#14b8a6', accColor: '#2dd4bf' },
  { key: 'cap-violet', acc: 'cap', color: '#8b5cf6', accColor: '#a78bfa' },
];

export const ROBOT_LOOK = { key: 'robot', color: '#94a3b8' };

/** Legacy ids from older setups keep the look they always had. */
const LEGACY_LOOKS = {
  luna: 'moon-violet', sol: 'sun-orange', claude2: 'scarf-coral', claude3: 'headphones-amber', main: 'cap-sky',
};

const ALL = [...CODEX_LOOKS, ...CLAUDE_LOOKS, ROBOT_LOOK];
export const lookByKey = (key) => ALL.find((l) => l.key === key) ?? ROBOT_LOOK;

/** FNV-1a hash of a string, unsigned. */
export function hashName(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const LEGACY_MODELS = [[/luna/i, 'luna', 'Luna'], [/sol/i, 'sol', 'Sol']];
const CLAUDE_NAME = /^(claude|sonnet|opus|haiku|main$)/i;

/** The model-as-identity pair for legacy `codex gpt-*` lines: {id, name}. */
function modelIdentity(model) {
  for (const [re, id, name] of LEGACY_MODELS) if (re.test(model)) return { id, name };
  return { id: model.toLowerCase(), name: model };
}

/**
 * Identity from the text after " on " in a chain line ("claude-main sonnet", "codex gpt-6-luna", "main", "grok").
 * Returns {id, name, kind: 'codex'|'claude'|'robot', look} or null for empty text. A `codex gpt-*` line (legacy
 * scripts) is identified by its model; a bare `claude` is the legacy `main`.
 */
export function identityOf(on) {
  const tokens = String(on ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const [coder, model] = tokens;
  const gpt = /^(gpt-|luna$|sol$)/i.test(coder) ? coder
    : coder.toLowerCase() === 'codex' && /^gpt-/i.test(model ?? '') ? model : null;
  let id;
  let name;
  if (gpt) ({ id, name } = modelIdentity(gpt));
  else {
    id = coder.toLowerCase() === 'claude' ? 'main' : coder.toLowerCase();
    name = id === 'main' ? 'main' : coder;
  }
  const kind = gpt || id === 'codex' || /^gpt-/i.test(model ?? '') ? 'codex' : CLAUDE_NAME.test(id) ? 'claude' : 'robot';
  if (kind === 'robot') name = name.charAt(0).toUpperCase() + name.slice(1);
  const pool = kind === 'codex' ? CODEX_LOOKS : kind === 'claude' ? CLAUDE_LOOKS : null;
  const legacy = LEGACY_LOOKS[id] ? lookByKey(LEGACY_LOOKS[id]) : null;
  const look = legacy ?? (pool ? pool[hashName(id) % pool.length] : ROBOT_LOOK);
  return { id, name, kind, look: look.key, color: look.color, model: (gpt ? gpt : model) ?? null };
}
