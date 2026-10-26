import { sceneFor } from './scene.js';
import { el, summaryText } from './util.js';
import { recentItems } from './recent.js';
import { updateMonitor, stopMonitor } from './monitor.js';
import { createSpark, drawSpark } from './spark.js';
import { tileMeterText, meterTitle } from './tokens.js';
import { modelShown } from './model.js';

const STATUS_CLASS = {
  thinking: 'st-thinking', editing: 'st-editing', 'running a gate': 'st-gate', 'running a command': 'st-command',
  done: 'st-done', 'rate-limited': 'st-limit', refused: 'st-refused', stopped: 'st-stopped', 'waiting for you': 'st-waiting', watching: 'st-watching',
};
const TALK_MS = 2000;
const RECENT = 3;

function build(grid, t, onSelect, onFocus) {
  const root = el('section', 'tile');
  root.tabIndex = 0;
  root.setAttribute('role', 'button');
  const feed = el('div', 'feed');
  feed.innerHTML = sceneFor(t.look ?? t.slot ?? t.id);
  const cap = el('div', 'caption');
  const capText = el('span', 'captext');
  cap.append(capText);
  const plate = el('div', 'plate');
  const name = el('b');
  const model = el('span', 'model');
  const pill = el('span', 'pill');
  const quiet = el('span', 'quietbadge');
  quiet.hidden = true;
  const hand = el('span', 'handbadge', '✋');
  hand.hidden = true;
  hand.title = 'Waiting for you';
  const spark = createSpark();
  const meter = el('span', 'meter');
  plate.append(name, model, pill, meter, spark, quiet, hand);
  feed.append(cap, plate);
  const infoBox = el('div', 'info');
  const summary = el('div', 'summary');
  const recent = el('ul', 'recent');
  infoBox.append(summary, recent);
  const stream = el('div', 'stream');
  const dot = el('span', 'avatar-dot');
  root.append(feed, infoBox, stream, dot);
  root.addEventListener('click', () => onSelect(t.id));
  root.addEventListener('focus', () => onFocus?.(t.id));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t.id); }
  });
  grid.append(root);
  return { id: t.id, root, spark, meter, name, model, pill, quiet, hand, summary, capText, recent, stream, dot, rows: new Map(), tile: null, talkTimer: null, caption: null };
}

function showRecent(v, events) {
  const items = recentItems(events || [], RECENT, false);
  const keep = new Set(items.map((i) => i.n));
  for (const [n, li] of v.rows) if (!keep.has(n)) { li.remove(); v.rows.delete(n); }
  for (const i of items) {
    if (v.rows.has(i.n)) continue;
    const li = el('li', `r-${i.kind}`, i.text);
    v.rows.set(i.n, li);
    v.recent.append(li);
  }
}

function showCaption(v, text, animate) {
  v.capText.textContent = text || '';
  v.capText.classList.remove('typing');
  if (!text) return;
  v.capText.style.setProperty('--n', Math.min(60, Math.max(8, Math.ceil(text.length / 3))));
  void v.capText.offsetWidth;
  v.capText.classList.add('typing');
  if (!animate) return;
  v.root.classList.add('talking');
  clearTimeout(v.talkTimer);
  v.talkTimer = setTimeout(() => v.root.classList.remove('talking'), TALK_MS);
}

/** The tile grid: one compact tile per agent of every project; only the current room's tiles are shown. */
export function createGrid(container, { onSelect, onFocus }) {
  const views = new Map();
  let spot = null;
  let room = null;

  const inProject = (v) => room != null && v.tile?.project === room;
  /** A replay tile (a past round) is shown only as the spotlight; it is never part of the live room. */
  const inRoom = (v) => inProject(v) && (!v.tile.replay || v.id === spot);

  function layout() {
    container.classList.toggle('spot', !!spot);
    let mini = 0;
    for (const v of views.values()) {
      const shown = inRoom(v);
      v.root.hidden = !shown;
      v.root.classList.toggle('big', shown && v.id === spot);
      const isMini = shown && !!spot && v.id !== spot;
      v.root.classList.toggle('mini', isMini);
      if (isMini) v.root.style.setProperty('--i', String(mini++));
      v.root.setAttribute('aria-pressed', String(v.id === spot));
    }
  }

  function apply(t) {
    let v = views.get(t.id);
    const isNew = !v;
    if (isNew) {
      v = build(container, t, onSelect, onFocus);
      views.set(t.id, v);
      if (t.kind === 'orchestrator') container.prepend(v.root);
    }
    const fail = t.status === 'done' && t.rc != null && t.rc !== 0;
    const keep = ['big', 'mini', 'talking','hand-up', 'enter', 'leaving'].filter((c) => v.root.classList.contains(c));
    v.root.className = ['tile', STATUS_CLASS[t.status], fail && 'st-fail', t.quiet && 'quiet', ...keep].filter(Boolean).join(' ');
    v.root.style.setProperty('--c', t.color);
    v.root.setAttribute('aria-label', `${t.name}, ${t.status}${t.caption ? `: ${t.caption}` : ''}. Press to open details.`);
    v.name.textContent = t.name;
    const shown = modelShown(t.name, t.model);
    v.model.textContent = shown;
    v.model.title = shown ? `Model: ${t.model}` : '';
    v.pill.textContent = t.status === 'done' && t.rc != null ? `done · rc=${t.rc}` : t.label || t.status;
    v.pill.classList.toggle('warn', fail);
    v.meter.textContent = tileMeterText(t.usage, t.kind === 'coder');
    v.meter.title = meterTitle(t.usage);
    v.quiet.hidden = !t.quiet;
    v.quiet.textContent = t.quiet ? `quiet ${t.quiet}m` : '';
    v.summary.textContent = t.status === 'refused' && t.reason ? `refused: ${t.reason}` : summaryText(t);
    v.dot.textContent = t.name.replace(/^Sonnet · /, '').charAt(0).toUpperCase();
    v.root.title = `${t.name}${shown ? ` · ${t.model}` : ''} · ${t.label || t.status}`;
    showRecent(v, t.events);
    v.tile = t;
    updateMonitor(v, t, isNew);
    drawSpark(v.spark, t.events);
    if (isNew || t.caption !== v.caption) {
      showCaption(v, t.caption, !isNew && !!t.caption);
      v.caption = t.caption;
    }
    layout();
    return v;
  }

  function remove(id) {
    const v = views.get(id);
    if (!v) return;
    clearTimeout(v.talkTimer);
    stopMonitor(v);
    v.root.remove();
    views.delete(id);
    if (spot === id) spot = null;
    layout();
  }

  return {
    views, apply, remove,
    /** Once a second: redraw the sparklines of the shown tiles so "last activity" and the minute buckets stay current. */
    tick() { for (const v of views.values()) if (v.tile && !v.root.hidden) drawSpark(v.spark, v.tile.events); },
    setRoom(project) { room = project; if (spot && !inProject(views.get(spot) ?? {})) spot = null; layout(); },
    setSpotlight(id) { spot = id && views.has(id) && inProject(views.get(id)) ? id : null; layout(); return spot; },
    /** Live tiles shown in the current room (no replays). */
    roomTiles() { return [...views.values()].filter((v) => inRoom(v) && !v.tile.replay).map((v) => v.tile); },
  };
}
