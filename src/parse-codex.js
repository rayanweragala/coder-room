import { stripRoot, fullText } from './events.js';

const SKIP_HEADER = /^(user|tokens used|file update|diff --git)/;
const HEADLINE = /^\*\*(.+)\*\*$/;

function commandOf(line) {
  let cmd = line.replace(/^\/bin\/bash -lc /, '');
  const at = cmd.lastIndexOf(' in /');
  if (at >= 0) cmd = cmd.slice(0, at);
  return cmd.replace(/^["']|["']$/g, '');
}

/** Codex text-log parser: `**headline**` lines are thoughts, `codex` blocks are narration. */
export function createCodexParser({ root = '' } = {}) {
  let mode = 'skip';
  let sayLines = 0;
  let header = true;
  return {
    feed(line) {
      if (header) {
        const m = /^model:\s*(\S+)\s*$/.exec(line);
        if (m) { header = false; return [{ kind: 'model', model: m[1] }]; }
        if (/^(user|codex|thinking|exec)$/.test(line)) header = false;
      }
      if (line === 'codex') { mode = 'say'; sayLines = 0; return []; }
      if (line === 'thinking') { mode = 'think'; return []; }
      if (line === 'exec') { mode = 'exec'; return []; }
      if (line.startsWith('apply patch')) { mode = 'patch'; return []; }
      if (line.startsWith('tokens used')) {
        const same = /^tokens used\D+(\d[\d,._]*)\s*$/.exec(line);
        mode = same ? 'skip' : 'tokens';
        return same ? [{ kind: 'usage', final: true, total: Number(same[1].replace(/\D/g, '')) }] : [];
      }
      if (mode === 'tokens') {
        mode = 'skip';
        const n = /^\s*(\d[\d,._]*)\s*$/.exec(line);
        return n ? [{ kind: 'usage', final: true, total: Number(n[1].replace(/\D/g, '')) }] : [];
      }
      if (SKIP_HEADER.test(line)) { mode = 'skip'; return []; }
      if (/^(ERROR|EXIT)/.test(line)) return [{ kind: 'error', text: stripRoot(line, root) }];
      if (!line.trim()) return [];
      const head = HEADLINE.exec(line.trim());
      if (head && mode !== 'exec' && mode !== 'patch') {
        return [{ kind: 'thought', text: fullText(stripRoot(head[1], root)) }];
      }
      if (mode === 'say') {
        return [{ kind: 'say', text: fullText(stripRoot(line, root)), cont: sayLines++ > 0 }];
      }
      if (mode === 'think') return [{ kind: 'thought', text: fullText(line) }];
      if (mode === 'exec') {
        mode = 'result';
        const cmd = stripRoot(commandOf(line), root);
        return [{ kind: 'command', text: cmd, cmd }];
      }
      if (mode === 'result' && /^ (succeeded|exited)/.test(line)) {
        const m = /^ (succeeded|exited (\d+)) in ([^:]*):?/.exec(line);
        mode = 'skip';
        if (!m) return [];
        const ok = m[1] === 'succeeded';
        return [{ kind: 'result', ok, text: ok ? m[3] : `${m[2]} ${m[3]}` }];
      }
      if (mode === 'patch' && line.startsWith('/')) {
        const file = stripRoot(line.trim(), root);
        return [{ kind: 'edit', text: file, file }];
      }
      return [];
    },
  };
}
