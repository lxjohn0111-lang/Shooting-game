// CrazyGames SDK v3 wrapper. Every call is guarded so the game runs anywhere (local file server, other hosts, ad-blocked).
export class SDK {
  constructor() { this.sdk = null; this.ok = false; this.env = 'none'; this.playing = false; this.loading = false; this.adPlaying = false; this.onMute = null; this.user = null; this.isMobile = false; this.onAuth = null; }
  async init() {
    try {
      const cg = window.CrazyGames && window.CrazyGames.SDK;
      if (!cg) return;
      await Promise.race([cg.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('sdk init timeout')), 4000))]);
      this.sdk = cg; this.env = cg.environment || 'unknown'; this.ok = this.env !== 'disabled';
      try { const si = cg.user && cg.user.systemInfo; if (si && si.device && si.device.type) this.isMobile = si.device.type !== 'desktop'; } catch (e) { }
      try { if (cg.game.addSettingsChangeListener) cg.game.addSettingsChangeListener((s) => { if (this.onMute) this.onMute(!!s.muteAudio); }); } catch (e) { }
      try { if (cg.user && cg.user.isUserAccountAvailable) { this.user = await cg.user.getUser(); cg.user.addAuthListener && cg.user.addAuthListener((u) => { const was = this.user && this.user.username; this.user = u; if (this.onAuth && (u && u.username) !== was) this.onAuth(u); }); } } catch (e) { }
    } catch (e) { console.info('[sdk] unavailable:', e && e.message); this.ok = false; }
  }
  get muted() { try { return !!(this.ok && this.sdk.game.settings && this.sdk.game.settings.muteAudio); } catch (e) { return false; } }
  _call(f) { if (!this.ok) return; try { const r = f(this.sdk); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
  loadingStart() { if (this.loading) return; this.loading = true; this._call(s => s.game.loadingStart()); }
  loadingStop() { if (!this.loading) return; this.loading = false; this._call(s => s.game.loadingStop()); }
  gameplayStart() { if (this.playing) return; this.playing = true; this._call(s => s.game.gameplayStart()); }
  gameplayStop() { if (!this.playing) return; this.playing = false; this._call(s => s.game.gameplayStop()); }
  happytime() { this._call(s => s.game.happytime()); }
  // returns Promise<boolean> : true if ad was shown & completed (for rewarded: reward should be granted)
  ad(type, hooks = {}) {
    return new Promise((resolve) => {
      if (!this.ok || !this.sdk.ad) { resolve(type === 'rewarded'); return; }
      let done = false; const fin = (v) => { if (done) return; done = true; this.adPlaying = false; hooks.onEnd && hooks.onEnd(); resolve(v); };
      try {
        this.sdk.ad.requestAd(type, {
          adStarted: () => { this.adPlaying = true; hooks.onStart && hooks.onStart(); },
          adFinished: () => fin(true),
          adError: (e) => fin(false),
        });
        setTimeout(() => { if (!this.adPlaying) fin(false); }, 6000);
      } catch (e) { fin(false); }
    });
  }
  // ---- persistent data ----
  // On CrazyGames all progress goes through the SDK Data module (localStorage-like API, string values). It is preloaded
  // by init(), saved to the player's account when logged in (synced across devices) and kept locally for guests.
  // Without the SDK (local testing, other hosts) the game falls back to the browser's localStorage.
  get dataOk() { try { return !!(this.ok && this.sdk && this.sdk.data && typeof this.sdk.data.getItem === 'function'); } catch (e) { return false; } }
  get storage() { return this.dataOk ? 'crazygames' : 'browser'; }
  getItem(k) {
    if (this.dataOk) { try { const v = this.sdk.data.getItem(k); return v === undefined ? null : v; } catch (e) { return null; } }
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  setItem(k, v) {
    if (this.dataOk) { try { this.sdk.data.setItem(k, String(v)); } catch (e) { console.warn('[sdk] data.setItem failed', e); } return; }
    try { localStorage.setItem(k, v); } catch (e) { }
  }
  removeItem(k) {
    if (this.dataOk) { try { this.sdk.data.removeItem(k); } catch (e) { } return; }
    try { localStorage.removeItem(k); } catch (e) { }
  }
  // a save written by an older build straight to localStorage (before the Data module was used)
  takeLegacy(k) { if (!this.dataOk) return null; try { const v = localStorage.getItem(k); if (v) localStorage.removeItem(k); return v; } catch (e) { return null; } }
}
