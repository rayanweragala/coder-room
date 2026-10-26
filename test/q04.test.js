import test from 'node:test';
import assert from 'node:assert/strict';
import { initAcks, handsFor, acknowledge, handKey } from '../public/hands.js';

const coder = (o = {}) => ({
  id: 'luna', kind: 'coder', name: 'Luna', status: 'thinking', round: 'q04', rc: null, reason: null,
  startedAt: 1000, endedAt: null, goal: { title: 'q04 — Raised hands' }, reportHead: null, ...o,
});
const orch = (o = {}) => ({ id: 'orchestrator', kind: 'orchestrator', name: 'Orchestrator', status: 'thinking', lastActivity: 5000, ...o });

const NOW = 10_000_000;
const ended = (o = {}) => coder({ status: 'done', rc: 0, endedAt: NOW - 60_000, ...o });

test('hands: raised for done/limit/refused, Orchestrator waiting; oldest first', () => {
  const acks = initAcks(null, NOW);
  const tiles = [
    ended({ id: 'sol', endedAt: NOW - 30_000 }), ended({ id: 'luna' }),
    coder({ id: 'x', status: 'refused', endedAt: NOW - 120_000 }), coder({ id: 'y', status: 'editing' }),
    orch({ status: 'waiting for you', lastActivity: NOW - 200_000 }), orch({ id: 'o2', kind: 'coder', status: 'thinking' }),
  ];
  assert.deepEqual(handsFor(tiles, acks, NOW).map((h) => h.id), ['orchestrator', 'x', 'luna', 'sol']);
});

test('hands: acknowledged stays down across reload; new round or state raises again', () => {
  let acks = initAcks(null, NOW);
  const t = ended();
  acks = acknowledge(acks, handKey(t), NOW);
  assert.equal(handsFor([t], acks, NOW).length, 0);
  const reloaded = initAcks(JSON.parse(JSON.stringify({ visit: NOW, keys: acks.keys })), NOW + 5000);
  assert.equal(handsFor([t], reloaded, NOW + 5000).length, 0);
  assert.equal(handsFor([ended({ round: 'q05', endedAt: NOW + 1000 })], reloaded, NOW + 5000).length, 1);
  assert.equal(handsFor([{ ...t, status: 'rate-limited' }], reloaded, NOW + 5000).length, 1);
});

test('hands: nothing older than 10 minutes on a first visit; newer than last visit is raised', () => {
  const first = initAcks(null, NOW);
  assert.equal(handsFor([ended({ endedAt: NOW - 11 * 60_000 })], first, NOW).length, 0);
  assert.equal(handsFor([ended({ endedAt: NOW - 9 * 60_000 })], first, NOW).length, 1);
  const back = initAcks({ visit: NOW - 3_600_000, keys: {} }, NOW);
  assert.equal(handsFor([ended({ endedAt: NOW - 30 * 60_000 })], back, NOW).length, 1);
  assert.equal(handsFor([ended({ endedAt: NOW - 5_000_000 })], back, NOW).length, 0);
});
