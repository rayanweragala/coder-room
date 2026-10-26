---
name: run-round
description: Launch a round with a separate coder process, watch it, and read the result.
argument-hint: <round> [coder]
disable-model-invocation: true
---

Run round `$ARGUMENTS` (first word = round, optional second word = coder name from `.rounds/config.json`).

1. Check `.rounds/<round>.md` exists and the user approved it. Run `coder-room status` to see which coders are
   available and whether another round is still running (one heavy job at a time).
2. Launch: `coder-room run <round> --detach` (add `--coder <name>` when given). It prints the coder's PID and the log
   path. Tell the user in one line that the coder started and where the log is.
3. Wait once, not in a loop: a single background command that exits when that PID exits, then read the last lines of
   `.rounds/chain.log`. Do not code in this session while waiting.
4. Report the outcome in one line: `finished rc=0`, `LIMIT` (the coder was limited and the run fell back or stopped),
   or `REFUSED` (dirty tree). If every coder is limited, tell the user when each frees up and wait for their choice.
5. On `finished`, continue with `/coder-room:review-round <round>`.
