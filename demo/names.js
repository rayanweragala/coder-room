// Coder names (config style, as they appear after " on " in chain lines) and per-round usage for the acme-shop story.
export const NAMES = {
  api: 'claude-api claude-sonnet-5-5',
  ui: 'codex-ui gpt-6-luna',
  fallback: 'claude-ui claude-sonnet-5-5',
  review: 'claude-review claude-haiku-5-5',
};

export const COSTS = {
  q04: { cost: 0.71, out: 31_400 },
  q05: { cost: 0.52, out: 21_800 },
  q06: { cost: 0.09, out: 4_200 },
  q05b: { cost: 0.18, out: 6_900 },
};
