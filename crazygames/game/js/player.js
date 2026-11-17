// First-person player: movement, camera feel, weapons, view-model animation
import * as THREE from './lib/three.min.js';
import { WEAPONS, WEAPON_ORDER } from './config.js';
import { buildWeapon } from './models.js';
import { clamp, lerp, damp, rand, smoothstep, TAU } from './util.js';

const S = 0.3; // view-model scale trick (keeps weapon from clipping into walls)
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Player {
  constructor(game) {
    this.game = game; const cam = this.cam = game.gfx.camera;
    this.body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.38, h: 1.8, onGround: true, gravity: 22, groundY: 0, landV: 0 };
    this.yaw = 0; this.pitch = 0; this.eye = 1.65; this.fov = 75; this.baseFov = 75;
    this.rig = new THREE.Group(); this.rig.scale.setScalar(S); cam.add(this.rig);
    this.holder = new THREE.Group(); this.holder.scale.set(1, 1, 0.62); this.rig.add(this.holder);
    this.models = {};
    this.reset();
  }

  stat(id) { // weapon stats with upgrades applied (multiplayer is a level field: no upgrades)
    const w = WEAPONS[id], u = this.game.mp ? {} : (this.game.save.data.upgrades[id] || {});
    const dm = 1 + 0.12 * (u.dmg || 0), mg = 1 + 0.2 * (u.mag || 0), hd = 1 - 0.1 * (u.handling || 0);
    return { dmg: w.dmg * dm, mag: Math.round(w.mag * mg), reserve: w.reserve === Infinity ? Infinity : Math.round(w.reserve * mg), reload: w.reload * hd, kick: hd };
  }

  reset() {
    const sv = this.game.save.data, mp = this.game.mp, pk = mp ? {} : sv.perks;
    this.maxHealth = 100 + 20 * (pk.vitality || 0); this.health = this.maxHealth;
    this.maxShield = 60 + 20 * (pk.shield || 0); this.shield = this.maxShield; this.shieldDelay = 0; this.shieldBroken = false;
    this.maxGrenades = 2 + (pk.grenadier || 0); this.grenades = this.maxGrenades;
    this.focus = 0.5; this.focusOn = false; this.focusK = 0; this.focusDur = 5 * (1 + 0.25 * (pk.focus || 0));
    this.dead = false; this.invuln = 0;
    this.inv = []; // owned weapons in slot order
    const owned = mp ? mp.loadout : sv.weapons;
    for (const id of WEAPON_ORDER) if (owned.includes(id)) { const st = this.stat(id); this.inv.push({ id, ammo: st.mag, reserve: st.reserve }); }
    this.cur = Math.min(1, this.inv.length - 1); this.last = 0;
    this.swapT = 0; this.swapTo = -1; this.reloadT = -1; this.fireCd = 0; this.bloom = 0; this.adsT = 0; this.sprintT = 0; this.charge = -1;
    this.recoil = { p: 0, y: 0, vp: 0, vy: 0 }; this.kick = { z: 0, r: 0, roll: 0 }; this.sway = { x: 0, y: 0 }; this.bob = 0; this.bobAmp = 0; this.landDip = 0; this.roll = 0;
    this.shake = 0; this.crouchT = 0; this.slideT = 0; this.slideDir = { x: 0, z: 0 }; this.coyote = 0; this.meleeT = -1; this.throwT = -1; this.boltT = 1; this.pumpT = 1; this.stepPh = 0; this.hurtT = 0; this.equipT = 0.4;
    this.moving = 0; this.airT = 0; this.deathT = 0; this.deathSide = 1; this.deathEye = 1.65; this.deathPitch = 0; this.deathThud = false; this.reloadEmpty = false; this.slideK = 0; this.roll = 0;
    this._equip(this.cur, true);
  }

  place(x, z, yaw = 0) { const b = this.body; b.x = x; b.z = z; b.y = 0; b.vx = b.vy = b.vz = 0; this.yaw = yaw; this.pitch = 0; }

  get weapon() { return this.inv[this.cur]; }
  get wdef() { return WEAPONS[this.inv[this.cur].id]; }

  _model(id) {
    if (!this.models[id]) { const m = buildWeapon(id, this.game.M.weapon); m.group.visible = false; this.holder.add(m.group); m.magHome = m.parts.mag ? m.parts.mag.position.clone() : null; this.models[id] = m; }
    return this.models[id];
  }
  _equip(i, instant = false) {
    for (const k in this.models) this.models[k].group.visible = false;
    this.cur = i; const m = this.model = this._model(this.inv[i].id); m.group.visible = true;
    this.reloadT = -1; this.charge = -1; this.equipT = instant ? 0 : 0.28;
    if (m.parts.mag) m.parts.mag.position.copy(m.magHome);
    this.game.ui && this.game.ui.hudWeapon(this);
  }
  switchTo(i) {
    if (i === this.cur || i < 0 || i >= this.inv.length || this.swapTo === i) return;
    this.swapTo = i; this.swapT = 0.16; this.reloadT = -1; this.reloadDone = 0; this.charge = -1; this.last = this.cur;
    this.game.audio.play('swap', { vol: 0.5, reverb: 0.1 });
  }
  addWeapon(id) { if (this.inv.find(w => w.id === id)) return; const st = this.stat(id); this.inv.push({ id, ammo: st.mag, reserve: st.reserve }); this.inv.sort((a, b) => WEAPONS[a.id].slot - WEAPONS[b.id].slot); }
  addAmmo(frac) { let any = false; for (const w of this.inv) { const st = this.stat(w.id); if (st.reserve === Infinity) continue; const add = Math.max(1, Math.round(st.reserve * frac)); if (w.reserve < st.reserve) { w.reserve = Math.min(st.reserve, w.reserve + add); any = true; } } this.game.ui.hudWeapon(this); return any; }

  damage(amount, from, opts = {}) {
    if (this.dead || this.invuln > 0 || this.game.godMode) return;
    this.lastHit = { by: opts.attacker ?? -1, w: opts.wpn ?? (opts.pierceShield ? 92 : 1), crit: !!opts.crit, t: this.game.time };
    amount *= this.game.diff.dmg;
    const g = this.game;
    this.shieldDelay = 3.6 - 0.35 * (g.save.data.perks.shield || 0);
    if (this.shield > 0 && !opts.pierceShield) {
      const s = Math.min(this.shield, amount); this.shield -= s; amount -= s * 1.0;
      g.gfx.fx.uShield.value = Math.min(1, g.gfx.fx.uShield.value + 0.6);
      if (this.shield <= 0) { g.audio.play('shield_break', { vol: 0.7, reverb: 0.2 }); this.shieldBroken = true; } else g.audio.play('shield_hit', { vol: 0.5, rv: 0.1, throttle: 0.05 });
    }
    if (amount > 0) {
      this.health -= amount; this.hurtT = 1;
      g.gfx.fx.uDamage.value = Math.min(1, g.gfx.fx.uDamage.value + 0.35 + amount / 60);
      g.audio.play('hurt', { vol: 0.7, throttle: 0.08 });
      this.shake = Math.min(1, this.shake + 0.25 + amount / 80);
      g.stats.damageTaken += amount;
    }
    if (from) g.ui.damageDir(from, this);
    if (this.health <= 0) {
      this.health = 0; this.dead = true; this.deathT = 0; this.deathEye = this.eye; this.deathPitch = this.pitch; this.deathThud = false; this.reloadT = -1; this.charge = -1;
      this.deathSide = from ? (Math.sin(this.yaw) * (from.z - this.body.z) - Math.cos(this.yaw) * (from.x - this.body.x) > 0 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1);
      g.onPlayerDeath();
    }
  }
  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }
  addFocus(n) { if (!this.focusOn) this.focus = Math.min(1, this.focus + n * (1 + 0.2 * (this.game.save.data.perks.focus || 0))); }

  // ---------- firing ----------
  _fire() {
    const g = this.game, w = this.weapon, def = this.wdef, st = this.stat(w.id), m = this.model, cam = this.cam;
    w.ammo--; this.fireCd = 60 / def.rpm; this.reloadT = -1; this.reloadDone = 0;
    cam.getWorldPosition(_v); cam.getWorldDirection(_v2);
    const ox = _v.x, oy = _v.y, oz = _v.z;
    const moveK = clamp(Math.hypot(this.body.vx, this.body.vz) / 6, 0, 1), air = this.body.onGround ? 0 : 1;
    const spread = lerp(def.hip * (1 + moveK * 0.9 + air * 1.5) * (this.crouchT > 0.5 ? 0.75 : 1), def.ads * (1 + moveK * 0.6), this.adsT) + this.bloom * (1 - this.adsT * 0.6);
    const muz = m.group.localToWorld(_v3.copy(m.muzzle));
    const mx = muz.x, my = muz.y, mz = muz.z;
    // basis for spread
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const fx = g.fx, pellets = def.pellets || 1;
    let anyHit = false, anyKill = false, anyCrit = false;
    if (def.projectile) {
      const dir = new THREE.Vector3(_v2.x, _v2.y, _v2.z).addScaledVector(right, rand(-spread, spread)).addScaledVector(up, rand(-spread, spread) + 0.06).normalize();
      g.projectiles.spawnGrenade(mx, my, mz, dir.x * 38, dir.y * 38, dir.z * 38, { impact: true, dmg: st.dmg, radius: def.radius, owner: 'player' });
    } else {
      for (let p = 0; p < pellets; p++) {
        const a = rand(TAU), r = Math.sqrt(Math.random()) * spread;
        const dx0 = _v2.x + (right.x * Math.cos(a) + up.x * Math.sin(a)) * r, dy0 = _v2.y + (right.y * Math.cos(a) + up.y * Math.sin(a)) * r, dz0 = _v2.z + (right.z * Math.cos(a) + up.z * Math.sin(a)) * r;
        const l = Math.hypot(dx0, dy0, dz0), dx = dx0 / l, dy = dy0 / l, dz = dz0 / l;
        const wh = g.level.raycast(ox, oy, oz, dx, dy, dz, 400);
        const maxT = wh ? wh.t : 400;
        const hits = g.enemies.raycastAll(ox, oy, oz, dx, dy, dz, maxT);
        let endT = maxT, stopped = false, pierce = def.pierce || 0;
        for (const h of hits) {
          let dmg = st.dmg * lerp(1, 0.5, smoothstep(def.range[0], def.range[1], h.t));
          const crit = h.mult > 1.01; dmg *= crit ? h.mult * (def.head / 2) : h.mult;
          const res = h.enemy.hit(dmg, ox + dx * h.t, oy + dy * h.t, oz + dz * h.t, dx, dy, dz, { crit, weapon: w.id, zone: h.zone });
          anyHit = true; if (crit && res !== 'shield') anyCrit = true; if (res === 'kill') anyKill = true;
          g.stats.hits++;
          if (pierce-- <= 0) { endT = h.t; stopped = true; break; }
        }
        if (!stopped && wh) {
          fx.impact(wh, dx, dy, dz, def.energy ? 2 : pellets > 1 ? 0.7 : 1);
          if (p === 0) g.audio.play(wh.kind === 'metal' ? 'metal_hit' : 'conc_hit', { pos: wh, vol: 0.5, rv: 0.2, throttle: 0.03 });
          if (wh.c && wh.c.prop) g.damageProp(wh.c.prop, st.dmg);
        }
        const ex = ox + dx * endT, ey = oy + dy * endT, ez = oz + dz * endT;
        if (p === 0 && g.mp) g.mp.onLocalShot(ex, ey, ez);
        if (def.energy) { fx.beam(mx, my, mz, ex, ey, ez, [0.3, 0.8, 1.0], 0.09, 0.5, 10); fx.glow(ex, ey, ez, 1.6, [0.3, 0.8, 1], 0.25, 0, 8); fx.sparks(ex, ey, ez, -dx, -dy + 0.5, -dz, 20, [0.4, 0.8, 1], 12, 1.5); }
        else if (p % 2 === 0) fx.tracer(mx, my, mz, ex, ey, ez, [1, 0.82, 0.5], pellets > 1 ? 0.022 : 0.032);
      }
    }
    g.stats.shots += 1;
    if (anyHit) { g.ui.hitmarker(anyKill, anyCrit); g.audio.play(anyCrit ? 'crit' : 'hit', { vol: 0.5, rv: 0.03, reverb: 0 }); }
    // feel
    const k = st.kick * (1 - this.adsT * 0.3) * (this.crouchT > 0.5 ? 0.85 : 1);
    this.recoil.vp += def.kick[0] * k * 0.55; this.recoil.vy += rand(-1, 1) * def.kick[1] * k * 0.55;
    this.pitch += def.kick[0] * k * 0.0055; this.yaw += rand(-1, 1) * def.kick[1] * k * 0.004;
    this.kick.z = Math.min(0.09, this.kick.z + 0.022 + def.kick[0] * 0.006); this.kick.r += 0.02 + def.kick[0] * 0.012; this.kick.roll += rand(-1, 1) * 0.02;
    this.bloom = Math.min(def.hip * 1.6, this.bloom + def.hip * 0.28);
    this.shake = Math.min(1, this.shake + def.shake * 0.11);
    this.boltT = 0; if (w.id === 'shotgun') this.pumpT = 0;
    _v2.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q));
    const lp = new THREE.Vector3(ox + _v2.x * 1.6, oy + _v2.y * 1.6 - 0.15, oz + _v2.z * 1.6);
    if (!def.energy) fx.muzzle(muz, _v2, def.pellets ? 1.5 : w.id === 'marksman' ? 1.4 : w.id === 'pistol' ? 0.8 : 1, [1.0, 0.75, 0.4], 0.17, lp);
    else { fx.glow(mx, my, mz, 0.22, [0.3, 0.8, 1], 0.12, 0, 6); g.gfx.flash(lp, new THREE.Color(0.3, 0.7, 1), 24, 0.15, 20); }
    if (!def.energy && !def.projectile && w.id !== 'shotgun') { const ej = m.group.localToWorld(_v3.copy(m.eject)); fx.casing(ej, _v.copy(right).multiplyScalar(rand(1.6, 2.6)).addScaledVector(up, rand(1.5, 2.5)).add(new THREE.Vector3(this.body.vx, 0, this.body.vz)), w.id === 'marksman' ? 1.5 : 1); }
    g.audio.play(def.sound, { vol: 0.9, rv: 0.04, reverb: 0.55 });
    g.onPlayerShot();
    g.ui.hudAmmo(this);
    if (w.ammo <= 0 && w.reserve > 0) this._queueReload = 0.25;
  }

  startReload() {
    const w = this.weapon, st = this.stat(w.id);
    if (this.reloadT >= 0 || w.ammo >= st.mag || w.reserve <= 0 || this.swapTo >= 0 || this.meleeT >= 0) return;
    this.reloadT = 0; this.reloadStage = 0; this.charge = -1; this.reloadEmpty = w.ammo === 0;
  }
  _reloadDur(st, def) { return st.reload * (this.reloadEmpty || this.weapon.id === 'launcher' ? 1 : 0.86); }
  // the spent magazine / power cell is physically thrown out of the weapon
  _dropMag() {
    const P = this.model.parts, g = this.game, b = this.body; if (!P.mag || !P.mag.visible) return;
    const mesh = new THREE.Mesh(P.mag.geometry, g.M.weapon); mesh.castShadow = true;
    mesh.position.copy(P.mag.position); mesh.rotation.copy(P.mag.rotation); P.mag.parent.add(mesh);
    _v.setFromMatrixColumn(this.cam.matrixWorld, 0).multiplyScalar(this.weapon.id === 'rail' ? -1.6 : -0.5);
    g.fx.addDebris(mesh, new THREE.Vector3(_v.x + b.vx, -0.4, _v.z + b.vz), 5, false, { floor: b.groundY, grow: 3.3, rad: 0.05, av: 5, sound: 'grenade_bounce' });
  }
  // small close-to-camera effects for the scaled view-model
  _vmFx(local, kind) {
    const g = this.game, fx = g.fx, m = this.model, w = m.group.localToWorld(_v3.copy(local));
    if (kind === 'steam') { for (let i = 0; i < 5; i++) fx.emit({ x: w.x, y: w.y, z: w.z, vx: rand(-0.12, 0.12), vy: rand(0.1, 0.3), vz: rand(-0.12, 0.12), life: rand(0.5, 0.9), s0: 0.015, s1: 0.11, r: 0.55, g: 0.75, b: 0.9, a: 0.3, add: false, frame: [1, 2, 13][i % 3], rv: rand(-2, 2), drag: 2, fadeIn: 0.05 }); }
    else { for (let i = 0; i < 7; i++) fx.emit({ x: w.x, y: w.y, z: w.z, vx: rand(-0.7, 0.7), vy: rand(-0.2, 0.9), vz: rand(-0.7, 0.7), life: rand(0.12, 0.3), s0: 0.004, s1: 0.001, r: 3, g: 7, b: 10, grav: 3, frame: 3, stretch: 0.03 }); fx.glow(w.x, w.y, w.z, 0.09, [0.3, 0.8, 1], 0.1, 0, 6); g.gfx.flash(w, new THREE.Color(0.3, 0.7, 1), 3, 0.15, 6); }
  }

  _melee() {
    const g = this.game; this.meleeT = 0; this.reloadT = -1;
    g.audio.play('melee', { vol: 0.6, reverb: 0.2 });
    this.cam.getWorldPosition(_v); this.cam.getWorldDirection(_v2);
    let hit = false;
    for (const e of g.enemies.list) {
      if (e.dead || e.friendly) continue; const dx = e.pos.x - _v.x, dy = e.pos.y + e.h * 0.5 - _v.y, dz = e.pos.z - _v.z, d = Math.hypot(dx, dy, dz);
      if (d < 2.3 + e.radius && (dx * _v2.x + dy * _v2.y + dz * _v2.z) / d > 0.45) { const r = e.hit(130, e.pos.x, e.pos.y + e.h * 0.6, e.pos.z, _v2.x, _v2.y, _v2.z, { melee: true }); hit = true; if (r === 'kill') g.ui.hitmarker(true, false); }
    }
    for (const p of g.level.props) if (!p.dead && Math.hypot(p.x - _v.x, p.z - _v.z) < 2) g.damageProp(p, 40);
    if (hit) { g.audio.play('melee_hit', { vol: 0.9 }); this.shake = Math.min(1, this.shake + 0.4); g.ui.hitmarker(false, false); }
  }

  // ---------- update ----------
  update(dt, input) {
    const g = this.game, b = this.body, cam = this.cam, def = this.wdef, w = this.weapon;
    if (this.dead) { // collapse: knees give way, topple sideways, weapon falls from the hands
      const T = (this.deathT += g.realDt), k1 = smoothstep(0, 0.34, T), k2 = smoothstep(0.26, 0.9, T), kk = k2 * k2;
      this.eye = lerp(lerp(this.deathEye, 1.0, k1), 0.2, kk) + (k2 >= 1 ? Math.sin(Math.min(1, (T - 0.9) / 0.28) * Math.PI) * 0.06 : 0);
      this.roll = this.deathSide * (0.1 * k1 + 1.25 * kk); this.pitch = lerp(lerp(this.deathPitch, -0.3, k1), 0.38, kk); this.yaw += this.deathSide * g.realDt * 0.35 * (1 - k2);
      if (k2 >= 1 && !this.deathThud) { this.deathThud = true; this.shake = 0.9; g.audio.play('land', { vol: 1, reverb: 0.3 }); g.audio.play('melee_hit', { vol: 0.6, rate: 0.7 }); }
      b.vx = damp(b.vx, 0, 6, dt); b.vz = damp(b.vz, 0, 6, dt); g.level.moveBody(b, dt);
      this.shake = Math.max(0, this.shake - g.realDt * 2.2); this.landDip = 0; this.bobAmp = 0; this.recoil.p = this.recoil.y = 0;
      this._applyCam(dt);
      const m = this.model, h = this.holder; h.position.set(m.hip.x + 0.02 + T * 0.12, m.hip.y - 0.02 - T * T * 1.5, m.hip.z - 0.11 + T * 0.1); h.rotation.set(-T * 2.4, T * 0.9, T * 3.4, 'YXZ');
      return;
    }
    // look
    const zoomK = lerp(1, def.scope ? 0.3 : 0.75, this.adsT);
    const sens = 0.0022 * input.sens * zoomK;
    this.yaw -= input.dx * sens; this.pitch -= input.dy * sens * (input.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    // movement intent
    let ix = (input.is('right') ? 1 : 0) - (input.is('left') ? 1 : 0) + input.stick.x, iz = (input.is('back') ? 1 : 0) - (input.is('forward') ? 1 : 0) + input.stick.y;
    const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ix * cos + iz * sin, wz = -ix * sin + iz * cos;
    const wantCrouch = input.is('crouch');
    const forwardish = iz < -0.3 || (input.touch && il > 0.92 && iz < -0.5);
    const sprinting = (input.is('sprint') || (input.touch && il > 0.95 && iz < -0.6)) && forwardish && !wantCrouch && this.adsT < 0.3 && this.slideT <= 0 && b.onGround;
    // slide
    if (input.hit('crouch') && b.onGround && Math.hypot(b.vx, b.vz) > 6.2 && this.slideT <= 0) { this.slideT = 0.75; const l = Math.hypot(b.vx, b.vz); this.slideDir.x = b.vx / l; this.slideDir.z = b.vz / l; g.audio.play('slide', { vol: 0.5, reverb: 0.2 }); }
    if (this.slideT > 0) { this.slideT -= dt; if (!wantCrouch && this.slideT < 0.45) this.slideT = 0; }
    const crouching = wantCrouch || this.slideT > 0;
    // stand-up check
    let canStand = true;
    if (!crouching && this.crouchT > 0.2) { const h = g.level.raycast(b.x, b.y + 1.0, b.z, 0, 1, 0, 0.85, false); if (h) canStand = false; }
    this.crouchT = damp(this.crouchT, crouching || !canStand ? 1 : 0, 12, dt);
    b.h = lerp(1.8, 1.15, this.crouchT);
    const ads = input.is('ads') && this.swapTo < 0 && this.meleeT < 0 && !(this.reloadT >= 0 && !def.shellReload) && this.equipT <= 0;
    let speed = sprinting ? 7.9 : 5.3; speed *= def.move; if (this.crouchT > 0.5) speed *= 0.55; speed *= lerp(1, 0.62, this.adsT);
    if (this.focusOn) speed *= 1.1;
    if (this.slideT > 0) { const sp = 10.5 * (0.35 + 0.65 * this.slideT / 0.75); b.vx = this.slideDir.x * sp; b.vz = this.slideDir.z * sp; }
    else { const acc = b.onGround ? 14 : 3.2; b.vx = damp(b.vx, wx * speed, acc, dt); b.vz = damp(b.vz, wz * speed, acc, dt); }
    this.coyote = b.onGround ? 0.12 : this.coyote - dt;
    if (input.hit('jump') && this.coyote > 0 && canStand) { b.vy = 7.4; b.onGround = false; this.coyote = 0; this.slideT = 0; g.audio.play('jump', { vol: 0.4, reverb: 0.1 }); }
    const wasGround = b.onGround; b.hitWall = false;
    g.level.moveBody(b, dt);
    if (!wasGround && b.onGround && b.landV > 3) { this.landDip = Math.min(0.22, b.landV * 0.018); g.audio.play('land', { vol: clamp(b.landV / 12, 0.2, 0.9), reverb: 0.2 }); if (b.landV > 17) this.damage((b.landV - 17) * 4, null, { pierceShield: true }); }
    this.airT = b.onGround ? 0 : this.airT + dt;
    const hs = Math.hypot(b.vx, b.vz); this.moving = hs;
    // footsteps / bob
    if (b.onGround && hs > 0.8 && this.slideT <= 0) {
      this.stepPh += hs * dt * 0.62;
      if (this.stepPh >= 1) { this.stepPh -= 1; g.audio.play(b.groundY > 0.5 ? 'step_metal' : (Math.random() < 0.5 ? 'step1' : 'step2'), { vol: (sprinting ? 0.5 : 0.32) * (this.crouchT > 0.5 ? 0.4 : 1), rv: 0.12, reverb: 0.25 }); }
      this.bob += hs * dt * 1.95; this.bobAmp = damp(this.bobAmp, Math.min(1.5, hs / 5.3), 8, dt);
    } else this.bobAmp = damp(this.bobAmp, 0, 8, dt);
    // timers
    this.fireCd -= dt; this.invuln -= dt; this.hurtT = Math.max(0, this.hurtT - dt * 0.5);
    this.adsT = damp(this.adsT, ads ? 1 : 0, ads ? 16 : 14, dt); this.sprintT = damp(this.sprintT, sprinting && this.reloadT < 0 ? 1 : 0, 10, dt);
    this.bloom = damp(this.bloom, 0, 7, dt);
    this.equipT = Math.max(0, this.equipT - dt);
    // shield regen
    if (this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (this.shield < this.maxShield) { if (this.shieldBroken || this.shield === 0) { g.audio.play('shield_up', { vol: 0.45, reverb: 0.2 }); this.shieldBroken = false; } this.shield = Math.min(this.maxShield, this.shield + (26 + 6 * (g.save.data.perks.shield || 0)) * dt); }
    if (this.health < this.maxHealth * 0.35 && this.shieldDelay <= 0) this.health = Math.min(this.maxHealth * 0.35, this.health + 4 * dt);
    // weapon switching
    if (this.swapTo >= 0) { this.swapT -= dt; if (this.swapT <= 0) { this._equip(this.swapTo); this.swapTo = -1; } }
    else {
      if (input.slot > 0) { const idx = this.inv.findIndex(x => WEAPONS[x.id].slot === input.slot); if (idx >= 0) this.switchTo(idx); }
      if (input.wheel) this.switchTo((this.cur + Math.sign(input.wheel) + this.inv.length) % this.inv.length);
      if (input.hit('next')) this.switchTo(this.last !== this.cur && this.last < this.inv.length ? this.last : (this.cur + 1) % this.inv.length);
    }
    const busy = this.swapTo >= 0 || this.equipT > 0 || this.meleeT >= 0 || this.throwT >= 0;
    // reload
    if (this._queueReload !== undefined) { this._queueReload -= dt; if (this._queueReload <= 0) { this._queueReload = undefined; this.startReload(); } }
    if (input.hit('reload')) this.startReload();
    if (this.reloadT >= 0) this._updateReload(dt);
    // fire
    const wantFire = def.auto ? input.is('fire') : input.hit('fire');
    if (def.charge) {
      if (this.charge < 0 && wantFire && !busy && this.fireCd <= 0 && this.reloadT < 0 && this.sprintT < 0.5) { if (w.ammo > 0) { this.charge = 0; g.audio.play('rail_charge', { vol: 0.7, reverb: 0.2 }); } else this._dry(); }
      if (this.charge >= 0) { this.charge += dt; if (this.charge >= def.charge) { this.charge = -1; this._fire(); } }
    } else if (wantFire && !busy && this.fireCd <= 0 && this.sprintT < 0.5) {
      if (this.reloadT >= 0 && !(def.shellReload && w.ammo > 0)) { /* reloading */ }
      else if (w.ammo > 0) { this.reloadT = -1; this._fire(); }
      else this._dry();
    }
    // grenade / melee / focus
    if (input.hit('grenade') && this.grenades > 0 && this.throwT < 0 && this.meleeT < 0) { this.throwT = 0; this.reloadT = -1; g.audio.play('pin', { vol: 0.6 }); }
    if (this.throwT >= 0) {
      const prev = this.throwT; this.throwT += dt;
      if (prev < 0.22 && this.throwT >= 0.22) { this.grenades--; cam.getWorldPosition(_v); cam.getWorldDirection(_v2); { const gx = _v.x + _v2.x * 0.5, gy = _v.y + _v2.y * 0.5 - 0.1, gz = _v.z + _v2.z * 0.5, gvx = _v2.x * 17 + b.vx * 0.6, gvy = _v2.y * 17 + 4, gvz = _v2.z * 17 + b.vz * 0.6; g.projectiles.spawnGrenade(gx, gy, gz, gvx, gvy, gvz, { fuse: 1.9, dmg: g.mp ? 150 : 220, radius: g.mp ? 6 : 7, owner: 'player' }); if (g.mp) g.mp.onThrow(gx, gy, gz, gvx, gvy, gvz); } g.audio.play('melee', { vol: 0.4 }); g.ui.hudStatus(this); }
      if (this.throwT > 0.5) this.throwT = -1;
    }
    if (input.hit('melee') && this.meleeT < 0 && this.throwT < 0 && this.swapTo < 0) this._melee();
    if (this.meleeT >= 0) { this.meleeT += dt; if (this.meleeT > 0.42) this.meleeT = -1; }
    if (input.hit('focus') && !g.mp) { if (!this.focusOn && this.focus >= 0.3) { this.focusOn = true; g.audio.play('focus_in', { vol: 0.8, reverb: 0.3 }); } else if (this.focusOn) this.focusOn = false; else g.audio.play('ui_deny', { vol: 0.4, reverb: 0 }); }
    if (this.focusOn) { this.focus -= g.realDt / this.focusDur; if (this.focus <= 0) { this.focus = 0; this.focusOn = false; } if (!this.focusOn) g.audio.play('focus_out', { vol: 0.7, reverb: 0.3 }); }
    this.focusK = damp(this.focusK, this.focusOn ? 1 : 0, 9, g.realDt);
    // recoil spring
    const r = this.recoil; r.vp += (-r.p * 110 - r.vp * 15) * dt; r.vy += (-r.y * 110 - r.vy * 15) * dt; r.p += r.vp * dt; r.y += r.vy * dt;
    const kk = this.kick; kk.z = damp(kk.z, 0, 16, dt); kk.r = damp(kk.r, 0, 14, dt); kk.roll = damp(kk.roll, 0, 12, dt);
    this.boltT = Math.min(1, this.boltT + dt * (w.id === 'pistol' ? 11 : 14)); this.pumpT = Math.min(1, this.pumpT + dt * 2.6);
    if (w.id === 'shotgun' && this.pumpT > 0.25 && this.pumpT - dt * 2.6 <= 0.25 && this.reloadT < 0) { g.audio.play('pump', { vol: 0.6, reverb: 0.2 }); const m = this.model; const ej = m.group.localToWorld(_v3.copy(m.eject)); _v.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(2).setY(1.8); g.fx.casing(ej, _v.clone(), 2.2); }
    this.shake = Math.max(0, this.shake - dt * 2.2); this.landDip = damp(this.landDip, 0, 9, dt);
    this.sway.x = damp(this.sway.x, clamp(-input.dx * 0.0009, -0.05, 0.05), 10, dt); this.sway.y = damp(this.sway.y, clamp(-input.dy * 0.0009, -0.05, 0.05), 10, dt);
    this.roll = damp(this.roll, -ix * 0.022 * Math.min(1, hs / 5) + (this.slideT > 0 ? 0.06 : 0) + (this.meleeT >= 0 ? Math.sin(this.meleeT / 0.42 * Math.PI) * -0.06 : 0), 10, dt); this.slideK = damp(this.slideK, this.slideT > 0 ? 1 : 0, 12, dt);
    this.eye = damp(this.eye, lerp(1.65, 1.0, this.crouchT) - (this.slideT > 0 ? 0.2 : 0), 14, dt);
    this.fov = damp(this.fov, this.baseFov * lerp(1, def.adsFov, this.adsT) * (1 + this.sprintT * 0.07) * (1 + this.focusK * 0.06) * (this.charge >= 0 ? 1 - this.charge * 0.12 : 1), 14, dt);
    this._applyCam(dt);
    this._viewModel(dt, g.time);
  }

  _dry() { this.fireCd = 0.25; this.game.audio.play('dry', { vol: 0.5, reverb: 0 }); if (this.weapon.reserve > 0) this.startReload(); else this.game.ui.toast('NO AMMO', 'warn', 0.9); }

  _updateReload(dt) {
    const g = this.game, w = this.weapon, def = this.wdef, st = this.stat(w.id), au = g.audio, m = this.model;
    if (def.shellReload) {
      const per = st.reload, lead = 0.4; this.reloadT += dt;
      if (this.reloadT > lead + per * (this.reloadStage + 0.55)) {
        this.reloadStage++; w.ammo++; w.reserve--; au.play('shell_in', { vol: 0.65, reverb: 0.15 }); g.ui.hudAmmo(this);
        if (w.ammo >= st.mag || w.reserve <= 0) this.reloadDone = this.reloadT + per * 0.45;
      }
      if (this.reloadDone && this.reloadT >= this.reloadDone) { this.reloadDone = 0; this.reloadT = -1; this.pumpT = 0; this.fireCd = 0.45; }
      return;
    }
    const dur = this._reloadDur(st, def), prev = this.reloadT / dur; this.reloadT += dt; const t = this.reloadT / dur, at = (x) => prev < x && t >= x;
    const refill = () => { const take = Math.min(st.mag - w.ammo, w.reserve); w.ammo += take; if (w.reserve !== Infinity) w.reserve -= take; g.ui.hudAmmo(this); };
    if (w.id === 'launcher') {
      if (at(0.13)) au.play('reload_out', { vol: 0.65, reverb: 0.15 });
      if (at(0.24)) { const p0 = m.group.localToWorld(_v3.set(-0.1, 0.0, -0.1)); for (let i = 0; i < 3; i++) g.fx.casing(p0, new THREE.Vector3(rand(-0.5, 0.5) + this.body.vx, rand(-0.5, 0.2), rand(-0.5, 0.5) + this.body.vz), 2.6); }
      for (let k = 0; k < 6; k++) if (at(0.41 + k * 0.06)) au.play('shell_in', { vol: 0.5, rate: 0.85 + k * 0.03, reverb: 0.1 });
      if (at(0.83)) { au.play('reload_in', { vol: 0.75, reverb: 0.15 }); refill(); }
    } else {
      if (at(0.14)) au.play('reload_out', { vol: 0.65, reverb: 0.15 });
      if (at(0.25)) this._dropMag();
      if (w.id === 'rail') { if (at(0.2)) { this._vmFx(_v2.set(0, -0.04, -0.02), 'steam'); au.play('shield_break', { vol: 0.3, rate: 1.8, reverb: 0.1 }); } if (at(0.64)) this._vmFx(_v2.set(0, -0.05, -0.02), 'arc'); if (at(0.76)) au.play('rail_charge', { vol: 0.3, rate: 1.6, reverb: 0.1 }); }
      if (at(0.63)) { au.play('reload_in', { vol: 0.7, reverb: 0.15 }); refill(); }
      if (at(0.71)) au.play('dry', { vol: 0.3, rate: 0.65, reverb: 0.05 });
      if (this.reloadEmpty && at(0.83)) { au.play('bolt', { vol: 0.65, reverb: 0.15 }); }
    }
    if (t >= 1) this.reloadT = -1;
  }

  _applyCam(dt) {
    const b = this.body, cam = this.cam, t = this.game.time, sh = this.shake * this.shake;
    const bobY = Math.sin(this.bob * 2) * 0.022 * this.bobAmp, bobX = Math.cos(this.bob) * 0.012 * this.bobAmp;
    cam.position.set(b.x, b.y + this.eye - this.landDip + bobY * (1 - this.adsT * 0.7), b.z);
    const sx = (Math.sin(t * 47.1) + Math.sin(t * 81.7)) * 0.014 * sh, sy = (Math.sin(t * 53.3 + 1) + Math.sin(t * 91.1)) * 0.014 * sh, sz = Math.sin(t * 61.7 + 2) * 0.02 * sh;
    _e.set(this.pitch + this.recoil.p * 0.012 + sx, this.yaw + this.recoil.y * 0.012 + sy, this.roll + sz + bobX * 0.15, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  _viewModel(dt, t) {
    const m = this.model, h = this.holder, def = this.wdef, w = this.weapon, st = this.stat(w.id), P = m.parts;
    const D = w.id === 'pistol' ? 0.36 : def.scope ? 0.16 : 0.25;
    const a = this.adsT, sp = this.sprintT * (1 - a);
    let px = lerp(m.hip.x + 0.015, -m.sight.x, a), py = lerp(m.hip.y - 0.02, -m.sight.y, a), pz = lerp(m.hip.z - 0.11, -D - m.sight.z * 0.62, a);
    let rx = 0, ry = 0, rz = 0;
    const bobK = this.bobAmp * (1 - a * 0.88);
    px += Math.cos(this.bob) * 0.011 * bobK; py += -Math.abs(Math.sin(this.bob)) * 0.012 * bobK + Math.sin(t * 1.4) * 0.0025 * (1 - a * 0.8);
    rz += Math.cos(this.bob) * 0.02 * bobK; rx += Math.sin(this.bob * 2) * 0.012 * bobK;
    // sway
    const sw = 1 - a * 0.7; ry += this.sway.x * 1.4 * sw; rx += this.sway.y * 1.2 * sw; px += this.sway.x * 0.25 * sw; py -= this.sway.y * 0.2 * sw; rz += this.sway.x * 0.9 * sw;
    py += clamp(-this.body.vy * 0.004, -0.03, 0.03) * (1 - a * 0.6) - this.landDip * 0.25;
    rz += this.roll * -1.5;
    // sprint: weapon carried across the body, pumping with each stride
    px -= 0.05 * sp; py -= 0.035 * sp; pz += 0.03 * sp; ry += 0.62 * sp; rx -= 0.22 * sp; rz += 0.18 * sp;
    px += Math.cos(this.bob) * 0.022 * sp; py += Math.sin(this.bob * 2) * 0.016 * sp; rz += Math.cos(this.bob) * 0.08 * sp; rx += Math.sin(this.bob * 2) * 0.05 * sp;
    // slide: weapon canted
    const sl = this.slideK * (1 - a * 0.6); px -= 0.04 * sl; py -= 0.02 * sl; rz += 0.42 * sl; rx += 0.07 * sl;
    // recoil
    pz += this.kick.z * (1 - a * 0.35); rx += this.kick.r * (1 - a * 0.5); rz += this.kick.roll; py += this.kick.r * 0.03;
    // holster / draw with a settle overshoot
    if (this.swapTo >= 0) { const k = (1 - this.swapT / 0.16) ** 2; py -= 0.24 * k; rx -= 0.8 * k; rz += 0.3 * k; ry += 0.2 * k; }
    else if (this.equipT > 0) { const lw = this.equipT / 0.28, k = lw * lw, o = Math.sin((1 - lw) * Math.PI); py -= 0.26 * k; rx -= 0.95 * k - 0.08 * o; rz += 0.55 * k - 0.12 * o; ry += 0.3 * k; pz += 0.05 * o; }
    // ---- reload choreography ----
    let magX = 0, magY = 0, magZ = 0, magRot = 0, magVis = true, lhx = 0, lhy = 0, lhz = 0, boltZ = -1, cylSpin = 0, shellVis = false, glow = 1;
    if (this.reloadT >= 0) {
      if (def.shellReload) {
        // roll the gun over, feed shells one at a time from below, then rack the pump
        const lead = 0.4, per = st.reload, k = smoothstep(0, 0.32, this.reloadT), on = this.reloadT > lead, cyc = on ? ((this.reloadT - lead) / per) % 1 : 0;
        rx += 0.3 * k; rz += 0.64 * k; ry += 0.1 * k; py -= 0.02 * k; px -= 0.06 * k;
        const reach = on ? Math.sin(Math.min(1, cyc / 0.5) * Math.PI / 2) : 0, ret = on ? smoothstep(0.62, 1, cyc) : 0, push = on ? Math.sin(clamp((cyc - 0.42) / 0.2, 0, 1) * Math.PI) : 0;
        lhx = 0.02 * k; lhy = -0.27 * k * (1 - reach * (1 - ret)); lhz = 0.27 * k - 0.055 * push;
        pz -= 0.009 * push; py += 0.005 * push; rz -= 0.03 * push; shellVis = on && cyc < 0.55 && !this.reloadDone;
      } else {
        const tt = clamp(this.reloadT / this._reloadDur(st, def), 0, 1), E = this.reloadEmpty;
        const bump = (t0, wd) => Math.sin(clamp((tt - t0) / wd, 0, 1) * Math.PI);
        if (w.id === 'launcher') {
          // break open, dump the spent casings with a spin, thumb in six rounds, flick shut
          const tilt = smoothstep(0, 0.12, tt) * (1 - smoothstep(0.88, 1, tt));
          rz += 0.72 * tilt; rx += 0.4 * tilt; ry += 0.15 * tilt; px -= 0.06 * tilt; py += 0.02 * tilt;
          const open = smoothstep(0.12, 0.2, tt) * (1 - smoothstep(0.8, 0.86, tt)); magX = -0.1 * open; magY = -0.015 * open;
          const idx = clamp((tt - 0.4) / 0.06, 0, 6), step = Math.floor(idx) + smoothstep(0, 0.45, idx % 1);
          cylSpin = smoothstep(0.2, 0.38, tt) * 15.7 + step * (TAU / 6);
          const loading = tt > 0.39 && tt < 0.77, load = loading ? Math.sin((idx % 1) * Math.PI) : 0, toCyl = smoothstep(0.1, 0.2, tt) * (1 - smoothstep(0.78, 0.86, tt));
          lhx = -0.07 * toCyl; lhy = 0.06 * toCyl - (loading ? 0.13 * (1 - load) : 0); lhz = 0.17 * toCyl - 0.04 * load;
          py += 0.006 * load; rz += 0.02 * load; const close = bump(0.82, 0.09); rz -= 0.34 * close; px += 0.025 * close; py += 0.014 * close; rx -= 0.1 * close;
        } else {
          // cant the weapon, strip the magazine (it drops free), seat a fresh one, tap it home, then rack the action
          const tilt = smoothstep(0, 0.13, tt) * (1 - smoothstep(0.88, 1, tt));
          rz += 0.56 * tilt; rx += 0.27 * tilt; ry += 0.2 * tilt; px -= 0.05 * tilt; py += 0.014 * tilt; pz += 0.03 * tilt;
          py -= 0.011 * bump(0.13, 0.06);
          const out = smoothstep(0.16, 0.26, tt), back = smoothstep(0.5, 0.63, tt), rail = w.id === 'rail', pistol = w.id === 'pistol';
          if (tt < 0.25) { magY = -0.2 * out; magZ = 0.04 * out; magRot = 0.5 * out; }
          else if (tt < 0.5) magVis = false;
          else { const k = 1 - back; magY = -0.3 * k; magZ = 0.03 * k; magRot = 0.45 * k; }
          if (rail) { magX = magY * 0.7; magY *= 0.35; magRot = 0; glow = tt < 0.2 ? 1 : tt < 0.63 ? 0.06 : 1 + 5 * (1 - smoothstep(0.63, 0.9, tt)) + (E ? 0 : 0); px += Math.sin(t * 95) * 0.0016 * smoothstep(0.74, 0.8, tt) * (1 - smoothstep(0.9, 0.96, tt)); }
          const toMag = smoothstep(0.04, 0.16, tt) * (1 - smoothstep(0.7, 0.8, tt)), down = out * (1 - back), tm = pistol ? 0.15 : 1;
          lhy = -0.1 * toMag * tm - 0.3 * down; lhz = 0.2 * toMag * tm + 0.05 * down; lhx = rail ? -0.05 * down : 0;
          const seat = bump(0.63, 0.06), tap = bump(0.71, 0.05);
          py += 0.017 * seat + 0.009 * tap; rx += 0.055 * seat + 0.02 * tap; rz += 0.03 * seat; lhy += 0.025 * tap;
          if (E && pistol) { boltZ = tt < 0.86 ? 0.035 : 0; const rel = bump(0.86, 0.08); rx -= 0.08 * rel; pz += 0.013 * rel; rz -= 0.12 * bump(0.76, 0.2); }
          else if (E && P.bolt) {
            const ch = smoothstep(0.74, 0.82, tt) * (1 - smoothstep(0.93, 0.99, tt)), pull = tt < 0.9 ? smoothstep(0.82, 0.87, tt) : 0, snap = bump(0.9, 0.06);
            lhx += 0.03 * ch; lhy += 0.07 * ch; lhz += 0.3 * ch + 0.05 * pull; boltZ = 0.05 * pull;
            rz -= 0.44 * ch; rx += 0.06 * ch; ry -= 0.12 * ch; pz += 0.02 * pull - 0.016 * snap; py -= 0.006 * snap;
          } else { const fl = bump(0.72, 0.2); rz -= 0.24 * fl; rx += 0.05 * fl; ry -= 0.06 * fl; }
        }
      }
    }
    if (P.mag && m.magHome) { P.mag.position.set(m.magHome.x + magX, m.magHome.y + magY, m.magHome.z + magZ); P.mag.rotation.x = magRot; P.mag.visible = magVis; }
    // melee: quick butt strike
    if (this.meleeT >= 0) { const k = Math.sin(clamp(this.meleeT / 0.42, 0, 1) * Math.PI), k2 = Math.sin(clamp(this.meleeT / 0.2, 0, 1) * Math.PI); pz -= 0.22 * k2; px -= 0.14 * k; ry += 1.15 * k; rz -= 0.55 * k; rx += 0.25 * k; py += 0.03 * k2; }
    if (this.throwT >= 0) { const k = Math.sin(clamp(this.throwT / 0.5, 0, 1) * Math.PI); py -= 0.1 * k; rz += 0.35 * k; px += 0.03 * k; lhz = -0.25 * Math.sin(clamp((this.throwT - 0.1) / 0.3, 0, 1) * Math.PI); lhy = 0.12 * k; lhx = -0.1 * k; }
    // bolt / slide / pump
    if (P.bolt) {
      if (w.id === 'shotgun') { const k = Math.sin(clamp(this.pumpT, 0, 1) * Math.PI); const rel = this.reloadT >= 0 ? 0 : k; P.bolt.position.z = 0.1 * rel; if (this.reloadT < 0) { lhz += 0.1 * rel; rx += 0.05 * rel; pz += 0.012 * rel; } }
      else if (boltZ >= 0) P.bolt.position.z = boltZ;
      else { const k = 1 - this.boltT, empty = w.ammo === 0 && w.id === 'pistol' && this.reloadT < 0 ? 1 : 0; P.bolt.position.z = Math.max(k, empty) * (w.id === 'pistol' ? 0.035 : 0.045); }
    }
    if (P.lhand) P.lhand.position.set(lhx, lhy, lhz);
    if (P.shell) { P.shell.visible = shellVis; P.shell.position.set(lhx, lhy, lhz); }
    if (w.id === 'launcher' && P.mag) P.mag.rotation.z = (st.mag - w.ammo) * (TAU / 6) + (1 - this.boltT) * -1.0 + cylSpin;
    if (def.energy) this.game.M.weapon.userData.emiBoost.value = (0.7 + (this.charge >= 0 ? this.charge / def.charge * 5 : 0) + Math.sin(t * 6) * 0.1) * glow;
    else this.game.M.weapon.userData.emiBoost.value = 1;
    h.position.set(px, py, pz); h.rotation.set(rx, ry, rz, 'YXZ');
    const scoped = def.scope && a > 0.85;
    m.group.visible = !scoped; this.scoped = scoped;
  }
}
