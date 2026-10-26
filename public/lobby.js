import { WORKING } from './util.js';
import { dayTotalsText } from './tokens.js';

/** Working projects first, then the most recent activity, then name. Pure. */
export function orderCards(cards) {
  return [...cards].sort((a, b) => (b.working > 0) - (a.working > 0) || b.last - a.last || a.name.localeCompare(b.name));
}

/**
 * Lobby cards from the server's project list and all tiles. A project without tiles has had no activity in
 * 24 h and goes to `quiet`. `handIds` are the tile ids with a raised hand; `midnight` starts "today".
 * @returns {{cards: object[], quiet: object[]}}
 */
export function buildCards(projects, tiles, handIds = new Set(), midnight = 0) {
  const cards = [];
  const quiet = [];
  for (const p of projects) {
    const mine = tiles.filter((t) => t.project === p.name);
    if (!mine.length) { quiet.push(p); continue; }
    const rounds = mine.filter((t) => t.kind === 'coder' && t.startedAt >= midnight).length;
    cards.push({
      name: p.name, goal: p.goal || '', toward: p.toward || '', agents: mine,
      working: mine.filter((t) => WORKING.includes(t.status)).length,
      rounds, totals: dayTotalsText(rounds, mine, midnight),
      hands: mine.filter((t) => handIds.has(t.id)).length,
      last: Math.max(0, ...mine.map(activityOf)),
      caption: captionOf(mine),
    });
  }
  return { cards: orderCards(cards), quiet };
}

const activityOf = (t) => Math.max(t.lastActivity || 0, t.endedAt || 0, t.startedAt || 0);

/** The latest caption of the most recently active agent that has one: {initial, text}, or null. */
function captionOf(tiles) {
  const t = tiles.filter((x) => x.caption).sort((a, b) => activityOf(b) - activityOf(a))[0];
  return t ? { initial: t.name.replace(/^Sonnet · /, '').charAt(0).toUpperCase(), text: t.caption } : null;
}
