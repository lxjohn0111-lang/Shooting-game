// Game core: state machine, mission director, objectives, pickups, scoring
import * as THREE from './lib/three.min.js';
import { Gfx, QUALITY, SKIES } from './gfx.js';
import { bakeTextures, makeFxAtlas, makeDecalAtlas, makeLightPoolTex, makePaintTex, makeHexTex } from './textures.js';
import { makeMaterials } from './materials.js';
import { Level } from './level.js';
import { FX } from './fx.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Enemies } from './enemies.js';
import { Projectiles } from './projectiles.js';
import { Builder } from './models.js';
import { MISSIONS, ONSLAUGHT, DIFFICULTY, ENEMIES, WEAPONS, rankFor } from './config.js';
import { rand, clamp, damp, pick, TAU, RNG } from './util.js';

const _v = new THREE.Vector3();

class Director {
  constructor(game) { this.game = game; this.reset(); }
  reset() { this.queue = []; this.spawnT = 0; this.phaseI = -1; this.phase = null; this.done = false; this.objs = []; this.wave = 0; this.waveT = 0; this.pressT = 0; this.timer = 0; this.maxAlive = 12; this.elapsed = 0; this.waveActive = false; this.onslaught = false; this.marker = null; this.prompt = null; }
  start(mission, onslaught) {
    this.reset(); this.mission = mission; this.onslaught = onslaught;
    if (onslaught) { this.phase = { type: 'onslaught', text: 'Survive the onslaught' }; this.waveT = 4; this.game.ui.objective('SURVIVE', 'Wave 1 incoming'); }
    else this.next();
  }
  next() {
    const g = this.game, m = this.mission; this.clearObjs(); this.phaseI++;
    if (this.phaseI >= m.phases.length) { this.done = true; g.completeMission(); return; }
    const ph = this.phase = m.phases[this.phaseI]; this.wave = 0; this.waveT = 2.5; this.pressT = 5; this.waveActive = false; this.marker = null; this.prompt = null;
    if (this.phaseI > 0) { g.ui.banner('OBJECTIVE UPDATED', ph.text.toUpperCase()); g.audio.play('objective', { vol: 0.7, reverb: 0.2 }); }
    const L = g.level, p = g.player.body;
    const slots = L.slots.slice().sort((a, b) => Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(a.x - p.x, a.z - p.z));
    if (ph.type === 'uplink') { const chosen = this.spread(slots, ph.count); this.objs = chosen.map((s, i) => g.makeTerminal(s.x, s.z, i)); this.active = 0; this.progress = 0; this.uploading = false; }
    else if (ph.type === 'destroy') { const chosen = this.spread(slots, ph.count); this.objs = chosen.map((s) => g.makeCore(s.x, s.z)); this.left = ph.count; }
    else if (ph.type === 'survive') { this.timer = ph.time; }
    else if (ph.type === 'extract') { const s = slots[0]; this.objs = [g.makeBeacon(s.x, s.z)]; }
    else if (ph.type === 'boss') { g.enemies.spawn('boss', 0, -8); g.ui.bossBar(true, 'COLOSSUS'); this.maxAlive = 9; }
    this.hud();
  }
  spread(slots, n) { // pick n slots far from each other
    const out = []; const pool = slots.slice();
    while (out.length < n && pool.length) { let bi = 0, bs = -1; for (let i = 0; i < pool.length; i++) { let s = 1e9; for (const o of out) s = Math.min(s, Math.hypot(o.x - pool[i].x, o.z - pool[i].z)); if (!out.length) s = -i; if (s > bs) { bs = s; bi = i; } } out.push(pool.splice(bi, 1)[0]); }
    return out;
  }
  clearObjs() { for (const o of this.objs) this.game.removeObjective(o); this.objs = []; }
  hud() {
    const ph = this.phase, ui = this.game.ui; if (!ph) return;
    let sub = '';
    if (ph.type === 'eliminate') sub = `Wave ${Math.min(this.wave + (this.waveActive ? 0 : 1), ph.waves.length)} / ${ph.waves.length}`;
    else if (ph.type === 'uplink') sub = `Terminals ${this.active} / ${ph.count}`;
    else if (ph.type === 'destroy') sub = `Cores remaining: ${this.left}`;
    else if (ph.type === 'onslaught') sub = `Wave ${this.wave}`;
    else if (ph.type === 'boss') sub = 'Target the glowing heat cores';
    ui.objective(ph.text.toUpperCase(), sub);
  }
  enqueue(list, mult = 1, eliteChance = 0) { for (const [type, n] of list) for (let i = 0; i < Math.round(n * mult); i++) this.queue.push({ type, elite: Math.random() < eliteChance && type !== 'crawler' && type !== 'heavy' }); for (let i = this.queue.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; } }
  typeCount(t) { let n = 0; for (const e of this.game.enemies.list) if (!e.dead && e.type === t) n++; for (const q of this.queue) if (q.type === t) n++; return n; }
  spawnGroup(list, near = false) { this.enqueue(list); this.nearSpawn = near; }
  pickSpawn(type) {
    const g = this.game, L = g.level, p = g.player.body, cand = [];
    const size = type === 'heavy' ? 2 : 1;
    for (const s of L.spawns) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d > 17 && d < 62 && !L.navBlocked(s.x, s.z, size)) cand.push(s); }
    if (!cand.length) return L.spawns[(Math.random() * L.spawns.length) | 0] || { x: 0, z: 0 };
    const s = pick(cand); let x = s.x + rand(-2, 2), z = s.z + rand(-2, 2); if (L.navBlocked(x, z, size)) { x = s.x; z = s.z; } return { x, z };
  }
  doSpawn(q) {
    const g = this.game, s = this.pickSpawn(q.type);
    const wave = this.onslaught ? this.wave : 0;
    // difficulty curve: Onslaught starts soft and ramps per wave; campaign ramps per mission
    let hpMul = 1, dmgMul = 1;
    if (this.onslaught) { hpMul = 1 + Math.max(0, wave - 3) * 0.035; dmgMul = clamp(0.6 + wave * 0.08, 0.6, 1) * (1 + Math.max(0, wave - 6) * 0.025); }
    else { const mi = Math.min(5, g.missionIndex || 0); dmgMul = [0.72, 0.82, 0.9, 0.97, 1.04, 1.1][mi]; hpMul = 0.88 + 0.04 * mi; }
    g.enemies.spawn(q.type, s.x, s.z, { elite: q.elite, hpMul, dmgMul });
    if (q.type !== 'drone') { g.fx.spawnBeam(s.x, s.z, q.elite ? [1, 0.2, 0.7] : [1, 0.35, 0.15]); g.audio.play('spawn', { pos: { x: s.x, y: 1, z: s.z }, vol: 0.7, ref: 10, throttle: 0.1 }); }
  }
  onProp(prop) { // objective prop destroyed
    if (this.phase && this.phase.type === 'destroy' && prop.type === 'core') { this.left--; this.game.ui.banner('CORE DESTROYED', this.left > 0 ? `${this.left} REMAINING` : 'ALL CORES OFFLINE'); this.game.audio.play('objective', { vol: 0.7 }); this.game.addScore(500, 'CORE DESTROYED'); this.hud(); if (this.left <= 0) this.waveT = 2.5; }
  }
  update(dt) {
    const g = this.game, ph = this.phase, ui = g.ui, p = g.player.body; if (!ph || this.done || g.player.dead) return;
    this.elapsed += dt;
    const alive = g.enemies.alive();
    // spawn queue
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0 && alive < this.maxAlive) { this.spawnT = this.onslaught ? Math.max(0.45, 1.05 - this.wave * 0.06) : 0.55; this.doSpawn(this.queue.shift()); }
    const pressure = () => { this.pressT -= dt; if (this.pressT <= 0 && ph.pressure) { const cap = Math.min(this.maxAlive, 4 + this.elapsed / 40); if (alive + this.queue.length < cap) { let e = pick(ph.pressure); const CAP = { lancer: 2, heavy: 2 }; if (CAP[e[0]] !== undefined && this.typeCount(e[0]) >= CAP[e[0]]) e = ph.pressure[0]; this.enqueue([[e[0], Math.max(1, Math.round(e[1] * rand(0.6, 1)))]]); } this.pressT = rand(6, 9.5); } };
    this.marker = null; this.prompt = null;
    if (ph.type === 'eliminate') {
      if (!this.waveActive) { this.waveT -= dt; if (this.waveT <= 0) { this.waveActive = true; const w = ph.waves[this.wave]; this.enqueue(w); ui.banner(`WAVE ${this.wave + 1}`, 'HOSTILES INBOUND'); g.audio.play('wave', { vol: 0.8 }); this.wave++; this.hud(); } }
      else if (!this.queue.length && alive === 0) { this.waveActive = false; if (this.wave >= ph.waves.length) { this.next(); } else { this.waveT = 4; g.dropSupply(); ui.toast('WAVE CLEARED', 'good', 1.6); this.hud(); } }
      else if (alive <= 3 && !this.queue.length) { let n = null, nd = 1e9; for (const e of g.enemies.list) if (!e.dead) { const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z); if (d < nd) { nd = d; n = e; } } if (n) this.marker = { x: n.pos.x, y: n.pos.y + n.h + 0.4, z: n.pos.z, kind: 'enemy' }; }
    } else if (ph.type === 'uplink') {
      const t = this.objs[this.active];
      if (t) {
        const d = Math.hypot(t.x - p.x, t.z - p.z); this.marker = { x: t.x, y: 2.4, z: t.z, kind: 'obj' };
        if (!this.uploading) { if (d < 3.2) { this.prompt = 'START UPLINK'; if (g.input.hit('interact')) { this.uploading = true; this.progress = 0; g.audio.play('ui_confirm', { vol: 0.7 }); ui.toast('UPLINK STARTED — HOLD THE ZONE', 'info', 2); this.enqueue([pick(ph.pressure), pick(ph.pressure)]); t.setState(1); } } }
        else {
          const inZone = d < 6.5; if (inZone) { this.progress += dt / ph.time; if (Math.random() < dt * 3) g.audio.play('upload', { pos: { x: t.x, y: 1, z: t.z }, vol: 0.25, throttle: 0.4 }); }
          ui.progress(true, inZone ? 'UPLOADING' : 'RETURN TO THE ZONE', this.progress, !inZone);
          g.fx.marker(t.x, 0.06, t.z, 13, inZone ? 0.25 : 1.2, inZone ? 1.2 : 0.3, inZone ? 1.6 : 0.2, 5);
          pressure();
          if (this.progress >= 1) { ui.progress(false); t.setState(2); this.uploading = false; this.active++; g.addScore(400, 'UPLINK COMPLETE'); g.audio.play('objective', { vol: 0.7 }); this.hud(); if (this.active >= ph.count) this.next(); else { ui.banner('UPLINK COMPLETE', 'PROCEED TO NEXT TERMINAL'); g.dropSupply(); } }
        }
      }
    } else if (ph.type === 'destroy') {
      if (this.left <= 0) { this.waveT -= dt; if (this.waveT <= 0) this.next(); }
      else { pressure(); let n = null, nd = 1e9; for (const o of this.objs) if (!o.dead) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < nd) { nd = d; n = o; } } if (n) this.marker = { x: n.x, y: 3.2, z: n.z, kind: 'obj' }; }
    } else if (ph.type === 'survive') {
      this.timer -= dt; pressure(); if (this.pressT > 5.5) this.pressT = 5.5 - Math.min(2.5, this.elapsed / 70);
      ui.objective(ph.text.toUpperCase(), `Extraction in ${Math.max(0, Math.ceil(this.timer))}s`);
      if (this.timer <= 0) this.next();
    } else if (ph.type === 'extract') {
      const b = this.objs[0]; this.marker = { x: b.x, y: 2.5, z: b.z, kind: 'obj' }; pressure();
      if (Math.hypot(b.x - p.x, b.z - p.z) < 3.5) this.next();
    } else if (ph.type === 'boss') {
      const boss = g.enemies.boss; if (boss && !boss.dead) ui.bossHp(boss.hp / boss.maxHp); else if (!this.bossDead) { this.bossDead = true; ui.bossBar(false); this.waveT = 5.8; for (const e of g.enemies.list) if (!e.dead) e.die(0, 1, 0, {}); }
      if (this.bossDead) { this.waveT -= dt; if (this.waveT <= 0) this.next(); }
    } else if (ph.type === 'onslaught') {
      if (!this.waveActive) {
        this.waveT -= dt;
        if (this.waveT <= 0) {
          this.wave++; this.waveActive = true; const w = this.wave; let budget = 4 + w * 1.6 + w * w * 0.07; const list = {};
          const avail = [['drone', 1], ['trooper', 1]]; if (w >= 3) avail.push(['crawler', 1.2]); if (w >= 5) avail.push(['lancer', 1]); if (w >= 8) avail.push(['heavy', 0.6]);
          let guard = 0; while (budget > 0.9 && guard++ < 200) { const [t] = pick(avail); const c = ENEMIES[t].cost; if (c > budget + 1) continue; if (t === 'heavy' && (list.heavy || 0) >= 1 + Math.floor((w - 8) / 6)) continue; if (t === 'lancer' && (list.lancer || 0) >= 1 + Math.floor(w / 6)) continue; list[t] = (list[t] || 0) + 1; budget -= c; }
          const heavyWave = w >= 10 && w % 5 === 0; if (heavyWave) list.heavy = (list.heavy || 0) + 1;
          this.enqueue(Object.entries(list), 1, clamp((w - 5) * 0.03, 0, 0.4)); this.maxAlive = Math.min(18, 6 + w);
          ui.banner(`WAVE ${w}`, heavyWave ? 'HEAVY ASSAULT' : 'HOSTILES INBOUND'); g.audio.play('wave', { vol: 0.8 }); this.hud();
        }
      } else if (!this.queue.length && alive === 0) { this.waveActive = false; this.waveT = 7; g.addScore(250 * this.wave, `WAVE ${this.wave} CLEARED`); g.dropSupply(); ui.toast('WAVE CLEARED — RESUPPLY INBOUND', 'good', 2); g.stats.wave = this.wave; }
      else if (alive <= 2 && !this.queue.length) { for (const e of g.enemies.list) if (!e.dead) { this.marker = { x: e.pos.x, y: e.pos.y + e.h + 0.4, z: e.pos.z, kind: 'enemy' }; break; } }
    }
    if (ph.type !== 'uplink' || !this.uploading) { if (ph.type === 'uplink') ui.progress(false); }
  }
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.state = 'loading'; this.time = 0; this.realDt = 0.016; this.timeScale = 1; this.slowT = 0;
    this.stats = this.newStats(); this.godMode = false; this.level = null; this.pickups = []; this.objectives = [];
  }
  newStats() { return { score: 0, kills: 0, crits: 0, shots: 0, hits: 0, damage: 0, damageTaken: 0, credits: 0, time: 0, combo: 1, comboT: 0, maxCombo: 1, wave: 0, multiT: 0, multiN: 0, revived: false }; }

  async boot(sdk, save, ui) {
    this.sdk = sdk; this.save = save; this.ui = ui; const s = save.data.settings;
    this.settings = s;
    let q = s.quality; this.isMobile = sdk.isMobile || (('ontouchstart' in window) && Math.min(screen.width, screen.height) < 820) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (q === 'auto' || !QUALITY[q]) q = this.isMobile ? 'low' : this.detectQuality();
    this.gfx = new Gfx(this.canvas, q); this.gfx.dyn = 1;
    this.audio = new AudioSys(); this.audio.vol = { master: s.master, sfx: s.sfx, music: s.music };
    this.input = new Input(this.canvas); this.input.sens = s.sens; this.input.invertY = s.invertY;
    this.diff = DIFFICULTY[save.data.difficulty] || DIFFICULTY.veteran;
    const step = (p, label) => new Promise((r) => { ui.loading(p, label); requestAnimationFrame(() => setTimeout(r, 0)); });
    await step(0.08, 'CALIBRATING OPTICS');
    this.tex = bakeTextures(this.gfx.renderer, this.gfx.q.tex);
    await step(0.45, 'FORGING MATERIALS');
    this.M = makeMaterials(this.tex); this.fxAtlas = makeFxAtlas(); this.decalAtlas = makeDecalAtlas(); this.poolTex = makeLightPoolTex(); this.paintTex = makePaintTex(); this.shieldTex = makeHexTex();
    await step(0.55, 'SYNTHESIZING AUDIO');
    this.audio.prepare();
    await step(0.7, 'ASSEMBLING HOSTILES');
    this.fx = new FX(this); this.enemies = new Enemies(this); this.enemies.prewarm(); this.projectiles = new Projectiles(this); this.director = new Director(this);
    this.player = new Player(this); this.player.baseFov = s.fov; this.player.rig.visible = false;
    await step(0.82, 'BUILDING KESTREL STATION');
    this.loadLevel({ theme: 'yard', sky: 'golden', seed: 3 });
    await step(0.97, 'READY');
    addEventListener('resize', () => this.gfx.resize());
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'playing' && !this.input.touch) this.pause(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    this.state = 'menu'; this.menuT = 0;
    this.last = performance.now(); this.fpsAvg = 60; this.dynT = 0;
    const loop = (now) => { requestAnimationFrame(loop); this.frame(now); };
    requestAnimationFrame(loop);
  }

  detectQuality() {
    try { const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'low'; const ext = gl.getExtension('WEBGL_debug_renderer_info'); const r = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase();
      if (/swiftshader|llvmpipe|software/.test(r)) return 'low'; if (/rtx|radeon rx|gtx 1[06-9]|gtx 9[78]|apple m[1-9]|arc\(tm\) a/.test(r)) return 'high'; if (/intel|uhd|iris|mali|adreno|hd graphics/.test(r)) return 'medium'; return 'high'; } catch (e) { return 'medium'; }
  }
  setQuality(q) { if (!QUALITY[q]) q = this.isMobile ? 'low' : this.detectQuality(); this.gfx.applyQuality(q); if (this.level) { const d = this.level.def; this.gfx.setSky(d.sky); } }

  loadLevel(def) {
    if (this.level) { this.level.dispose(); this.level = null; }
    for (const o of this.objectives.slice()) this.removeObjective(o);
    for (const p of this.pickups) this.gfx.scene.remove(p.mesh); this.pickups.length = 0;
    this.enemies.clear(); this.projectiles.reset();
    this.gfx.setSky(def.sky);
    this.level = new Level(this, def);
    this.fx.reset();
    this.thunderT = rand(6, 14);
  }

  // ---------- mission flow ----------
  startMission(index, onslaught = false) {
    const ui = this.ui; this.audio.init(); this.audio.resume();
    ui.show('deploy');
    setTimeout(() => {
      let def;
      if (onslaught) { const r = new RNG((Date.now() / 1000) | 0); def = { ...ONSLAUGHT, theme: r.pick(ONSLAUGHT.themes), sky: r.pick(ONSLAUGHT.skies), seed: r.i(1, 9999), phases: [] }; }
      else def = MISSIONS[index];
      this.mission = def; this.missionIndex = index; this.onslaught = onslaught;
      this.diff = DIFFICULTY[this.save.data.difficulty] || DIFFICULTY.veteran;
      this.loadLevel(def);
      this.stats = this.newStats(); this.player.reset(); this.player.baseFov = this.settings.fov;
      const st = this.level.start; this.player.place(st.x, st.z, st.yaw); this.player.rig.visible = true;
      this.director.start(def, onslaught);
      this.timeScale = 1; this.slowT = 0; this.gfx.fx.uFade.value = 1; this.fadeIn = 1;
      this.audio.setMusic('combat'); this.audio.intensity = 0.2;
      this.state = 'playing'; ui.show('hud'); ui.hudAll(this.player); ui.bossBar(def.phases[0] && def.phases[0].type === 'boss', 'COLOSSUS');
      ui.banner(def.name, def.sub); this.input.enabled = true; this.input.lock(); this.sdk.gameplayStart();
      this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera);
    }, 60);
  }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.input.enabled = false; this.input.unlock(); this.sdk.gameplayStop(); this.ui.show('pause'); this.audio.setMuffle(1); }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this.input.enabled = true; this.input.lock(); this.sdk.gameplayStart(); this.ui.show('hud'); this.audio.setMuffle(0); this.last = performance.now(); }
  toMenu() {
    this.state = 'menu'; this.input.enabled = false; this.input.unlock(); this.sdk.gameplayStop(); this.audio.setMuffle(0); this.audio.setSlowmo(0); this.audio.stopLoops(); this.audio.setMusic('menu');
    this.player.rig.visible = false; this.timeScale = 1; const f = this.gfx.fx; f.uDamage.value = f.uLow.value = f.uFocus.value = f.uShield.value = f.uFlash.value = 0; f.uFade.value = 0;
    this.enemies.clear(); this.projectiles.reset(); this.director.reset(); this.ui.bossBar(false); this.ui.show('menu'); this.menuT = 0;
    this.gfx.camera.fov = 60; this.gfx.camera.updateProjectionMatrix();
  }
  onPlayerDeath() {
    this.state = 'dead'; this.deadT = 0; this.sdk.gameplayStop(); this.audio.setMuffle(0.8); this.audio.intensity = 0;
    this.input.enabled = false;
    setTimeout(() => { if (this.state === 'dead') { this.input.unlock(); this.ui.death(this, !this.stats.revived); } }, 1500);
  }
  async revive() {
    const ok = await this.showAd('rewarded'); if (!ok) { this.ui.toast('NO AD AVAILABLE', 'warn', 2); return false; }
    const p = this.player; p.dead = false; p.health = p.maxHealth; p.shield = p.maxShield; p.invuln = 3.5; p.roll = 0; p.pitch = 0; p.eye = 1.65; this.stats.revived = true; this.projectiles.bolts.length = 0;
    for (const e of this.enemies.list) if (!e.dead && e.type !== 'boss' && Math.hypot(e.pos.x - p.body.x, e.pos.z - p.body.z) < 9) e.hit(9999, e.pos.x, e.pos.y + 1, e.pos.z, 0, 1, 0, { explosive: true });
    this.fx.ring(p.body.x, 0.3, p.body.z, 1, 18, [0.3, 0.8, 1], 0.6, 4);
    this.state = 'playing'; this.ui.show('hud'); this.ui.hudAll(p); this.input.enabled = true; this.input.lock(); this.sdk.gameplayStart(); this.audio.setMuffle(0); this.last = performance.now();
    return true;
  }
  showAd(type) { return this.sdk.ad(type, { onStart: () => { this.audio.adMuted = true; this.audio.applyVol(); }, onEnd: () => { this.audio.adMuted = false; this.audio.applyVol(); this.last = performance.now(); } }); }

  completeMission() {
    if (this.state !== 'playing') return; this.state = 'ending'; this.endT = 0; this.sdk.gameplayStop();
    this.ui.banner('MISSION COMPLETE', this.mission.name); this.audio.play('levelup', { vol: 0.8 }); this.sdk.happytime();
  }
  finishRun(win) {
    const s = this.stats, d = this.save.data, m = this.mission; this.input.enabled = false; this.input.unlock();
    const acc = s.shots ? Math.min(1, s.hits / s.shots) : 0;
    const res = { win, onslaught: this.onslaught, name: m.name, kills: s.kills, acc, time: s.time, maxCombo: s.maxCombo, wave: this.director.wave, bonus: 0, stars: 0, newBest: false };
    if (win && !this.onslaught) {
      const timeBonus = Math.max(0, Math.round(2000 - s.time * 4)), accBonus = Math.round(acc * 1500), flawless = s.revived ? 0 : 500;
      res.bonus = timeBonus + accBonus + flawless; s.score += res.bonus; res.timeBonus = timeBonus; res.accBonus = accBonus; res.flawless = flawless;
      res.stars = s.score >= m.par ? 3 : s.score >= m.par * 0.6 ? 2 : 1;
      const prev = d.missions[m.id] || { stars: 0, best: 0 }; res.newBest = s.score > prev.best;
      d.missions[m.id] = { stars: Math.max(prev.stars, res.stars), best: Math.max(prev.best, s.score) };
      s.credits += Math.round(m.reward * this.diff.credits * (prev.stars ? 0.5 : 1));
      if (this.missionIndex + 1 >= d.unlocked) d.unlocked = Math.min(MISSIONS.length, this.missionIndex + 2);
    }
    if (this.onslaught) { res.newBest = s.score > d.onslaught.score; d.onslaught.score = Math.max(d.onslaught.score, s.score); d.onslaught.wave = Math.max(d.onslaught.wave, this.director.wave - (win ? 0 : 1)); }
    res.score = Math.round(s.score); res.credits = Math.round(s.credits); res.xp = Math.round(s.score / 8);
    const before = rankFor(d.xp).lvl; d.credits += res.credits; d.xp += res.xp; res.rankUp = rankFor(d.xp).lvl > before;
    d.totals.kills += s.kills; d.totals.time += s.time; d.totals.shots += s.shots; d.totals.hits += s.hits;
    this.save.save(); this.lastResult = res; return res;
  }
  async doubleReward() { const r = this.lastResult; if (!r || r.doubled) return false; const ok = await this.showAd('rewarded'); if (!ok) return false; r.doubled = true; this.save.data.credits += r.credits; this.save.save(); return true; }

  // ---------- scoring ----------
  addScore(n, label, crit) { const s = this.stats; const v = Math.round(n * s.combo); s.score += v; this.ui.feed(label, v, crit); this.ui.hudScore(s); }
  onEnemyKilled(e, o) {
    const s = this.stats, def = e.def, p = this.player; s.kills++; if (o.crit) s.crits++;
    s.comboT = 4.5; s.combo = Math.min(5, s.combo + 0.25); s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.multiN = s.multiT > 0 ? s.multiN + 1 : 1; s.multiT = 1.4;
    const base = def.score * (e.elite ? 1.6 : 1);
    this.addScore(base, (e.elite ? 'ELITE ' : '') + def.name, false);
    if (o.crit) this.addScore(base * 0.3, 'CRITICAL', true); if (o.melee) this.addScore(100, 'MELEE KILL', true); if (e.flying && o.explosive) this.addScore(80, 'AIRBURST', true);
    if (s.multiN === 2) this.ui.announce('DOUBLE KILL'); else if (s.multiN === 3) this.ui.announce('TRIPLE KILL'); else if (s.multiN === 4) this.ui.announce('OVERKILL'); else if (s.multiN >= 5) this.ui.announce('ANNIHILATION');
    if (s.multiN >= 2) this.addScore(50 * s.multiN, 'MULTI-KILL', true);
    const cr = def.credits * this.diff.credits * (e.elite ? 1.6 : 1) * (1 + 0.2 * (this.save.data.perks.scavenger || 0)); s.credits += cr;
    p.addFocus(0.035 + (o.crit ? 0.02 : 0)); this.audio.play('kill', { vol: 0.55, reverb: 0 });
    this.audio.intensity = Math.min(1, this.audio.intensity + 0.12);
    // drops
    if (e.type !== 'boss') {
      const w = p.weapon, st = p.stat(w.id), lowAmmo = st.reserve !== Infinity && w.reserve < st.reserve * 0.35, lowHp = p.health < p.maxHealth * 0.5;
      const r = Math.random(); let kind = null;
      const hC = lowHp ? 0.3 : 0.1, aC = hC + (lowAmmo ? 0.24 : 0.12), gC = aC + 0.06;
      if (r < hC) kind = 'health'; else if (r < aC) kind = 'ammo'; else if (r < gC && p.grenades < p.maxGrenades) kind = 'grenade'; else if (r > 0.92) kind = 'shield';
      if (e.type === 'heavy') { this.spawnPickup('ammo', e.pos.x + 0.6, e.pos.z); kind = 'health'; }
      if (kind) this.spawnPickup(kind, e.pos.x, e.pos.z);
    } else { this.sdk.happytime(); this.slowT = 1.3; }
    if (this.director.phase && !this.director.queue.length && this.enemies.alive() === 0 && (this.director.phase.type === 'eliminate' || this.director.phase.type === 'onslaught')) this.slowT = Math.max(this.slowT, 0.9);
    this.ui.hudScore(s);
  }
  onPlayerShot() { this.audio.intensity = Math.min(1, this.audio.intensity + 0.012); }
  onExplosion() { }
  damageProp(prop, dmg, explosive) {
    if (prop.dead) return; prop.hp -= dmg;
    if (prop.type === 'core') { prop.flash = 1; this.ui.hitmarker(false, false); }
    if (prop.hp > 0) return;
    if (prop.type === 'barrel') { this.level.removeProp(prop); setTimeout(() => { if (this.level && this.state !== 'menu') this.projectiles.explode(prop.x, 0.6, prop.z, 5.5, 160, 'player'); }, explosive ? 120 + Math.random() * 120 : 0); }
    else if (prop.type === 'core') { prop.dead = true; prop.collider.dead = true; this.gfx.scene.remove(prop.group); this.projectiles.explode(prop.x, 1.6, prop.z, 6, 120, 'enemyOnly'); this.fx.explosion(prop.x, 2.4, prop.z, 7, [0.4, 0.7, 1]); this.director.onProp(prop); }
  }

  // ---------- objective props ----------
  _objMat() { return this.enemies.makeMat(); }
  makeTerminal(x, z, idx) {
    const b = new Builder(2.2), dark = [0.07, 0.075, 0.085], grey = [0.3, 0.31, 0.33];
    b.box(1.5, 0.16, 1.1, 0, 0.08, 0, dark, { bevel: 0.03 }); b.box(0.9, 1.0, 0.5, 0, 0.62, 0.1, grey, { bevel: 0.05 }); b.box(1.2, 0.08, 0.7, 0, 1.12, -0.05, dark, { bevel: 0.02, rx: 0.35 });
    b.box(1.3, 0.85, 0.08, 0, 1.75, 0.22, dark, { bevel: 0.03, rx: -0.12 }); b.cyl(0.04, 0.04, 2.6, 0.55, 1.5, 0.3, grey, { seg: 6 }); b.cyl(0.3, 0.02, 0.12, 0.55, 2.86, 0.3, grey, { seg: 12 });
    for (let k = 0; k < 6; k++) b.box(0.1, 0.02, 0.06, -0.4 + k * 0.16, 1.17, -0.1, [0.2, 0.9, 1], { emi: 3, metal: 0, rx: 0.35 });
    const mat = this._objMat(), body = b.mesh(mat);
    const sb = new Builder(2.2); sb.box(1.16, 0.7, 0.02, 0, 1.75, 0.17, [1, 0.45, 0.1], { emi: 2.2, metal: 0, rx: -0.12 }); sb.sphere(0.09, 0.55, 2.98, 0.3, [1, 0.3, 0.1], { emi: 12, metal: 0 });
    const smat = this._objMat(), screen = sb.mesh(smat, false);
    const group = new THREE.Group(); group.add(body, screen); group.position.set(x, 0, z); const p = this.player.body; group.rotation.y = Math.atan2(p.x - x, p.z - z) + Math.PI; this.gfx.scene.add(group);
    const col = this.level.addCollider(x - 0.6, 0, z - 0.6, x + 0.6, 2.2, z + 0.6, { kind: 'metal', nav: false }); this.level._hashInsert(col);
    const o = { type: 'terminal', x, z, group, mats: [mat, smat], col, state: 0, t: 0, setState(s) { this.state = s; } };
    o.update = (dt) => { o.t += dt; smat.userData.emiBoost.value = o.state === 0 ? 0.7 + 0.3 * Math.sin(o.t * 3) : o.state === 1 ? 1.2 + 0.8 * Math.sin(o.t * 14) : 0.9; const c = o.state === 2 ? [0.2, 1, 0.4] : o.state === 1 ? [0.2, 0.8, 1] : [1, 0.45, 0.1]; smat.color.setRGB(1, 1, 1); if (o._s !== o.state) { o._s = o.state; const col = screen.geometry.attributes.color; for (let i = 0; i < col.count; i++) col.setXYZ(i, c[0], c[1], c[2]); col.needsUpdate = true; } if (o.state !== 2) this.fx.add.push(x, 3.4, z, 0, 14, 0, 0.25, 0, 14, 1, c[0] * 2, c[1] * 2, c[2] * 2, 0.5); };
    this.objectives.push(o); return o;
  }
  makeCore(x, z) {
    const b = new Builder(2.2), dark = [0.07, 0.075, 0.085], grey = [0.3, 0.31, 0.33], yel = [0.78, 0.55, 0.06];
    b.cyl(1.25, 1.4, 0.4, 0, 0.2, 0, dark, { seg: 20 }); b.cyl(0.55, 0.55, 2.6, 0, 1.7, 0, [0.3, 0.75, 1], { seg: 18, emi: 1.3, metal: 0 });
    for (const y of [0.6, 1.7, 2.8]) b.cyl(0.8, 0.8, 0.22, 0, y, 0, grey, { seg: 20 }); b.cyl(1.0, 0.8, 0.3, 0, 3.1, 0, yel, { seg: 20 });
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.78; b.box(0.16, 2.7, 0.16, Math.cos(a) * 0.86, 1.7, Math.sin(a) * 0.86, dark, { bevel: 0.03, ry: -a }); }
    const mat = this._objMat(), mesh = b.mesh(mat), group = new THREE.Group(); group.add(mesh); group.position.set(x, 0, z); this.gfx.scene.add(group);
    const hp = 650 * this.diff.hp;
    const o = { type: 'core', x, y: 1.7, z, group, mats: [mat], hp, maxHp: hp, dead: false, flash: 0, t: rand(5) };
    o.collider = this.level.addCylCollider(x, z, 0.95, 0, 3.3, { kind: 'metal', prop: o }); this.level._hashInsert(o.collider);
    o.update = (dt) => { o.t += dt; o.flash = Math.max(0, o.flash - dt * 6); mat.emissive.setScalar(o.flash * 0.6); mat.userData.emiBoost.value = 0.6 + 0.4 * Math.sin(o.t * 4) + (1 - o.hp / o.maxHp) * Math.abs(Math.sin(o.t * 20)) * 1.5; if (!o.dead) { this.fx.add.push(x, 3.4, z, 0, 9, 0, 0.3, 0, 14, 1, 0.5, 1.4, 2.4, 0.5); if (o.hp < o.maxHp * 0.5 && Math.random() < dt * 12) this.fx.sparks(x + rand(-0.6, 0.6), rand(0.6, 3), z + rand(-0.6, 0.6), 0, 0.5, 0, 3, [0.5, 0.8, 1], 5); } };
    this.objectives.push(o); return o;
  }
  makeBeacon(x, z) {
    const o = { type: 'beacon', x, z, mats: [], t: 0 };
    o.update = (dt) => { o.t += dt; const k = 0.7 + 0.3 * Math.sin(o.t * 5); this.fx.add.push(x, 0.1, z, 0, 60, 0, 0.9, 0, 14, 1, 0.3 * k, 2.2 * k, 0.8 * k, 0.9); this.fx.marker(x, 0.06, z, 7, 0.2, 1.8 * k, 0.6, 5); this.fx.marker(x, 0.07, z, 5 + 2 * ((o.t * 0.8) % 1), 0.1, 0.9, 0.3, 12); if (Math.random() < dt * 20) this.fx.emit({ x: x + rand(-0.4, 0.4), y: 0.2, z: z + rand(-0.4, 0.4), vy: rand(1.5, 3), life: 1.6, s0: 0.3, s1: 1.4, r: 0.15, g: 0.9, b: 0.35, a: 0.4, add: false, frame: 2, rv: rand(-1, 1), fadeIn: 0.2 }); };
    this.ui.banner('EXTRACTION INBOUND', 'REACH THE BEACON'); this.objectives.push(o); return o;
  }
  removeObjective(o) { const i = this.objectives.indexOf(o); if (i >= 0) this.objectives.splice(i, 1); if (o.group) { this.gfx.scene.remove(o.group); o.group.traverse((m) => m.geometry && m.geometry.dispose()); } for (const m of o.mats) m.dispose(); if (o.col) o.col.dead = true; if (o.collider) o.collider.dead = true; }

  // ---------- pickups ----------
  _pickGeo(kind) {
    this._pg = this._pg || {}; if (this._pg[kind]) return this._pg[kind]; const b = new Builder(2.2);
    if (kind === 'health') { b.box(0.34, 0.24, 0.22, 0, 0, 0, [0.75, 0.76, 0.78], { bevel: 0.04 }); b.box(0.16, 0.05, 0.23, 0, 0, 0, [1, 0.12, 0.1], { emi: 6, metal: 0 }); b.box(0.05, 0.16, 0.23, 0, 0, 0, [1, 0.12, 0.1], { emi: 6, metal: 0 }); }
    else if (kind === 'ammo') { b.box(0.36, 0.22, 0.2, 0, 0, 0, [0.2, 0.24, 0.14], { bevel: 0.03 }); for (let k = -2; k <= 2; k++) b.cyl(0.022, 0.022, 0.1, k * 0.06, 0.14, 0, [0.9, 0.65, 0.2], { seg: 8, emi: 1.5, metal: 0 }); b.box(0.37, 0.04, 0.21, 0, 0.02, 0, [1, 0.7, 0.15], { emi: 3, metal: 0 }); }
    else if (kind === 'shield') { b.cyl(0.11, 0.11, 0.32, 0, 0, 0, [0.2, 0.75, 1], { seg: 12, emi: 6, metal: 0 }); for (const y of [-0.15, 0.15]) b.cyl(0.14, 0.14, 0.07, 0, y, 0, [0.3, 0.31, 0.33], { seg: 12 }); }
    else { b.sphere(0.13, 0, 0, 0, [0.12, 0.15, 0.1], { seg: 12 }); b.cyl(0.135, 0.135, 0.04, 0, 0, 0, [1, 0.5, 0.1], { seg: 12, emi: 5, metal: 0 }); b.cyl(0.04, 0.04, 0.1, 0, 0.15, 0, [0.3, 0.31, 0.33], { seg: 8 }); }
    return (this._pg[kind] = b.build());
  }
  spawnPickup(kind, x, z, y = 0) {
    if (this.pickups.length > 24) return; if (!this._pmat) this._pmat = this.enemies.makeMat();
    const mesh = new THREE.Mesh(this._pickGeo(kind), this._pmat); mesh.position.set(x, y + 0.6, z); mesh.castShadow = true; this.gfx.scene.add(mesh);
    this.pickups.push({ kind, mesh, x, z, y, t: rand(6), life: 45, vy: 4 });
  }
  dropSupply() { const p = this.player.body; for (const k of ['ammo', 'ammo', 'health', 'grenade']) { for (let i = 0; i < 12; i++) { const a = rand(TAU), d = rand(3, 7), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (!this.level.navBlocked(x, z, 1)) { this.spawnPickup(k, x, z); this.fx.ring(x, 0.2, z, 0.3, 3, [0.3, 0.9, 1], 0.5, 2); break; } } } }
  updatePickups(dt) {
    const p = this.player, b = p.body, COL = { health: [3, 0.4, 0.3], ammo: [3, 2, 0.4], shield: [0.5, 2, 3], grenade: [3, 1.4, 0.3] };
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]; k.t += dt; k.life -= dt; const d = Math.hypot(k.x - b.x, k.z - b.z), dy = Math.abs(b.y - k.y);
      let want = true; if (k.kind === 'health') want = p.health < p.maxHealth; else if (k.kind === 'shield') want = p.shield < p.maxShield; else if (k.kind === 'grenade') want = p.grenades < p.maxGrenades;
      if (d < 3 && dy < 2.5 && want) { const sp = 9 * dt / Math.max(d, 0.1); k.x += (b.x - k.x) * Math.min(1, sp); k.z += (b.z - k.z) * Math.min(1, sp); }
      k.mesh.position.set(k.x, k.y + 0.6 + Math.sin(k.t * 2.4) * 0.1, k.z); k.mesh.rotation.y = k.t * 1.6; const c = COL[k.kind];
      const blink = k.life < 6 ? (Math.sin(k.t * 12) > 0 ? 1 : 0.3) : 1; this.fx.add.push(k.x, k.y + 0.6, k.z, 0, 0, 0, 0.9, 0, 0, 0, c[0] * 0.5 * blink, c[1] * 0.5 * blink, c[2] * 0.5 * blink, 1); this.fx.add.push(k.x, k.y + 0.1, k.z, 0, 2.4, 0, 0.12, 0, 14, 1, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 0.6 * blink);
      let got = false;
      if (d < 1.1 && dy < 2.2 && want) {
        if (k.kind === 'health') { p.heal(40); this.ui.toast('+40 HEALTH', 'good', 1); this.audio.play('heal', { vol: 0.6, reverb: 0.1 }); got = true; }
        else if (k.kind === 'shield') { p.shield = p.maxShield; this.ui.toast('SHIELD RESTORED', 'info', 1); this.audio.play('shield_up', { vol: 0.6 }); got = true; }
        else if (k.kind === 'grenade') { p.grenades++; this.ui.toast('+1 FRAG', 'info', 1); this.audio.play('pickup', { vol: 0.6 }); got = true; }
        else if (p.addAmmo(0.22 * (1 + 0.2 * (this.save.data.perks.scavenger || 0)))) { this.ui.toast('AMMO +', 'info', 1); this.audio.play('pickup', { vol: 0.6 }); got = true; }
        if (got) this.ui.hudAll(p);
      }
      if (got || k.life <= 0) { this.gfx.scene.remove(k.mesh); this.pickups.splice(i, 1); }
    }
  }

  // ---------- frame ----------
  frame(now) {
    let rdt = Math.min(0.05, (now - this.last) / 1000); this.last = now; if (rdt <= 0) rdt = 0.001; this.realDt = rdt;
    const gfx = this.gfx, f = gfx.fx, p = this.player;
    this.fpsAvg = this.fpsAvg * 0.95 + (1 / rdt) * 0.05;
    let dt = rdt;
    if (this.state === 'playing' || this.state === 'ending' || this.state === 'dead') {
      // time scale: focus + cinematic slow-mo
      this.slowT = Math.max(0, this.slowT - rdt);
      const target = this.state === 'dead' ? 0.35 : this.slowT > 0 ? 0.25 : p.focusOn ? 0.38 : 1; this.timeScale = damp(this.timeScale, target, 10, rdt);
      dt = rdt * this.timeScale; this.time += dt;
      const pdt = p.focusOn ? rdt * Math.min(1, this.timeScale * 1.75) : dt;
      if (this.state !== 'dead') this.stats.time += rdt;
      if (this.input.hit('pause') && this.state === 'playing') { this.pause(); this.input.endFrame(); return; }
      p.update(pdt, this.state === 'playing' ? this.input : this._noInput || (this._noInput = { is: () => false, hit: () => false, dx: 0, dy: 0, wheel: 0, slot: 0, stick: { x: 0, y: 0 }, sens: 1 }));
      this.enemies.update(dt, gfx.camera); this.projectiles.update(dt); this.director.update(dt); this.updatePickups(dt);
      for (const o of this.objectives) o.update(dt);
      const s = this.stats; if (s.comboT > 0) { s.comboT -= dt; if (s.comboT <= 0) { s.combo = 1; this.ui.hudScore(s); } } s.multiT -= dt;
      // post fx driven by state
      f.uFlash.value = Math.max(0, f.uFlash.value - rdt * 1.1); f.uDamage.value = Math.max(0, f.uDamage.value - rdt * 1.6); f.uShield.value = Math.max(0, f.uShield.value - rdt * 2.2);
      f.uLow.value = damp(f.uLow.value, p.dead ? 1 : clamp(1 - p.health / (p.maxHealth * 0.4), 0, 1), 5, rdt); f.uFocus.value = p.focusK;
      this.audio.setSlowmo(clamp((1 - this.timeScale) / 0.62, 0, 1) * (this.state === 'dead' ? 0.5 : 1));
      if (p.health < p.maxHealth * 0.3 && !p.dead) { this.hbT = (this.hbT || 0) - rdt; if (this.hbT <= 0) { this.hbT = 0.85; this.audio.play('heartbeat', { vol: 0.9, reverb: 0, rv: 0 }); } }
      this.audio.intensity = Math.max(this.enemies.alive() ? 0.3 : 0.08, this.audio.intensity - rdt * 0.05); if (this.enemies.boss) this.audio.intensity = Math.max(this.audio.intensity, 0.85);
      // weather audio + lightning
      const sky = gfx.sky0; this.audio.loop('loop_wind', sky.rain ? 0.3 : 0.16, 1); this.audio.loop('loop_rain', sky.rain ? 0.5 : 0, 1);
      if (sky.rain) { this.thunderT -= rdt; if (this.thunderT <= 0) { this.thunderT = rand(9, 22); this.lightning = 1; this.audio.play('thunder', { vol: 0.9, delay: rand(0.2, 1.2), reverb: 0.6 }); } }
      if (this.lightning > 0) { this.lightning -= rdt * 2.4; const k = Math.max(0, this.lightning), fl = k * (0.6 + 0.4 * Math.sin(this.time * 70)); gfx.sun.intensity = gfx.sunBase + fl * 9; gfx.skyMat.uniforms.uIntensity.value = sky.skyInt * (1 + fl * 5); } else if (sky.rain) { gfx.sun.intensity = gfx.sunBase; gfx.skyMat.uniforms.uIntensity.value = sky.skyInt; }
      if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - rdt * 1.2); f.uFade.value = this.fadeIn; }
      this.ui.hudFrame(this, rdt);
      if (this.state === 'ending') { this.endT += rdt; this.slowT = Math.max(this.slowT, 0.1); if (this.endT > 2.6) { this.state = 'results'; this.audio.setSlowmo(0); this.ui.results(this, this.finishRun(true)); } }
      if (this.state === 'dead') { this.deadT += rdt; }
      this.level.update(this.time);
      this.fx.update(dt, gfx.camera);
      this.audio.setListener(gfx.camera);
    } else {
      // menu / paused / results : slow orbit camera over the base (menu) or frozen frame
      if (this.state === 'menu' || this.state === 'results' || this.state === 'loading') {
        this.menuT += rdt; const t = this.menuT * 0.035 + 0.6, cam = gfx.camera, R = 30;
        if (this.state !== 'results') { cam.position.set(Math.cos(t) * R, 5.5 + Math.sin(t * 1.7) * 1.6, Math.sin(t) * R); cam.lookAt(Math.cos(t + 1.3) * 10, 3.2, Math.sin(t + 1.3) * 10); if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); } }
        this.time += rdt * 0.5; this.level.update(this.time); this.fx.update(rdt * 0.5, cam);
        f.uFocus.value = 0; f.uLow.value = damp(f.uLow.value, 0, 4, rdt); f.uDamage.value = 0;
      }
      dt = 0;
    }
    this.input.endFrame();
    f.uGrain.value = 0.035; f.uVignette.value = this.state === 'menu' ? 0.75 : 0.55;
    gfx.render(dt, rdt);
    // dynamic resolution
    this.dynT += rdt;
    if (this.dynT > 2.5 && this.state === 'playing' && !this.noDrs) { this.dynT = 0; const q = gfx.q; if (this.fpsAvg < 42 && gfx.dyn > 0.55) { gfx.dyn = Math.max(0.55, gfx.dyn - 0.12); this.applyDyn(); } else if (this.fpsAvg > 58.5 && gfx.dyn < 1 && this.settings.quality === 'auto') { gfx.dyn = Math.min(1, gfx.dyn + 0.06); this.applyDyn(); } }
    if (this.settings.showFps) this.ui.fps(this.fpsAvg, gfx);
  }
  applyDyn() { const g = this.gfx, base = QUALITY[g.qualityName]; g.q = { ...base, scale: base.scale * g.dyn }; g.resize(); }
}
