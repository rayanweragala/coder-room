import { createGrid } from './grid.js';
import { createSpotlight } from './spotlight.js';
import { createChat } from './chat.js';
import { createFollowMode } from './focus.js';
import { fly } from './handoff.js';
import { WORKING } from './util.js';
import { createHands } from './hands-ui.js';
import { createLobby } from './lobby-ui.js';
import { parseRoute, routeHash, stepProject } from './route.js';
import { fitGrid } from './fit.js';
import { scrollable } from './scroll.js';
import { createDrawer } from './drawer.js';
import { createHud } from './hud.js';
import { drawerLayout } from './split.js';
import { createSplit } from './split-ui.js';
import { createHelp } from './help.js';
import { createHistoryPanel } from './history-ui.js';

const $ = (id) => document.getElementById(id);
const CHAT_KEY = 'coder-room-chat';
const SWAP_MS = 400;
const TILE_TEXT_PX = 100;
const REPLAY = 'replay:';
let project = null;
let spotId = null;
let wanted = null;
let swapping = false;
let projects = [];
let chatAll = [];
let historyOn = false;
let replayRound = null;
let replayData = null;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
const historyPanel = createHistoryPanel($('history'), {
  load: async (name) => (await getJson(`/api/rounds?project=${encodeURIComponent(name)}`)).rounds,
  onOpen: (round) => navigate({ project, round }),
});

const spotlight = createSpotlight();
const syncDrawerLayout = () => document.body.classList.toggle('drawer-open', drawerLayout(drawer.isOpen, spotId).on);
const drawer = createDrawer({
  onChange: (on) => { $('detailsBtn').setAttribute('aria-pressed', String(on)); syncDrawerLayout(); },
});
const split = createSplit(document.querySelector('.stage'));
const hud = createHud({ onOpen: (tab) => drawer.open(tab) });
const help = createHelp();
$('detailsBtn').setAttribute('aria-pressed', String(drawer.isOpen));
const chat = createChat(scrollable($('chatlist')));
const grid = createGrid($('grid'), { onSelect: (id) => open(id), onFocus: (id) => hands.acknowledgeTile(grid.views.get(id)?.tile) });
const allTiles = () => [...grid.views.values()].map((v) => v.tile).filter((t) => t && !t.replay);
const follow = createFollowMode({
  getTiles: () => grid.roomTiles(), getCurrent: () => spotId, isActive: () => !!spotId && !swapping,
  switchTo: (id) => swap(id), setBanner, setToast,
});
const hands = createHands({ views: grid.views, button: $('handsBtn') });
const lobby = createLobby($('lobby'), {
  onOpen: (name) => navigate({ project: name }),
  onHistory: (name) => navigate({ project: name, history: true }),
});
const currentRoute = () => (replayRound
  ? { project, round: replayRound, history: historyOn }
  : { project, focus: spotId ?? wanted, follow: follow.following, history: historyOn });
function syncHash() {
  const hash = routeHash(currentRoute());
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function renderFollow() {
  $('followState').textContent = follow.following ? 'Following' : 'Pinned';
  $('pinBtn').textContent = follow.following ? '📌 Pin' : '▶ Follow';
  syncHash();
}

function setBanner(text) {
  const feed = spotId && grid.views.get(spotId)?.root.querySelector('.feed');
  const old = document.querySelector('.donebanner');
  if (old && (!text || old.textContent === text) && old.parentNode === feed) { if (!text) old.remove(); return; }
  old?.remove();
  if (!text || !feed) return;
  const b = document.createElement('div');
  b.className = 'donebanner';
  b.textContent = text;
  feed.append(b);
}

function setToast(text) {
  $('toast').hidden = !text;
  if (text) $('toastText').textContent = text;
}

function showSpot(tile, fresh, stream) {
  spotlight.show(tile, fresh, stream);
  if (tile) { drawer.update(tile); hud.update(tile); }
}

function select(id) {
  wanted = id;
  const next = grid.setSpotlight(id);
  const fresh = next !== spotId;
  spotId = next;
  if (next) hands.acknowledgeTile(grid.views.get(next).tile);
  document.body.classList.toggle('full', !!next);
  $('fullbar').hidden = !next;
  const isReplay = !!next && next.startsWith(REPLAY);
  document.body.classList.toggle('replay', isReplay);
  $('replayNav').hidden = !isReplay;
  $('prevRound').disabled = !replayData?.prev;
  $('nextRound').disabled = !replayData?.next;
  if (!next) document.body.classList.remove('chatover');
  setBanner(null);
  setToast(null);
  const view = next && grid.views.get(next);
  const feed = view?.root.querySelector('.feed') ?? null;
  drawer.mount(view?.root ?? null);
  split.mount(view?.root ?? null);
  hud.mount(feed);
  syncDrawerLayout();
  showSpot(view ? view.tile : null, fresh, view?.stream);
  renderFollow();
  fitRoom();
  if (next && fresh) {
    view.root.classList.add('enter');
    setTimeout(() => view.root.classList.remove('enter'), SWAP_MS + 50);
  }
}

/** Follow mode's switch: the old feed fades out, then the new one fades in. */
function swap(id) {
  const old = grid.views.get(spotId)?.root;
  if (!old) { select(id); return; }
  swapping = true;
  old.classList.add('leaving');
  setTimeout(() => {
    old.classList.remove('leaving');
    swapping = false;
    select(id);
  }, SWAP_MS);
}

/** Shows the lobby (no project) or a project room, optionally with one agent full screen. */
function applyRoute(r) {
  project = r.project;
  historyOn = !!r.history && !!project;
  document.body.classList.toggle('hist', historyOn);
  $('historyBtn').setAttribute('aria-pressed', String(historyOn));
  if (historyOn) historyPanel.show(project); else historyPanel.stop();
  follow.setFollowing(r.follow);
  document.body.classList.toggle('lobby', !project);
  grid.setRoom(project);
  if (replayRound !== (r.round ?? null)) dropReplay();
  replayRound = project ? r.round ?? null : null;
  select(replayRound ? null : r.focus && grid.views.get(r.focus)?.tile?.project === project ? r.focus : null);
  wanted = replayRound ? null : r.focus;
  syncHash();
  renderChrome();
  if (replayRound) openReplay(replayRound);
}

function dropReplay() {
  for (const id of [...grid.views.keys()]) if (id.startsWith(REPLAY)) grid.remove(id);
  replayData = null;
}

/** Fetches a past round and shows it full screen as a static (not live) tile. */
async function openReplay(round) {
  let details;
  try {
    details = await getJson(`/api/round?project=${encodeURIComponent(project)}&round=${encodeURIComponent(round)}`);
  } catch {
    if (replayRound === round) navigate({ project, history: historyOn }, true);
    return;
  }
  if (replayRound !== round) return;
  for (const id of [...grid.views.keys()]) if (id.startsWith(REPLAY) && id !== details.tile.id) grid.remove(id);
  replayData = details;
  grid.apply(details.tile);
  select(details.tile.id);
}

function navigate(r, replace = false) {
  const next = { ...r, history: r.history ?? (r.project === project && historyOn) };
  const hash = routeHash(next);
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  applyRoute(next);
}

function stepReplay(step) {
  const to = step < 0 ? replayData?.prev : replayData?.next;
  if (to) navigate({ project, round: to });
}

/** A click or key on a card: from the room it opens full screen (following); inside it switches and pins. */
function open(id) {
  const t = grid.views.get(id)?.tile;
  if (!t || id === spotId) return;
  navigate({ project: t.project, focus: id, follow: spotId ? false : true });
}

function close() {
  navigate({ project, focus: null });
}

function toggleBrowserFullscreen() {
  try {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    p?.catch(() => {});
  } catch { /* the browser refused */ }
}

function fitRoom() {
  const g = $('grid');
  if (!project || spotId) return;
  const n = grid.roomTiles().length;
  const { cols, rows } = fitGrid(g.clientWidth, g.clientHeight, n, { aspect: 1.6, extra: TILE_TEXT_PX });
  g.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  g.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
}

function renderSwitcher() {
  const sw = $('switcher');
  const names = projects.map((p) => p.name);
  if (project && !names.includes(project)) names.push(project);
  const sig = names.join('\0');
  if (sw.dataset.sig !== sig) {
    sw.dataset.sig = sig;
    sw.replaceChildren(new Option('Lobby', ''), ...names.map((n) => new Option(n, n)));
  }
  sw.value = project ?? '';
}

function renderChat() {
  $('chatTitle').textContent = project ? `Chat · ${project} orchestrator` : 'Chat';
  chat.set(project ? chatAll.filter((m) => m.project === project) : []);
}

function refreshSummary() {
  const tiles = project ? grid.roomTiles() : allTiles();
  const coders = tiles.filter((t) => t.kind === 'coder');
  const n = coders.filter((t) => WORKING.includes(t.status)).length;
  const midnight = new Date().setHours(0, 0, 0, 0);
  const done = coders.filter((t) => t.status === 'done' && t.endedAt >= midnight).length;
  $('working').textContent = `${n} agent${n === 1 ? '' : 's'} working · ${done} round${done === 1 ? '' : 's'} done today`;
  $('empty').hidden = !project || coders.length > 0;
}

function renderLobby() {
  if (project) return;
  lobby.render(projects, allTiles(), hands.ids, new Date().setHours(0, 0, 0, 0));
}

function renderChrome() {
  renderSwitcher();
  renderChat();
  refreshSummary();
  renderLobby();
  fitRoom();
  lobby.fit();
}

function applyTile(t) {
  grid.apply(t);
  if (wanted === t.id && spotId !== t.id && t.project === project) select(t.id);
  else if (spotId === t.id) showSpot(t, false, grid.views.get(t.id).stream);
  hands.refresh(allTiles(), spotId);
  refreshSummary();
  renderLobby();
  follow.check();
}

function removeTile(id) {
  grid.remove(id);
  if (spotId === id) {
    const orch = grid.roomTiles().find((t) => t.kind === 'orchestrator');
    select(follow.following && orch ? orch.id : null);
  }
  hands.refresh(allTiles(), spotId);
  refreshSummary();
  renderLobby();
  fitRoom();
}

function applySnapshot(snap) {
  const ids = new Set(snap.tiles.map((t) => t.id));
  for (const id of [...grid.views.keys()]) if (!ids.has(id) && !id.startsWith(REPLAY)) removeTile(id);
  projects = snap.projects || [];
  for (const t of snap.tiles) applyTile(t);
  chatAll = snap.chat || [];
  renderChrome();
}

function onHandoff(h) {
  if (h.project !== project) return;
  const orch = [...grid.views.values()].find((v) => v.tile?.kind === 'orchestrator' && v.tile.project === h.project)?.root;
  const side = grid.views.get(h.to ?? h.from)?.root;
  if (h.type === 'spec') fly(orch, side, 'spec');
  else if (h.type === 'report') fly(side, orch, 'report');
}

const es = new EventSource('/events');
es.addEventListener('snapshot', (e) => applySnapshot(JSON.parse(e.data)));
es.addEventListener('tile', (e) => applyTile(JSON.parse(e.data)));
es.addEventListener('remove', (e) => removeTile(JSON.parse(e.data).id));
es.addEventListener('chat', (e) => { chatAll = JSON.parse(e.data); renderChat(); });
es.addEventListener('handoff', (e) => onHandoff(JSON.parse(e.data)));
es.onopen = () => { $('banner').hidden = true; };
es.onerror = () => { $('banner').hidden = false; };

function togglePin() {
  if (!spotId || replayRound) return;
  follow.setFollowing(!follow.following);
  renderFollow();
  follow.check();
}

function toggleChatOverlay() {
  if (!spotId) return;
  const on = document.body.classList.toggle('chatover');
  $('chatOver').setAttribute('aria-pressed', String(on));
}

function toggleHistory() {
  if (project) navigate({ ...currentRoute(), history: !historyOn });
}

function stepRoom(step) {
  const next = stepProject(projects.map((p) => p.name), project, step);
  if (next) navigate({ project: next });
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (help.close()) return;
    if (spotId && drawer.isOpen) drawer.close();
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (spotId) close();
    else if (historyOn) toggleHistory();
  } else if (e.key === '?') help.toggle();
  else if (e.key === '/' && spotId) { e.preventDefault(); spotlight.focusFilter(); }
  else if (key === 'd' && spotId) drawer.toggle();
  else if (key === 'f') toggleBrowserFullscreen();
  else if (key === 'p') togglePin();
  else if (key === 'c' && spotId) toggleChatOverlay();
  else if (key === 'h' && project) toggleHistory();
  else if (e.key === '[') { if (replayRound) stepReplay(-1); else stepRoom(-1); }
  else if (e.key === ']') { if (replayRound) stepReplay(1); else stepRoom(1); }
  else if (project && /^[1-9]$/.test(e.key)) {
    const ids = [...$('grid').children].filter((n) => !n.hidden).map((n) => [...grid.views.values()].find((v) => v.root === n)?.id).filter(Boolean);
    open(ids[Number(e.key) - 1]);
  }
});
window.addEventListener('hashchange', () => {
  const r = parseRoute(location.hash);
  if (routeHash(r) === routeHash(currentRoute())) return;
  applyRoute(r);
});
document.addEventListener('visibilitychange', () => document.body.classList.toggle('hidden', document.hidden));
for (const ev of ['wheel', 'touchmove', 'pointerdown', 'keydown']) $('grid').addEventListener(ev, () => follow.touch(), true);
$('detailsBtn').addEventListener('click', () => drawer.toggle());

$('handsBtn').addEventListener('click', () => {
  const id = hands.oldest;
  if (!id) return;
  open(id);
  follow.setFollowing(false);
  renderFollow();
});
$('switcher').addEventListener('change', (e) => navigate({ project: e.target.value || null }));
$('pinBtn').addEventListener('click', togglePin);
$('chatOver').addEventListener('click', toggleChatOverlay);
$('exitBtn').addEventListener('click', close);
$('historyBtn').addEventListener('click', toggleHistory);
$('prevRound').addEventListener('click', () => stepReplay(-1));
$('nextRound').addEventListener('click', () => stepReplay(1));
$('stayBtn').addEventListener('click', () => { follow.setFollowing(false); renderFollow(); });
for (const b of document.querySelectorAll('.fsbtn')) b.addEventListener('click', toggleBrowserFullscreen);

function setChat(on) {
  document.body.classList.toggle('nochat', !on);
  $('chatToggle').setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(CHAT_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  fitRoom();
}
let chatOn = true;
try { chatOn = localStorage.getItem(CHAT_KEY) !== '0'; } catch { /* storage unavailable */ }
setChat(chatOn);
$('chatToggle').addEventListener('click', () => {
  if (historyOn) { chatOn = true; setChat(true); toggleHistory(); return; }
  chatOn = !chatOn;
  setChat(chatOn);
});

new ResizeObserver(() => { fitRoom(); lobby.fit(); }).observe(document.querySelector('.stage'));
applyRoute(parseRoute(location.hash));

setInterval(() => {
  $('clock').textContent = new Date().toTimeString().slice(0, 8);
  hands.refresh(allTiles(), spotId);
  renderLobby();
  grid.tick();
  hud.tick();
  follow.check();
}, 1000);
