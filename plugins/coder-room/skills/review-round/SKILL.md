---
name: review-round
description: Review a finished round from its report and diff, then decide SHIP or FIX.
argument-hint: <round>
disable-model-invocation: true
---

Review round `$ARGUMENTS` using `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/review-checklist.md`.

1. Read `.rounds/<round>-report.md` and the spec `.rounds/<round>.md`. No report: look at the end of
   `.rounds/<round>.log` and `coder-room status` to see whether the coder crashed or was limited.
2. Run `git status` and `git diff --stat`, spot-check the risky part of the diff, and run one targeted check.
3. Decide:
   - SHIP: update `.rounds/BACKLOG.md` and `.rounds/HANDOFF.md`, and tell the user in one line. Commit only if the
     user asked.
   - FIX: write `.rounds/<round>b.md` from the spec template with the findings ranked most severe first, show it
     to the user, and run it with `/coder-room:run-round <round>b`.
4. End with the verdict and the reason in two lines at most.
