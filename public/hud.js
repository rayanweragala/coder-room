import { el, elapsedText, GATE_MARK, ENDED } from './util.js';
import { hudMeterText, meterTitle } from './tokens.js';

/**
 * HUD items for the feed's corner: round id (or project), elapsed, checklist progress (only when a checklist exists)
 * and the last gate's result. `tab` is the drawer tab a click opens.
 */
export function hudParts(t, now = Date.now()) {
  const parts = [];
  if (t.model) parts.push({ key: 'model', text: t.model, tab: 'goal', title: `Model: ${t.model}` });
  const name = t.round || t.project;
  if (name) parts.push({ key: 'round', text: name, tab: 'goal' });
  if (t.startedAt) {
    const end = ENDED.includes(t.status) && t.endedAt ? t.endedAt : now;
    parts.push({ key: 'elapsed', text: elapsedText(end - t.startedAt), tab: 'goal' });
  }
  if (t.checklist?.length && t.checklistMode !== 'spec') {
    parts.push({ key: 'checks', text: `${t.checklist.filter((c) => c.status === 'done').length}/${t.checklist.length} ✓`, tab: 'checks' });
  }
  const meter = hudMeterText(t.usage);
  if (meter) parts.push({ key: 'tokens', text: meter, tab: 'goal', title: meterTitle(t.usage) });
  const gate = t.gates?.at(-1);
  if (gate) parts.push({ key: 'gate', text: `gate ${GATE_MARK[gate.status] ?? '…'}`, tab: 'checks', status: gate.status });
  return parts;
}

/** The translucent HUD; `mount(feed)` moves it into the open agent's feed, `update`/`tick` refresh the text. */
export function createHud({ onOpen }) {
  const root = el('div', 'hud');
  let tile = null;

  function render(now) {
    if (!tile) { root.replaceChildren(); return; }
    root.replaceChildren(...hudParts(tile, now).map((p) => {
      const b = el('button', `hudi hud-${p.key}${p.status ? ` g-${p.status}` : ''}`, p.text);
      b.type = 'button';
      if (p.title) b.title = p.title;
      b.addEventListener('click', () => onOpen(p.tab));
      return b;
    }));
  }

  return {
    mount(feed) { if (feed && root.parentNode !== feed) feed.append(root); if (!feed) { root.remove(); tile = null; } },
    update(t) { tile = t; render(Date.now()); },
    tick() {
      const b = root.querySelector('.hud-elapsed');
      const p = tile && hudParts(tile).find((x) => x.key === 'elapsed');
      if (b && p && b.textContent !== p.text) b.textContent = p.text;
    },
  };
}
