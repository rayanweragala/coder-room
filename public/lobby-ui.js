import { el, dayTimeText } from './util.js';
import { buildCards } from './lobby.js';
import { fitGrid } from './fit.js';
import { agentRows, moreText } from './lobby-rows.js';
import { createLobbyOrder } from './lobby-order.js';

const STATUS_CLASS = {
  thinking: 'st-thinking', editing: 'st-editing', 'running a gate': 'st-gate', 'running a command': 'st-command',
  done: 'st-done', 'rate-limited': 'st-limit', refused: 'st-refused', stopped: 'st-stopped', 'waiting for you': 'st-waiting', watching: 'st-watching',
};

function avatar(t) {
  const fail = t.status === 'done' && t.rc != null && t.rc !== 0;
  const a = el('span', ['lav', STATUS_CLASS[t.status], fail && 'st-fail'].filter(Boolean).join(' '));
  a.dataset.id = t.id;
  a.style.setProperty('--c', t.color);
  a.title = `${t.name} · ${t.label || t.status}`;
  a.append(el('b', null, t.name.replace(/^Sonnet · /, '').charAt(0).toUpperCase()), el('i', 'lmouth'));
  return a;
}

function agentList(agents) {
  const { rows, more } = agentRows(agents, Date.now());
  const list = el('ul', 'lrows');
  for (const r of rows) {
    const li = el('li', 'lrow');
    const pill = el('span', `lpill ${STATUS_CLASS[r.status] || ''}`, r.status === 'done' && r.rc != null ? `done · rc=${r.rc}` : r.label);
    li.append(avatar(agents.find((t) => t.id === r.id)), el('b', null, r.name.replace(/^Sonnet · /, '')), ...(r.model ? [el('span', 'lmodel', r.model)] : []), pill, el('span', 'lline', r.line), el('span', 'lel', r.elapsed));
    list.append(li);
  }
  if (more) list.append(el('li', 'lmore', moreText(more)));
  return list;
}

function card(c, onOpen, onHistory) {
  const root = el('article', 'lcard');
  root.tabIndex = 0;
  root.setAttribute('role', 'button');
  root.dataset.project = c.name;
  root.setAttribute('aria-label', `${c.name}: ${c.working} working, ${c.rounds} rounds today. Press to enter the room.`);
  if (c.working) root.classList.add('busy');
  const head = el('div', 'lhead');
  head.append(el('h2', null, c.name));
  if (c.hands) head.append(el('span', 'lhands', `✋ ${c.hands}`));
  const hist = el('a', 'lhist', 'History');
  hist.href = `#/p/${encodeURIComponent(c.name)}?history=1`;
  hist.title = 'Round history';
  hist.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onHistory?.(c.name); });
  hist.addEventListener('keydown', (e) => e.stopPropagation());
  head.append(hist);
  const goal = el('p', 'lgoal', c.goal || 'No handoff goal yet.');
  const agents = agentList(c.agents);
  const foot = el('div', 'lfoot');
  foot.append(el('span', null, `${c.working} working · ${c.totals} today`), el('span', 'ltime', c.last ? dayTimeText(c.last) : ''));
  root.append(head, goal);
  if (c.caption) root.append(el('p', 'lcaption', `${c.caption.initial} · ${c.caption.text}`));
  root.append(agents, foot);
  root.addEventListener('click', () => onOpen(c.name));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.name); }
  });
  return root;
}

/** The lobby: one card per active project, a collapsed "Quiet projects" line, and a layout that always fits. */
export function createLobby(container, { onOpen, onHistory }) {
  const cards = el('div', 'lcards');
  const quietBox = el('details', 'lquiet');
  container.append(cards, quietBox);
  let sig = '';
  let count = 0;
  let lastArgs = null;
  const stable = createLobbyOrder();

  /** FLIP: cards that changed place slide from where they were instead of jumping. */
  function slide(before) {
    for (const n of cards.children) {
      const was = before.get(n.dataset.project);
      if (!was) continue;
      const now = n.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) continue;
      n.style.transition = 'none';
      n.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        n.style.transition = 'transform 250ms ease';
        n.style.transform = '';
      });
    }
  }

  cards.addEventListener('mouseleave', () => { if (lastArgs) api.render(...lastArgs); });

  function fit() {
    const { cols, rows } = fitGrid(cards.clientWidth, cards.clientHeight, Math.max(1, count), { aspect: 2, extra: 80 });
    cards.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    cards.style.gridTemplateRows = `repeat(${rows}, minmax(0, 250px))`;
  }

  const api = {
    fit,
    render(projects, tiles, handIds, midnight) {
      lastArgs = [projects, tiles, handIds, midnight];
      const built = buildCards(projects, tiles, handIds, midnight);
      const quiet = built.quiet;
      const list = stable.order(built.cards, cards.matches(':hover'));
      const next = JSON.stringify([list.map((c) => [c.name, c.goal, c.working, c.rounds, c.hands, c.last, c.caption, c.totals, agentRows(c.agents, Date.now()), c.agents.map((t) => [t.id, t.status, t.label, t.rc])]), quiet.map((p) => p.name)]);
      if (next === sig) return;
      sig = next;
      const focused = document.activeElement?.closest?.('.lcard')?.dataset.project;
      const before = new Map([...cards.children].map((n) => [n.dataset.project, n.getBoundingClientRect()]));
      cards.replaceChildren(...list.map((c) => card(c, onOpen, onHistory)));
      count = list.length;
      quietBox.hidden = !quiet.length;
      quietBox.replaceChildren(el('summary', null, `Quiet projects (${quiet.length})`));
      const names = el('div', 'lnames');
      for (const p of quiet) {
        const b = el('button', 'toggle', p.name);
        b.type = 'button';
        b.addEventListener('click', () => onOpen(p.name));
        names.append(b);
      }
      quietBox.append(names);
      if (focused) [...cards.children].find((n) => n.dataset.project === focused)?.focus();
      fit();
      slide(before);
    },
  };
  return api;
}
