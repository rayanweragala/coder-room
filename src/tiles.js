import { bestModel } from '../public/model.js';

export const SHOWN_EVENTS = 80;
export const ORCH_COLOR = '#14b8a6';

function checklistOf(facts, docs) {
  const todos = facts?.checklist() ?? [];
  if (todos.length || !docs.spec) return todos;
  return docs.spec.items.map((text) => ({ text, status: docs.report ? 'done' : 'todo' }));
}

/** 'spec' when the checklist is only the spec's headings (no TodoWrite data and no report), so it has no progress. */
const checklistMode = (facts, docs) => ((facts?.checklist() ?? []).length || !docs.spec || docs.report ? null : 'spec');

function derived(facts, docs) {
  return {
    seq: facts?.seq ?? 0, usage: facts?.usage() ?? null, caption: facts?.caption ?? null, checklist: checklistOf(facts, docs),
    checklistMode: checklistMode(facts, docs),
    files: facts?.filesList() ?? [], gates: facts?.gatesList() ?? [],
    goal: docs.spec ? { title: docs.spec.title, summary: docs.spec.goal } : null,
    reportHead: docs.report, events: (facts?.events ?? []).slice(-SHOWN_EVENTS),
  };
}

const NO_DOCS = { spec: null, report: null };

/** `docs` is the round's parsed spec and report ({spec, report}, either may be null). */
export function coderTile(r, follower, docs, { status, quiet }) {
  return {
    id: r.id ?? r.slot, slot: r.slot, kind: 'coder', name: r.name, model: bestModel(follower?.facts?.model, r.model), color: r.color, char: r.char ?? null, look: r.look ?? null, status, quiet,
    project: r.project, round: r.round, role: r.role, rc: r.rc, reason: r.reason,
    startedAt: r.startedAt, endedAt: r.endedAt, current: follower?.current ?? null, lastActivity: follower?.grewAt || null,
    ...derived(follower?.facts, docs),
  };
}

/** `goal` is the project's handoff goal ({goal, toward}) or null. */
export function orchestratorTile(orch, state, goal = null) {
  const { status, label = null, watching = null } = typeof state === 'string' ? { status: state } : state;
  return {
    id: orch?.project ? `orchestrator@${orch.project}` : 'orchestrator', slot: 'orchestrator', kind: 'orchestrator', char: 'orchestrator', look: 'orchestrator', name: 'Orchestrator', model: orch?.follower.facts.model ?? null, color: ORCH_COLOR, status, label, watching, quiet: null,
    project: orch?.project ?? null, round: null, role: null, rc: null, reason: null,
    startedAt: null, endedAt: null, current: orch?.follower.current ?? null,
    lastActivity: orch?.follower.grewAt || null,
    ...derived(orch?.follower.facts, NO_DOCS),
    goal: goal?.goal ? { title: 'Project goal', summary: goal.goal, toward: goal.toward || null } : null,
  };
}
