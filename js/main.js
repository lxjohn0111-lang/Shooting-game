// Bootstrap
import { SDK } from './sdk.js';
import { Save } from './save.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { MISSIONS } from './config.js';

(async () => {
  const ui = new UI();
  const fail = (msg) => { document.getElementById('loadLabel').textContent = msg; document.getElementById('loadLabel').style.color = '#ff4a3a'; };
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) { fail('WEBGL 2 IS REQUIRED — PLEASE ENABLE HARDWARE ACCELERATION'); return; }
    const sdk = new SDK();
    ui.loading(0.02, 'CONNECTING');
    await sdk.init();
    sdk.loadingStart();
    const save = new Save(sdk); save.load();
    const q = new URLSearchParams(location.search);
    if (q.get('q')) save.data.settings.quality = q.get('q');
    const game = new Game(); window.__game = game;
    await game.boot(sdk, save, ui);
    ui.bind(game);
    // platform audio mute
    game.audio.muted = sdk.muted; sdk.onMute = (m) => { game.audio.muted = m; game.audio.applyVol(); };
    // audio needs a user gesture
    game.input.onFirstGesture = () => { game.audio.init(); game.audio.muted = sdk.muted; game.audio.applyVol(); game.audio.resume(); if (game.state === 'menu') game.audio.setMusic('menu'); };
    addEventListener('pointerdown', () => { if (!game.audio.ctx) { game.audio.init(); game.audio.applyVol(); if (game.state === 'menu') game.audio.setMusic('menu'); } game.audio.resume(); }, { passive: true });
    if (game.isMobile || 'ontouchstart' in window && navigator.maxTouchPoints > 1 && !matchMedia('(pointer:fine)').matches) game.input.setupTouch(document.getElementById('touch'));
    sdk.loadingStop();
    ui.show('menu');
    // first-mission control hint
    const origStart = game.startMission.bind(game);
    game.startMission = (i, o) => { origStart(i, o); if (!save.data.seenIntro && !game.input.touch) { setTimeout(() => ui.hint('<kbd>WASD</kbd> move · <kbd>SHIFT</kbd> sprint · <kbd>C</kbd> crouch / slide · <kbd>RMB</kbd> aim · <kbd>R</kbd> reload · <kbd>G</kbd> frag · <kbd>F</kbd> melee · <kbd>Q</kbd> focus', 12), 1500); save.data.seenIntro = true; save.save(); } };
    // dev / QA hooks:  ?m=1..6 autostart mission, ?mp=dm|dom find a multiplayer match, ?god=1
    if (q.get('god')) game.godMode = true;
    if (q.get('nodrs')) game.noDrs = true;
    if (q.get('norender')) game.noRender = true;
    if (q.get('credits')) { save.data.credits = +q.get('credits'); }
    if (q.get('m')) { save.data.unlocked = MISSIONS.length; game.startMission(Math.max(0, Math.min(MISSIONS.length - 1, +q.get('m') - 1))); }
    else if (q.get('mp')) { if (q.get('mpname')) game.net.setName(q.get('mpname')); ui.mpMode = q.get('mp') === 'dom' ? 'dom' : 'dm'; game.net.find(ui.mpMode); }
    window.READY = true;
  } catch (e) {
    console.error(e); fail('FAILED TO START: ' + (e && e.message ? e.message : e)); window.READY = true;
  }
})();
