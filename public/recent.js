import { plainText } from './markdown.js';

const TALK = new Set(['thought', 'say', 'intent', 'message', 'user']);
const PREVIEW_CHARS = 240;

/** First line of a thought with Markdown stripped (the whole text when that line is only markup). */
const preview = (text) => (plainText(text.split('\n')[0]) || plainText(text)).slice(0, PREVIEW_CHARS);

/**
 * The last `max` timeline items for a grid tile: thoughts and says first; with `fill` (default) other items fill
 * the gaps, without it only thoughts and says are returned.
 */
export function recentItems(events, max = 4, fill = true) {
  const picked = new Set(events.filter((e) => TALK.has(e.kind)).slice(-max));
  for (let i = events.length - 1; fill && i >= 0 && picked.size < max; i--) picked.add(events[i]);
  return events.filter((e) => picked.has(e)).map((e) => ({
    n: e.n, kind: e.kind, text: e.kind === 'edit' ? e.file : TALK.has(e.kind) ? preview(e.text || '') : (e.text || '').split('\n')[0],
  }));
}
