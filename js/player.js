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

  stat(id) { // weapon stats with upgrades applied
    const w = WEAPONS[id], u = this.game.save.data.upgrades[id] || {};
    const dm = 1 + 0.12 * (u.dmg || 0), mg = 1 + 0.2 * (u.mag || 0), hd = 1 - 0.1 * (u.handling || 0);
    return { dmg: w.dmg * dm, mag: Math.round(w.mag * mg), reserve: w.reserve === Infinity ? Infinity : Math.round(w.reserve * mg), reload: w.reload * hd, kick: hd };
  }

  reset() {
    const sv = this.game.save.data, pk = sv.perks;
    this.maxHealth = 100 + 20 * (pk.vitality || 0); this.health = this.maxHealth;
    this.maxShield = 60 + 20 * (pk.shield || 0); this.shield = this.maxShield; this.shieldDelay = 0; this.shieldBroken = false;
    this.maxGrenades = 2 + (pk.grenadier || 0); this.grenades = this.maxGrenades;
    this.focus = 0.5; this.focusOn = false; this.focusK = 0; this.focusDur = 5 * (1 + 0.25 * (pk.focus || 0));
    this.dead = false; this.invuln = 0;
    this.inv = []; // owned weapons in slot order
    for (const id of WEAPON_ORDER) if (sv.weapons.includes(id)) { const st = this.stat(id); this.inv.push({ id, ammo: st.mag, reserve: st.reserve }); }
    this.cur = Math.min(1, this.inv.length - 1); this.last = 0;
    this.swapT = 0; this.swapTo = -1; this.reloadT = -1; this.fireCd = 0; this.bloom = 0; this.adsT = 0; this.sprintT = 0; this.charge = -1;
    this.recoil = { p: 0, y: 0, vp: 0, vy: 0 }; this.kick = { z: 0, r: 0, roll: 0 }; this.sway = { x: 0, y: 0 }; this.bob = 0; this.bobAmp = 0; this.landDip = 0; this.roll = 0;
    this.shake = 0; this.crouchT = 0; this.slideT = 0; this.slideDir = { x: 0, z: 0 }; this.coyote = 0; this.meleeT = -1; this.throwT = -1; this.boltT = 1; this.pumpT = 1; this.stepPh = 0; this.hurtT = 0; this.equipT = 0.4;
    this.moving = 0; this.airT = 0;
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
    this.swapTo = i; this.swapT = 0.16; this.reloadT = -1; this.charge = -1; this.last = this.cur;
    this.game.audio.play('swap', { vol: 0.5, reverb: 0.1 });
  }
  addWeapon(id) { if (this.inv.find(w => w.id === id)) return; const st = this.stat(id); this.inv.push({ id, ammo: st.mag, reserve: st.reserve }); this.inv.sort((a, b) => WEAPONS[a.id].slot - WEAPONS[b.id].slot); }
  addAmmo(frac) { let any = false; for (const w of this.inv) { const st = this.stat(w.id); if (st.reserve === Infinity) continue; const add = Math.max(1, Math.round(st.reserve * frac)); if (w.reserve < st.reserve) { w.reserve = Math.min(st.reserve, w.reserve + add); any = true; } } this.game.ui.hudWeapon(this); return any; }

  damage(amount, from, opts = {}) {
    if (this.dead || this.invuln > 0 || this.game.godMode) return;
    amount *= this.game.diff.dmg;
    const g = this.game;
    this.shieldDelay = 4.2 - 0.4 * (g.save.data.perks.shield || 0);
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
    if (this.health <= 0) { this.health = 0; this.dead = true; g.onPlayerDeath(); }
  }
  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }
  addFocus(n) { if (!this.focusOn) this.focus = Math.min(1, this.focus + n * (1 + 0.2 * (this.game.save.data.perks.focus || 0))); }

  // ---------- firing ----------
  _fire() {
    const g = this.game, w = this.weapon, def = this.wdef, st = this.stat(w.id), m = this.model, cam = this.cam;
    w.ammo--; this.fireCd = 60 / def.rpm; this.reloadT = -1;
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
    if (!def.energy) fx.muzzle(muz, _v2, def.pellets ? 1.5 : w.id === 'marksman' ? 1.4 : w.id === 'pistol' ? 0.8 : 1);
    else { fx.glow(mx, my, mz, 1.2, [0.3, 0.8, 1], 0.12, 0, 8); g.gfx.flash(muz, new THREE.Color(0.3, 0.7, 1), 60, 0.15, 20); }
    if (!def.energy && !def.projectile && w.id !== 'shotgun') { const ej = m.group.localToWorld(_v3.copy(m.eject)); fx.casing(ej, _v.copy(right).multiplyScalar(rand(1.6, 2.6)).addScaledVector(up, rand(1.5, 2.5)).add(new THREE.Vector3(this.body.vx, 0, this.body.vz)), w.id === 'marksman' ? 1.5 : 1); }
    g.audio.play(def.sound, { vol: 0.9, rv: 0.04, reverb: 0.55 });
    g.onPlayerShot();
    g.ui.hudAmmo(this);
    if (w.ammo <= 0 && w.reserve > 0) this._queueReload = 0.25;
  }

  startReload() {
    const w = this.weapon, st = this.stat(w.id);
    if (this.reloadT >= 0 || w.ammo >= st.mag || w.reserve <= 0 || this.swapTo >= 0 || this.meleeT >= 0) return;
    this.reloadT = 0; this.reloadStage = 0; this.charge = -1;
  }

  _melee() {
    const g = this.game; this.meleeT = 0; this.reloadT = -1;
    g.audio.play('melee', { vol: 0.6, reverb: 0.2 });
    this.cam.getWorldPosition(_v); this.cam.getWorldDirection(_v2);
    let hit = false;
    for (const e of g.enemies.list) {
      if (e.dead) continue; const dx = e.pos.x - _v.x, dy = e.pos.y + e.h * 0.5 - _v.y, dz = e.pos.z - _v.z, d = Math.hypot(dx, dy, dz);
      if (d < 2.3 + e.radius && (dx * _v2.x + dy * _v2.y + dz * _v2.z) / d > 0.45) { const r = e.hit(130, e.pos.x, e.pos.y + e.h * 0.6, e.pos.z, _v2.x, _v2.y, _v2.z, { melee: true }); hit = true; if (r === 'kill') g.ui.hitmarker(true, false); }
    }
    for (const p of g.level.props) if (!p.dead && Math.hypot(p.x - _v.x, p.z - _v.z) < 2) g.damageProp(p, 40);
    if (hit) { g.audio.play('melee_hit', { vol: 0.9 }); this.shake = Math.min(1, this.shake + 0.4); g.ui.hitmarker(false, false); }
  }

  // ---------- update ----------
  update(dt, input) {
    const g = this.game, b = this.body, cam = this.cam, def = this.wdef, w = this.weapon;
    if (this.dead) { this.eye = damp(this.eye, 0.35, 4, dt); this.roll = damp(this.roll, 0.9, 3, dt); this._applyCam(dt); return; }
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
      if (prev < 0.22 && this.throwT >= 0.22) { this.grenades--; cam.getWorldPosition(_v); cam.getWorldDirection(_v2); g.projectiles.spawnGrenade(_v.x + _v2.x * 0.5, _v.y + _v2.y * 0.5 - 0.1, _v.z + _v2.z * 0.5, _v2.x * 17 + b.vx * 0.6, _v2.y * 17 + 4, _v2.z * 17 + b.vz * 0.6, { fuse: 1.9, dmg: 220, radius: 7, owner: 'player' }); g.audio.play('melee', { vol: 0.4 }); g.ui.hudStatus(this); }
      if (this.throwT > 0.5) this.throwT = -1;
    }
    if (input.hit('melee') && this.meleeT < 0 && this.throwT < 0 && this.swapTo < 0) this._melee();
    if (this.meleeT >= 0) { this.meleeT += dt; if (this.meleeT > 0.42) this.meleeT = -1; }
    if (input.hit('focus')) { if (!this.focusOn && this.focus >= 0.3) { this.focusOn = true; g.audio.play('focus_in', { vol: 0.8, reverb: 0.3 }); } else if (this.focusOn) this.focusOn = false; else g.audio.play('ui_deny', { vol: 0.4, reverb: 0 }); }
    if (this.focusOn) { this.focus -= g.realDt / this.focusDur; if (this.focus <= 0) { this.focus = 0; this.focusOn = false; } if (!this.focusOn) g.audio.play('focus_out', { vol: 0.7, reverb: 0.3 }); }
    this.focusK = damp(this.focusK, this.focusOn ? 1 : 0, 9, g.realDt);
    // recoil spring
    const r = this.recoil; r.vp += (-r.p * 110 - r.vp * 15) * dt; r.vy += (-r.y * 110 - r.vy * 15) * dt; r.p += r.vp * dt; r.y += r.vy * dt;
    const kk = this.kick; kk.z = damp(kk.z, 0, 16, dt); kk.r = damp(kk.r, 0, 14, dt); kk.roll = damp(kk.roll, 0, 12, dt);
    this.boltT = Math.min(1, this.boltT + dt * (w.id === 'pistol' ? 11 : 14)); this.pumpT = Math.min(1, this.pumpT + dt * 2.6);
    if (w.id === 'shotgun' && this.pumpT > 0.25 && this.pumpT - dt * 2.6 <= 0.25 && this.reloadT < 0) { g.audio.play('pump', { vol: 0.6, reverb: 0.2 }); const m = this.model; const ej = m.group.localToWorld(_v3.copy(m.eject)); _v.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(2).setY(1.8); g.fx.casing(ej, _v.clone(), 2.2); }
    this.shake = Math.max(0, this.shake - dt * 2.2); this.landDip = damp(this.landDip, 0, 9, dt);
    this.sway.x = damp(this.sway.x, clamp(-input.dx * 0.0009, -0.05, 0.05), 10, dt); this.sway.y = damp(this.sway.y, clamp(-input.dy * 0.0009, -0.05, 0.05), 10, dt);
    this.roll = damp(this.roll, -ix * 0.022 * Math.min(1, hs / 5) + (this.slideT > 0 ? 0.06 : 0), 8, dt);
    this.eye = damp(this.eye, lerp(1.65, 1.0, this.crouchT) - (this.slideT > 0 ? 0.2 : 0), 14, dt);
    this.fov = damp(this.fov, this.baseFov * lerp(1, def.adsFov, this.adsT) * (1 + this.sprintT * 0.07) * (1 + this.focusK * 0.06) * (this.charge >= 0 ? 1 - this.charge * 0.12 : 1), 14, dt);
    this._applyCam(dt);
    this._viewModel(dt, g.time);
  }

  _dry() { this.fireCd = 0.25; this.game.audio.play('dry', { vol: 0.5, reverb: 0 }); if (this.weapon.reserve > 0) this.startReload(); else this.game.ui.toast('NO AMMO', 'warn', 0.9); }

  _updateReload(dt) {
    const g = this.game, w = this.weapon, def = this.wdef, st = this.stat(w.id);
    if (def.shellReload) {
      const per = st.reload; this.reloadT += dt;
      const lead = 0.35;
      if (this.reloadT > lead + per * (this.reloadStage + 1)) {
        this.reloadStage++; w.ammo++; w.reserve--; g.audio.play('shell_in', { vol: 0.6, reverb: 0.15 }); g.ui.hudAmmo(this);
        if (w.ammo >= st.mag || w.reserve <= 0) { this.reloadT = -1; this.pumpT = 0; this.fireCd = 0.4; }
      }
      return;
    }
    const prev = this.reloadT / st.reload; this.reloadT += dt; const t = this.reloadT / st.reload;
    if (prev < 0.18 && t >= 0.18) g.audio.play('reload_out', { vol: 0.65, reverb: 0.15 });
    if (prev < 0.62 && t >= 0.62) g.audio.play('reload_in', { vol: 0.7, reverb: 0.15 });
    if (prev < 0.84 && t >= 0.84) { g.audio.play('bolt', { vol: 0.6, reverb: 0.15 }); const need = st.mag - w.ammo, take = Math.min(need, w.reserve); w.ammo += take; if (w.reserve !== Infinity) w.reserve -= take; g.ui.hudAmmo(this); this.boltT = 0; }
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
    const m = this.model, h = this.holder, def = this.wdef, w = this.weapon, st = this.stat(w.id);
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
    // sprint pose
    px -= 0.05 * sp; py -= 0.035 * sp; pz += 0.03 * sp; ry += 0.62 * sp; rx -= 0.22 * sp; rz += 0.18 * sp;
    // recoil
    pz += this.kick.z * (1 - a * 0.35); rx += this.kick.r * (1 - a * 0.5); rz += this.kick.roll; py += this.kick.r * 0.03;
    // equip / swap
    const lower = this.swapTo >= 0 ? 1 - this.swapT / 0.16 : this.equipT / 0.28;
    if (lower > 0) { const k = lower * lower; py -= 0.22 * k; rx -= 0.7 * k; rz += 0.25 * k; }
    // reload
    const P = m.parts; let magOff = 0, magRot = 0, lhx = 0, lhy = 0, lhz = 0;
    if (this.reloadT >= 0) {
      if (def.shellReload) {
        const k = smoothstep(0, 0.3, this.reloadT); const cyc = ((this.reloadT - 0.35) / st.reload) % 1, ins = this.reloadT > 0.35 ? Math.sin(cyc * Math.PI) : 0;
        rx += 0.32 * k; rz += 0.5 * k; py -= 0.03 * k; px -= 0.05 * k; lhy = -0.05 * k + 0.03 * ins; lhz = 0.24 * k - 0.05 * ins; lhx = 0.02 * k;
      } else {
        const tt = this.reloadT / st.reload;
        const tilt = smoothstep(0, 0.15, tt) * (1 - smoothstep(0.86, 1, tt));
        rz += 0.42 * tilt; rx += 0.2 * tilt; py -= 0.035 * tilt; px -= 0.02 * tilt; ry += 0.12 * tilt;
        const out = smoothstep(0.16, 0.32, tt) * (1 - smoothstep(0.5, 0.64, tt));
        magOff = out; magRot = out * 0.5;
        const ms = (m.magHome ? 1 : 0); lhy = -0.16 * out * ms - 0.05 * tilt; lhz = 0.18 * tilt; lhx = 0.01 * tilt;
        if (tt > 0.78) { const rk = Math.sin(smoothstep(0.78, 0.94, tt) * Math.PI); lhz = lerp(lhz, 0.3, rk); lhy = lerp(lhy, 0.05, rk); lhx = 0.03 * rk; }
        py -= Math.sin(smoothstep(0.58, 0.68, tt) * Math.PI) * 0.012;
      }
    }
    if (P.mag && m.magHome) { P.mag.position.set(m.magHome.x - magOff * 0.04, m.magHome.y - magOff * 0.3, m.magHome.z + magOff * 0.06); P.mag.rotation.x = magRot; P.mag.visible = !(magOff > 0.97); if (w.id === 'launcher') { P.mag.rotation.x = 0; P.mag.position.x = m.magHome.x - magOff * 0.1; P.mag.position.y = m.magHome.y; } }
    // melee: quick butt strike
    if (this.meleeT >= 0) { const k = Math.sin(clamp(this.meleeT / 0.42, 0, 1) * Math.PI), k2 = Math.sin(clamp(this.meleeT / 0.2, 0, 1) * Math.PI); pz -= 0.2 * k2; px -= 0.14 * k; ry += 1.1 * k; rz -= 0.5 * k; rx += 0.25 * k; }
    if (this.throwT >= 0) { const k = Math.sin(clamp(this.throwT / 0.5, 0, 1) * Math.PI); py -= 0.1 * k; rz += 0.35 * k; px += 0.03 * k; lhz = -0.25 * Math.sin(clamp((this.throwT - 0.1) / 0.3, 0, 1) * Math.PI); lhy = 0.12 * k; lhx = -0.1 * k; }
    // bolt / slide / pump
    if (P.bolt) {
      if (w.id === 'shotgun') { const k = Math.sin(clamp(this.pumpT, 0, 1) * Math.PI); const rel = this.reloadT >= 0 ? 0 : k; P.bolt.position.z = 0.1 * rel; if (this.reloadT < 0) lhz += 0.1 * rel; }
      else { const k = 1 - this.boltT, empty = w.ammo === 0 && w.id === 'pistol' && this.reloadT < 0 ? 1 : 0; P.bolt.position.z = Math.max(k, empty) * (w.id === 'pistol' ? 0.035 : 0.045); }
    }
    if (P.lhand) P.lhand.position.set(lhx, lhy, lhz);
    if (w.id === 'launcher' && P.mag) P.mag.rotation.z = (st.mag - w.ammo) * (TAU / 6) + (1 - this.boltT) * -1.0;
    if (def.energy) this.game.M.weapon.userData.emiBoost.value = 0.7 + (this.charge >= 0 ? this.charge / def.charge * 5 : 0) + Math.sin(t * 6) * 0.1;
    else this.game.M.weapon.userData.emiBoost.value = 1;
    h.position.set(px, py, pz); h.rotation.set(rx, ry, rz, 'YXZ');
    const scoped = def.scope && a > 0.85;
    m.group.visible = !scoped; this.scoped = scoped;
  }
}
