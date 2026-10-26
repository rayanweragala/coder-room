import { stripRoot, oneLine, fullText, lineCount, diffLines } from './events.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const USER_MAX = 300;
const PENDING_MAX = 200;

function editCounts(name, input) {
  if (name === 'Write') return { add: lineCount(input.content), del: 0 };
  if (name === 'Edit') return { add: lineCount(input.new_string), del: lineCount(input.old_string) };
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.reduce((a, e) => ({ add: a.add + lineCount(e?.new_string), del: a.del + lineCount(e?.old_string) }),
      { add: 0, del: 0 });
  }
  return {};
}

function diffOf(name, input) {
  if (name === 'Write') return diffLines('', input.content);
  if (name === 'Edit') return diffLines(input.old_string, input.new_string);
  if (name === 'MultiEdit' && Array.isArray(input.edits) && input.edits[0]) return diffLines(input.edits[0].old_string, input.edits[0].new_string);
  return [];
}

/** Plain "Working on" text for a tool call: the command itself, or a short label for tools without one. */
function labelOf(name = '', input) {
  if (name === 'Read' && input.file_path) return `reading ${input.file_path}`;
  if (/^(Grep|Glob)$/.test(name) && input.pattern) return `searching ${input.pattern}`;
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return `${mcp[1].replace(/^claude[-_]?(ai|in)?[-_]/i, '').replace(/[_]+/g, ' ')}: ${mcp[2].replace(/_/g, ' ')}`;
  return String(input.command ?? input.file_path ?? input.pattern ?? name);
}

function todosOf(input) {
  if (!Array.isArray(input.todos)) return [];
  return input.todos.filter((t) => t && t.content).map((t) => ({ text: oneLine(t.content, 160), status: String(t.status || 'pending') }));
}

const NOTIFICATION = '<task-notification>';

/** The user's own text parts of a user line, and whether any part was a background-task notification. */
function userParts(content) {
  const parts = typeof content === 'string' ? [content]
    : Array.isArray(content) ? content.filter((c) => c?.type === 'text' && c.text).map((c) => c.text) : [];
  const woken = parts.some((p) => p.includes(NOTIFICATION));
  return { text: parts.filter((p) => !p.includes(NOTIFICATION)).join('\n'), woken };
}

/** TaskCreate / TaskUpdate keep a task list per parser; returns the whole list as a `todo` event. */
function taskEvent(block, tasks) {
  const input = block.input || {};
  const subject = input.subject ? oneLine(input.subject, 160) : null;
  if (block.name === 'TaskCreate' && subject) {
    tasks.set(String(tasks.size + 1), { text: subject, status: 'pending' });
  } else if (block.name === 'TaskUpdate' && input.taskId != null) {
    const id = String(input.taskId);
    const task = tasks.get(id);
    if (input.status === 'deleted') tasks.delete(id);
    else if (task) {
      if (input.status) task.status = String(input.status);
      if (subject) task.text = subject;
    } else if (subject) tasks.set(id, { text: subject, status: String(input.status || 'pending') });
  }
  return { kind: 'todo', text: 'checklist', todos: [...tasks.values()].map((t) => ({ ...t })) };
}

function usageOf(u = {}) {
  return { in: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0 };
}

/** The final `usage` event of a result line: `modelUsage` totals (incl. subagents) and `total_cost_usd`, if present. */
function resultUsage(record) {
  const models = {};
  const given = record.modelUsage && typeof record.modelUsage === 'object' ? record.modelUsage : {};
  for (const [name, m] of Object.entries(given)) {
    models[name] = {
      in: m.inputTokens || 0, out: m.outputTokens || 0, cr: m.cacheReadInputTokens || 0, cw: m.cacheCreationInputTokens || 0,
      cost: typeof m.costUSD === 'number' ? m.costUSD : null,
    };
  }
  if (!Object.keys(models).length && record.usage) models.total = { ...usageOf(record.usage), cost: null };
  const cost = typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null;
  return Object.keys(models).length || cost !== null ? { kind: 'usage', final: true, models, cost } : null;
}

function toolEvents(block, root, pending, tasks) {
  const input = block.input || {};
  if (block.name === 'TodoWrite') return [{ kind: 'todo', text: 'checklist', todos: todosOf(input) }];
  if (block.name === 'TaskCreate' || block.name === 'TaskUpdate') return [taskEvent(block, tasks)];
  if (EDIT_TOOLS.has(block.name) && (input.file_path || input.notebook_path)) {
    const file = stripRoot(String(input.file_path || input.notebook_path), root);
    return [{ kind: 'edit', text: file, file, ...editCounts(block.name, input), diff: diffOf(block.name, input) }];
  }
  const out = [];
  if (block.name === 'Bash' && input.description) {
    out.push({ kind: 'intent', text: fullText(stripRoot(String(input.description), root)) });
  }
  const cmd = stripRoot(labelOf(block.name, input), root);
  out.push({ kind: 'command', text: cmd, cmd, id: block.id });
  if (block.id) {
    pending.add(block.id);
    if (pending.size > PENDING_MAX) pending.delete(pending.values().next().value);
  }
  return out;
}

/** The line's own `timestamp` in ms, or null. */
function timestampOf(record) {
  const t = record.timestamp;
  const ms = typeof t === 'number' ? t : typeof t === 'string' ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Claude stream-json / transcript parser. `feed(line)` returns events; bad lines yield [].
 * With `orchestrator`, assistant text is a `message` to the user and the user's own lines become `user` events.
 */
export function createClaudeParser({ root = '', orchestrator = false } = {}) {
  const pending = new Set();
  const tasks = new Map();
  let lastSay = null;
  function parseRecord(record) {
    if (record.type === 'result') {
      const text = fullText(stripRoot(String(record.result ?? ''), root));
      const dup = lastSay !== null && text !== '' && text === lastSay;
      lastSay = null;
      const usage = resultUsage(record);
      return [...(usage ? [usage] : []), { kind: 'done', text: oneLine(record.result ?? '', 400), ...(dup ? { dup: true } : {}) }];
    }
    if (record.type === 'system' && record.subtype === 'init' && typeof record.model === 'string' && record.model) {
      return [{ kind: 'model', model: record.model }];
    }
    if (orchestrator && record.type === 'system' && record.subtype === 'turn_duration') return [{ kind: 'turn-end', text: '' }];
    if (record.type === 'user') {
      const content = record.message?.content;
      if (orchestrator) {
        const { text, woken } = userParts(content);
        const t = text.trim();
        if (woken) return [{ kind: 'wake', text: '' }];
        return t && t[0] !== '<' ? [{ kind: 'user', text: oneLine(t, USER_MAX) }] : [];
      }
      if (!Array.isArray(content)) return [];
      return content
        .filter((c) => c?.type === 'tool_result' && pending.delete(c.tool_use_id))
        .map((c) => ({ kind: 'result', ok: !c.is_error, text: '', id: c.tool_use_id }));
    }
    if (record.type !== 'assistant') return [];
    const content = record.message?.content;
    if (!Array.isArray(content)) return [];
    const out = [];
    const m = record.message?.model;
    if (typeof m === 'string' && m && !m.startsWith('<')) out.push({ kind: 'model', model: m, latest: orchestrator });
    const u = record.message?.usage;
    if (u && typeof u === 'object') out.push({ kind: 'usage', id: record.message.id ?? null, ...usageOf(u) });
    for (const block of content) {
      if (block?.type === 'text' && block.text) {
        out.push({ kind: orchestrator ? 'message' : 'say', text: fullText(stripRoot(block.text, root)) });
      } else if (block?.type === 'thinking' && block.thinking) {
        out.push({ kind: 'thought', text: fullText(block.thinking) });
      } else if (block?.type === 'tool_use') {
        out.push(...toolEvents(block, root, pending, tasks));
      }
    }
    const last = out.at(-1);
    lastSay = last?.kind === 'say' ? last.text : null;
    return out;
  }

  return {
    feed(line) {
      if (!line || line[0] !== '{') return [];
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        return [];
      }
      const events = parseRecord(record);
      const ts = timestampOf(record);
      return ts === null ? events : events.map((ev) => ({ ...ev, ts }));
    },
  };
}
