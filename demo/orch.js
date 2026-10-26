// Orchestrator transcript lines (Claude Code jsonl). Each builder returns a function, evaluated when the line is
// written so its timestamp is current.
import { MODELS } from './steps.js';

const toJson = JSON.stringify;

export function orch(dir) {
  const line = (type, extra) => () => toJson({ type, timestamp: new Date().toISOString(), cwd: dir, ...extra });
  let n = 0;
  const asst = (content) => line('assistant', {
    message: { id: `msg_orch_${++n}`, model: MODELS.opus, content, usage: { input_tokens: 12, output_tokens: 150 + (n % 9) * 40, cache_read_input_tokens: 20_000 + n * 800, cache_creation_input_tokens: 500 } },
  });
  const tool = (name, input) => asst([{ type: 'tool_use', id: `toolu_orch_${n + 1}`, name, input }]);
  return {
    user: (t) => line('user', { message: { role: 'user', content: t } }),
    say: (t) => asst([{ type: 'text', text: t }]),
    run: (command) => tool('Bash', { command }),
    read: (file_path) => tool('Read', { file_path }),
    write: (file_path, content) => tool('Write', { file_path, content }),
    notify: (t) => line('user', { message: { role: 'user', content: [{ type: 'text', text: `<task-notification>${t}</task-notification>` }] } }),
    end: () => line('system', { subtype: 'turn_duration', durationMs: 4200 }),
  };
}
