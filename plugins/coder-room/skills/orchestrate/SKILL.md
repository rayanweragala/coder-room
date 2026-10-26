---
name: orchestrate
description: Orchestrate a project in coding rounds. This session plans, writes round specs, reviews, verifies and keeps the handoff; the coding itself goes to separate coder processes launched with `coder-room run`, not to in-session subagents.
when_to_use: Use when the user wants to plan or build a feature with coders, start a round, continue the project, review a coder's report, or resume from a handoff; and whenever the project has a `.rounds/` folder (or a legacy `.codex-runs/` folder).
---

# Orchestrate coder rounds

Work in rounds. A round is one spec file, one coder run, one report and one review. The project state lives in files
under `.rounds/`, so any fresh session can continue.

## Roles
This session is the orchestrator. It plans, writes round specs, reviews, verifies, keeps the handoff, and commits only
when the user asks. It does not write the feature code.

Coders are separate processes, started with `coder-room run`, each with its own log in `.rounds/`. Subagents are the
wrong tool for the coding:
- They count toward the same usage limits and context budget as this conversation.
- They stop when this session ends and leave no log on disk.
- A separate coder can use another account or tool (Codex, a second Claude login) or a cheaper model, keeps running
  if this session ends, and can be watched live in the room.

Subagents are fine for read-only lookups (searching the codebase, reading docs).

## Session start
Before planning anything, read `.rounds/HANDOFF.md` (or `.codex-runs/HANDOFF.md` in a legacy project) and the backlog
it points to (`.rounds/BACKLOG.md`). If neither exists, offer to run `coder-room init` and then fill in the handoff.
Check `coder-room status` for rounds that are still running or coders marked as limited.

## Round loop
1. Spec: write `.rounds/<round>.md` from `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/spec-template.md`: goal, user
   decisions, items each with a done-criterion, tests, gates, what the report must contain, out of scope. Show it to
   the user and wait for an OK before running anything that adds a feature.
2. Run: `coder-room run <round> --detach`. Tell the user in one line that the coder started and where the log is.
   Then wait once, without polling in a loop: use a single background wait that exits when the coder process exits
   (for example a shell loop that waits on the PID printed by `--detach`).
3. Review: follow `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/review-checklist.md`. Read `.rounds/<round>-report.md`,
   spot-check the risky part of the diff, run one targeted check. Run full test suites only at milestones.
4. Decide: on SHIP, update BACKLOG.md and HANDOFF.md. On FIX, write `.rounds/<round>b.md` with the findings ranked
   most severe first, and run it the same way.
5. Commit only when the user asks.

## Verification budget
The coder runs the round's gates and reports their output. The orchestrator reads the report, spot-checks the risky
part of the diff and runs one targeted check. Run the full suite only at a milestone or before a deploy.

## Machine limits
Unless the project says otherwise, run one heavy job at a time (a build, a full test suite, a running backend, a coder
that is building). Prefer targeted tests while working. If the project's AGENTS.md sets limits (RAM, workers), follow
them and put them in the spec so the coder follows them too.

## Messages
Send the user one short line when a long step starts (a coder round, a build, a long scan) and one when a decision or
result is ready. Detailed progress lives in `.rounds/chain.log` and the round logs, not in chat.

## Fallback
`coder-room run` picks the first enabled coder that is installed and not limited, and falls back to the next on a
limit. If every coder is limited, `coder-room status` shows when each was marked (a mark lasts one hour). Tell the
user which coders are limited and when they free up, then wait for their choice. Do not start coding in this session
as a workaround.

## The room
`coder-room serve` starts the read-only live view at http://127.0.0.1:4317, where the user can watch rounds as they
run. Mention it once and leave starting it to the user.

## Handoff
Update `.rounds/HANDOFF.md` at every milestone and before the session ends, from
`${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/handoff-template.md`: done, in progress, next step, open decisions, how to
resume. Write it for a fresh session with no conversation history: the user may start one per milestone to save
tokens, and the handoff is all it has.

## Related commands
`/coder-room:new-round <round> <topic>`, `/coder-room:run-round <round> [coder]`, `/coder-room:review-round <round>`,
`/coder-room:handoff`.
