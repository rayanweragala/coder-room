import { el } from './util.js';

export const KEYS = [
  ['1–9', 'open the Nth agent of the room'], ['[ ]', 'previous / next project room'], ['F', 'browser full screen'],
  ['D', 'details drawer'], ['C', 'chat overlay'], ['P', 'pin / follow'], ['/', 'filter the live thoughts'],
  ['H', 'round history'], ['↑ ↓ Enter', 'move / open a round in the history'], ['[ ]', 'in a replay: previous / next round'],
  ['?', 'this list'], ['Esc', 'close drawer, this list, then full screen'],
];

/** Keyboard map overlay: `toggle()` shows or hides it; `close()` returns true when it was open. */
export function createHelp() {
  const root = el('div', 'help');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Keyboard shortcuts');
  const card = el('div', 'helpcard');
  card.append(el('h3', null, 'Keyboard'));
  const list = el('dl');
  for (const [k, d] of KEYS) list.append(el('dt', null, k), el('dd', null, d));
  card.append(list);
  root.append(card);
  root.addEventListener('click', () => { root.hidden = true; });
  document.body.append(root);
  return {
    toggle() { root.hidden = !root.hidden; },
    close() { const was = !root.hidden; root.hidden = true; return was; },
  };
}
