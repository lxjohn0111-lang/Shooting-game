import { SAVE_KEY } from './config.js';
const DEFAULT = () => ({
  v: 1, credits: 0, xp: 0, weapons: ['pistol', 'rifle'], upgrades: {}, perks: {}, missions: {}, unlocked: 1, difficulty: 'veteran',
  mp: null, totals: { kills: 0, time: 0, shots: 0, hits: 0 }, seenIntro: false,
  settings: { quality: 'auto', sens: 1, fov: 78, master: 0.8, sfx: 1, music: 0.6, invertY: false, dmgNumbers: true, shake: 1, showFps: false },
});
const merge = (d) => { const def = DEFAULT(); return { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) }, totals: { ...def.totals, ...(d.totals || {}) } }; };
// rough progress measure, used to decide which of two saves to keep
const progress = (d) => (d.xp || 0) + (d.credits || 0) + Object.keys(d.missions || {}).length * 1000 + ((d.mp && d.mp.matches) || 0) * 200;

export class Save {
  constructor(sdk) { this.sdk = sdk; this.data = DEFAULT(); this._t = 0; this.saveT = 0; }
  _parse(raw) { try { const d = JSON.parse(raw); return d && typeof d === 'object' ? d : null; } catch (e) { return null; } }
  load() {
    let d = this._parse(this.sdk.getItem(SAVE_KEY));
    // one-time migration of a save an older build wrote straight to the browser
    const legacy = this._parse(this.sdk.takeLegacy(SAVE_KEY));
    if (legacy && (!d || progress(legacy) > progress(d))) { d = legacy; this._pendingWrite = true; }
    this.data = d ? merge(d) : DEFAULT();
    if (!this.data.weapons.includes('pistol')) this.data.weapons.push('pistol');
    delete this.data.onslaught;
    if (this._pendingWrite) { this._pendingWrite = false; this.save(); }
  }
  // the player logged in (or switched account) on CrazyGames: use that account's progress,
  // or carry the guest progress over if the account has none yet
  reloadAfterLogin() {
    const d = this._parse(this.sdk.getItem(SAVE_KEY));
    if (d && progress(d) >= progress(this.data)) { const s = this.data.settings; this.data = merge(d); this.data.settings = { ...s, ...(d.settings || {}) }; return 'account'; }
    this.save(); return 'carried';
  }
  save() { try { this.data.savedAt = Date.now(); this.sdk.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { } }
  reset() { const s = this.data.settings; this.data = DEFAULT(); this.data.settings = s; this.save(); }
}
