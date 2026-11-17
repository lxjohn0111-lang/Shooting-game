// Enemy bolts, grenades, missiles, explosions
import * as THREE from './lib/three.min.js';
import { rand, clamp } from './util.js';

export class Projectiles {
  constructor(game) {
    this.game = game; this.bolts = []; this.grenades = []; this.missiles = [];
    const geo = new THREE.SphereGeometry(0.07, 10, 8);
    this.gMat = new THREE.MeshStandardMaterial({ color: 0x20261c, roughness: 0.55, metalness: 0.6 });
    this.pool = []; for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(geo, this.gMat); m.visible = false; m.castShadow = true; game.gfx.scene.add(m); this.pool.push(m); }
    const mg = new THREE.CylinderGeometry(0.07, 0.09, 0.6, 8); mg.rotateX(Math.PI / 2);
    this.mPool = []; for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(mg, this.gMat); m.visible = false; game.gfx.scene.add(m); this.mPool.push(m); }
    this._v = new THREE.Vector3();
  }
  reset() { this.bolts.length = 0; this.grenades.length = 0; this.missiles.length = 0; for (const m of this.pool) m.visible = false; for (const m of this.mPool) m.visible = false; }

  spawnBolt(x, y, z, vx, vy, vz, dmg, color = [1, 0.3, 0.1], size = 0.09) { if (this.bolts.length < 160) this.bolts.push({ x, y, z, vx, vy, vz, dmg, color, size, life: 4, whiz: false }); }
  spawnGrenade(x, y, z, vx, vy, vz, o) {
    const mesh = this.pool.find(m => !m.visible); if (mesh) { mesh.visible = true; mesh.position.set(x, y, z); }
    this.grenades.push({ x, y, z, vx, vy, vz, fuse: o.fuse ?? 5, impact: !!o.impact, dmg: o.dmg, radius: o.radius, owner: o.owner, mesh, t: 0 });
  }
  spawnMissile(x, y, z, tx, tz, dmg, radius, flight = 2.2) {
    const mesh = this.mPool.find(m => !m.visible); if (mesh) mesh.visible = true;
    this.missiles.push({ x0: x, y0: y, z0: z, x, y, z, tx, tz, t: 0, flight, dmg, radius, mesh, apex: 16 + rand(6) });
    this.game.audio.play('missile', { pos: { x, y, z }, vol: 0.8, ref: 10 });
  }

  explode(x, y, z, radius, dmg, owner) {
    const g = this.game, p = g.player, b = p.body;
    g.fx.explosion(x, y, z, radius, owner === 'player' ? [1.0, 0.55, 0.2] : [1.0, 0.4, 0.15]);
    const d = Math.hypot(x - b.x, y - (b.y + 1), z - b.z);
    g.audio.play(radius > 6.5 ? 'explosion_big' : radius < 3.6 ? 'explosion_small' : 'explosion', { pos: { x, y, z }, vol: 1, ref: 12, reverb: 0.8, max: 200 });
    p.shake = Math.min(1, p.shake + clamp(1.4 - d / (radius * 3.5), 0, 1));
    if (dmg > 0 && d < radius * 1.15 && !p.dead) {
      if (g.level.los(x, y + 0.4, z, b.x, b.y + 1.0, b.z)) { const k = clamp(1 - d / (radius * 1.15), 0, 1); p.damage(dmg * k * (owner === 'player' ? 0.3 : 0.55), { x, y, z }); const l = Math.hypot(b.x - x, b.z - z) || 1; b.vx += (b.x - x) / l * 6 * k; b.vz += (b.z - z) / l * 6 * k; b.vy += 3.5 * k; b.onGround = false; }
    }
    if (owner !== 'enemyOnly' && dmg > 0) {
      for (const e of g.enemies.list) {
        if (e.dead || e.friendly) continue; const ey = e.pos.y + e.h * 0.5, de = Math.hypot(e.pos.x - x, ey - y, e.pos.z - z) - e.radius;
        if (de < radius) { const k = clamp(1 - de / radius, 0.15, 1); const l = Math.hypot(e.pos.x - x, e.pos.z - z) || 1; const res = e.hit(dmg * k * (owner === 'player' ? 1 : 0.6), e.pos.x, ey, e.pos.z, (e.pos.x - x) / l, 0.4, (e.pos.z - z) / l, { explosive: true }); if (owner === 'player' && res) g.ui.hitmarker(res === 'kill', false); }
      }
    }
    for (const pr of g.level.props) if (!pr.dead && Math.hypot(pr.x - x, pr.z - z) < radius * 0.9) g.damageProp(pr, 100, true);
    g.onExplosion(x, y, z, radius, dmg, owner);
  }

  update(dt) {
    const g = this.game, L = g.level, fx = g.fx, p = g.player, b = p.body, add = fx.add;
    // bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const o = this.bolts[i]; o.life -= dt;
      const sp = Math.hypot(o.vx, o.vy, o.vz), dist = sp * dt; let dead = o.life <= 0;
      if (!dead) {
        const dx = o.vx / sp, dy = o.vy / sp, dz = o.vz / sp;
        const h = L.raycast(o.x, o.y, o.z, dx, dy, dz, dist);
        let hitT = h ? h.t : dist;
        // player capsule test along segment (closest approach in xz, then y range)
        if (!p.dead) {
          const px = b.x - o.x, pz = b.z - o.z;
          const tt = clamp((px * dx + pz * dz) / Math.max(1e-6, dx * dx + dz * dz), 0, hitT);
          const cx = o.x + dx * tt, cy = o.y + dy * tt, cz = o.z + dz * tt, dd = Math.hypot(cx - b.x, cz - b.z);
          if (dd < b.r + 0.12 && cy > b.y - 0.05 && cy < b.y + b.h + 0.1) { p.damage(o.dmg, { x: o.x - dx * 4, y: o.y, z: o.z - dz * 4 }); fx.glow(cx, cy, cz, 0.5, o.color, 0.1, 0, 4); dead = true; }
          else if (!o.whiz && dd < 2.2 && Math.abs(cy - (b.y + 1.3)) < 2) { o.whiz = true; g.audio.play('whiz', { vol: 0.5, rv: 0.2, throttle: 0.08, reverb: 0.1 }); }
        }
        if (!dead && h) {
          fx.sparks(h.x, h.y, h.z, h.nx, h.ny, h.nz, 4, o.color, 5); fx.glow(h.x, h.y, h.z, 0.45, o.color, 0.1, 0, 4);
          if (Math.random() < 0.5) fx.decal(h, 2, rand(0.1, 0.16), 0.7);
          if (h.c && h.c.prop) g.damageProp(h.c.prop, o.dmg * 0.5);
          dead = true;
        }
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      }
      if (dead) { this.bolts[i] = this.bolts[this.bolts.length - 1]; this.bolts.pop(); continue; }
      const c = o.color, k = 0.035;
      add.push(o.x, o.y, o.z, -o.vx * k, -o.vy * k, -o.vz * k, o.size, 0, 14, 1, c[0] * 9, c[1] * 9, c[2] * 9, 1);
      add.push(o.x, o.y, o.z, 0, 0, 0, o.size * 4.5, 0, 0, 0, c[0] * 2, c[1] * 2, c[2] * 2, 0.8);
    }
    // grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const o = this.grenades[i]; o.fuse -= dt; o.t += dt; o.vy -= 15 * dt;
      const sp = Math.hypot(o.vx, o.vy, o.vz), dist = sp * dt; let boom = o.fuse <= 0;
      if (!boom && sp > 0.01) {
        const dx = o.vx / sp, dy = o.vy / sp, dz = o.vz / sp;
        const h = L.raycast(o.x, o.y, o.z, dx, dy, dz, dist + 0.08);
        let eh = null;
        if (o.impact || o.t > 0.15) { const hs = g.enemies.raycastAll(o.x, o.y, o.z, dx, dy, dz, h ? h.t : dist + 0.1); if (hs.length) eh = hs[0]; }
        if (eh) { o.x += dx * eh.t; o.y += dy * eh.t; o.z += dz * eh.t; boom = true; }
        else if (h) {
          if (o.impact) { o.x = h.x + h.nx * 0.1; o.y = h.y + h.ny * 0.1; o.z = h.z + h.nz * 0.1; boom = true; }
          else {
            const dot = o.vx * h.nx + o.vy * h.ny + o.vz * h.nz;
            o.vx = (o.vx - 2 * dot * h.nx) * 0.45; o.vy = (o.vy - 2 * dot * h.ny) * 0.45; o.vz = (o.vz - 2 * dot * h.nz) * 0.45;
            if (h.ny > 0.5) { o.vx *= 0.8; o.vz *= 0.8; if (Math.abs(o.vy) < 1.2) o.vy = 0; }
            o.x = h.x + h.nx * 0.08; o.y = h.y + h.ny * 0.08; o.z = h.z + h.nz * 0.08;
            if (sp > 2) g.audio.play('grenade_bounce', { pos: o, vol: 0.5, rv: 0.15 });
          }
        } else { o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; }
      }
      if (o.y < 0.07) { o.y = 0.07; if (o.vy < 0) o.vy = 0; }
      if (o.mesh) o.mesh.position.set(o.x, o.y, o.z);
      if (o.impact) { if (Math.random() < dt * 60) fx.emit({ x: o.x, y: o.y, z: o.z, life: 0.5, s0: 0.08, s1: 0.35, r: 0.5, g: 0.5, b: 0.5, a: 0.3, add: false, frame: 1, rv: rand(-1, 1) }); }
      else { const blink = Math.sin(o.t * (10 + o.t * 14)) > 0.2 ? 1 : 0.15; add.push(o.x, o.y + 0.08, o.z, 0, 0, 0, 0.3, 0, 0, 0, 4 * blink, 0.5 * blink, 0.3 * blink, 1); }
      if (boom) { if (o.mesh) o.mesh.visible = false; this.grenades.splice(i, 1); this.explode(o.x, Math.max(0.3, o.y), o.z, o.radius, o.dmg, o.owner); }
    }
    // missiles (ballistic arc to marked ground target)
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const o = this.missiles[i]; o.t += dt; const k = o.t / o.flight;
      const px = o.x, py = o.y, pz = o.z;
      o.x = o.x0 + (o.tx - o.x0) * k; o.z = o.z0 + (o.tz - o.z0) * k; o.y = o.y0 * (1 - k) + 4 * o.apex * k * (1 - k);
      if (o.mesh) { o.mesh.position.set(o.x, o.y, o.z); this._v.set(o.x * 2 - px, o.y * 2 - py, o.z * 2 - pz); o.mesh.lookAt(this._v); }
      add.push(o.x, o.y, o.z, (px - o.x) * 6, (py - o.y) * 6, (pz - o.z) * 6, 0.22, 0, 14, 1, 9, 4, 1, 1);
      add.push(o.x, o.y, o.z, 0, 0, 0, 0.9, 0, 0, 0, 5, 2, 0.6, 1);
      if (Math.random() < dt * 40) fx.emit({ x: px, y: py, z: pz, life: 0.9, s0: 0.2, s1: 0.9, r: 0.35, g: 0.33, b: 0.32, a: 0.35, add: false, frame: 2, rv: rand(-1, 1) });
      // ground warning marker
      const pulse = 0.6 + 0.4 * Math.sin(o.t * 18), R = o.radius * 2;
      fx.marker(o.tx, 0.07, o.tz, R * (0.4 + 0.6 * k), 3 * pulse, 0.5 * pulse, 0.15 * pulse, 12); fx.marker(o.tx, 0.07, o.tz, R, 1.5, 0.25, 0.08, 5);
      if (k >= 1) { if (o.mesh) o.mesh.visible = false; this.missiles.splice(i, 1); this.explode(o.tx, 0.4, o.tz, o.radius, o.dmg, 'enemy'); }
    }
  }
}
