import { SAVE_KEY } from './config.js';
const DEFAULT = () => ({
  v: 1, credits: 0, xp: 0, weapons: ['pistol', 'rifle'], upgrades: {}, perks: {}, missions: {}, unlocked: 1, difficulty: 'veteran',
  onslaught: { wave: 0, score: 0 }, totals: { kills: 0, time: 0, shots: 0, hits: 0 }, seenIntro: false,
  settings: { quality: 'auto', sens: 1, fov: 78, master: 0.8, sfx: 1, music: 0.6, invertY: false, dmgNumbers: true, shake: 1, showFps: false },
});
export class Save {
  constructor(sdk) { this.sdk = sdk; this.data = DEFAULT(); this._t = 0; }
  load() {
    try { const raw = this.sdk.getItem(SAVE_KEY); if (raw) { const d = JSON.parse(raw), def = DEFAULT(); this.data = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) }, onslaught: { ...def.onslaught, ...(d.onslaught || {}) }, totals: { ...def.totals, ...(d.totals || {}) } }; } } catch (e) { this.data = DEFAULT(); }
    if (!this.data.weapons.includes('pistol')) this.data.weapons.push('pistol');
  }
  save() { try { this.sdk.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { } }
  reset() { const s = this.data.settings; this.data = DEFAULT(); this.data.settings = s; this.save(); }
}
