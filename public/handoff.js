import { el } from './util.js';

const FLY_MS = 900;
const ICON = { spec: '📄 spec', report: '📋 report' };

/** Paper icon that flies between two tiles with a CSS transition; only called for live events. */
export function fly(fromEl, toEl, kind) {
  if (!fromEl || !toEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const icon = el('div', `flyer fly-${kind}`, ICON[kind]);
  icon.setAttribute('aria-hidden', 'true');
  icon.style.left = `${a.left + a.width / 2}px`;
  icon.style.top = `${a.top + a.height / 2}px`;
  document.body.append(icon);
  void icon.offsetWidth;
  icon.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px)`;
  icon.classList.add('go');
  setTimeout(() => icon.remove(), FLY_MS + 400);
}
