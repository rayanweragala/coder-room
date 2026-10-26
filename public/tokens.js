/** Token count as `950`, `12.3k`, `210k`, `1.2M`. */
export function fmtTokens(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v < 1000) return String(v);
  const short = (x) => (x < 100 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));
  const k = short(v / 1000);
  if (Number(k) < 1000) return `${k}k`;
  return `${short(v / 1e6)}M`;
}

/** Cost as `$0.84`; under a cent `<$0.01`; null when unknown. */
export function fmtCost(c) {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return c > 0 && c < 0.005 ? '<$0.01' : `$${c.toFixed(2)}`;
}

const cost = (u) => fmtCost(u.cost);
const lower = (u) => (u.partial && !u.final ? '≥' : '');

/** HUD meter: `↑ 12.3k out · 1.2M ctx · $0.84`; Codex shows its total; null when there is nothing to show. */
export function hudMeterText(u) {
  if (!u) return null;
  if (u.total != null) return `${fmtTokens(u.total)} tokens`;
  const parts = [`↑ ${lower(u)}${fmtTokens(u.out)} out`, `${lower(u)}${fmtTokens(u.ctx)} ctx`];
  if (cost(u)) parts.push(cost(u));
  return parts.join(' · ');
}

/** Grid-tile meter: `↑12.3k · $0.84`, Codex total, or `—` while a Codex/coder run has no numbers yet. */
export function tileMeterText(u, coder = false) {
  if (!u) return coder ? '—' : '';
  if (u.total != null) return `${fmtTokens(u.total)} tok`;
  return [`↑${lower(u)}${fmtTokens(u.out)}`, cost(u)].filter(Boolean).join(' · ');
}

/** Tooltip: the four numbers, and per model when known. */
export function meterTitle(u) {
  if (!u) return '';
  if (u.total != null) return `${u.total.toLocaleString('en-US')} tokens (Codex total)`;
  const line = (m) => `input ${fmtTokens(m.in)} · output ${fmtTokens(m.out)} · cache read ${fmtTokens(m.cr)} · cache write ${fmtTokens(m.cw)}`;
  const lines = u.models?.length ? u.models.map((m) => `${m.name}: ${line(m)}${cost(m) ? ` · ${cost(m)}` : ''}`) : [line(u)];
  if (u.partial && !u.final) lines.push('≥ partial: only the part of the log read so far');
  return lines.join('\n');
}

/** Lobby line "3 rounds · 210k out · $3.10": rounds today, output tokens, cost of finished rounds (parts only when known). */
export function dayTotalsText(rounds, tiles, midnight = 0) {
  const today = tiles.filter((t) => t.kind === 'coder' && t.startedAt >= midnight);
  const out = today.reduce((n, t) => n + (t.usage?.out || 0), 0);
  const money = today.reduce((n, t) => n + (t.status === 'done' && t.usage?.cost ? t.usage.cost : 0), 0);
  return [`${rounds} round${rounds === 1 ? '' : 's'}`, out > 0 && `${fmtTokens(out)} out`, money > 0 && fmtCost(money)].filter(Boolean).join(' · ');
}
