const KEEP_IDS = 2000;

/**
 * Tokens (and cost) one agent log has shown. Live: every assistant message counted once by its id. A `final`
 * usage event (a coder's result: `modelUsage` totals + `total_cost_usd`, or Codex `tokens used`) replaces it.
 */
export class UsageMeter {
  constructor() {
    this.sum = { in: 0, out: 0, cr: 0, cw: 0 };
    this.ids = new Set();
    this.seen = false;
    this.final = null;
    this.partial = false;
  }

  /** @returns {boolean} true when the numbers changed */
  add(ev) {
    if (ev.final) {
      this.final = ev;
      return true;
    }
    if (this.final) return false;
    if (ev.id) {
      if (this.ids.has(ev.id)) return false;
      this.ids.add(ev.id);
      if (this.ids.size > KEEP_IDS) this.ids.delete(this.ids.values().next().value);
    }
    for (const k of ['in', 'out', 'cr', 'cw']) this.sum[k] += ev[k] || 0;
    this.seen = true;
    return true;
  }

  /** The tile's `usage` object, or null when nothing was seen. `partial` only matters until the totals arrive. */
  view() {
    const f = this.final;
    if (f?.total !== undefined) return { total: f.total, final: true, partial: false };
    if (!f && !this.seen) return null;
    const models = f ? Object.entries(f.models || {}).map(([name, m]) => ({ name, ...m })) : [];
    const s = f && models.length
      ? models.reduce((a, m) => ({ in: a.in + m.in, out: a.out + m.out, cr: a.cr + m.cr, cw: a.cw + m.cw }), { in: 0, out: 0, cr: 0, cw: 0 })
      : this.sum;
    return {
      ...s, ctx: s.in + s.cr + s.cw, cost: f?.cost ?? null, models, final: !!f, partial: !f && !!this.partial,
    };
  }
}
