import { listRounds, roundDetails, ROUND_ID } from './history.js';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function reply(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

/**
 * GET /api/rounds?project=<name> and /api/round?project=<name>&round=<id>. The project must be one the room
 * watches (its paths come from there, never from the request); the round id must match ROUND_ID.
 * @returns {Promise<boolean>} true when the path was one of these endpoints
 */
export async function serveHistory(room, url, res) {
  if (url.pathname !== '/api/rounds' && url.pathname !== '/api/round') return false;
  const name = url.searchParams.get('project') ?? '';
  const project = room.projects.find((p) => p.name === name);
  if (!project) { reply(res, 404, { error: 'unknown project' }); return true; }
  if (url.pathname === '/api/rounds') {
    reply(res, 200, { project: project.name, rounds: await listRounds(project) });
    return true;
  }
  const round = url.searchParams.get('round') ?? '';
  if (!ROUND_ID.test(round)) { reply(res, 400, { error: 'bad round id' }); return true; }
  const att = url.searchParams.get('attempt');
  const details = await roundDetails(project, round, Date.now(), att !== null && /^\d{1,3}$/.test(att) ? Number(att) : null);
  if (!details) reply(res, 404, { error: 'unknown round' });
  else reply(res, 200, details);
  return true;
}
