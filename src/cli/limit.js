const CODEX_MARKER = /^(exec|codex|thinking|user|tokens used|file update|apply_patch|mcp\b|-{4,})/;
const CODEX_TAIL_LINES = 40;

function claudeOutput(log) {
  const parts = [];
  for (const line of log.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith('{')) {
      parts.push(line);
      continue;
    }
    if (!line.includes('"type":"result"')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type !== 'result') continue;
      if (typeof ev.result === 'string') parts.push(ev.result);
      for (const e of Array.isArray(ev.errors) ? ev.errors : []) parts.push(typeof e === 'string' ? e : JSON.stringify(e));
    } catch {
      /* partial line: not a result event */
    }
  }
  return parts.join('\n');
}

function codexOutput(log) {
  const errors = [];
  const rest = [];
  let inExec = false;
  for (const line of log.split('\n')) {
    if (line.startsWith('ERROR')) errors.push(line);
    if (CODEX_MARKER.test(line)) inExec = line === 'exec';
    else if (!inExec && line.trim()) rest.push(line);
  }
  return [...errors, ...rest.slice(-CODEX_TAIL_LINES)].join('\n');
}

/** The part of a coder log that the coder itself said, not tool output or echoed spec text. */
export function coderOutput(kind, log) {
  return kind === 'claude' ? claudeOutput(log) : codexOutput(log);
}

export function isLimited(kind, log, patterns) {
  const text = coderOutput(kind, log).toLowerCase();
  return patterns.some((p) => text.includes(p.toLowerCase()));
}
