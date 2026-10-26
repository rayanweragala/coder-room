import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.js';

function sseClient(port) {
  const events = [];
  const waiters = [];
  let req;
  const ready = new Promise((resolve) => {
    req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!ev) continue;
          const msg = { event: ev, data: JSON.parse(data) };
          events.push(msg);
          for (const w of waiters) w(msg);
        }
      });
      resolve();
    });
  });
  const waitFor = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const hit = events.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => reject(new Error('timeout waiting for event')), ms);
    waiters.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m); } });
  });
  return { ready, waitFor, close: () => req.destroy() };
}

const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

const getH = (port, p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});

const hhmm = () => new Date().toTimeString().slice(0, 5);

for (const runsName of ['.rounds', '.codex-runs']) test(`live (${runsName}): started + exec gate -> running a gate, finished -> done`, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-int-'));
  const root = path.join(tmp, 'proj');
  const runs = path.join(root, runsName);
  const claude = path.join(tmp, 'claude');
  fs.mkdirSync(runs, { recursive: true });
  fs.mkdirSync(claude);
  const chain = path.join(runs, 'chain.log');
  fs.writeFileSync(chain, 'free text line\n');
  fs.writeFileSync(path.join(runs, 'q99.log'), '');

  const srv = await startServer({ port: 0, roots: [root], claudeProjects: claude });
  const sse = sseClient(srv.port);
  try {
    await sse.ready;
    const snap = await sse.waitFor((m) => m.event === 'snapshot');
    assert.deepEqual(snap.data.tiles, []);
    assert.deepEqual(snap.data.projects.map((p) => p.name), ['proj']);
    assert.deepEqual(snap.data.projects.map((p) => p.runsDir), [runsName]);

    fs.appendFileSync(chain, `coder q99 started ${hhmm()} on codex gpt-6-luna\n`);
    fs.appendFileSync(path.join(runs, 'q99.log'),
      `exec\n/bin/bash -lc 'npm test' in ${root}\n succeeded in 5ms:\n`);
    const gate = await sse.waitFor((m) => m.event === 'tile' && m.data.id === 'luna@proj' && m.data.status === 'running a gate');
    assert.equal(gate.data.round, 'q99');
    assert.equal(gate.data.project, 'proj');
    assert.equal(gate.data.current, 'npm test');

    fs.appendFileSync(chain, `coder q99 finished ${hhmm()} rc=0 on codex gpt-6-luna\n`);
    const done = await sse.waitFor((m) => m.event === 'tile' && m.data.id === 'luna@proj' && m.data.status === 'done');
    assert.equal(done.data.rc, 0);

    const api = JSON.parse((await get(srv.port, '/api/state')).body);
    assert.deepEqual(api.tiles.map((t) => t.id), ['luna@proj']);
    assert.deepEqual(api.projects.map((p) => p.name), ['proj']);
  } finally {
    sse.close();
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('static files send no-cache + ETag and answer 304 on a match', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-cache-'));
  const srv = await startServer({ port: 0, roots: [tmp], claudeProjects: tmp });
  try {
    for (const p of ['/', '/app.js']) {
      const first = await getH(srv.port, p);
      assert.equal(first.status, 200);
      assert.equal(first.headers['cache-control'], 'no-cache');
      const etag = first.headers.etag;
      assert.ok(etag);
      const again = await getH(srv.port, p, { 'if-none-match': etag });
      assert.equal(again.status, 304);
      assert.equal(again.body, '');
      assert.equal(again.headers['cache-control'], 'no-cache');
      assert.equal((await getH(srv.port, p, { 'if-none-match': '"other"' })).status, 200);
    }
  } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('static files are served and traversal is rejected', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-static-'));
  const srv = await startServer({ port: 0, roots: [tmp], claudeProjects: tmp });
  try {
    const index = await get(srv.port, '/');
    assert.equal(index.status, 200);
    assert.match(index.body, /coder room/);
    assert.equal((await get(srv.port, '/app.js')).status, 200);
    assert.equal((await get(srv.port, '/..%2fpackage.json')).status, 403);
    assert.notEqual((await get(srv.port, '/%2e%2e/server.js')).status, 200);
    assert.notEqual((await get(srv.port, '/../server.js')).status, 200);
    assert.equal((await get(srv.port, '/nope.txt')).status, 404);
  } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
