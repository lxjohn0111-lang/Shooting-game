// AI operatives that fill empty seats. Simulated only on the match host; everyone else sees them through the host's presence.
import { WEAPONS, MP_LOADOUT } from '../config.js';
import { clamp, rand, angleDelta, damp, TAU } from '../util.js';

const _f = { x: 0, z: 0 };
const BOT_WEAPONS = ['rifle', 'rifle', 'smg', 'shotgun', 'marksman', 'smg', 'rifle'];
const ENGAGE = { pistol: 22, rifle: 34, smg: 18, shotgun: 9, marksman: 55 };
const SPEED = 5.0;

export class BotBrain {
  constructor(match, slot, skill, seed = Math.random()) {
    this.m = match; this.slot = slot; this.skill = skill;
    this.wpn = BOT_WEAPONS[(seed * BOT_WEAPONS.length) | 0]; this.wIdx = MP_LOADOUT.indexOf(this.wpn);
    this.body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.38, h: 1.8, onGround: true, gravity: 22, groundY: 0, landV: 0 };
    this.yaw = 0; this.pitch = 0; this.alive = false; this.respawnT = 0.5 + rand(1.5); this.hp = 100; this.shield = 60; this.shieldT = 0; this.invuln = 0;
    this.fs = 0; this.end = [0, 0, 0]; this.sq = 0; this.crouch = 0;
    this.target = null; this.seen = 0; this.react = 0; this.thinkT = 0; this.goal = null; this.goalT = 0; this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.cool = 0; this.burst = 0; this.mag = WEAPONS[this.wpn].mag; this.reloadT = 0; this.stuckT = 0; this.lastPos = { x: 0, z: 0 }; this.lastKnown = null; this.role = Math.random();
  }
  get team() { return this.m.teamOf(this.slot); }
  spawn(sp) {
    const b = this.body; b.x = sp.x; b.z = sp.z; b.y = 0; b.vx = b.vy = b.vz = 0; this.yaw = sp.yaw || 0; this.pitch = 0;
    this.alive = true; this.hp = 100; this.shield = 60; this.invuln = 1.5; this.sq++; this.target = null; this.goal = null; this.mag = WEAPONS[this.wpn].mag; this.reloadT = 0; this.react = 0;
  }
  // returns true if this hit killed the bot
  takeHit(dmg) {
    if (!this.alive || this.invuln > 0) return false;
    this.shieldT = 4;
    if (this.shield > 0) { const s = Math.min(this.shield, dmg); this.shield -= s; dmg -= s; }
    this.hp -= dmg; this.react = Math.min(this.react, 0.15);   // getting shot makes it react
    if (this.hp <= 0) { this.alive = false; this.respawnT = this.m.mode.respawn + rand(0.5); return true; }
    return false;
  }
  encode() {
    const b = this.body;
    return [this.slot, Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(this.yaw * 1000), Math.round(this.pitch * 1000), this.alive ? 1 : 0, Math.round(this.crouch * 100), this.fs, this.wIdx, Math.round(this.end[0] * 10), Math.round(this.end[1] * 10), Math.round(this.end[2] * 10), this.sq];
  }

  _pointAt(goal) { const pts = this.m.level.points; for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - goal.x, pts[i].z - goal.z) < 5) return i; return -1; }
  _pickGoal(ents) {
    const m = this.m, L = m.level;
    if (m.mode.id === 'dom') {
      const pts = L.points, owned = m.H.pt, team = this.team;
      // most bots push points they don't own; some guard owned ones
      const want = pts.map((p, i) => ({ p, i, own: owned[i][0] })).filter((x) => x.own !== team);
      let pick;
      if (want.length && this.role < 0.78) { want.sort((a, b) => Math.hypot(a.p.x - this.body.x, a.p.z - this.body.z) - Math.hypot(b.p.x - this.body.x, b.p.z - this.body.z) + (a.i === 1 ? -8 : 0) - (b.i === 1 ? -8 : 0)); pick = want[this.role < 0.45 ? 0 : Math.min(1, want.length - 1)]; }
      else pick = { p: pts[(this.role * 30 | 0) % 3] };
      const a = rand(TAU), r = rand(0.5, 3.5); return { x: pick.p.x + Math.cos(a) * r, z: pick.p.z + Math.sin(a) * r, hold: 3 + rand(4) };
    }
    // deathmatch: hunt the closest enemy (bots "hear" the fight), otherwise roam between spawn lanes
    let best = null, bd = 1e9;
    for (const e of ents) { if (!e.alive || e.slot === this.slot) continue; const d = Math.hypot(e.x - this.body.x, e.z - this.body.z); if (d < bd) { bd = d; best = e; } }
    if (best && Math.random() < 0.7) return { x: best.x + rand(-4, 4), z: best.z + rand(-4, 4), hold: 0 };
    const s = L.dmSpawns[(Math.random() * L.dmSpawns.length) | 0]; return { x: s.x, z: s.z, hold: 0 };
  }

  update(dt, ents) {
    const m = this.m, L = m.level, b = this.body;
    if (!this.alive) { this.respawnT -= dt; if (this.respawnT <= 0) this.spawn(m.pickSpawn(this.team, this.slot)); return; }
    this.invuln -= dt; this.cool -= dt; this.thinkT -= dt; this.strafeT -= dt;
    if (this.shieldT > 0) this.shieldT -= dt; else this.shield = Math.min(60, this.shield + 26 * dt);
    // perception (4x a second)
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + rand(0.08);
      let best = null, bs = 1e9; const ex = b.x, ey = b.y + 1.6, ez = b.z;
      for (const e of ents) {
        if (!e.alive || e.slot === this.slot || (m.mode.teams && e.team === this.team)) continue;
        const d = Math.hypot(e.x - ex, e.z - ez); if (d > 38 + this.skill * 34) continue;
        // field of view: things behind are noticed only when close or when they just shot
        const fwd = Math.cos(angleDelta(this.yaw, Math.atan2(-(e.x - ex), -(e.z - ez))));
        if (fwd < 0.15 - this.skill * 0.25 && d > 6 + this.skill * 4 && !(e.firedAt && m.time - e.firedAt < 0.6 + this.skill)) continue;
        if (!L.los(ex, ey, ez, e.x, e.y + 1.2, e.z)) continue;
        const sc = d - (this.target && this.target.slot === e.slot ? 8 : 0); if (sc < bs) { bs = sc; best = e; }
      }
      if (best && (!this.target || this.target.slot !== best.slot)) this.react = (1.05 - this.skill * 0.75) + rand(0.3);
      this.target = best; if (best) { this.lastKnown = { x: best.x, z: best.z, t: m.time }; this.seen = m.time; }
    } else if (this.target) { const t = ents.find((e) => e.slot === this.target.slot); this.target = t && t.alive ? t : null; }
    const tg = this.target, wdef = WEAPONS[this.wpn], dom = m.mode.id === 'dom';
    // objective: in Domination every bot always has a point to push or hold, even mid-fight
    if (dom && (!this.goal || this.goalT <= 0)) { this.goal = this._pickGoal(ents); this.goalT = 9 + rand(4); }
    this.goalT -= dt;
    // movement
    let mx = 0, mz = 0, sp = SPEED;
    const gd = this.goal ? Math.hypot(this.goal.x - b.x, this.goal.z - b.z) : 0;
    if (tg && dom && gd > 4.5) {
      // advance on the objective while fighting: path toward the point, strafe a little, aim at the target
      const dist = L.flowField(this.goal.x, this.goal.z, 1); if (dist) L.flowDirIn(dist, b.x, b.z, _f); else { _f.x = (this.goal.x - b.x) / gd; _f.z = (this.goal.z - b.z) / gd; }
      if (this.strafeT <= 0) { this.strafeT = rand(0.5, 1.4); if (Math.random() < 0.5) this.strafe *= -1; this.crouch = 0; }
      mx = _f.x * 0.85 - _f.z * this.strafe * 0.35; mz = _f.z * 0.85 + _f.x * this.strafe * 0.35; sp *= 0.8;
      const dx = tg.x - b.x, dz = tg.z - b.z, d = Math.hypot(dx, dz) || 1;
      this.yaw += angleDelta(this.yaw, Math.atan2(-dx, -dz)) * Math.min(1, (2.4 + this.skill * 9) * dt);
      this.pitch = damp(this.pitch, Math.atan2(tg.y + 1.2 - (b.y + 1.6), d), 8, dt);
    } else if (tg) {
      const dx = tg.x - b.x, dz = tg.z - b.z, d = Math.hypot(dx, dz) || 1, eng = ENGAGE[this.wpn];
      if (this.strafeT <= 0) { this.strafeT = rand(0.6, 1.8); if (Math.random() < 0.45) this.strafe *= -1; this.crouch = Math.random() < 0.25 && this.wpn !== 'shotgun' ? 1 : 0; }
      const fw = d > eng ? 0.85 : d < eng * 0.45 ? -0.6 : 0;
      mx = dx / d * fw - dz / d * this.strafe * 0.8; mz = dz / d * fw + dx / d * this.strafe * 0.8; sp *= this.crouch ? 0.45 : 0.75;
      const want = Math.atan2(-dx, -dz); this.yaw += angleDelta(this.yaw, want) * Math.min(1, (2.4 + this.skill * 9) * dt);
      this.pitch = damp(this.pitch, Math.atan2(tg.y + 1.2 - (b.y + 1.6), d), 8, dt);
    } else {
      this.crouch = 0;
      if (!dom && (!this.goal || this.goalT <= 0)) { this.goal = this.lastKnown && m.time - this.lastKnown.t < 5 ? { x: this.lastKnown.x, z: this.lastKnown.z, hold: 0 } : this._pickGoal(ents); this.goalT = 14; this.lastKnown = null; }
      const gd = Math.hypot(this.goal.x - b.x, this.goal.z - b.z);
      if (gd > 1.6) { const dist = L.flowField(this.goal.x, this.goal.z, 1); if (dist) { L.flowDirIn(dist, b.x, b.z, _f); mx = _f.x; mz = _f.z; } if (!mx && !mz) { mx = (this.goal.x - b.x) / gd; mz = (this.goal.z - b.z) / gd; } sp *= 1.25; }
      else { const pi = dom ? this._pointAt(this.goal) : -1; const ours = pi >= 0 && m.H.pt[pi][0] === this.team && Math.abs(m.H.pt[pi][1]) >= 99; if (!dom || ours) { this.goal.hold -= dt; if (this.goal.hold <= 0) this.goalT = 0; } this.yaw += dt * 0.6 * this.strafe; }
      if (mx || mz) this.yaw += angleDelta(this.yaw, Math.atan2(-mx, -mz)) * Math.min(1, 7 * dt);
      this.pitch = damp(this.pitch, 0, 4, dt);
    }
    b.vx = damp(b.vx, mx * sp, b.onGround ? 10 : 2, dt); b.vz = damp(b.vz, mz * sp, b.onGround ? 10 : 2, dt);
    b.hitWall = false; L.moveBody(b, dt);
    // stuck: hop, then pick a new goal
    this.stuckT += dt;
    if (this.stuckT > 1.2) { const moved = Math.hypot(b.x - this.lastPos.x, b.z - this.lastPos.z); if (moved < 0.5 && (mx || mz)) { if (b.onGround) b.vy = 7; this.goalT = 0; this.strafe *= -1; } this.stuckT = 0; this.lastPos.x = b.x; this.lastPos.z = b.z; }
    const H = L.half - 1; b.x = clamp(b.x, -H, H); b.z = clamp(b.z, -H, H);
    // shooting
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = wdef.mag; return; }
    if (!tg || this.invuln > 1.2) return;
    this.react -= dt; if (this.react > 0) return;
    const facing = Math.abs(angleDelta(this.yaw, Math.atan2(-(tg.x - b.x), -(tg.z - b.z))));
    if (facing > 0.25 || this.cool > 0) return;
    if (this.burst <= 0) { this.burst = this.wpn === 'marksman' || this.wpn === 'shotgun' ? 1 : 3 + (Math.random() * 4 | 0); }
    this._shoot(tg, wdef);
    this.burst--; this.mag--;
    this.cool = 60 / wdef.rpm * (this.wpn === 'marksman' ? 2.2 : 1.12) + (this.burst <= 0 ? rand(0.4, 1.0) * (1.6 - this.skill) : 60 / wdef.rpm * (1 - this.skill) * 0.8);
    if (this.mag <= 0) this.reloadT = wdef.reload * 1.1;
  }

  _shoot(tg, wdef) {
    const m = this.m, b = this.body, d = Math.hypot(tg.x - b.x, tg.z - b.z), eng = ENGAGE[this.wpn];
    this.fs++; m.markFired(this.slot);
    let p = 0.05 + this.skill * 0.6;
    p *= d < eng ? 1 : clamp(1 - (d - eng) / (eng * 1.6), 0.15, 1);
    p *= Math.hypot(tg.vx || 0, tg.vz || 0) > 3 ? 0.78 : 1;
    p *= m.time - this.seen < 0.6 ? 1 : 0.85;
    if (tg.crouch) p *= 0.85;
    const pellets = wdef.pellets || 1;
    let dmg = 0, crit = false;
    const pp = pellets > 1 ? (d < 8 ? 0.7 : d < 16 ? 0.35 : 0.08) * (0.35 + this.skill * 0.65) : p;
    for (let i = 0; i < pellets; i++) if (Math.random() < pp) dmg += wdef.dmg;
    if (dmg > 0 && pellets === 1 && Math.random() < 0.02 + this.skill * 0.16) { crit = true; dmg *= wdef.head; }
    dmg *= d > wdef.range[0] ? clamp(1 - (d - wdef.range[0]) / (wdef.range[1] - wdef.range[0]) * 0.5, 0.5, 1) : 1;
    // tracer end point: on the target if it connected, a near miss otherwise
    const ty = tg.y + (crit ? 1.65 : 1.15) + (dmg > 0 ? 0 : rand(-0.6, 0.6)); const ox = dmg > 0 ? 0 : rand(-1.2, 1.2), oz = dmg > 0 ? 0 : rand(-1.2, 1.2);
    this.end[0] = tg.x + ox; this.end[1] = ty; this.end[2] = tg.z + oz;
    if (dmg > 0) m.botHit(this.slot, tg.slot, dmg, crit, this.wpn, b.x, b.z);
  }
}
