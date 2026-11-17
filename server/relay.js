// VANTA PROTOCOL multiplayer relay.
// Mirrors the semantics the game uses from the claude.ai `room` capability:
//   - a lobby ("") plus any number of named rooms a client can join/leave
//   - each client has one presence object per room (merged patches, latest value wins)
//   - everyone in a room receives everyone's presence; leavers are announced
// The server holds no game logic: one player in each match acts as host (see js/mp/session.js).
//
//   PORT=8080 node relay.js                 # relay only
//   PORT=8080 STATIC=.. node relay.js       # also serve the game files (local testing)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const STATIC = process.env.STATIC ? path.resolve(__dirname, process.env.STATIC) : null;
const MAX_MSG = 8 * 1024;         // bytes per incoming message
const MAX_PRESENCE = 6 * 1024;    // bytes per merged presence object
const MAX_ROOMS_PER_CLIENT = 8;
const RATE = 60;                  // messages per second per client (burst 120)
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, clients: clients.size, rooms: rooms.size })); return; }
  if (!STATIC) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('VANTA PROTOCOL relay'); return; }
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(STATIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(STATIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });
const clients = new Map();   // ws -> client
const rooms = new Map();     // name -> Map(id -> client)
let nextId = 1;

const randId = () => Math.random().toString(36).slice(2, 8) + (nextId++).toString(36);
const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const roomOf = (name) => { let r = rooms.get(name); if (!r) { r = new Map(); rooms.set(name, r); } return r; };

function broadcast(name, msg, except) {
  const r = rooms.get(name); if (!r) return;
  const s = JSON.stringify(msg);
  for (const c of r.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s);
}
function joinRoom(c, name) {
  if (c.rooms.has(name)) { sendSnapshot(c, name); return; }
  if (c.rooms.size >= MAX_ROOMS_PER_CLIENT) { send(c, { t: 'err', r: name, code: 'limit_reached' }); return; }
  const r = roomOf(name); c.rooms.set(name, {}); r.set(c.id, c);
  sendSnapshot(c, name);
  broadcast(name, { t: 'joined', r: name, id: c.id, p: {} }, c);
}
function sendSnapshot(c, name) {
  const r = rooms.get(name); const peers = [];
  for (const o of r.values()) peers.push({ id: o.id, p: o.rooms.get(name) || {} });
  send(c, { t: 'peers', r: name, peers });
}
function leaveRoom(c, name) {
  if (!c.rooms.has(name)) return;
  c.rooms.delete(name); const r = rooms.get(name);
  if (r) { r.delete(c.id); if (!r.size) rooms.delete(name); else broadcast(name, { t: 'left', r: name, id: c.id }); }
}

wss.on('connection', (ws) => {
  const c = { ws, id: randId(), rooms: new Map(), tokens: RATE * 2, last: Date.now(), alive: true };
  clients.set(ws, c);
  send(c, { t: 'welcome', id: c.id });
  joinRoom(c, '');
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (raw) => {
    const now = Date.now(); c.tokens = Math.min(RATE * 2, c.tokens + (now - c.last) / 1000 * RATE); c.last = now;
    if (c.tokens < 1) return; c.tokens -= 1;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const name = typeof m.r === 'string' ? m.r : '';
    if (name && !NAME_RE.test(name)) { send(c, { t: 'err', r: name, code: 'invalid_argument' }); return; }
    if (m.t === 'join') joinRoom(c, name);
    else if (m.t === 'leave' && name) leaveRoom(c, name);
    else if (m.t === 'p') {
      const cur = c.rooms.get(name); if (!cur || !m.d || typeof m.d !== 'object' || Array.isArray(m.d)) return;
      const next = { ...cur };
      for (const k of Object.keys(m.d)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (m.d[k] === null) delete next[k]; else next[k] = m.d[k]; }
      if (JSON.stringify(next).length > MAX_PRESENCE) { send(c, { t: 'err', r: name, code: 'invalid_argument' }); return; }
      c.rooms.set(name, next);
      broadcast(name, { t: 'pp', r: name, id: c.id, p: next }, c);
    }
  });
  ws.on('close', () => { for (const name of [...c.rooms.keys()]) leaveRoom(c, name); clients.delete(ws); });
  ws.on('error', () => { });
});

// drop dead connections
setInterval(() => { for (const c of clients.values()) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch (e) { } } }, 15000);

server.listen(PORT, () => console.log(`[relay] listening on :${PORT}${STATIC ? ' (serving ' + STATIC + ')' : ''}`));
