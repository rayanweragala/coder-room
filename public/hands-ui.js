import { initAcks, handsFor, handKey, acknowledge } from './hands.js';

const KEY = 'coder-room-hands';
const SAVE_MS = 15_000;

function load(now) {
  try { return initAcks(JSON.parse(localStorage.getItem(KEY) || 'null'), now); } catch { return initAcks(null, now); }
}

/** Raised-hand badges on tiles and the header count. Hands stay up until the tile is clicked, focused or open. */
export function createHands({ views, button }) {
  let acks = load(Date.now());
  let list = [];
  let savedAt = 0;

  function save(now = Date.now()) {
    savedAt = now;
    try { localStorage.setItem(KEY, JSON.stringify({ visit: now, keys: acks.keys })); } catch { /* storage unavailable */ }
  }

  function render() {
    const up = new Set(list.map((h) => h.id));
    for (const v of views.values()) {
      v.root.classList.toggle('hand-up', up.has(v.id));
      v.hand.hidden = !up.has(v.id);
    }
    button.hidden = !list.length;
    button.textContent = `✋ ${list.length}`;
    button.title = list.length ? `${list.length} waiting for you: open the oldest` : '';
  }

  return {
    /** Recompute from the current tiles; a hand on the open tile (`openId`) is acknowledged at once. */
    refresh(tiles, openId, now = Date.now()) {
      list = handsFor(tiles, acks, now);
      const seen = list.filter((h) => h.id === openId);
      if (seen.length) {
        for (const h of seen) acks = acknowledge(acks, h.key, now);
        list = list.filter((h) => h.id !== openId);
        save(now);
      } else if (now - savedAt > SAVE_MS) save(now);
      render();
    },
    acknowledgeTile(tile, now = Date.now()) {
      if (!tile) return;
      acks = acknowledge(acks, handKey(tile), now);
      list = list.filter((h) => h.id !== tile.id);
      save(now);
      render();
    },
    get oldest() { return list[0]?.id ?? null; },
    get ids() { return new Set(list.map((h) => h.id)); },
  };
}
