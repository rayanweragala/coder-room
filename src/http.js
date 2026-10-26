import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { serveHistory } from './history-api.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const MIN_GAP_MS = 250;
const PING_MS = 15_000;

/** Read-only HTTP server: static files, /api/state and the /events SSE stream. */
export function createHttpServer(room, publicDir) {
  const root = path.resolve(publicDir);
  const clients = new Set();
  const lastSent = new Map();
  const pending = new Map();
  const timers = new Map();

  const send = (event, payload) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(frame);
  };

  const flush = (id) => {
    timers.delete(id);
    const tile = pending.get(id);
    pending.delete(id);
    if (!tile) return;
    lastSent.set(id, Date.now());
    send('tile', tile);
  };

  const offTile = room.on('tile', (tile) => {
    pending.set(tile.id, tile);
    if (timers.has(tile.id)) return;
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - (lastSent.get(tile.id) ?? 0)));
    timers.set(tile.id, setTimeout(() => flush(tile.id), wait));
  });
  const offRemove = room.on('remove', (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    pending.delete(id);
    lastSent.delete(id);
    send('remove', { id });
  });
  const offChat = room.on('chat', (chat) => send('chat', chat));
  const offHandoff = room.on('handoff', (h) => send('handoff', h));
  const ping = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, PING_MS);

  async function serveStatic(urlPath, req, res) {
    const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await fs.readFile(file);
      const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
      const headers = { 'cache-control': 'no-cache', etag };
      const sent = (req.headers['if-none-match'] ?? '').split(',').map((s) => s.trim().replace(/^W\//, ''));
      if (sent.includes(etag) || sent.includes('*')) {
        res.writeHead(304, headers).end();
        return;
      }
      res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end('read-only');
      return;
    }
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://x');
      pathname = url.pathname;
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    try {
      if (pathname === '/api/state') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(room.snapshotJson());
      } else if (pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive',
        });
        res.write(`event: snapshot\ndata: ${room.snapshotJson()}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
      } else if (!(await serveHistory(room, url, res))) {
        await serveStatic(pathname, req, res);
      }
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });

  server.close_ = () => {
    clearInterval(ping);
    offTile();
    offRemove();
    offChat();
    offHandoff();
    for (const t of timers.values()) clearTimeout(t);
    for (const res of clients) res.end();
    clients.clear();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
  return server;
}
