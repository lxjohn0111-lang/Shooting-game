// Network transport: one small interface over three backends.
//   RoomTransport  - the claude.ai artifact `room` capability (real-time presence between viewers)
//   WsTransport    - the bundled WebSocket relay (server/relay.js), used on CrazyGames or any web host
//   LocalTransport - offline: a room with only you in it (matches are filled with AI)
//
// Chan:  presence(patch)  peers() -> [{peer, isMe, presence, at}]  onPeers(fn) -> unsub  connected()  leave()
// Transport: kind, online, lobby (Chan), join(name) -> Promise<Chan>, me() -> peer id

const now = () => performance.now();

class Chan {
  constructor(name) { this.name = name; this.map = new Map(); this.listeners = new Set(); this.meId = null; this._snap = null; }
  peers() { if (!this._snap) this._snap = [...this.map.values()]; return this._snap; }
  onPeers(fn) { this.listeners.add(fn); queueMicrotask(() => { if (this.listeners.has(fn)) fn({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }); }); return () => this.listeners.delete(fn); }
  _emit(joined = [], left = [], updated = []) { this._snap = null; const peers = this.peers(); for (const fn of this.listeners) { try { fn({ peers, joined, left, updated }); } catch (e) { console.error(e); } } }
  _set(id, presence, isMe) {
    const had = this.map.get(id); const p = { peer: id, isMe: !!isMe, presence: Object.freeze({ ...(presence || {}) }), at: now() };
    this.map.set(id, p); if (had) this._emit([], [], [p]); else this._emit([p]);
  }
  _del(id) { const p = this.map.get(id); if (!p) return; this.map.delete(id); this._emit([], [p]); }
}

// ---------------------------------------------------------------- offline
class LocalChan extends Chan {
  constructor(name, id) { super(name); this.meId = id; this._set(id, {}, true); }
  presence(patch) { const cur = { ...(this.map.get(this.meId).presence) }; for (const k in patch) { if (patch[k] === null) delete cur[k]; else cur[k] = patch[k]; } this._set(this.meId, cur, true); return Promise.resolve(); }
  connected() { return true; }
  leave() { this.listeners.clear(); return Promise.resolve(); }
}
export class LocalTransport {
  constructor() { this.kind = 'local'; this.online = false; this.id = 'local-' + Math.random().toString(36).slice(2, 8); this.lobby = new LocalChan('', this.id); }
  me() { return this.id; }
  async join(name) { return new LocalChan(name, this.id); }
}

// ---------------------------------------------------------------- claude.ai room capability
class RoomChan {
  constructor(src, name, t) {
    this.src = src; this.name = name; this.t = t; this._snap = null; this._srcSnap = null;
    this.listeners = new Set();
    this._unsub = src.onPeers(() => { this._snap = null; const peers = this.peers(); for (const fn of this.listeners) { try { fn({ peers }); } catch (e) { console.error(e); } } }, () => { });
  }
  peers() {
    const raw = this.src.peers();
    if (raw !== this._srcSnap || !this._snap) {
      this._srcSnap = raw;
      // a viewer with two tabs is two players: only THIS tab counts as "me"
      this._snap = raw.filter((p) => p.kind !== 'agent').map((p) => ({ peer: p.peer, isMe: !!p.sameTab, presence: p.presence || {}, at: p.updatedAt || now() }));
      const me = this._snap.find((p) => p.isMe); if (me && this.t) this.t._me = me.peer;
    }
    return this._snap;
  }
  onPeers(fn) { this.listeners.add(fn); queueMicrotask(() => { if (this.listeners.has(fn)) fn({ peers: this.peers() }); }); return () => this.listeners.delete(fn); }
  presence(patch) { return this.src.presence(patch).catch(() => { }); }
  connected() { try { return this.src.connected(); } catch (e) { return false; } }
  leave() { this.listeners.clear(); try { this._unsub(); } catch (e) { } return this.src.leave ? this.src.leave().catch(() => { }) : Promise.resolve(); }
}
export class RoomTransport {
  constructor(room) { this.kind = 'room'; this.online = true; this.room = room; this._me = null; this.lobby = new RoomChan(room, '', this); }
  me() { if (!this._me) { const p = this.room.peers().find((x) => x.sameTab); if (p) this._me = p.peer; } return this._me; }
  async join(name) { const r = await this.room.join(name); return new RoomChan(r, name, this); }
}

// ---------------------------------------------------------------- WebSocket relay
class WsChan extends Chan {
  constructor(t, name) { super(name); this.t = t; this.mine = {}; }
  presence(patch) {
    for (const k in patch) { if (patch[k] === null) delete this.mine[k]; else this.mine[k] = patch[k]; }
    if (this.t.id) this._set(this.t.id, this.mine, true);
    this.t._send({ t: 'p', r: this.name, d: patch }); return Promise.resolve();
  }
  connected() { return this.t.open; }
  leave() { this.listeners.clear(); this.t.chans.delete(this.name); this.t._send({ t: 'leave', r: this.name }); return Promise.resolve(); }
}
export class WsTransport {
  constructor(url) { this.kind = 'ws'; this.online = true; this.url = url; this.chans = new Map(); this.open = false; this.id = null; this.lobby = new WsChan(this, ''); this.chans.set('', this.lobby); this._pending = new Map(); }
  me() { return this.id; }
  connect(timeout = 4000) {
    return new Promise((resolve, reject) => {
      let done = false; const fin = (ok, e) => { if (done) return; done = true; ok ? resolve(this) : reject(e); };
      setTimeout(() => { if (!done) { this.dead = true; try { this.ws.close(); } catch (e) { } } fin(false, new Error('timeout')); }, timeout);
      this._open(() => fin(true), (e) => fin(false, e));
    });
  }
  _open(onReady, onFail) {
    let ws; try { ws = new WebSocket(this.url); } catch (e) { onFail && onFail(e); return; }
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') {
        this.id = m.id; this.open = true;
        // (re)join rooms and restore presence after a reconnect
        for (const c of this.chans.values()) { c.map.clear(); if (c.name) this._send({ t: 'join', r: c.name }); if (Object.keys(c.mine).length) this._send({ t: 'p', r: c.name, d: c.mine }); }
        onReady && onReady(); onReady = null;
        return;
      }
      const c = this.chans.get(m.r || ''); if (!c) return;
      if (m.t === 'peers') {
        c.map.clear(); for (const p of m.peers) c.map.set(p.id, { peer: p.id, isMe: p.id === this.id, presence: Object.freeze(p.id === this.id ? { ...c.mine } : p.p), at: now() });
        c._emit(c.peers()); const pend = this._pending.get(c.name); if (pend) { this._pending.delete(c.name); pend(c); }
      } else if (m.t === 'joined') { if (m.id !== this.id) c._set(m.id, m.p, false); }
      else if (m.t === 'pp') { if (m.id !== this.id) c._set(m.id, m.p, false); }
      else if (m.t === 'left') c._del(m.id);
      else if (m.t === 'err') { const pend = this._pending.get(c.name); if (pend) { this._pending.delete(c.name); pend(null, m.code); } }
    };
    ws.onclose = () => { const was = this.open; this.open = false; if (onFail) { onFail(new Error('closed')); onFail = null; } if ((was || this._retrying) && !this.dead) { this._retrying = true; setTimeout(() => this._open(), 2000); } };
    ws.onerror = () => { };
  }
  _send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  join(name) {
    return new Promise((resolve, reject) => {
      let c = this.chans.get(name); if (!c) { c = new WsChan(this, name); this.chans.set(name, c); }
      const timer = setTimeout(() => { this._pending.delete(name); reject(new Error('upstream_error')); }, 8000);
      this._pending.set(name, (ch, err) => { clearTimeout(timer); if (ch) resolve(ch); else { this.chans.delete(name); reject(new Error(err || 'join failed')); } });
      this._send({ t: 'join', r: name });
    });
  }
}

// ---------------------------------------------------------------- pick the best available backend
export async function connectTransport(serverUrl) {
  // 1. claude.ai artifact room (only exists when the page runs inside the viewer)
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const room = await Promise.race([window.claude.use('room'), new Promise((r) => setTimeout(() => r(null), 6000))]);
      if (room) {
        const ok = await new Promise((res) => { let done = false; const fin = (v) => { if (!done) { done = true; res(v); } }; try { room.onConnection((c) => { if (c) fin(true); }, () => fin(false)); } catch (e) { fin(false); } setTimeout(() => fin(room.connected()), 5000); });
        if (ok) return new RoomTransport(room);
      }
    }
  } catch (e) { console.info('[net] room unavailable', e); }
  // 2. WebSocket relay
  if (serverUrl) {
    try { const t = new WsTransport(serverUrl); await t.connect(12000); return t; } catch (e) { console.info('[net] relay unreachable:', serverUrl); }
  }
  // 3. offline
  return new LocalTransport();
}
