// Split between the feed and the Details drawer in the full-screen left column. Pure helpers.

export const SPLIT_MIN = 35;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 55;

/** Feed share in percent, clamped to 35-75; anything that is not a number gives the default. */
export function clampSplit(value) {
  if (value == null || value === '') return SPLIT_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(n)));
}

/** CSS custom properties the stage's grid rows read: the feed and drawer shares as `fr` tracks. */
export function splitVars(pct) {
  const p = clampSplit(pct);
  return { '--feed-fr': `${p}fr`, '--drawer-fr': `${100 - p}fr` };
}

/** Feed share for a pointer at `y`, given the top of the feed and the height of feed plus drawer. */
export function splitFromPointer(y, top, height) {
  if (!(height > 0)) return SPLIT_DEFAULT;
  return clampSplit(((y - top) / height) * 100);
}

/** Layout state of the full-screen column: the drawer takes its own rows only when open on an open agent. */
export function drawerLayout(open, spotlit) {
  const on = !!open && !!spotlit;
  return { on, className: on ? 'drawer-open' : '' };
}
