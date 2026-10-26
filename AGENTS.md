# coder-room

A local, read-only "video call" view of your coder rounds: one tile per coder (named after the coder in the chain
line, as a Codex-style or Claude-style character) plus the orchestrator session. Each tile shows live status, the
current file or command, and a log tail.
It reads the files the run scripts already write (`<project>/.rounds/chain.log`, `<project>/.rounds/<round>.log`; the legacy `.codex-runs/` folder is still read)
and the orchestrator's Claude Code transcript (`~/.claude/projects/<encoded path>/<session>.jsonl`).

## Hard rules
- Read-only. Never start, stop, signal or write to a coder process or any watched file. No `child_process`,
  no `process.kill`, no fs write calls in `src/` or `public/`. The only network listener binds `127.0.0.1`.
- Light. Node 24 built-ins only (no npm dependencies unless the round file allows one). No build step:
  the browser loads plain files from `public/`. Read only the tail of each log and then follow it by offset;
  never load a whole log (real logs reach 100k+ lines). The server stays under 100 MB RSS in the live check.
- 7 GB RAM laptop. One heavy command at a time. Stop every server you start before you finish.

## Layout
- `src/` server modules (ES modules, `.js`, JSDoc types where they help).
- `public/` static page (`index.html`, `app.js`, `style.css`).
- `demo/` synthetic demo workspace (`make-demo.js`) and its log appender (`appender.js`). The appender writes only
  inside the demo dir and is started by `coder-room serve --demo`, never by the server.
- `test/` `node --test` tests. Fixtures under `test/fixtures/` are synthetic, never copied from real logs.
- `server.js` entry point: `node server.js [--port N] [--root DIR ...]`.

## Style
Small files (under ~250 lines), clear names, few comments. Plain DOM in the browser, no framework.
Prose, comments and UI text are plain and specific: no dashes as connectors, no filler, no staged contrasts.
