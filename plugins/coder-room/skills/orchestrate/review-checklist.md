# Review checklist

Review a finished round in this order. Stop reading the diff once you have what you need to decide.

1. Report. Read `.rounds/<round>-report.md`. Does it list every item from the spec as met, with gate output?
   A missing report means the coder crashed or was limited: check `coder-room status` and the end of the log.
2. Scope. `git status` and `git diff --stat`. Files outside the spec's scope, or changes to files the spec put out
   of scope, are findings.
3. Risky part. Pick the part most likely to be wrong (new parsing, concurrency, anything touching files or
   processes, anything user-facing) and read that diff closely. Skip the rest unless the report is vague.
4. One targeted check. Run the one test or command that proves the risky part, not the whole suite. Full suites
   only at milestones or before a deploy.
5. Rules. Check the project's hard rules (AGENTS.md / CLAUDE.md) against the diff, for example forbidden APIs.
6. Verdict.
   - SHIP: update BACKLOG.md and HANDOFF.md, tell the user in one line. Commit only if the user asked.
   - FIX: write `.rounds/<round>b.md` with the findings ranked most severe first, each with file, what is wrong,
     and the done-criterion; then run it with `coder-room run <round>b --detach`.
