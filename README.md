# coder-room

Run coding rounds with a separate coder process while your Claude Code session plans and reviews, and watch the whole thing in a live local room.

https://github.com/user-attachments/assets/a5424e22-a4a2-48e2-83db-c20e8191648f

## What it does

One Claude Code session is the orchestrator. It writes a spec for each round, starts a coder, reviews the result and keeps the handoff file up to date. The coder (Claude Code in print mode, or Codex) runs as its own process with its own log, so its work does not go through the orchestrator's conversation.

The room is a local web page that shows this live. It reads the files the run already writes and never touches them. You see:

- a lobby with one card per project and a room per project
- one tile per coder and one for the orchestrator, each with a character, a status, the current file or command and a log tail
- live thoughts from the coder, with a filter
- a full screen view of one agent with a details drawer
- round history, and a replay of a finished round
- a token meter with per-round usage and cost

## Why separate coder processes

- In-session subagents count toward the same usage limits as the main conversation (Claude Code docs, sub-agents page). A separate process can use another account or another tool.
- In Claude Code's result data, `modelUsage` and `total_cost_usd` include subagents, while `usage` covers the main loop only (cost-tracking page). A subagent's tokens are therefore easy to miss when you look at one number.
- Each coder has its own log file, so you can follow it, replay it and measure it per round.

### Token comparison

`bench/ab.js` gives one small task (two functions with a spec and tests) to two arms. In both, an Opus orchestrator plans, reviews the diff and runs `npm test`. In **A** a Sonnet coder runs as a separate process through coder-room. In **B** the orchestrator uses an in-session subagent instead.

With the lean coder (v2):

| | A: coder-room | B: subagent |
|---|---|---|
| tokens on the orchestrator session | **97,494** | 240,140 |
| orchestrator main-loop output tokens | **505** | 1,433 |
| tokens across every process | **216,848** | 240,140 |
| orchestrator cost | **$0.15** | $0.31 |
| total cost | **$0.28** | $0.31 |
| wall time | **70 s** | 82 s |
| result | tests pass | tests pass |

The orchestrator session used about 60% fewer tokens with coder-room. That is the session that holds your plan and the handoff, so it fills up and hits its limits later.

With the coder's full account setup (v1, before lean mode), the orchestrator session was still smaller (96k against 246k), but the coder loaded 30 tools, 31 skills and 2 MCP servers, so the total cost was higher: $0.46 against $0.33.

These are single runs of one small task on one account. In real use the coder can run on another account or on Codex, so its tokens do not count against the orchestrator's account at all. [docs/why.md](docs/why.md) has the full numbers and caveats.

## Requirements

- Node 20 or newer
- Claude Code
- Codex CLI, optional, as a second kind of coder
- Linux or macOS. It was tested on Linux only.

## Install

As a Claude Code plugin:

```
/plugin marketplace add rayanweragala/coder-room
/plugin install coder-room@coder-room
```

The shell equivalents:

```
claude plugin marketplace add rayanweragala/coder-room
claude plugin install coder-room@coder-room --scope user
```

The plugin adds the skills `/coder-room:new-round`, `/coder-room:run-round`, `/coder-room:review-round`, `/coder-room:handoff` and `orchestrate`, plus a `coder-room` command on the Bash tool's PATH.

To try the plugin from a checkout without installing it, run `claude --plugin-dir ./plugins/coder-room`.

As a command line tool:

```
npm i -g coder-room
```

## Quick start

1. In your project, run `coder-room init`. It creates `.rounds/` and asks before adding it to `.gitignore`.
2. Edit `.rounds/config.json` to enable the coders you want.
3. Ask Claude to start a round, or run `/coder-room:new-round <round> <topic>`. Claude writes `.rounds/<round>.md`, you approve it, and the round is started with `coder-room run <round>`.
4. Run `coder-room serve` and open http://127.0.0.1:4317.

To try the room without any agents, run `coder-room serve --demo`. It builds a synthetic workspace in a temp directory, plays a 10 minute story in it and removes it on exit: an orchestrator and three coders add discount codes to a shop, with two rounds in parallel, a failing gate, a usage limit with a fallback coder, and a review. Add `--fast` to play it three times faster.

## Commands

| command | main flags |
|---|---|
| `coder-room init` | `--yes` adds `.rounds/` to `.gitignore` without asking, `--dir <project>` |
| `coder-room run <round>` | `--coder <name>`, `--no-fallback`, `--extra "<text>"`, `--detach` |
| `coder-room serve` | `--port 4317`, `--root <dir>` (repeatable), `--claude-projects <dir>` (repeatable; default `~/.claude/projects` plus every `~/.claude*/projects`), `--user-name <name>`, `--open`, `--demo`, `--out <dir>` |
| `coder-room status` | `--dir <project>` |
| `coder-room tokens` | `--round <r>`, `--json`, `--dir <project>` |

`run` exits with 0 on success, 1 when the coder failed or was limited and there is no fallback, 2 on a usage error and 3 when it refused to start because of a dirty tree. `coder-room <command> --help` has the details.

## Configuration

`.rounds/config.json` has these keys:

| key | meaning |
|---|---|
| `coders` | list of coders. Claude coders have `name`, `kind: "claude"`, `model`, `enabled`, `configDir`, `tools`, `lean`, `coreTools`. Codex coders have `kind: "codex"`, `model`, `enabled`, `sandbox`, `writableRoots`. |
| `order` | coder names in the order `run` tries them when `--coder` is not given |
| `lean` | per Claude coder, on unless set to `false` (see below) |
| `coreTools` | per Claude coder, the built-in tools a lean coder gets. Default: Read, Edit, Write, Glob, Grep, Bash, TodoWrite |
| `configDir` | per Claude coder, used as `CLAUDE_CONFIG_DIR`, so the coder can run on another account. `null` uses the default login |
| `limitPatterns` | text per coder kind that marks a log as rate-limited |
| `requireCleanTree` | when `true`, `run` refuses to start on a dirty git tree |
| `prompt` | replaces the default coder prompt when set |

Fallback: without `--coder`, `run` uses the first enabled coder in `order` that is on PATH and not limited. When a coder's log matches a limit pattern, that coder is marked limited for one hour and the run continues with the next coder. `--no-fallback` stops instead.

Lean mode starts a Claude coder with `--strict-mcp-config --disable-slash-commands --no-chrome --tools <coreTools>`, so it loads no MCP servers, skills or extra tools. Set `"lean": false` on a coder to turn it off.

## The .rounds folder

- `chain.log`: one line per coder event, read by the room
- `<round>.md`: the round spec
- `<round>.log`: the coder's output for that round. A rerun moves the old log to `<round>-prev-<time>.log`
- `<round>-report.md`: the coder's report
- `HANDOFF.md`: where the project stands and how to resume
- `BACKLOG.md`: what comes next
- `spec-template.md`, `config.json`, `coder-tools.txt`: templates and settings

## Safety and privacy

- The room server is read-only. It binds 127.0.0.1 and reads only the tails of log files.
- `run` and `init` are the only commands that write, and they write inside `.rounds/`, plus the `.gitignore` line that `init` asks about first.
- The room shows your orchestrator session's messages. Anyone who can open the port on your machine can read them.

## Keyboard shortcuts

| key | action |
|---|---|
| `1` to `9` | open the Nth agent of the room |
| `[` `]` | previous or next project room |
| `F` | browser full screen |
| `D` | details drawer |
| `C` | chat overlay |
| `P` | pin or follow |
| `/` | filter the live thoughts |
| `H` | round history |
| `↑` `↓` `Enter` | move through and open a round in the history |
| `[` `]` | in a replay, previous or next round |
| `?` | the shortcut list |
| `Esc` | close the drawer, then the list, then full screen |

## Development

```
npm test
```

runs `node --test --test-concurrency=1`.

- `bin/` the CLI entry
- `src/` server modules and `src/cli/` commands
- `public/` the page, plain files with no build step
- `demo/` the synthetic demo workspace
- `plugins/coder-room/` the Claude Code plugin, `.claude-plugin/marketplace.json` its marketplace
- `bench/` the A/B bench. `node bench/ab.js --dry` prepares the arms without calling `claude`
- `test/` tests and synthetic fixtures
