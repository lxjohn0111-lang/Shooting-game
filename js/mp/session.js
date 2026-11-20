// Multiplayer: lobby + matchmaking (MPService) and the match itself (Match).
//
// Networking model (works over presence alone, so every viewer may play):
//   - every player publishes ~20x/s one presence object: its own state `s`, a ring of recent events `e`
//   - one player is the match HOST: it also publishes `h` (phase, clock, roster, scores, capture points, AI bots)
//   - each player is authoritative for its own movement and health. Shooters report hits ('h' events), the victim
//     applies them and reports its own death ('d'). The host simulates bots, captures and scores.
//   - if the host leaves or its tab is hidden, the remaining player with the lowest id takes over from the last state.
import * as THREE from '../lib/three.min.js';
import { connectTransport, LocalTransport } from '../net/transport.js';
import { MP_MODES, MP_SERVER_URL, MP_SEARCH_MIN, MP_SEARCH_MAX, MP_LOADOUT, TEAMS, MP_THEMES, MP_SKIES, MP_MAP_NAMES, WEAPONS } from '../config.js';
import { mpDefaults, rateMatch, botSkillFor, randomCallsign, cleanName, tierOf } from './ranked.js';
import { BotBrain } from './bots.js';
import { Avatar } from './avatar.js';
import { clamp, RNG, rand } from '../util.js';

export const PROTO = 1;
const SEND_INTERVAL = 0.05;           // 20 updates / second
const PRESENCE_BUDGET = 3900;         // bytes; the platform's limit is 4 KiB
const EVENT_TTL = 2.0;                // seconds an event stays in the ring
export const MP_DIFF = { name: 'RANKED', hp: 1, dmg: 1, credits: 1, desc: '' };
const DM_TINT = [1.3, 0.62, 0.55];
const q = new URLSearchParams(location.search);

const wIndex = (id) => { const i = MP_LOADOUT.indexOf(id); return i < 0 ? (id === 'frag' ? 90 : id === 'melee' ? 91 : 1) : i; };
export const wName = (i) => (i === 90 ? 'FRAG' : i === 91 ? 'MELEE' : i === 92 ? 'FALL' : (WEAPONS[MP_LOADOUT[i]] || WEAPONS.rifle).name);
const randId = () => Math.random().toString(36).slice(2, 10);

function decodeState(s) {
  if (!Array.isArray(s) || s.length < 13) return null;
  return { x: s[0] / 100, y: s[1] / 100, z: s[2] / 100, yaw: s[3] / 1000, pitch: s[4] / 1000, alive: !!s[5], crouch: s[6] / 100, fs: s[7] | 0, w: s[8] | 0, ex: s[9] / 10, ey: s[10] / 10, ez: s[11] / 10, sq: s[12] | 0 };
}

// ======================================================================================= service
export class MPService {
  constructor(game) {
    this.game = game; this.t = null; this._at = 0; this.status = 'offline'; this.state = 'idle'; this.match = null; this.mode = 'dm';
    this.searchT = 0; this.scanT = 0; this.rejected = new Set(); this.lobbyP = {}; this.lobbyDirty = false; this.lobbySendT = 0; this.away = false;
    document.addEventListener('visibilitychange', () => { this.away = document.hidden; if (this.match) this.match.sendNow(); });
    addEventListener('pagehide', () => { if (this.match) this.match.leave(true); });
  }
  get data() {
    const d = this.game.save.data; if (!d.mp) d.mp = mpDefaults();
    if (!d.mp.name) { d.mp.name = randomCallsign(); this.game.save.save(); }
    return d.mp;
  }
  get name() { return cleanName(this.data.name) || 'Operative'; }
  setName(n) { const c = cleanName(n); if (c) { this.data.name = c; this.game.save.save(); this.setLobby({ n: c }); } }
  serverUrl() { return q.get('mpserver') || MP_SERVER_URL; }
  connect() {
    // an offline fallback is retried (at most every 8 s) when a relay is configured
    const retry = this.t && this.t.kind === 'local' && this.serverUrl() && performance.now() - this._at > 8000;
    if (this._connecting && !retry) return this._connecting;
    this._at = performance.now();
    this.status = 'connecting';
    this._connecting = connectTransport(this.serverUrl()).then((t) => {
      this.t = t; this.status = t.online ? 'online' : 'offline';
      this.setLobby({ v: PROTO, n: this.name, m: Math.round(this.data.mmr), st: 'idle' });
      t.lobby.onPeers(() => { this.game.ui.mpLobby && this.game.ui.mpLobby(this); });
      this.game.ui.mpLobby && this.game.ui.mpLobby(this);
      return t;
    });
    return this._connecting;
  }
  lobbyPeers() { return this.t ? this.t.lobby.peers().filter((p) => p.presence && p.presence.v === PROTO) : []; }
  onlineCount() { return Math.max(1, this.lobbyPeers().length); }
  setLobby(patch) { Object.assign(this.lobbyP, patch); this.lobbyDirty = true; }

  async find(mode) {
    this.mode = mode; this.game.audio.init(); this.game.audio.resume();
    this.state = 'search'; this.searchT = 0; this.scanT = 0.6; this.rejected.clear();
    this.game.ui.mmShow(this);
    await this.connect();
    if (this.state !== 'search') return;
    this.setLobby({ st: 'search', md: mode, id: null, ph: null, o: null });
  }
  cancel() {
    if (this.match) { this.match.leave(); this.match = null; }
    this.state = 'idle'; this.setLobby({ st: 'idle', md: null, id: null, ph: null, o: null });
  }
  tick(dt) {
    if (this.t && this.lobbyDirty) { this.lobbySendT -= dt; if (this.lobbySendT <= 0) { this.lobbySendT = 0.5; this.lobbyDirty = false; this.t.lobby.presence({ ...this.lobbyP }); } }
    if (this.state === 'search') { if (this.t && !this._opening) this._searchTick(dt); this.game.ui.mmSearch(this); }
    if (this.match) { this.match.tick(dt); this._mergeTick(dt); }
  }
  // two players who searched at the same moment each open a match: the newer, still-empty one folds into the older one
  _mergeTick(dt) {
    const m = this.match; if (!m || m.intro || !m.isHost || !m.H || m.H.ph !== 'form' || this._opening || !this.t) return;
    this.mergeT = (this.mergeT || 0) - dt; if (this.mergeT > 0) return; this.mergeT = 0.5;
    if (m.H.ro.filter((r) => !r[3]).length > 1) return;
    const me = this.t.me(), age = m.H.t;
    const older = this.lobbyPeers().find((p) => { const x = p.presence; return !p.isMe && x.st === 'host' && x.md === this.mode && x.ph === 'form' && x.o > 0 && x.id !== m.id && !this.rejected.has(x.id) && ((x.ag || 0) > age + 1.5 || (Math.abs((x.ag || 0) - age) <= 1.5 && p.peer < me)); });
    if (!older) return;
    m.leave(true); this.match = null; this.state = 'search'; this._open(older.presence.id, false);
  }
  _searchTick(dt) {
    this.searchT += dt; this.scanT -= dt; if (this.scanT > 0) return; this.scanT = 0.4;
    const me = this.data.mmr, tol = 250 + 20 * this.searchT;
    const hosts = this.lobbyPeers().filter((p) => {
      const x = p.presence; if (p.isMe || x.st !== 'host' || x.md !== this.mode || !(x.o > 0) || this.rejected.has(x.id)) return false;
      if (x.ph === 'live' && !(x.rm > 75)) return false;
      return (x.ph === 'form' || x.ph === 'start' || x.ph === 'live') && Math.abs((x.am || 1000) - me) <= tol;
    });
    if (hosts.length) {
      hosts.sort((a, b) => (a.presence.ph === 'form' ? 0 : 1) - (b.presence.ph === 'form' ? 0 : 1) || (b.presence.hc || 0) - (a.presence.hc || 0) || Math.abs(a.presence.am - me) - Math.abs(b.presence.am - me));
      this._open(hosts[0].presence.id, false); return;
    }
    if (this.searchT > (this.t.online ? 1.6 : 0)) this._open(randId(), true);
  }
  async _open(id, asHost) {
    this._opening = true;
    try {
      const m = new Match(this, this.mode, id, asHost);
      await m.open(); this.match = m; this.state = 'match';
    } catch (e) { console.warn('[mp] could not open match', e); this.rejected.add(id); this.state = 'search'; }
    this._opening = false;
  }
  // a match we tried turned out to be full / gone: keep searching
  matchFailed(id) { this.rejected.add(id); this.match = null; this.state = 'search'; this.scanT = 0.2; this.setLobby({ st: 'search', id: null, ph: null, o: null }); this.game.ui.mmShow(this); }
  // the match the game opens with: Domination, straight into play, no lobby
  async startIntro() {
    this.mode = 'dom'; this.state = 'match'; this.game.ui.mpMode = 'dom';
    const m = new Match(this, 'dom', 'q' + randId(), true, { intro: true, transport: new LocalTransport() });
    this.match = m; await m.open();
  }
  matchClosed() { this.match = null; this.state = 'idle'; this.setLobby({ st: 'idle', id: null, ph: null, o: null, md: null }); }
}

// ======================================================================================= match
export class Match {
  constructor(svc, mode, id, asHost, opts = {}) {
    this.intro = !!opts.intro; this.tp = opts.transport || null;
    this.svc = svc; this.game = svc.game; this.mode = MP_MODES[mode]; this.id = id; this.asHost = asHost;
    this.loadout = MP_LOADOUT; this.isHost = false; this.H = null; this.lastH = null; this.hostPeer = null;
    this.peers = []; this.pinfo = new Map(); this.lastSeq = new Map(); this.ring = []; this.seq = 0;
    this.mySlot = -1; this.views = new Map(); this.bots = new Map(); this.time = 0; this.sendT = 0; this.openedAt = 0;
    this.loaded = false; this.began = false; this.ended = false; this.left = false; this.result = null;
    this.myFs = 0; this.myEnd = [0, 0, 0]; this.mySq = 0; this.respawnT = 0; this.pendingHits = new Map(); this.firedAt = new Map();
    this.notInRosterT = 0; this.noHostT = 0; this.scoreT = 0; this.rosterT = 0; this.lobbyT = 0; this.killStreak = 0; this.multiT = 0; this.multiN = 0;
    this.stats = { kills: 0, deaths: 0, caps: 0 };
  }
  get t() { return this.tp || this.svc.t; }
  get myPeer() { return this.t.me(); }
  get level() { return this.game.level; }
  teamOf(slot) { const r = this.H && this.H.ro[slot]; return r ? r[2] : -1; }
  get myTeam() { return this.teamOf(this.mySlot); }
  isBot(slot) { const r = this.H && this.H.ro[slot]; return !!(r && r[3]); }
  nameOf(slot) { const r = this.H && this.H.ro[slot]; return r ? r[1] : '—'; }

  async open() {
    this.chan = await this.t.join('vp-' + this.id);
    this.chan.onPeers((ch) => this._onPeers(ch.peers));
    this.openedAt = this.time;
    if (this.asHost) this._becomeHost(null);
    if (!this.intro) this.svc.setLobby(this.asHost ? this._lobbyInfo() : { st: 'in', id: this.id, md: this.mode.id, ph: null, o: null });
    this.sendNow();
  }
  _onPeers(peers) {
    this.peers = peers; const now = performance.now();
    for (const p of peers) { const pi = this.pinfo.get(p.peer); if (!pi || pi.pres !== p.presence) this.pinfo.set(p.peer, { pres: p.presence, at: now, st: p.presence && p.presence.s ? decodeState(p.presence.s) : null }); }
  }
  humans() { return this.peers.filter((p) => p.presence && p.presence.v === PROTO && !p.presence.bye); }

  // ------------------------------------------------------------------ host election / migration
  _elect() {
    const humans = this.humans(); let cur = null;
    for (const p of humans) { const h = p.presence.h; if (h && h.id === this.id && (!cur || h.v > cur.presence.h.v || (h.v === cur.presence.h.v && p.peer < cur.peer))) cur = p; }
    if (this.isHost) {
      if (cur && !cur.isMe && (cur.presence.h.v > this.H.v || (cur.presence.h.v === this.H.v && cur.peer < this.myPeer))) { this.isHost = false; this.bots.clear(); this.chan.presence({ h: null }); }
      else { this.hostPeer = this.myPeer; return; }
    }
    if (cur && !cur.isMe && !cur.presence.aw) { this.hostPeer = cur.peer; this.lastH = cur.presence.h; this.noHostT = 0; return; }
    // no (reachable) host: the lowest-id active player takes over, if we have seen a match state to continue from
    if (!this.lastH) return;
    const cands = humans.filter((p) => !p.presence.aw).sort((a, b) => (a.peer < b.peer ? -1 : 1));
    if (cands.length && cands[0].isMe && !this.svc.away) this._becomeHost(this.lastH);
  }
  _becomeHost(from) {
    this.isHost = true; this.hostPeer = this.myPeer;
    if (!from) {
      const r = new RNG((Math.random() * 1e9) | 0), th = r.pick(MP_THEMES);
      // 10–17 s counted from when the player pressed FIND MATCH (time already spent scanning the lobby included)
      const wait = +q.get('mpwait') || Math.max(3, Math.round((MP_SEARCH_MIN + Math.random() * (MP_SEARCH_MAX - MP_SEARCH_MIN) - this.svc.searchT) * 10) / 10);
      if (this.intro) { this.H = { v: 1, id: this.id, md: 'dom', sd: r.i(1, 99999), th, sk: r.pick(['golden', 'dusk', 'dawn', 'ember']), mn: r.pick(MP_MAP_NAMES[th]), ph: 'form', t: 0, win: 0, ro: [], ts: [0, 0], pt: [[-1, 0], [-1, 0], [-1, 0]], bs: [], w: -1, bm: Math.round(this.svc.data.mmr), lim: 150, dur: 600, intro: 1 }; this.lastH = this.H; return; }
      this.H = { v: 1, id: this.id, md: this.mode.id, sd: r.i(1, 99999), th, sk: r.pick(MP_SKIES), mn: r.pick(MP_MAP_NAMES[th]), ph: 'form', t: 0, win: wait, ro: [], ts: [0, 0], pt: [[-1, 0], [-1, 0], [-1, 0]], bs: [], w: -1, bm: Math.round(this.svc.data.mmr), lim: +q.get('mplimit') || this.mode.scoreLimit, dur: +q.get('mptime') || this.mode.time };
    } else {
      this.H = JSON.parse(JSON.stringify(from)); this.H.v = from.v + 1;
      // continue the AI from where the old host left it
      for (let i = 0; i < this.H.ro.length; i++) if (this.H.ro[i][3]) { const b = this._makeBot(i); const e = this.H.bs.find((x) => x[0] === i); if (e) { const st = decodeState(e.slice(1)); if (st && st.alive && this.loaded) { b.body.x = st.x; b.body.y = st.y; b.body.z = st.z; b.yaw = st.yaw; b.alive = true; b.sq = st.sq; b.fs = st.fs; } } }
      this.game.ui.toast('YOU ARE NOW HOSTING THIS MATCH', 'info', 2);
    }
    this.lastH = this.H;
  }
  _makeBot(slot) { const r = this.H.ro[slot]; const b = new BotBrain(this, slot, botSkillFor(r ? r[4] : this.H.bm), Math.random()); this.bots.set(slot, b); return b; }
  _botMmr() { return Math.max(0, Math.round(this.H.bm + (Math.random() - 0.5) * 120)); }
  _botName() { const used = new Set(this.H.ro.map((r) => r[1])); for (let i = 0; i < 20; i++) { const n = randomCallsign(); if (!used.has(n)) return n; } return 'Unit-' + ((Math.random() * 999) | 0); }
  _teamFor() { if (!this.mode.teams) return 0; const c = [0, 0]; for (const r of this.H.ro) c[r[2]]++; return c[0] <= c[1] ? 0 : 1; }

  // ------------------------------------------------------------------ host simulation
  _hostTick(dt) {
    const H = this.H, slots = this.mode.slots;
    this.rosterT -= dt;
    if (this.rosterT <= 0) {
      this.rosterT = 0.25;
      const hs = new Map(this.humans().map((p) => [p.peer, p]));
      // departed humans: drop while forming, hand the seat to AI once the match is set
      for (let i = H.ro.length - 1; i >= 0; i--) {
        const r = H.ro[i]; if (r[3] || hs.has(r[0])) continue;
        if (H.ph === 'form') H.ro.splice(i, 1);
        else { H.ro[i] = ['', this._botName(), r[2], 1, this._botMmr(), 0, 0, 0]; if (H.ph !== 'end') this._makeBot(i); }
      }
      // new humans
      for (const [peer, p] of hs) {
        if (H.ro.some((r) => r[0] === peer)) continue;
        const nm = cleanName(p.presence.n) || 'Operative', mm = clamp(+p.presence.m || 1000, 0, 4000);
        if (H.ph === 'form') { if (H.ro.length < slots) H.ro.push([peer, nm, this._teamFor(), 0, mm, 0, 0, 0]); }
        else if (H.ph === 'start' || (H.ph === 'live' && H.dur - H.t > 30)) {
          // take over an AI seat, on the team with fewer humans
          const hc = [0, 0]; for (const r of H.ro) if (!r[3]) hc[r[2]]++;
          let best = -1; for (let i = 0; i < H.ro.length; i++) if (H.ro[i][3] && (best < 0 || hc[H.ro[i][2]] < hc[H.ro[best][2]])) best = i;
          if (best >= 0) { const r = H.ro[best]; H.ro[best] = [peer, nm, r[2], 0, mm, 0, 0, 0]; this.bots.delete(best); }
        }
      }
      for (const r of H.ro) if (!r[3]) { const p = hs.get(r[0]); if (p) { r[1] = cleanName(p.presence.n) || r[1]; r[4] = clamp(+p.presence.m || r[4], 0, 4000); } }
      const hum = H.ro.filter((r) => !r[3]); if (hum.length) H.bm = Math.round(hum.reduce((a, r) => a + r[4], 0) / hum.length);
    }
    if (H.ph === 'form') {
      H.t += dt;
      if (H.ro.filter((r) => !r[3]).length >= slots || H.t >= H.win) {
        while (H.ro.length < slots) { const i = H.ro.length; H.ro.push(['', this._botName(), this._teamFor(), 1, this._botMmr(), 0, 0, 0]); this._makeBot(i); }
        H.ph = 'start'; H.t = H.intro ? 0.2 : 5;
      }
    } else if (H.ph === 'start') { H.t -= dt; if (H.t <= 0) { H.ph = 'live'; H.t = 0; } }
    else if (H.ph === 'live') {
      H.t += dt;
      if (this.loaded) {
        const ents = this.ents();
        for (const b of this.bots.values()) b.update(dt, ents);
        if (this.mode.id === 'dom') this._domTick(dt, ents);
        if (H.intro) this._introTick(dt);
      }
      // end of match
      let over = H.t >= H.dur, w = -1;
      if (H.intro) { const mt = this.myTeam < 0 ? 0 : this.myTeam; over = H.ts[mt] >= H.lim || over; if (over && H.ts[mt] <= H.ts[1 - mt]) H.ts[mt] = H.ts[1 - mt] + 1; w = mt; }
      else if (this.mode.teams) { if (H.ts[0] >= H.lim || H.ts[1] >= H.lim) over = true; w = H.ts[0] > H.ts[1] ? 0 : H.ts[1] > H.ts[0] ? 1 : -1; }
      else { let best = -1; for (let i = 0; i < H.ro.length; i++) if (best < 0 || H.ro[i][5] > H.ro[best][5]) best = i; if (best >= 0 && H.ro[best][5] >= H.lim) over = true; w = best; }
      if (over) { H.ph = 'end'; H.t = 0; H.w = w; }
    } else if (H.ph === 'end') H.t += dt;
    H.bs = [...this.bots.values()].map((b) => b.encode());
    // keep the lobby informed so searchers can find us
    this.lobbyT -= dt; if (!this.intro && this.lobbyT <= 0) { this.lobbyT = H.ph === 'form' ? 0.5 : 1.5; this.svc.setLobby(this._lobbyInfo()); }
  }
  _lobbyInfo() {
    const H = this.H, hc = H.ro.filter((r) => !r[3]).length, bc = H.ro.length - hc;
    const open = H.ph === 'form' ? this.mode.slots - hc : (H.ph === 'start' || H.ph === 'live') ? bc : 0;
    return { st: 'host', id: this.id, md: this.mode.id, ph: H.ph, o: open, hc, am: H.bm, ag: H.ph === 'form' ? Math.round(H.t * 10) / 10 : 0, rm: Math.round(H.dur - (H.ph === 'live' ? H.t : 0)), mn: H.mn };
  }
  _domTick(dt, ents) {
    const H = this.H, pts = this.level.points;
    const mt = this.myTeam < 0 ? 0 : this.myTeam, lead = H.intro ? H.ts[mt] - H.ts[1 - mt] : 0;
    for (let k = 0; k < 3; k++) {
      const p = pts[k], c = [0, 0], who = [[], []];
      for (const e of ents) if (e.alive && Math.hypot(e.x - p.x, e.z - p.z) < 5.5 && e.y < 3) { c[e.team]++; who[e.team].push(e.slot); }
      const pt = H.pt[k]; let [own, prog] = pt;
      const dir = c[0] && !c[1] ? 1 : c[1] && !c[0] ? -1 : 0, n = Math.max(c[0], c[1]);
      let rate = 100 / 5 * (1 + 0.3 * (Math.min(n, 3) - 1));
      if (H.intro && lead >= 12 && dir === (mt === 0 ? -1 : 1)) rate *= lead >= 20 ? 2.6 : 1.7;
      if (dir) {
        prog = clamp(prog + dir * rate * dt, -100, 100);
        if (own === 0 && prog < 0) own = -1; if (own === 1 && prog > 0) own = -1;
        const t = prog >= 100 ? 0 : prog <= -100 ? 1 : -1;
        if (t >= 0 && own !== t) { own = t; this.emit(['c', k, t]); for (const s of who[t]) if (H.ro[s]) H.ro[s][7]++; }
      } else if (!c[0] && !c[1]) { const goal = own === 0 ? 100 : own === 1 ? -100 : 0; prog += clamp(goal - prog, -rate * 0.5 * dt, rate * 0.5 * dt); }
      pt[0] = own; pt[1] = Math.round(prog * 10) / 10;
    }
    this.scoreT += dt;
    if (this.scoreT >= 2) {
      this.scoreT -= 2;
      const held = [0, 0];
      for (const pt of H.pt) {
        if (pt[0] < 0) continue;
        if (H.intro && pt[0] !== mt) {
          const behind = H.ts[pt[0]] - H.ts[mt];
          if (H.ts[pt[0]] >= H.lim - 14 || behind >= 14 || (H.t > H.dur - 90 && behind >= 0)) continue;
        } else if (H.intro && lead >= 14 && Math.random() > (lead >= 24 ? 0.2 : lead >= 18 ? 0.4 : 0.65)) continue;
        held[pt[0]]++; H.ts[pt[0]]++;
      }
      // a squad that has been pushed off every point still trickles in, so the score never runs away
      if (H.intro && lead >= 20 && !held[1 - mt] && H.ts[1 - mt] < H.lim - 14 && Math.random() < 0.6) H.ts[1 - mt]++;
    }
  }
  // opening match: keep it close by tuning both squads' AI from the score
  _introTick(dt) {
    this.introT = (this.introT || 0) - dt; if (this.introT > 0) return; this.introT = 1.5;
    const H = this.H, mt = this.myTeam < 0 ? 0 : this.myTeam, lead = H.ts[mt] - H.ts[1 - mt];
    let ally = 0.24, foe = 0.13;
    if (lead > 20) { ally = 0.1; foe = 0.4; } else if (lead > 12) { ally = 0.15; foe = 0.28; } else if (lead < -6) { ally = 0.42; foe = 0.05; } else if (lead < 2) { ally = 0.32; foe = 0.09; }
    for (const [slot, b] of this.bots) b.skill = this.teamOf(slot) === mt ? ally : foe;
  }
  // positions of everyone, for AI and capture zones
  ents() {
    const out = [], H = this.H, pl = this.game.player;
    for (let i = 0; i < H.ro.length; i++) {
      const r = H.ro[i]; let e = null;
      if (r[3]) { const b = this.bots.get(i); if (b) e = { slot: i, team: r[2], x: b.body.x, y: b.body.y, z: b.body.z, vx: b.body.vx, vz: b.body.vz, alive: b.alive, crouch: b.crouch > 0.5 }; }
      else if (i === this.mySlot) { const b = pl.body; e = { slot: i, team: r[2], x: b.x, y: b.y, z: b.z, vx: b.vx, vz: b.vz, alive: this.began && !pl.dead, crouch: pl.crouchT > 0.5 }; }
      else { const pi = this.pinfo.get(r[0]); const st = pi && pi.st; if (st) e = { slot: i, team: r[2], x: st.x, y: st.y, z: st.z, vx: 0, vz: 0, alive: st.alive, crouch: st.crouch > 0.5 }; }
      if (e) { e.firedAt = this.firedAt.get(i); out.push(e); }
    }
    return out;
  }
  markFired(slot) { this.firedAt.set(slot, this.time); }
  // an AI shot connected (host only)
  botHit(attacker, target, dmg, crit, wpn, fx, fz) {
    if (this.isBot(target)) { const b = this.bots.get(target); if (b && b.takeHit(dmg)) this.emit(['d', target, attacker, wIndex(wpn), crit ? 1 : 0, Math.round(fx * 10), Math.round(fz * 10)]); }
    else this.emit(['h', target, Math.round(dmg), crit ? 1 : 0, wIndex(wpn), Math.round(fx * 10), Math.round(fz * 10), attacker]);
  }
  pickSpawn(team, slot) {
    const L = this.level, cands = this.mode.teams ? L.teamSpawns[team] : L.dmSpawns;
    const foes = this.ents().filter((e) => e.alive && e.slot !== slot && (!this.mode.teams || e.team !== team));
    const near = this.ents().filter((e) => e.alive && e.slot !== slot);
    const scored = cands.map((c) => {
      let d = 60; for (const f of foes) d = Math.min(d, Math.hypot(f.x - c.x, f.z - c.z));
      let crowd = 0; for (const e of near) if (Math.hypot(e.x - c.x, e.z - c.z) < 1.6) crowd++;
      return { c, s: d - crowd * 40 + Math.random() * 6 };
    }).sort((a, b) => b.s - a.s);
    const top = scored.slice(0, this.mode.teams ? 5 : 3); const pick = (top[(Math.random() * top.length) | 0] || { c: { x: 0, z: 0, yaw: 0 } }).c;
    const yaw = this.mode.teams ? pick.yaw : Math.atan2(pick.x, pick.z);
    return { x: pick.x, z: pick.z, yaw };
  }

  // ------------------------------------------------------------------ events
  emit(ev) { this.ring.push({ e: [++this.seq, ...ev], t: this.time }); this.sendT = Math.min(this.sendT, 0.01); }
  _processEvents() {
    for (const p of this.peers) {
      const pres = p.presence; if (!pres || !Array.isArray(pres.e)) continue;
      let last = this.lastSeq.get(p.peer);
      if (last === undefined) {
        // first time we see this player: skip history (it happened before we were here), except our own
        last = p.isMe ? 0 : pres.e.reduce((m, e) => Math.max(m, e[0] | 0), 0);
        this.lastSeq.set(p.peer, last); if (!p.isMe) continue;
      }
      let mx = last;
      for (const e of pres.e) { const s = e[0] | 0; if (s > last) { try { this._handle(e, p); } catch (err) { console.error('[mp] event', err); } if (s > mx) mx = s; } }
      this.lastSeq.set(p.peer, mx);
    }
  }
  _handle(e, from) {
    const g = this.game, type = e[1];
    if (type === 'h') {
      const [, , target, dmg, crit, w, fx, fz, attacker] = e;
      if (this.mode.teams && this.teamOf(target) === this.teamOf(attacker) && target !== attacker) return;
      if (target === this.mySlot && this.began && !g.player.dead) g.player.damage(dmg, { x: fx / 10, y: 1.4, z: fz / 10 }, { attacker, wpn: w, crit: !!crit });
      else if (this.isHost && this.isBot(target)) { const b = this.bots.get(target); if (b && b.takeHit(dmg)) this.emit(['d', target, attacker, w, crit, fx, fz]); }
    } else if (type === 'd') {
      const [, , victim, killer, w, crit, kx, kz] = e;
      if (this.isHost && this.H.ro[victim]) {
        this.H.ro[victim][6]++;
        if (killer >= 0 && killer !== victim && this.H.ro[killer] && (!this.mode.teams || this.teamOf(killer) !== this.teamOf(victim))) this.H.ro[killer][5]++;
      }
      const v = this.views.get(victim);
      if (v && v.avatar && !v.avatar.dead) { const dx = v.avatar.pos.x - kx / 10, dz = v.avatar.pos.z - kz / 10, l = Math.hypot(dx, dz) || 1; v.avatar.kill(dx / l, dz / l, !!crit); }
      g.ui.killFeed(this, killer, victim, w, !!crit);
      if (killer === this.mySlot && victim !== this.mySlot && this.began) this._onMyKill(victim, !!crit);
    } else if (type === 'g') {
      if (from.isMe) return;
      const [, , x, y, z, vx, vy, vz] = e;
      g.projectiles.spawnGrenade(x / 100, y / 100, z / 100, vx / 100, vy / 100, vz / 100, { fuse: 1.9, dmg: 0, radius: 7, owner: 'remote' });
    } else if (type === 'c') {
      const [, , k, team] = e, mine = team === this.myTeam, id = 'ABC'[k];
      g.ui.toast(`${TEAMS[team].name} CAPTURED ${id}`, mine ? 'good' : 'warn', 2);
      g.audio.play(mine ? 'objective' : 'alarm', { vol: 0.6, reverb: 0.2 });
    }
  }
  _onMyKill(victim, crit) {
    const g = this.game, s = this.stats; s.kills++; g.stats.kills++;
    this.multiN = this.multiT > 0 ? this.multiN + 1 : 1; this.multiT = 3.5; this.killStreak++;
    g.ui.hitmarker(true, crit); g.audio.play('kill', { vol: 0.7, reverb: 0 });
    g.ui.announce(this.multiN === 2 ? 'DOUBLE KILL' : this.multiN === 3 ? 'TRIPLE KILL' : this.multiN >= 4 ? 'RAMPAGE' : this.killStreak === 5 ? 'KILLING SPREE' : this.killStreak === 10 ? 'UNSTOPPABLE' : '');
    g.ui.feed(`ELIMINATED ${this.nameOf(victim)}`, crit ? 150 : 100, crit);
  }

  // ------------------------------------------------------------------ hooks from the local player
  onLocalShot(ex, ey, ez) { this.myFs++; this.myEnd[0] = ex; this.myEnd[1] = ey; this.myEnd[2] = ez; this.markFired(this.mySlot); }
  onLocalHit(slot, dmg, crit, wpn) {
    if (this.mySlot < 0) return;
    const h = this.pendingHits.get(slot) || { dmg: 0, crit: false, w: wIndex(wpn) }; h.dmg += dmg; h.crit = h.crit || crit; this.pendingHits.set(slot, h);
  }
  onThrow(x, y, z, vx, vy, vz) { this.emit(['g', Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), Math.round(vx * 100), Math.round(vy * 100), Math.round(vz * 100)]); }
  onLocalDeath() {
    const g = this.game, p = g.player, lh = p.lastHit, recent = lh && g.time - lh.t < 6;
    const killer = recent ? (lh.by ?? -1) : -1, w = recent ? (lh.w ?? 1) : 92;
    this.emit(['d', this.mySlot, killer, w, recent && lh.crit ? 1 : 0, Math.round(p.body.x * 10), Math.round(p.body.z * 10)]);
    this.stats.deaths++; this.killStreak = 0; this.respawnT = this.mode.respawn; this.killedBy = killer;
    g.ui.mpRespawn(this, true);
  }

  // ------------------------------------------------------------------ per-frame
  tick(dt) {
    if (this.left) return;
    this.time += dt; this.multiT -= dt;
    this._elect();
    if (this.isHost) this._hostTick(dt);
    const H = this.isHost ? this.H : (this.hostPeer && this.pinfo.get(this.hostPeer) ? this.pinfo.get(this.hostPeer).pres.h : null);
    if (H && H.id === this.id) { this.H = H; this.lastH = H; this.noHostT = 0; }
    else { this.noHostT += dt; if (!this.H && this.noHostT > 8) { this.leave(); this.svc.matchFailed(this.id); return; } }
    if (this.H) {
      this._processEvents();
      this._phase(dt);
      if (this.left) return;
      if (this.began && !this.ended) this._play(dt);
    }
    this._send(dt);
    this.game.ui.mmUpdate && this.game.ui.mmUpdate(this);
  }
  _phase(dt) {
    const H = this.H, g = this.game;
    this.mySlot = H.ro.findIndex((r) => r[0] === this.myPeer && !r[3]);
    if (this.mySlot < 0 && H.ph !== 'form' && !this.ended) { this.notInRosterT += dt; if (this.notInRosterT > 4) { this.leave(); this.svc.matchFailed(this.id); return; } }
    else this.notInRosterT = 0;
    if (H.ph === 'form' && this.mySlot < 0 && this.time - this.openedAt > 5 && H.ro.length >= this.mode.slots) { this.leave(); this.svc.matchFailed(this.id); return; }
    if ((H.ph === 'start' || H.ph === 'live') && !this.loaded && this.mySlot >= 0) {
      this.loaded = true;
      g.mpLoad(this, { theme: H.th, sky: H.sk, seed: H.sd, size: 36, mp: true, name: H.mn });
      // bots of an inherited match need positions on the freshly built map
      if (this.isHost) for (const b of this.bots.values()) if (!b.alive) b.respawnT = Math.min(b.respawnT, rand(0.2, 1));
    }
    if (H.ph === 'live' && this.loaded && !this.began && this.mySlot >= 0) { this.began = true; g.mpBegin(this); this._spawnMe(); }
    if (H.ph === 'end' && !this.ended) {
      this.ended = true;
      if (this.began) { this.result = this._finish(); setTimeout(() => { if (!this.left) g.mpEnd(this, this.result); }, 2600); g.mpEnding(this); }
      else { this.leave(); this.svc.matchFailed(this.id); }
    }
  }
  _spawnMe() {
    const g = this.game, sp = this.pickSpawn(this.myTeam, this.mySlot);
    g.mpSpawn(sp); this.mySq++; g.ui.mpRespawn(this, false);
  }
  _play(dt) {
    const g = this.game, H = this.H, p = g.player;
    // flush aggregated hits (a shotgun blast is one report)
    for (const [slot, h] of this.pendingHits) { const b = p.body; this.emit(['h', slot, Math.round(h.dmg), h.crit ? 1 : 0, h.w, Math.round(b.x * 10), Math.round(b.z * 10), this.mySlot]); }
    this.pendingHits.clear();
    // respawn
    if (p.dead) { this.respawnT -= dt; g.ui.mpRespawnTimer(this, Math.max(0, this.respawnT)); if (this.respawnT <= 0) this._spawnMe(); }
    // remote operatives
    const now = performance.now(), hostAt = this.isHost ? now : (this.pinfo.get(this.hostPeer) || {}).at;
    const bs = new Map(); for (const e of H.bs) bs.set(e[0], e);
    for (let i = 0; i < H.ro.length; i++) {
      if (i === this.mySlot) continue;
      const r = H.ro[i], key = (r[3] ? 'b:' : 'h:') + (r[3] ? i + r[1] : r[0]);
      let v = this.views.get(i); if (!v || v.key !== key) { if (v && v.avatar) v.avatar.remove(); v = { key, avatar: null, sq: -1, fs: 0, at: -1 }; this.views.set(i, v); }
      let st, at;
      if (r[3]) { const e = bs.get(i); st = e ? decodeState(e.slice(1)) : null; at = hostAt; }
      else { const pi = this.pinfo.get(r[0]); st = pi && pi.st; at = pi && pi.at; }
      if (!st) continue;
      if (st.alive) {
        if (!v.avatar || v.avatar.dead || v.sq !== st.sq) {
          if (v.avatar && !v.avatar.dead) v.avatar.remove();
          const friendly = this.mode.teams && r[2] === this.myTeam, tint = this.mode.teams ? TEAMS[r[2]].tint : DM_TINT;
          v.avatar = new Avatar(g.enemies, this, i, st, tint, friendly); g.enemies.list.push(v.avatar); v.sq = st.sq; v.fs = st.fs; v.at = -1;
        }
        if (at !== v.at) { v.at = at; v.avatar.push(st, at); if (st.fs > v.fs) { v.avatar.shootFx(st.ex, st.ey, st.ez, st.w, st.fs - v.fs); this.markFired(i); } v.fs = st.fs; }
      } else if (v.avatar && !v.avatar.dead) v.avatar.kill(0, 0, false);
    }
    for (const [i, v] of this.views) if (i >= H.ro.length || i === this.mySlot) { if (v.avatar) v.avatar.remove(); this.views.delete(i); }
  }
  _myState() {
    const p = this.game.player, b = p.body;
    return [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(p.yaw * 1000), Math.round(p.pitch * 1000), p.dead ? 0 : 1, Math.round(p.crouchT * 100), this.myFs, wIndex(p.weapon.id), Math.round(this.myEnd[0] * 10), Math.round(this.myEnd[1] * 10), Math.round(this.myEnd[2] * 10), this.mySq];
  }
  sendNow() { this.sendT = 0; this._send(0); }
  _send(dt) {
    this.sendT -= dt; if (this.sendT > 0 || !this.chan) return; this.sendT = SEND_INTERVAL;
    this.ring = this.ring.filter((r) => this.time - r.t < EVENT_TTL).slice(-24);
    const pres = { v: PROTO, n: this.svc.name, m: Math.round(this.svc.data.mmr), aw: this.svc.away ? 1 : 0, s: this.began && !this.ended ? this._myState() : null, e: this.ring.map((r) => r.e), h: this.isHost ? this.H : null, bye: this.left ? 1 : null };
    let json = JSON.stringify(pres);
    while (json.length > PRESENCE_BUDGET && pres.e.length) { pres.e.shift(); json = JSON.stringify(pres); }
    this.chan.presence(pres);
  }

  // ------------------------------------------------------------------ results & leaving
  _finish() {
    const H = this.H, ro = H.ro, me = this.mySlot, mine = ro[me] || ['', this.svc.name, 0, 0, 1000, 0, 0, 0], mp = this.svc.data;
    const K = mine[5], D = mine[6], caps = mine[7];
    let score, win, place = 0, oppAvg;
    if (this.mode.teams) {
      win = H.w === mine[2]; score = H.w === -1 ? 0.5 : win ? 1 : 0;
      const opp = ro.filter((r) => r[2] !== mine[2]); oppAvg = opp.length ? opp.reduce((a, r) => a + r[4], 0) / opp.length : mp.mmr;
    } else {
      const order = ro.map((r, i) => i).sort((a, b) => ro[b][5] - ro[a][5] || ro[a][6] - ro[b][6]);
      place = order.indexOf(me) + 1; score = ro.length > 1 ? 1 - (place - 1) / (ro.length - 1) : 1; win = place === 1;
      const opp = ro.filter((r, i) => i !== me); oppAvg = opp.length ? opp.reduce((a, r) => a + r[4], 0) / opp.length : mp.mmr;
    }
    if (this.intro) {
      const credits = K * 20 + caps * 12 + (win ? 150 : 60), xp = K * 40 + caps * 30 + (win ? 300 : 120);
      const sd = this.game.save.data; sd.credits += credits; sd.xp += xp; this.game.save.save();
      return { mode: this.mode, intro: true, win, draw: false, place, total: ro.length, K, D, caps, before: mp.mmr, after: mp.mmr, delta: 0, credits, xp, ro: ro.map((r) => r.slice()), me, myTeam: mine[2], ts: H.ts.slice(), mapName: H.mn };
    }
    const before = mp.mmr, delta = rateMatch(mp, oppAvg, score, (K - D) * 0.35 + caps * 0.8);
    mp.mmr = Math.max(0, before + delta); mp.best = Math.max(mp.best || 0, mp.mmr); mp.matches++; if (win) mp.wins++; mp.kills += K; mp.deaths += D;
    mp.history = [{ md: this.mode.id, d: delta, w: win ? 1 : 0, k: K, de: D, t: Date.now() }, ...(mp.history || [])].slice(0, 20);
    const credits = K * 20 + caps * 12 + (win ? 150 : place && place <= 3 ? 100 : 60), xp = K * 40 + caps * 30 + (win ? 300 : 120);
    const sd = this.game.save.data; sd.credits += credits; sd.xp += xp; this.game.save.save();
    return { mode: this.mode, win, draw: score === 0.5 && this.mode.teams, place, total: ro.length, K, D, caps, before, after: mp.mmr, delta, credits, xp, ro: ro.map((r) => r.slice()), me, myTeam: mine[2], ts: H.ts.slice(), mapName: H.mn };
  }
  // leaving a live match counts as a loss
  forfeit() {
    if (!this.began || this.ended || !this.H) return;
    if (this.intro) { this.ended = true; return; }
    const mp = this.svc.data, ro = this.H.ro; const avg = ro.length ? ro.reduce((a, r) => a + r[4], 0) / ro.length : mp.mmr;
    const d = rateMatch(mp, avg, 0, 0); mp.mmr = Math.max(0, mp.mmr + d); mp.matches++; mp.history = [{ md: this.mode.id, d, w: 0, k: this.stats.kills, de: this.stats.deaths, t: Date.now(), left: 1 }, ...(mp.history || [])].slice(0, 20);
    this.game.save.save(); this.ended = true;
  }
  leave(silent) {
    if (this.left) return;
    this.left = true; try { this.sendNow(); } catch (e) { }
    for (const v of this.views.values()) if (v.avatar) v.avatar.remove(); this.views.clear();
    if (this.chan) setTimeout(() => this.chan.leave(), silent ? 0 : 150);
    if (this.svc.match === this) this.svc.match = null;
  }
}
