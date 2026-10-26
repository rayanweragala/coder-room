---
name: new-round
description: Write a new round spec, .rounds/<round>.md, from the coder-room template.
argument-hint: <round> <topic>
disable-model-invocation: true
---

Create the round spec for `$ARGUMENTS` (first word = round name such as `r03`, the rest = topic).

1. Read `.rounds/HANDOFF.md` and `.rounds/BACKLOG.md` if they exist, and the project's AGENTS.md or CLAUDE.md.
2. If `.rounds/<round>.md` already exists, stop and tell the user; never overwrite a spec.
3. Copy `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/spec-template.md` to `.rounds/<round>.md` and fill every section:
   goal, decisions the user already made, items each with a "Done when" criterion, tests, gates (the exact commands),
   the report contents, and what is out of scope. Keep items small enough for one coder run.
4. Show the user the spec and wait for an OK before the round is run.
