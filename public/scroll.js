const EDGE_PX = 2;

/** Which edges have more content: `top` when scrolled down, `bottom` when more is below. */
export function fadeState(scrollTop, clientHeight, scrollHeight) {
  return {
    top: scrollTop > EDGE_PX,
    bottom: scrollHeight - scrollTop - clientHeight > EDGE_PX,
  };
}

/**
 * Makes `node` a keyboard-focusable scroll area with no scrollbar (`.scroll`) and soft fades at the edges that
 * have more content. One passive scroll listener; size and child changes refresh the fades too.
 */
export function scrollable(node) {
  node.classList.add('scroll');
  node.tabIndex = 0;
  const update = () => {
    const s = fadeState(node.scrollTop, node.clientHeight, node.scrollHeight);
    node.classList.toggle('fade-top', s.top);
    node.classList.toggle('fade-bottom', s.bottom);
  };
  node.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(node);
  if (typeof MutationObserver === 'function') new MutationObserver(update).observe(node, { childList: true });
  queueMicrotask(update);
  return node;
}
