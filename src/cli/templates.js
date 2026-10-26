export const CORE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'TodoWrite'];

export const HANDOFF = `# Handoff

## What this is
(one paragraph: the project and the goal)

## State
- Done:
- In progress:

## Next step
(the single next action)

## Open decisions
-

## How to resume
(commands to run, files to read first)
`;

export const BACKLOG = `# Backlog

| Round | Goal | Status | Notes |
|-------|------|--------|-------|
| r01   |      | todo   |       |
`;

export const SPEC_TEMPLATE = `# <round> — <title>

## Goal

## Decisions

## Items
### 1. <item>
- Done when:

## Tests

## Gates

## Report
Write \`.rounds/<round>-report.md\`: files, items met, tests, gate output, anything deferred.

## Out of scope
`;

export const CODER_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(wc:*)', 'Bash(pwd)',
  'Bash(mkdir:*)', 'Bash(node:*)', 'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
].join('\n') + '\n';

export function defaultConfig({ claude, codex }) {
  const coders = [];
  if (claude) {
    coders.push({ name: 'claude-main', kind: 'claude', model: 'sonnet', enabled: true, configDir: null, tools: '.rounds/coder-tools.txt', lean: true, coreTools: CORE_TOOLS });
  }
  if (codex) {
    coders.push({ name: 'codex', kind: 'codex', model: '<set me>', enabled: false, sandbox: 'workspace-write', writableRoots: [] });
  }
  // Example for a second Claude account; disabled until the user points configDir at a real login.
  coders.push({ name: 'claude-extra', kind: 'claude', model: 'sonnet', enabled: false, configDir: '~/.claude-extra', tools: '.rounds/coder-tools.txt', lean: true, coreTools: CORE_TOOLS });
  const names = coders.map((c) => c.name);
  return {
    coders,
    order: [...names.filter((n) => n === 'codex'), ...names.filter((n) => n !== 'codex')],
    requireCleanTree: false,
    prompt: null,
    limitPatterns: {
      claude: ['hit your session limit', 'usage limit', 'hit your limit'],
      codex: ['usage limit', 'rate limit', 'hit your limit'],
    },
  };
}
