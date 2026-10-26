# Why separate coder processes

coder-room runs the coder as its own process instead of as a subagent inside the orchestrating Claude Code session. This page gives the reasons and the measurements so far. The measurements are small, and the section on what is not measured says where.

## Documented behaviour

- In-session subagents count toward the same usage limits as the main conversation (Claude Code docs, sub-agents page). A subagent has its own context window but uses the same quota.
- In the result event of a headless run, `modelUsage` and `total_cost_usd` include subagents, while `usage` covers the main loop only (cost-tracking page). Costs are client-side estimates.

## Build session

The tool was built with its own workflow: 21 rounds with a recorded result (q01 to q17, including the follow-up rounds such as q01b and q12b), all coded by a Sonnet coder on a secondary Claude account while an Opus session orchestrated. Totals from `coder-room tokens --json`:

| metric | total |
|---|---|
| rounds with a result | 21 |
| coder turns | 1,678 |
| coder wall time | 8,308 s |
| input tokens | 1,676 |
| output tokens | 888,424 |
| cache read tokens | 69,110,302 |
| cache write tokens | 2,086,606 |
| cost (client-side estimate) | $24.15 |

None of these tokens went through the orchestrator's session, because the coder ran under another account.

## A/B bench

`bench/ab.js` gives the same small task (two functions with a spec and tests) to two arms. In arm A an Opus orchestrator starts a Sonnet coder through coder-room. In arm B the Opus orchestrator uses an in-session subagent. In both arms the orchestrator reviews the diff and runs `npm test` once.

### v1, coder with the full account setup

Results: `bench/results/20261025-2306/results.md`.

| metric | A (coder-room) | B (subagent) |
|---|---|---|
| orchestrator main-loop output tokens | 617 | 1,338 |
| tokens on the orchestrator session | 96,253 | 246,487 |
| tokens across every process in the arm | 356,686 | 246,487 |
| orchestrator cost | $0.2389 | $0.3315 |
| total cost | $0.4573 | $0.3315 |
| wall time | 78.8 s | 63.3 s |
| verdict, `npm test` | SHIP, passes | SHIP, passes |

The orchestrator session was smaller in A, but the total across processes and the total cost were higher. The `claude -p` coder in A loaded everything the account has: 30 tools, 31 skills and 2 MCP servers.

### What changed for v2

Lean mode starts the coder with `--strict-mcp-config --disable-slash-commands --no-chrome --tools <core tools>`. The coder then has 6 tools, 0 skills and 0 MCP servers, down from 30, 31 and 2. It can be turned off per coder with `"lean": false`.

### v2, lean coder

Results: `bench/results/20261026-0003/results.md`.

| metric | A (coder-room) | B (subagent) |
|---|---|---|
| orchestrator main-loop output tokens | 505 | 1,433 |
| tokens on the orchestrator session | 97,494 | 240,140 |
| tokens across every process in the arm | 216,848 | 240,140 |
| orchestrator cost | $0.1523 | $0.3054 |
| total cost | $0.2832 | $0.3054 |
| wall time | 70.1 s | 82.3 s |
| verdict, `npm test` | SHIP, passes | SHIP, passes |

With the lean coder, total tokens across all processes in A were below B, and total cost was $0.2832 against $0.3054.

## Caveats

- Each run is one small task, one run per configuration (n=1 each). The differences are not repeated measurements.
- Both arms ran on one account in the bench. In real use the coder can run on another account or on Codex, so its tokens would not touch the orchestrator session at all. The bench counts them in A's total.
- The orchestrator was Opus and the coder was Sonnet. Other pairings were not run.
- Costs are Claude Code's client-side estimates, not billing data.

## Not measured yet

- Larger tasks. Both runs used one small task.
- Codex coders.
- Repeated runs of the same configuration, so there is no estimate of run-to-run spread.
