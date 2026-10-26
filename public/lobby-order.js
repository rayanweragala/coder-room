import { orderCards } from './lobby.js';

export const REORDER_MS = 30_000;

/**
 * Keeps lobby cards in a stable order. The first call sorts once (working projects first, then recent activity).
 * Afterwards a card changes place only when its project switches between "has a working agent" and "has none",
 * at most once every `REORDER_MS`, and never while `hovered`. Activity changes alone never move a card.
 * `order(cards, hovered, now)` returns the cards in the order to show; the state lives in the returned object.
 */
export function createLobbyOrder(minGap = REORDER_MS) {
  let names = null;
  let flags = new Map();
  let movedAt = -Infinity;

  const partition = (cards) => [...cards.filter((c) => c.working > 0), ...cards.filter((c) => !(c.working > 0))];

  return {
    order(cards, hovered = false, now = Date.now()) {
      if (!names) {
        const sorted = orderCards(cards);
        names = sorted.map((c) => c.name);
        flags = new Map(sorted.map((c) => [c.name, c.working > 0]));
        movedAt = now;
        return sorted;
      }
      const byName = new Map(cards.map((c) => [c.name, c]));
      const known = names.filter((n) => byName.has(n));
      const fresh = orderCards(cards.filter((c) => !names.includes(c.name))).map((c) => c.name);
      let next = [...known, ...fresh];
      const changed = next.some((n) => (byName.get(n).working > 0) !== flags.get(n) && flags.has(n));
      if (changed && !hovered && now - movedAt >= minGap) {
        next = partition(next.map((n) => byName.get(n))).map((c) => c.name);
        flags = new Map(cards.map((c) => [c.name, c.working > 0]));
        movedAt = now;
      } else {
        for (const n of fresh) flags.set(n, byName.get(n).working > 0);
      }
      names = next;
      return next.map((n) => byName.get(n));
    },
  };
}
