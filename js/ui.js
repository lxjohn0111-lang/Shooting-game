// DOM HUD + menus
import * as THREE from './lib/three.min.js';
import { MISSIONS, WEAPONS, WEAPON_ORDER, WEAPON_UPGRADES, PERKS, DIFFICULTY, upgradeCost, perkCost, rankFor } from './config.js';
import { clamp, fmtTime, fmtNum } from './util.js';
import { MP_MODES, TEAMS } from './config.js';
import { tierOf, PLACEMENT_MATCHES, TIERS } from './mp/ranked.js';
import { wName } from './mp/session.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const stars = (n) => '★'.repeat(n) + '<s>' + '★'.repeat(3 - n) + '</s>';
const OBJ_TEXT = { eliminate: 'Eliminate all hostiles', uplink: 'Hold terminals to upload data', destroy: 'Destroy power cores', survive: 'Survive until extraction', extract: 'Reach the extraction beacon', boss: 'Destroy COLOSSUS' };

export class UI {
  constructor() {
    this.screens = {}; document.querySelectorAll('.screen').forEach((s) => (this.screens[s.id] = s));
    this.cur = 'loading'; this.selMission = 0; this.selWeapon = 'rifle'; this.settingsFrom = 'menu';
    this.nums = []; for (let i = 0; i < 14; i++) { const d = document.createElement('div'); d.className = 'num'; $('nums').appendChild(d); this.nums.push({ el: d, t: 9, p: new THREE.Vector3() }); } this.numI = 0;
    this.radar = $('radar').getContext('2d'); this.cache = {}; this.hintT = 0;
  }
  set(id, key, val) { const k = id + key; if (this.cache[k] === val) return; this.cache[k] = val; const el = $(id); if (key === 'text') el.textContent = val; else if (key === 'html') el.innerHTML = val; else if (key === 'w') el.style.width = val; else el.classList.toggle(key, !!val); }
  loading(p, label) { $('loadFill').style.width = Math.round(p * 100) + '%'; $('loadLabel').textContent = label; }
  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
    this.cur = name; const t = $('touch'); t.classList.toggle('play', name === 'hud');
    if (name === 'menu') this.refreshMenu(); else if (name === 'missions') this.refreshMissions(); else if (name === 'armory') this.refreshArmory(); else if (name === 'settings') this.refreshSettings(); else if (name === 'mp') this.refreshMp();
  }

  bind(game) {
    this.game = game; const g = game, snd = (n) => { g.audio.init(); g.audio.resume(); g.audio.play(n, { vol: 0.6, reverb: 0 }); };
    document.addEventListener('mouseover', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && b !== this._hov) { this._hov = b; if (g.audio.ready) g.audio.play('ui_hover', { vol: 0.5, reverb: 0 }); } });
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { snd('ui_click'); this.show(b.dataset.go); }));
    // multiplayer
    this.mpMode = 'dm';
    document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => { snd('ui_click'); this.mpMode = b.dataset.mode; document.querySelectorAll('.mode').forEach((x) => x.classList.toggle('sel', x === b)); }));
    $('btnFind').onclick = () => { snd('ui_confirm'); g.net.setName($('mpName').value); g.net.find(this.mpMode); };
    $('mpName').addEventListener('change', () => { g.net.setName($('mpName').value); $('mpName').value = g.net.name; });
    $('mpName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('btnMmCancel').onclick = () => { snd('ui_click'); if (g.mp) g.mpExit(); else { g.net.cancel(); this.show('mp'); } };
    $('btnMrAgain').onclick = () => { snd('ui_confirm'); g.mpExit(this.mpMode); };
    $('btnMrMp').onclick = () => { snd('ui_click'); g.mpExit(); };
    $('btnMrMenu').onclick = () => { snd('ui_click'); g.mpExit(); this.show('menu'); };
    this.nps = []; for (let i = 0; i < 12; i++) { const d = document.createElement('div'); d.className = 'np'; d.style.display = 'none'; $('nameplates').appendChild(d); this.nps.push({ el: d, los: false, losT: 0, key: '' }); }
    $('btnDeploy').onclick = () => { if (this.selMission < g.save.data.unlocked) { snd('ui_confirm'); g.startMission(this.selMission); } else snd('ui_deny'); };
    $('btnResume').onclick = () => { snd('ui_click'); g.resume(); };
    $('btnPauseSettings').onclick = () => { snd('ui_click'); this.settingsFrom = 'pause'; this.show('settings'); };
    $('settingsBack').onclick = () => { snd('ui_click'); g.save.save(); this.show(this.settingsFrom); this.settingsFrom = 'menu'; };
    document.querySelector('[data-go="settings"]').addEventListener('click', () => { this.settingsFrom = 'menu'; });
    const restart = async () => { await g.showAd('midgame'); g.audio.setMuffle(0); g.startMission(g.missionIndex); };
    $('btnRestart').onclick = () => { snd('ui_click'); g.finishRun(false); restart(); };
    $('btnQuit').onclick = () => { snd('ui_click'); if (g.mp) { g.mpExit(); return; } g.finishRun(false); g.toMenu(); };
    $('btnRevive').onclick = async () => { snd('ui_click'); $('btnRevive').disabled = true; const ok = await g.revive(); if (!ok) $('btnRevive').disabled = false; };
    $('btnRetry').onclick = () => { snd('ui_click'); if (!this._ended) { g.finishRun(false); } restart(); };
    $('btnDeathEnd').onclick = () => { snd('ui_click'); g.finishRun(false); g.toMenu(); };
    $('btnDouble').onclick = async () => { snd('ui_click'); $('btnDouble').disabled = true; if (await g.doubleReward()) { $('resCredits').textContent = fmtNum(g.lastResult.credits * 2); $('resNote').textContent = 'CREDITS DOUBLED'; g.audio.play('levelup', { vol: 0.6 }); } else { $('btnDouble').disabled = false; this.toast('NO AD AVAILABLE', 'warn', 2); } };
    $('btnNext').onclick = async () => { snd('ui_confirm'); const r = g.lastResult; await g.showAd('midgame'); if (r.win && g.missionIndex + 1 < MISSIONS.length) g.startMission(g.missionIndex + 1); else g.startMission(g.missionIndex); };
    $('btnResArmory').onclick = () => { snd('ui_click'); g.toMenu(); this.show('armory'); };
    $('btnResMenu').onclick = () => { snd('ui_click'); g.toMenu(); };
    $('btnBuy').onclick = () => this.buyWeapon();
    $('btnReset').onclick = () => { if (this._resetArm) { g.save.reset(); this._resetArm = false; $('btnReset').querySelector('b').textContent = 'PROGRESS RESET'; snd('ui_confirm'); } else { this._resetArm = true; $('btnReset').querySelector('b').textContent = 'CLICK AGAIN TO CONFIRM'; snd('ui_deny'); } };
    // settings inputs
    const s = g.settings, sv = () => g.save.save();
    const range = (id, key, fmt, apply) => { const el = $(id); el.oninput = () => { s[key] = +el.value; $(fmt[0]).textContent = fmt[1](s[key]); apply && apply(s[key]); }; el.onchange = sv; };
    range('setSens', 'sens', ['vSens', (v) => v.toFixed(2) + 'x'], (v) => (g.input.sens = v));
    range('setFov', 'fov', ['vFov', (v) => v + '°'], (v) => (g.player.baseFov = v));
    range('setMaster', 'master', ['vMaster', (v) => Math.round(v * 100) + '%'], (v) => { g.audio.vol.master = v; g.audio.applyVol(); });
    range('setSfx', 'sfx', ['vSfx', (v) => Math.round(v * 100) + '%'], (v) => { g.audio.vol.sfx = v; g.audio.applyVol(); });
    range('setMusic', 'music', ['vMusic', (v) => Math.round(v * 100) + '%'], (v) => { g.audio.vol.music = v; g.audio.applyVol(); });
    $('setQuality').onchange = (e) => { s.quality = e.target.value; g.gfx.dyn = 1; g.setQuality(s.quality); sv(); };
    $('setInvert').onchange = (e) => { s.invertY = e.target.checked; g.input.invertY = s.invertY; sv(); };
    $('setDmg').onchange = (e) => { s.dmgNumbers = e.target.checked; sv(); };
    $('setFps').onchange = (e) => { s.showFps = e.target.checked; $('fps').textContent = ''; sv(); };
  }

  // ---------- menus ----------
  refreshMenu() {
    const d = this.game.save.data, r = rankFor(d.xp);
    $('rankLvl').textContent = r.lvl; $('rankName').textContent = r.name; $('xpFill').style.width = (r.xp / r.need * 100) + '%'; $('xpText').textContent = `${fmtNum(r.xp)} / ${fmtNum(r.need)} XP`; $('menuCredits').textContent = fmtNum(d.credits);
    const done = MISSIONS.filter((m) => d.missions[m.id]).length, st = MISSIONS.reduce((a, m) => a + ((d.missions[m.id] || {}).stars || 0), 0);
    $('menuCampaign').textContent = `${done} / ${MISSIONS.length} complete · ${st} / ${MISSIONS.length * 3} ★`;
    const mp = this.game.net.data, mt = tierOf(mp.mmr); $('menuMp').textContent = mp.matches ? `Ranked · ${mt.label} · ${Math.round(mp.mmr)}` : 'Ranked · Deathmatch & Domination';
  }
  credits() { const c = fmtNum(this.game.save.data.credits); document.querySelectorAll('.creditsVal').forEach((e) => (e.textContent = c)); }
  refreshMissions() {
    const d = this.game.save.data, list = $('missionList'); this.credits(); list.innerHTML = '';
    if (this.selMission >= d.unlocked) this.selMission = d.unlocked - 1;
    MISSIONS.forEach((m, i) => {
      const locked = i >= d.unlocked, rec = d.missions[m.id], b = document.createElement('button');
      b.className = 'mcard' + (i === this.selMission ? ' sel' : '') + (locked ? ' locked' : '');
      b.innerHTML = `<span class="mnum">0${i + 1}</span><span><div class="mname">${locked ? 'CLASSIFIED' : m.name}</div><div class="msub">${locked ? 'Complete the previous mission' : m.sub}</div></span><span class="stars">${locked ? '🔒' : stars(rec ? rec.stars : 0)}</span>`;
      if (!locked) b.onclick = () => { this.selMission = i; this.game.audio.play('ui_click', { vol: 0.5, reverb: 0 }); this.refreshMissions(); };
      list.appendChild(b);
    });
    const m = MISSIONS[this.selMission], rec = d.missions[m.id];
    $('mdSub').textContent = `MISSION 0${this.selMission + 1} // ${m.sub.toUpperCase()}`; $('mdName').textContent = m.name; $('mdBrief').textContent = m.brief; $('mdStars').innerHTML = stars(rec ? rec.stars : 0);
    $('mdObj').innerHTML = m.phases.map((p) => `<div>${OBJ_TEXT[p.type]}</div>`).join(''); $('mdBest').textContent = rec ? fmtNum(rec.best) : '—';
    const df = DIFFICULTY[d.difficulty]; $('mdReward').textContent = `${fmtNum(m.reward * df.credits * (rec ? 0.5 : 1))} CR${rec ? ' (replay)' : ''}`;
    const row = $('diffRow'); row.innerHTML = '';
    for (const k in DIFFICULTY) { const b = document.createElement('button'); b.textContent = DIFFICULTY[k].name; b.className = k === d.difficulty ? 'sel' : ''; b.onclick = () => { d.difficulty = k; this.game.save.save(); this.game.audio.play('ui_click', { vol: 0.5, reverb: 0 }); this.refreshMissions(); }; row.appendChild(b); }
    $('diffDesc').textContent = df.desc;
  }
  refreshArmory() {
    const g = this.game, d = g.save.data, list = $('weaponList'); this.credits(); list.innerHTML = '';
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id], own = d.weapons.includes(id), b = document.createElement('button');
      b.className = 'wcard' + (id === this.selWeapon ? ' sel' : '');
      b.innerHTML = `<span class="wslot">${w.slot}</span><span><div class="mname">${w.name}</div><div class="msub">${w.cls}</div></span><span class="wprice${own ? ' own' : ''}">${own ? 'OWNED' : fmtNum(w.cost) + ' CR'}</span>`;
      b.onclick = () => { this.selWeapon = id; g.audio.play('ui_click', { vol: 0.5, reverb: 0 }); this.refreshArmory(); };
      list.appendChild(b);
    }
    const id = this.selWeapon, w = WEAPONS[id], own = d.weapons.includes(id), up = d.upgrades[id] || {};
    $('wdCls').textContent = w.cls; $('wdName').textContent = w.name; $('wdDesc').textContent = w.desc;
    const dmg = w.dmg * (w.pellets || 1) * (1 + 0.12 * (up.dmg || 0)), mag = Math.round(w.mag * (1 + 0.2 * (up.mag || 0)));
    const bars = [['DAMAGE', dmg / 320, Math.round(dmg)], ['FIRE RATE', w.rpm / 950, w.rpm + ' RPM'], ['MAGAZINE', mag / 45, mag], ['RANGE', w.range[0] / 100, w.range[0] + ' m'], ['HANDLING', (1 - w.kick[0] / 8) * (1 + 0.1 * (up.handling || 0)), '']];
    $('wdStats').innerHTML = bars.map(([n, v, t]) => `<span>${n} <b style="color:#fff">${t}</b></span><div class="trk"><i style="width:${clamp(v, 0.04, 1) * 100}%"></i></div>`).join('');
    const ue = $('wdUp'); ue.innerHTML = '';
    if (own) for (const u of WEAPON_UPGRADES) {
      const lvl = up[u.id] || 0, cost = upgradeCost(id, lvl), row = document.createElement('div'); row.className = 'uprow';
      row.innerHTML = `<span><b>${u.name}</b><small>${u.desc}</small></span><span class="pips">${[0, 1, 2].map((i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>`;
      const b = document.createElement('button'); b.className = 'upbtn'; b.textContent = lvl >= 3 ? 'MAX' : fmtNum(cost) + ' CR'; b.disabled = lvl >= 3 || d.credits < cost;
      b.onclick = () => { if (d.credits >= cost && lvl < 3) { d.credits -= cost; d.upgrades[id] = { ...up, [u.id]: lvl + 1 }; g.save.save(); g.audio.play('ui_confirm', { vol: 0.6, reverb: 0 }); this.refreshArmory(); } };
      row.appendChild(b); ue.appendChild(row);
    }
    const buy = $('btnBuy'); buy.style.display = own ? 'none' : ''; buy.disabled = d.credits < w.cost; buy.querySelector('b').textContent = d.credits < w.cost ? `NEED ${fmtNum(w.cost - d.credits)} MORE CR` : `PURCHASE — ${fmtNum(w.cost)} CR`;
    const pr = $('perkRow'); pr.innerHTML = '';
    for (const p of PERKS) {
      const lvl = d.perks[p.id] || 0, cost = perkCost(p, lvl), el = document.createElement('div'); el.className = 'perk';
      el.innerHTML = `<b>${p.name}</b><small>${p.desc}</small><span class="pips">${Array.from({ length: p.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>`;
      const b = document.createElement('button'); b.className = 'upbtn'; b.textContent = lvl >= p.max ? 'MAX' : fmtNum(cost) + ' CR'; b.disabled = lvl >= p.max || d.credits < cost;
      b.onclick = () => { if (d.credits >= cost && lvl < p.max) { d.credits -= cost; d.perks[p.id] = lvl + 1; g.save.save(); g.audio.play('ui_confirm', { vol: 0.6, reverb: 0 }); this.refreshArmory(); } };
      el.appendChild(b); pr.appendChild(el);
    }
  }
  buyWeapon() { const g = this.game, d = g.save.data, w = WEAPONS[this.selWeapon]; if (d.weapons.includes(w.id) || d.credits < w.cost) { g.audio.play('ui_deny', { vol: 0.5, reverb: 0 }); return; } d.credits -= w.cost; d.weapons.push(w.id); g.save.save(); g.audio.play('levelup', { vol: 0.6, reverb: 0 }); this.refreshArmory(); }
  refreshSettings() {
    const s = this.game.settings; $('setQuality').value = s.quality; $('setSens').value = s.sens; $('vSens').textContent = s.sens.toFixed(2) + 'x'; $('setFov').value = s.fov; $('vFov').textContent = s.fov + '°';
    for (const [id, k, v] of [['setMaster', 'master', 'vMaster'], ['setSfx', 'sfx', 'vSfx'], ['setMusic', 'music', 'vMusic']]) { $(id).value = s[k]; $(v).textContent = Math.round(s[k] * 100) + '%'; }
    $('setInvert').checked = s.invertY; $('setDmg').checked = s.dmgNumbers; $('setFps').checked = s.showFps; $('btnReset').style.display = this.settingsFrom === 'menu' ? '' : 'none';
  }

  // ---------- HUD ----------
  hudAll(p) { this.hudWeapon(p); this.hudStatus(p); this.hudScore(this.game.stats); }
  hudWeapon(p) {
    const w = p.weapon; if (!w) return; this.set('wName', 'text', WEAPONS[w.id].name);
    this.set('slots', 'html', p.inv.map((x, i) => `<i class="${i === p.cur ? 'on' : ''}">${WEAPONS[x.id].slot}</i>`).join('')); this.hudAmmo(p);
  }
  hudAmmo(p) { const w = p.weapon, st = p.stat(w.id); this.set('ammoVal', 'text', String(w.ammo)); this.set('resVal', 'text', w.reserve === Infinity ? '/ ∞' : '/ ' + w.reserve); $('ammoVal').parentElement.classList.toggle('low', w.ammo <= st.mag * 0.25); }
  hudStatus(p) { this.set('nades', 'text', '◆'.repeat(p.grenades) + '◇'.repeat(Math.max(0, p.maxGrenades - p.grenades)) + ' FRAG'); }
  hudScore(s) { this.set('scoreVal', 'text', fmtNum(s.score)); this.set('comboVal', 'text', s.combo > 1 ? 'x' + s.combo.toFixed(2).replace(/0$/, '') : ''); }
  objective(title, sub) { this.set('objTitle', 'text', title); this.set('objSub', 'text', sub || ''); }
  progress(on, label, v, warn) { this.set('progress', 'on', on); if (on) { this.set('prLabel', 'text', label); $('prFill').style.width = clamp(v, 0, 1) * 100 + '%'; this.set('progress', 'warn', warn); } }
  bossBar(on, name) { this.set('bossbar', 'on', !!on); if (name) this.set('bossName', 'text', name); if (on) $('bossFill').style.width = '100%'; }
  bossHp(f) { this.set('bossFill', 'w', (clamp(f, 0, 1) * 100).toFixed(1) + '%'); }
  _restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  banner(title, sub) { $('bannerTitle').textContent = title; $('bannerSub').textContent = sub || ''; this._restart($('banner'), 'on'); }
  announce(text) { const el = $('announce'); el.textContent = text; this._restart(el, 'on'); }
  toast(text, kind = 'info', dur = 1.6) { const box = $('toasts'); if (box.lastChild && box.lastChild.textContent === text) return; const d = document.createElement('div'); d.className = 'toast ' + kind; d.style.setProperty('--d', dur + 's'); d.textContent = text; box.appendChild(d); while (box.children.length > 3) box.firstChild.remove(); setTimeout(() => d.remove(), dur * 1000 + 50); }
  feed(label, v, crit) { const box = $('feed'), d = document.createElement('div'); if (crit) d.className = 'crit'; d.innerHTML = `${label}<b>+${fmtNum(v)}</b>`; box.appendChild(d); while (box.children.length > 6) box.firstChild.remove(); setTimeout(() => d.remove(), 2450); }
  hitmarker(kill, crit) { const el = $('hitm'); el.className = ''; void el.offsetWidth; el.className = kill ? 'kill' : crit ? 'crit' : 'hit'; }
  damageDir(from, p) {
    const b = p.body, a = Math.atan2(from.x - b.x, from.z - b.z), rel = -(a - p.yaw) + Math.PI; // screen-space angle (0 = ahead)
    const box = $('dmgDirs'); if (box.children.length > 5) box.firstChild.remove();
    const d = document.createElement('div'); d.className = 'ddir'; d.style.transform = `rotate(${rel}rad)`; box.appendChild(d); setTimeout(() => d.remove(), 1300);
  }
  dmgNumber(x, y, z, dmg, crit) { const n = this.nums[this.numI]; this.numI = (this.numI + 1) % this.nums.length; n.t = 0; n.p.set(x, y + 0.2, z); n.el.textContent = Math.round(dmg); n.el.className = crit ? 'num crit' : 'num'; n.ox = (Math.random() - 0.5) * 30; }
  hint(text, dur = 7) { const el = $('hint'); el.innerHTML = text; el.classList.add('on'); this.hintT = dur; }
  fps(f, gfx) { this._ft = (this._ft || 0) + 1; if (this._ft % 20) return; const i = gfx.renderer.info.render; $('fps').textContent = `${Math.round(f)} FPS\n${i.calls} calls\n${(i.triangles / 1000) | 0}k tris\n${gfx.W}x${gfx.H} ${gfx.qualityName}`; }

  hudFrame(g, rdt) {
    const p = g.player, cam = g.gfx.camera, W = innerWidth, H = innerHeight, def = WEAPONS[p.weapon.id];
    this.set('hpFill', 'w', (p.health / p.maxHealth * 100).toFixed(0) + '%'); this.set('shFill', 'w', (p.shield / p.maxShield * 100).toFixed(0) + '%');
    this.set('hpVal', 'text', String(Math.ceil(p.health))); this.set('shVal', 'text', String(Math.ceil(p.shield)));
    $('hpFill').parentElement.classList.toggle('low', p.health < p.maxHealth * 0.3);
    this.set('focusFill', 'w', (p.focus * 100).toFixed(0) + '%'); const fe = $('focusFill').parentElement; fe.classList.toggle('ready', p.focus >= 0.3 && !p.focusOn); fe.classList.toggle('active', p.focusOn);
    // crosshair
    const cr = $('cross'), spread = def.hip * (1 + clamp(p.moving / 6, 0, 1) * 0.9 + (p.body.onGround ? 0 : 1.5)) + p.bloom;
    const px = Math.max(5, spread * (H / 2) / Math.tan(cam.fov * Math.PI / 360));
    cr.style.setProperty('--g', px.toFixed(1) + 'px'); cr.style.opacity = p.dead ? 0 : p.adsT > 0.5 && !def.pellets ? 0 : p.sprintT > 0.6 ? 0.35 : 1;
    this.set('scope', 'on', !!p.scoped);
    if (g.mp) this.mpFrame(g, rdt);
    this.set('clicklock', 'on', g.state === 'playing' && !g.input.locked && !g.input.touch && g.stats.time > 1);
    // prompt / waypoint
    const dr = g.director; this.set('prompt', 'on', !!dr.prompt); if (dr.prompt) this.set('promptTxt', 'text', dr.prompt);
    const wp = $('waypoint'), m = dr.marker;
    if (m && !p.dead) {
      _v.set(m.x, m.y, m.z).project(cam); let x = _v.x, y = _v.y; const behind = _v.z > 1;
      if (behind) { x = -x; y = -y; } const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.88;
      if (off) { const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88, 0.001); x /= k; y /= k; if (behind && Math.abs(y) < 0.5) y = -0.88; }
      wp.style.display = 'flex'; wp.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(0)}px,${((-y * 0.5 + 0.5) * H).toFixed(0)}px) translate(-50%,-50%)`; wp.className = m.kind === 'enemy' ? 'enemy' : '';
      wp.lastElementChild.textContent = Math.round(Math.hypot(m.x - p.body.x, m.z - p.body.z)) + ' m';
    } else wp.style.display = 'none';
    // damage numbers
    for (const n of this.nums) { if (n.t > 0.8) { if (n.t < 9) { n.el.style.opacity = 0; n.t = 9; } continue; } n.t += rdt; _v.copy(n.p).project(cam); if (_v.z > 1) { n.el.style.opacity = 0; continue; } n.el.style.opacity = String(1 - Math.pow(n.t / 0.8, 3)); n.el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * W + n.ox).toFixed(0)}px,${((-_v.y * 0.5 + 0.5) * H - n.t * 60).toFixed(0)}px)`; }
    if (this.hintT > 0) { this.hintT -= rdt; if (this.hintT <= 0) $('hint').classList.remove('on'); }
    // radar (every other frame)
    this._rf = !this._rf; if (this._rf) return;
    const c = this.radar, S = 150, R = 72, range = 48, sin = Math.sin(p.yaw), cos = Math.cos(p.yaw), b = p.body;
    c.clearRect(0, 0, S, S); c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1; c.beginPath(); c.arc(75, 75, R * 0.5, 0, 6.283); c.moveTo(75, 3); c.lineTo(75, 147); c.moveTo(3, 75); c.lineTo(147, 75); c.stroke();
    const plot = (wx, wz, col, r, clampEdge) => { const dx = wx - b.x, dz = wz - b.z; let rx = (dx * cos - dz * sin) / range * R, ry = (dx * sin + dz * cos) / range * R; const l = Math.hypot(rx, ry); if (l > R - 3) { if (!clampEdge) return; rx *= (R - 3) / l; ry *= (R - 3) / l; } c.fillStyle = col; c.beginPath(); c.arc(75 + rx, 75 + ry, r, 0, 6.283); c.fill(); };
    if (g.mp) {
      // multiplayer radar: squad always, enemies only while they are firing
      for (const e of g.enemies.list) if (!e.dead && e.netAvatar && (e.friendly || g.time - e.lastFire < 2.5)) plot(e.pos.x, e.pos.z, g.mp.mode.teams ? TEAMS[g.mp.teamOf(e.slot)].color : '#ff5a4a', 2.8, false);
      if (g.mp.mode.id === 'dom' && g.level.points && g.mp.H) g.level.points.forEach((pt, k) => { const o = g.mp.H.pt[k][0]; plot(pt.x, pt.z, o === 0 ? '#5fb8ff' : o === 1 ? '#ff8a3d' : '#e8eef4', 4, true); });
    } else for (const e of g.enemies.list) if (!e.dead) plot(e.pos.x, e.pos.z, e.type === 'boss' ? '#ff3a2a' : e.elite ? '#ff4ab8' : e.type === 'heavy' ? '#ff8a2a' : '#ff5a4a', e.type === 'boss' ? 6 : e.type === 'heavy' ? 4 : 2.6, e.type === 'boss');
    for (const k of g.pickups) plot(k.x, k.z, k.kind === 'health' ? '#58f08a' : '#ffd24a', 1.8, false);
    if (m && m.kind === 'obj') plot(m.x, m.z, '#5fd4ff', 4, true);
    for (const o of g.objectives) if (o.type === 'core' && !o.dead) plot(o.x, o.z, '#5fd4ff', 3, true);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(75, 68); c.lineTo(80, 80); c.lineTo(75, 77); c.lineTo(70, 80); c.closePath(); c.fill();
  }

  // ---------- end screens ----------
  death(g, canRevive) {
    const s = g.stats; this._ended = false; this.show('death');
    $('deathStats').innerHTML = `<div>SCORE<b>${fmtNum(s.score)}</b></div><div>KILLS<b>${s.kills}</b></div><div>TIME<b>${fmtTime(s.time)}</b></div><div>BEST COMBO<b>x${s.maxCombo.toFixed(2)}</b></div>`;
    const rv = $('btnRevive'); rv.style.display = canRevive ? '' : 'none'; rv.disabled = false; $('btnDeathEnd').querySelector('b').textContent = 'ABORT TO MENU';
  }
  results(g, r) {
    this._ended = true; this.show('results'); g.audio.setMusic('menu'); g.audio.stopLoops(); g.player.rig.visible = !r.win ? false : g.player.rig.visible;
    $('resSub').textContent = r.name; $('resTitle').textContent = 'MISSION COMPLETE';
    $('resStars').innerHTML = stars(r.stars); $('resStars').style.display = '';
    let rows = `<div>KILLS<b>${r.kills}</b></div><div>ACCURACY<b>${Math.round(r.acc * 100)}%</b></div><div>TIME<b>${fmtTime(r.time)}</b></div><div>BEST COMBO<b>x${r.maxCombo.toFixed(2)}</b></div>`;
    rows += `<div>TIME BONUS<b>+${fmtNum(r.timeBonus)}</b></div><div>ACCURACY BONUS<b>+${fmtNum(r.accBonus)}</b></div><div>NO REVIVES<b>+${fmtNum(r.flawless)}</b></div><div>DIFFICULTY<b>${g.diff.name}</b></div>`;
    $('resGrid').innerHTML = rows; $('resScore').textContent = fmtNum(r.score); $('resCredits').textContent = fmtNum(r.credits); $('resXp').textContent = fmtNum(r.xp);
    $('resNote').textContent = [r.newBest ? 'NEW BEST SCORE' : '', r.rankUp ? 'RANK UP' : ''].filter(Boolean).join(' · ');
    const dbl = $('btnDouble'); dbl.disabled = false; dbl.style.display = r.credits > 0 ? '' : 'none';
    const last = g.missionIndex + 1 >= MISSIONS.length; $('btnNext').querySelector('b').textContent = last ? 'REPLAY' : 'NEXT MISSION';
    if (last && r.win) $('resTitle').textContent = 'PROTOCOL TERMINATED';
  }

  // ================================================================ multiplayer
  refreshMp() {
    const g = this.game, svc = g.net, d = svc.data, t = tierOf(d.mmr);
    this.credits();
    $('mpEmblem').style.setProperty('--tc', t.color); $('mpEmblemDiv').textContent = t.div || 'E';
    $('mpTier').textContent = t.label; $('mpTier').style.color = t.color; $('mpMmr').textContent = Math.round(d.mmr);
    $('mpProg').style.width = (t.progress * 100).toFixed(1) + '%'; $('mpProg').style.background = t.color;
    $('mpNext').textContent = d.matches < PLACEMENT_MATCHES ? `PLACEMENT MATCH ${d.matches + 1} OF ${PLACEMENT_MATCHES} · RATING MOVES FASTER` : t.toNext ? `${t.toNext} RATING TO THE NEXT DIVISION` : `PEAK RATING ${Math.round(d.best)}`;
    const kd = d.deaths ? (d.kills / d.deaths).toFixed(2) : d.kills ? d.kills.toFixed(2) : '—';
    $('mpStats').innerHTML = `<div><span>MATCHES</span><b>${d.matches}</b></div><div><span>WIN RATE</span><b>${d.matches ? Math.round(d.wins / d.matches * 100) + '%' : '—'}</b></div><div><span>K / D</span><b>${kd}</b></div><div><span>PEAK</span><b>${Math.round(d.best || d.mmr)}</b></div>`;
    const inp = $('mpName'); if (document.activeElement !== inp) inp.value = svc.name;
    const h = $('mpHist'); h.innerHTML = '';
    if (!d.history || !d.history.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'No ranked matches yet. Placement starts with your first one.'; h.appendChild(e); }
    else for (const m of d.history.slice(0, 5)) {
      const row = document.createElement('div');
      const a = document.createElement('span'); a.className = m.w ? 'w' : 'l'; a.textContent = m.left ? 'LEFT' : m.w ? 'WIN' : 'LOSS';
      const b = document.createElement('span'); b.textContent = `${(MP_MODES[m.md] || MP_MODES.dm).name} · ${m.k} / ${m.de}`;
      const c = document.createElement('em'); c.className = m.d >= 0 ? 'w' : 'l'; c.textContent = (m.d >= 0 ? '+' : '') + m.d;
      row.append(a, b, c); h.appendChild(row);
    }
    const lad = $('mpLadder'); lad.innerHTML = '';
    TIERS.forEach((tt, i) => { const c = document.createElement('div'); c.style.setProperty('--tc', tt.color); if (i === t.idx) c.className = 'cur'; const b = document.createElement('b'); b.textContent = tt.name; const sp = document.createElement('span'); sp.textContent = i === t.idx ? 'YOU' : tt.min + '+'; c.append(b, sp); lad.appendChild(c); });
    document.querySelectorAll('.mode').forEach((x) => x.classList.toggle('sel', x.dataset.mode === this.mpMode));
    svc.connect(); this.mpLobby(svc);
  }
  mpLobby(svc) {
    const el = $('mpNet'), tx = $('mpNetText'); if (!el) return;
    el.className = 'net ' + svc.status;
    if (svc.status === 'connecting') tx.textContent = 'CONNECTING TO THE LOBBY';
    else if (svc.status === 'online') { const n = svc.onlineCount(); tx.textContent = `ONLINE · ${n} ${n === 1 ? 'OPERATIVE' : 'OPERATIVES'} IN THE LOBBY`; }
    else tx.textContent = 'OFFLINE · NO MULTIPLAYER SERVER · SEATS ARE FILLED WITH AI';
  }
  mmShow(svc) {
    this.show('mm'); const m = MP_MODES[svc.mode];
    $('mmMode').textContent = 'RANKED · ' + m.name; $('mmTitle').textContent = 'SEARCHING'; $('mmTime').textContent = '0:00'; $('mmBar').style.width = '0%';
    $('mmSub').textContent = 'Connecting to the lobby'; $('mmMap').textContent = ''; $('mmSlots').innerHTML = ''; this._mmKey = '';
  }
  mmSearch(svc) {
    if (this.cur !== 'mm') return;
    $('mmTitle').textContent = 'SEARCHING'; $('mmTime').textContent = fmtTime(svc.searchT);
    $('mmSub').textContent = svc.status === 'online' ? 'Looking for an open match near your rating' : svc.status === 'connecting' ? 'Connecting to the lobby' : 'Offline · starting a match against AI';
  }
  mmUpdate(m) {
    if (this.cur !== 'mm') return; const H = m.H;
    if (!H) { $('mmTitle').textContent = 'JOINING MATCH'; $('mmSub').textContent = 'Waiting for the host'; return; }
    const hum = H.ro.filter((r) => !r[3]).length;
    if (H.ph === 'form') {
      const left = Math.max(0, H.win - H.t);
      $('mmTitle').textContent = 'SEARCHING FOR OPERATIVES'; $('mmTime').textContent = fmtTime(left); $('mmBar').style.width = clamp(H.t / H.win * 100, 0, 100) + '%';
      $('mmSub').textContent = m.svc.t.online ? `${hum} of ${m.mode.slots} operatives found · AI fills the empty seats when the timer runs out` : 'Offline · empty seats are filled with AI';
    } else if (H.ph === 'start') { $('mmTitle').textContent = 'MATCH FOUND'; $('mmTime').textContent = String(Math.max(1, Math.ceil(H.t))); $('mmBar').style.width = '100%'; $('mmSub').textContent = 'Deploying'; }
    else if (H.ph === 'live') { $('mmTitle').textContent = 'JOINING MATCH IN PROGRESS'; $('mmTime').textContent = fmtTime(H.dur - H.t); $('mmSub').textContent = 'Taking over an AI seat'; }
    $('mmMap').textContent = H.ph === 'form' ? '' : `${H.mn} · ${m.mode.name}`;
    const key = JSON.stringify(H.ro.map((r) => [r[0], r[1], r[2], r[3]])) + m.mySlot + H.ph;
    if (key === this._mmKey) return; this._mmKey = key;
    const box = $('mmSlots'); box.innerHTML = '';
    const rows = H.ro.map((r, i) => ({ r, i })); if (m.mode.teams) rows.sort((a, b) => a.r[2] - b.r[2]);
    for (let k = 0; k < m.mode.slots; k++) {
      const e = rows[k], d = document.createElement('div'), nm = document.createElement('span'), tag = document.createElement('span'); nm.className = 'nm'; tag.className = 'tag';
      if (!e) { d.className = 'mm-slot empty'; nm.textContent = 'Searching…'; }
      else {
        const { r, i } = e; d.className = 'mm-slot ' + (r[3] ? 'b' : 'h') + (i === m.mySlot ? ' me' : '') + (m.mode.teams ? ' t' + r[2] : '');
        nm.textContent = r[1]; tag.textContent = i === m.mySlot ? 'YOU' : r[3] ? 'AI' : tierOf(r[4]).label;
      }
      d.append(nm, tag); box.appendChild(d);
    }
  }
  mpHud(on, m) {
    const hud = $('hud'); hud.classList.toggle('mp', !!on); hud.classList.toggle('dom', !!(on && m && m.mode.teams)); $('killfeed').innerHTML = ''; $('respawn').classList.remove('on'); $('scoreboard').classList.remove('on');
    for (const n of this.nps || []) n.el.style.display = 'none';
    if (!on) return;
    const top = $('mpTop');
    if (m.mode.teams) {
      top.innerHTML = `<div class="mp-teamscore t0"><span>${TEAMS[0].name}</span><b id="ts0">0</b><div class="bar"><i id="tb0"></i></div></div><div><div class="mp-pts">${[0, 1, 2].map((k) => `<div class="mp-pt" id="mpt${k}"><i></i><b>${'ABC'[k]}</b></div>`).join('')}</div><div class="mp-timer" id="mpTimer"></div></div><div class="mp-teamscore t1"><span>${TEAMS[1].name}</span><b id="ts1">0</b><div class="bar"><i id="tb1"></i></div></div>`;
      this.objective('CAPTURE AND HOLD', `You are ${TEAMS[m.myTeam] ? TEAMS[m.myTeam].name : 'deployed'} · first to ${m.H.lim}`);
    } else {
      top.innerHTML = `<div class="mp-dm"><div class="you"><b id="dmYou">0</b><span>YOU</span></div><div><b class="mp-timer" id="mpTimer"></b><span>FIRST TO ${m.H.lim}</span></div><div class="lead"><b id="dmLead">0</b><span id="dmLeadN">LEADER</span></div></div>`;
      this.objective('ELIMINATE OPERATIVES', `Free-for-all · first to ${m.H.lim}`);
    }
    this.cache = {};
  }
  mpFrame(g, rdt) {
    const m = g.mp, H = m.H; if (!H) return; const cam = g.gfx.camera, W = innerWidth, Hh = innerHeight;
    const left = H.ph === 'live' ? Math.max(0, H.dur - H.t) : H.ph === 'end' ? 0 : H.dur; this.set('mpTimer', 'text', fmtTime(left));
    if (m.mode.teams) {
      for (const t of [0, 1]) { this.set('ts' + t, 'text', String(H.ts[t])); this.set('tb' + t, 'w', clamp(H.ts[t] / H.lim * 100, 0, 100).toFixed(1) + '%'); }
      const ents = this._entsT > 0 ? this._ents : (this._ents = m.ents()); this._entsT = (this._entsT || 0) > 0 ? this._entsT - rdt : 0.2;
      H.pt.forEach(([own, prog], k) => {
        const el = $('mpt' + k); if (!el) return; el.className = 'mp-pt' + (own >= 0 ? ' o' + own : '');
        const pt = g.level.points[k], c = [0, 0]; for (const e of ents) if (e.alive && Math.hypot(e.x - pt.x, e.z - pt.z) < 5.5) c[e.team]++;
        if (c[0] && c[1]) el.classList.add('contest');
        const f = el.firstChild; const side = prog > 0 ? 0 : 1; f.style.height = Math.abs(prog) + '%'; f.style.background = TEAMS[side].color;
        // world marker
        const pm = $('pm' + k); pm.className = 'pm' + (own >= 0 ? ' o' + own : ''); _v.set(pt.x, 2.6, pt.z).project(cam); let x = _v.x, y = _v.y; const behind = _v.z > 1;
        if (behind) { x = -x; y = -y; } const off = behind || Math.abs(x) > 0.94 || Math.abs(y) > 0.9; if (off) { const kk = Math.max(Math.abs(x) / 0.94, Math.abs(y) / 0.9, 0.001); x /= kk; y /= kk; pm.classList.add('edge'); }
        pm.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(0)}px,${((-y * 0.5 + 0.5) * Hh).toFixed(0)}px) translate(-50%,-50%)`;
        pm.lastChild.textContent = Math.round(Math.hypot(pt.x - g.player.body.x, pt.z - g.player.body.z)) + ' m';
        // floor ring in the owner's colour
        const col = own === 0 ? [0.35, 0.75, 1.5] : own === 1 ? [1.5, 0.6, 0.25] : [0.9, 0.9, 0.9]; g.fx.marker(pt.x, 0.06, pt.z, 11, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 5);
        g.fx.add.push(pt.x, 0.2, pt.z, 0, 7, 0, 0.35, 0, 14, 1, col[0], col[1], col[2], 0.55);
      });
    } else {
      const me = H.ro[m.mySlot]; let li = -1; for (let i = 0; i < H.ro.length; i++) if (i !== m.mySlot && (li < 0 || H.ro[i][5] > H.ro[li][5])) li = i;
      this.set('dmYou', 'text', String(me ? me[5] : 0)); this.set('dmLead', 'text', String(li >= 0 ? H.ro[li][5] : 0)); this.set('dmLeadN', 'text', li >= 0 ? H.ro[li][1] : '—');
    }
    // nameplates
    let n = 0; const p = g.player, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (const [slot, v] of m.views) {
      const a = v.avatar; if (!a || a.dead || n >= this.nps.length) continue;
      const np = this.nps[n], d = Math.hypot(a.pos.x - cx, a.pos.z - cz); if (d > (a.friendly ? 90 : 38)) continue;
      np.losT -= rdt; if (np.key !== v.key || np.losT <= 0) { np.key = v.key; np.losT = 0.3; np.los = g.level.los(cx, cy, cz, a.pos.x, a.pos.y + 1.9, a.pos.z); }
      if (!a.friendly && !np.los) continue;
      _v.set(a.pos.x, a.pos.y + 2.3, a.pos.z).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) continue;
      const nm = m.nameOf(slot); if (np.el.textContent !== nm) np.el.textContent = nm;
      np.el.className = 'np ' + (m.mode.teams ? 't' + m.teamOf(slot) : 'e'); np.el.style.display = '';
      np.el.style.opacity = a.friendly ? 1 : clamp(1.3 - d / 38, 0.3, 1);
      np.el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * W).toFixed(0)}px,${((-_v.y * 0.5 + 0.5) * Hh).toFixed(0)}px) translate(-50%,-100%)`; n++;
    }
    for (; n < this.nps.length; n++) this.nps[n].el.style.display = 'none';
    // scoreboard (hold TAB)
    const show = g.input.is('score') || (p.dead && m.respawnT > 1.2 && false);
    $('scoreboard').classList.toggle('on', show);
    if (show) { this._sbT = (this._sbT || 0) - rdt; if (this._sbT <= 0) { this._sbT = 0.25; $('scoreboard').innerHTML = this.scoreHtml(m.mode, H.ro, m.mySlot, H, `${m.mode.name} · ${H.mn}`, fmtTime(left)); } }
  }
  scoreHtml(mode, ro, me, H, title, sub) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const row = (r, i, rank) => `<div class="sb-row${i === me ? ' me' : ''}"><span>${rank}</span><span class="nm">${esc(r[1])}${r[3] ? '<span class="ai">AI</span>' : ''}</span><span>${r[5]}</span><span>${r[6]}</span><span>${mode.teams ? r[7] : (r[6] ? (r[5] / r[6]).toFixed(1) : r[5])}</span></div>`;
    const hd = `<div class="sb-row hd"><span>#</span><span>OPERATIVE</span><span>K</span><span>D</span><span>${mode.teams ? 'CAP' : 'K/D'}</span></div>`;
    const sorted = ro.map((r, i) => ({ r, i })).sort((a, b) => b.r[5] - a.r[5] || a.r[6] - b.r[6]);
    let body;
    if (mode.teams) body = `<div class="sb-cols two">${[0, 1].map((t) => `<div><div class="sb-team t${t}"><span>${TEAMS[t].name}</span><b>${H.ts[t]}</b></div>${hd}${sorted.filter((x) => x.r[2] === t).map((x, k) => row(x.r, x.i, k + 1)).join('')}</div>`).join('')}</div>`;
    else body = `<div class="sb-cols">${hd}${sorted.map((x, k) => row(x.r, x.i, k + 1)).join('')}</div>`;
    return `<div class="sb-h"><b>${esc(title)}</b><span>${esc(sub)}</span></div>${body}`;
  }
  killFeed(m, killer, victim, w, crit) {
    const box = $('killfeed'), d = document.createElement('div'), mine = killer === m.mySlot || victim === m.mySlot;
    d.className = 'kf' + (mine ? ' mine' : '');
    const cls = (s) => s === m.mySlot ? 'me' : m.mode.teams ? 't' + m.teamOf(s) : 'foe';
    const nameEl = (s) => { const e = document.createElement('span'); e.className = cls(s); e.textContent = s === m.mySlot ? 'YOU' : m.nameOf(s); return e; };
    const wep = document.createElement('em'); wep.textContent = (crit ? '◎ ' : '') + (killer < 0 || killer === victim ? 'ELIMINATED' : wName(w)); if (crit) wep.classList.add('crit');
    if (killer >= 0 && killer !== victim) d.append(nameEl(killer), wep, nameEl(victim)); else d.append(nameEl(victim), wep);
    box.prepend(d); while (box.children.length > 6) box.lastChild.remove(); setTimeout(() => d.remove(), 5000);
  }
  mpRespawn(m, dead) {
    $('respawn').classList.toggle('on', !!dead);
    if (dead) { const k = m.killedBy; $('rsBy').textContent = k >= 0 && k !== m.mySlot ? 'BY ' + m.nameOf(k) : ''; this.mpRespawnTimer(m, m.respawnT); }
  }
  mpRespawnTimer(m, t) { this.set('rsT', 'text', `REDEPLOYING IN ${Math.ceil(t)}`); }
  pauseMode(mp) {
    $('btnRestart').style.display = mp ? 'none' : ''; $('btnQuit').querySelector('b').textContent = mp ? 'LEAVE MATCH' : 'ABORT TO MENU';
    $('quitSub').textContent = mp ? 'Leaving a ranked match counts as a loss' : ''; $('quitSub').style.display = mp ? '' : 'none';
  }
  mpEndBanner(m) {
    const H = m.H; let t, s;
    if (m.mode.teams) { t = H.w === -1 ? 'DRAW' : H.w === m.myTeam ? 'VICTORY' : 'DEFEAT'; s = `${TEAMS[0].name} ${H.ts[0]} — ${H.ts[1]} ${TEAMS[1].name}`; }
    else { t = H.w === m.mySlot ? 'VICTORY' : 'MATCH OVER'; s = H.w >= 0 ? `${m.nameOf(H.w)} WINS WITH ${H.ro[H.w][5]}` : ''; }
    this.banner(t, s);
  }
  mpResults(g, r) {
    this.show('mpres'); const el = $('mpres'); el.classList.toggle('win', r.win); el.classList.toggle('loss', !r.win && !r.draw);
    $('mrSub').textContent = `RANKED · ${r.mode.name} · ${r.mapName}`;
    $('mrTitle').textContent = r.mode.teams ? (r.draw ? 'DRAW' : r.win ? 'VICTORY' : 'DEFEAT') : r.place === 1 ? 'VICTORY' : `#${r.place} OF ${r.total}`;
    const t = tierOf(r.after), tb = tierOf(r.before);
    $('mrEmblem').style.setProperty('--tc', t.color); $('mrEmblemDiv').textContent = t.div || 'E';
    $('mrTier').textContent = t.label + (t.idx > tb.idx || (t.idx === tb.idx && t.div !== tb.div && r.delta > 0) ? ' · PROMOTED' : t.idx < tb.idx || (t.idx === tb.idx && t.div !== tb.div && r.delta < 0) ? ' · DEMOTED' : ''); $('mrTier').style.color = t.color;
    $('mrBefore').textContent = Math.round(r.before); $('mrAfter').textContent = Math.round(r.after);
    const de = $('mrDelta'); de.textContent = (r.delta >= 0 ? '+' : '') + r.delta; de.className = r.delta >= 0 ? 'up' : 'down';
    const bar = $('mrProg'); bar.style.background = t.color; bar.style.transition = 'none'; bar.style.width = (tb.progress * 100) + '%'; requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = 'width 1.2s ease-out'; bar.style.width = (t.progress * 100) + '%'; }));
    $('mrTable').innerHTML = this.scoreHtml(r.mode, r.ro, r.me, { ts: r.ts }, 'FINAL STANDINGS', r.mode.teams ? `${TEAMS[0].name} ${r.ts[0]} — ${r.ts[1]} ${TEAMS[1].name}` : `${r.K} ELIMINATIONS`);
    $('mrK').textContent = r.K; $('mrCr').textContent = '+' + fmtNum(r.credits); $('mrXp').textContent = '+' + fmtNum(r.xp);
    this.mpMode = r.mode.id;
  }
}
