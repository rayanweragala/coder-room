# Changelog

## 0.2.0

- Live read-only room for coder rounds: lobby, project rooms, one tile per coder and for the orchestrator, full screen view, details drawer and live thoughts.
- Round history and replay, and a token meter with per-round usage and cost.
- `coder-room` CLI with `init`, `run`, `serve`, `status` and `tokens`. `run` starts a coder as a separate process and falls back to the next coder when one is limited.
- The `.rounds/` folder for specs, logs, reports, handoff and backlog.
- Claude Code plugin with skills for new rounds, running, reviewing and handoff.
- Lean coder mode: Claude coders start without MCP servers, skills or extra tools.
- Token A/B bench in `bench/`.
- Demo room: `coder-room serve --demo`.
- Generic character identities for coders.
- Release metadata.
