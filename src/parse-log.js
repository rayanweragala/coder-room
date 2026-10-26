import { createClaudeParser } from './parse-claude.js';
import { createCodexParser } from './parse-codex.js';

/** Picks the parser from the first non-empty line: `{` means Claude stream-json, else Codex text. */
export function createLogParser(opts) {
  let inner = null;
  return {
    feed(line) {
      if (!inner) {
        if (!line.trim()) return [];
        inner = line[0] === '{' ? createClaudeParser(opts) : createCodexParser(opts);
      }
      return inner.feed(line);
    },
  };
}
