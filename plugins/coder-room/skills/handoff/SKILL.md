---
name: handoff
description: Update .rounds/HANDOFF.md so a fresh session with no history can continue the project.
disable-model-invocation: true
---

Update `.rounds/HANDOFF.md` (create it from `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/handoff-template.md` if missing).

1. Read the current handoff, `.rounds/BACKLOG.md`, the last lines of `.rounds/chain.log`, and `git status`.
2. Rewrite the sections: what this is; state (done, in progress, including any round still running and its log);
   the single next step; open decisions that need the user; how to resume (commands, files to read first).
3. Update `.rounds/BACKLOG.md` so statuses match.
4. Write for a reader with no conversation history. Do not paste logs; point to files. Tell the user the file is
   updated in one line.
