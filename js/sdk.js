// CrazyGames SDK v3 wrapper. Every call is guarded so the game runs anywhere (local file server, other hosts, ad-blocked).
export class SDK {
  constructor() { this.sdk = null; this.ok = false; this.env = 'none'; this.playing = false; this.loading = false; this.adPlaying = false; this.onMute = null; this.user = null; this.isMobile = false; }
  async init() {
    try {
      const cg = window.CrazyGames && window.CrazyGames.SDK;
      if (!cg) return;
      await Promise.race([cg.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('sdk init timeout')), 4000))]);
      this.sdk = cg; this.env = cg.environment || 'unknown'; this.ok = this.env !== 'disabled';
      try { const si = cg.user && cg.user.systemInfo; if (si && si.device && si.device.type) this.isMobile = si.device.type !== 'desktop'; } catch (e) { }
      try { if (cg.game.addSettingsChangeListener) cg.game.addSettingsChangeListener((s) => { if (this.onMute) this.onMute(!!s.muteAudio); }); } catch (e) { }
      try { if (cg.user && cg.user.isUserAccountAvailable) { this.user = await cg.user.getUser(); cg.user.addAuthListener && cg.user.addAuthListener((u) => { this.user = u; }); } } catch (e) { }
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
  // persistent data (cloud-synced for logged-in CrazyGames users, localStorage otherwise)
  getItem(k) { try { if (this.ok && this.sdk.data) { const v = this.sdk.data.getItem(k); if (v !== null && v !== undefined) return v; } } catch (e) { } try { return localStorage.getItem(k); } catch (e) { return null; } }
  setItem(k, v) { try { if (this.ok && this.sdk.data) this.sdk.data.setItem(k, v); } catch (e) { } try { localStorage.setItem(k, v); } catch (e) { } }
}
