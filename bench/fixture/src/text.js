/** Upper-cases the first letter and lower-cases the rest. */
export function capitalize(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (text === '') return '';
  return text[0].toUpperCase() + text.slice(1).toLowerCase();
}

/** Counts whitespace-separated words. */
export function countWords(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
