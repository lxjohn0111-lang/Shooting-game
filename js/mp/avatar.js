// A remote operative (human or AI) as seen on this machine: the robot trooper rig, tinted, driven by network snapshots.
import * as THREE from '../lib/three.min.js';
import { Trooper } from '../enemies.js';
import { WEAPONS, MP_LOADOUT } from '../config.js';
import { clamp, damp, lerp, angleDelta } from '../util.js';

const DELAY = 110; // ms of interpolation buffer
const _v = new THREE.Vector3();

export class Avatar extends Trooper {
  constructor(sys, match, slot, st, tint, friendly) {
    super(sys, 'trooper', st.x, st.z, { noDrop: true });
    this.netAvatar = true; this.match = match; this.slot = slot; this.friendly = !!friendly;
    this.mat.color.setRGB(tint[0], tint[1], tint[2]);
    this.pos.set(st.x, st.y, st.z); this.yaw = this.aimYaw = st.yaw; this.netPitch = st.pitch; this.buf = []; this.see = true; this.lastFire = -99;
    this.zones = [[0, 1.86, 0, 0.21, 2], [0, 1.45, 0, 0.38, 1], [0, 0.98, 0, 0.32, 1], [0, 0.45, 0, 0.3, 0.8]];
    this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
  }
  push(st, t) { const b = this.buf; b.push({ t, ...st }); if (b.length > 24) b.shift(); }
  update(dt) {
    const b = this.buf, tr = performance.now() - DELAY;
    if (b.length) {
      let i = b.length - 1; while (i > 0 && b[i - 1].t > tr) i--;
      const s1 = b[i], s0 = b[i > 0 ? i - 1 : 0];
      let k = s1.t > s0.t ? clamp((tr - s0.t) / (s1.t - s0.t), 0, 1.15) : 1;
      if (tr > s1.t) k = 1;
      const px = this.pos.x, pz = this.pos.z;
      const big = Math.hypot(s1.x - s0.x, s1.z - s0.z) > 4; // teleport (respawn): snap
      this.pos.set(big ? s1.x : lerp(s0.x, s1.x, k), big ? s1.y : lerp(s0.y, s1.y, k), big ? s1.z : lerp(s0.z, s1.z, k));
      this.yaw = s0.yaw + angleDelta(s0.yaw, s1.yaw) * k; this.aimYaw = this.yaw; this.netPitch = lerp(s0.pitch, s1.pitch, k);
      const inv = 1 / Math.max(dt, 1e-3); this.vel.x = damp(this.vel.x, (this.pos.x - px) * inv, 12, dt); this.vel.z = damp(this.vel.z, (this.pos.z - pz) * inv, 12, dt);
      if (Math.hypot(this.vel.x, this.vel.z) > 14) this.vel.set(0, 0, 0);
      this.kneel = damp(this.kneel, s1.crouch * 0.55, 10, dt);
    }
    this.twist = 0;
    this.animBiped(dt, 2.3, 0.62);
    // aim: whole upper body pitches with the view
    this.arms.rotation.x = damp(this.arms.rotation.x, clamp(this.netPitch, -1.1, 1.1) - this.torso.rotation.x, 14, dt) + this.recoilK * 0.05;
    this.arms.position.z = this.recoilK * 0.07; this.arms.rotation.z = this.flinch * 0.25 * this.flinchSide;
    this.common(dt);
  }
  // remote shot: muzzle flash, tracer and sound
  shootFx(ex, ey, ez, wIdx, n = 1) {
    const g = this.game, fx = g.fx, id = MP_LOADOUT[wIdx] || 'rifle', w = WEAPONS[id];
    const m = this.muzzleWorld(this.arms, 0.3, -0.22, -1.18), mx = m.x, my = m.y, mz = m.z;
    fx.glow(mx, my, mz, 0.45, [1, 0.75, 0.4], 0.05, 4, 6); fx.glow(mx, my, mz, 0.9, [1, 0.7, 0.35], 0.05, 0, 1.6);
    const pel = w.pellets ? 4 : 1;
    for (let i = 0; i < pel; i++) { const s = w.pellets ? 0.7 : 0; fx.tracer(mx, my, mz, ex + (Math.random() - 0.5) * s, ey + (Math.random() - 0.5) * s, ez + (Math.random() - 0.5) * s, [1, 0.82, 0.5], 0.03); }
    if (Math.hypot(ex - mx, ey - my, ez - mz) > 1.5) { fx.sparks(ex, ey, ez, mx - ex, 0.4, mz - ez, 2, [1, 0.8, 0.5], 4, 0.6); }
    g.gfx.flash(_v.set(mx, my, mz), new THREE.Color(1, 0.7, 0.35), 18, 0.06, 10);
    g.audio.play(w.sound, { pos: { x: mx, y: my, z: mz }, vol: 0.75, ref: 7, rv: 0.05, throttle: 0.025 });
    this.recoilK = Math.min(1.6, this.recoilK + n * 0.8); this.lastFire = g.time;
  }
  // a local bullet / blast connected with this operative: tell its owner, show the feedback here
  hit(dmg, x, y, z, dx, dy, dz, o = {}) {
    if (this.dead) return null; const g = this.game;
    this.match.onLocalHit(this.slot, dmg, !!o.crit, o.explosive ? 'frag' : o.melee ? 'melee' : (o.weapon || 'rifle'));
    this.flinch = Math.min(1, this.flinch + 0.25 + dmg / 300); this.flinchSide = Math.random() < 0.5 ? -1 : 1; this.flash = 1;
    g.fx.robotHit(x, y, z, -dx, -dy + 0.3, -dz, [1, 0.8, 0.5], o.crit);
    if (g.settings.dmgNumbers) g.ui.dmgNumber(x, y, z, dmg, o.crit);
    return 'hit';
  }
  // death visual, triggered by the network death event
  kill(dx, dz, crit) { if (this.dead) return; this.hp = 0; this.die(dx, 0, dz, { crit }); }
  deathStyle(o) { return o.crit ? 'head' : Math.random() < 0.25 ? 'overload' : 'collapse'; }
  healthBar() { }
}
