// Fully procedural audio: synthesized SFX buffers, 3D positioning, reverb, adaptive music
import { rand, clamp } from './util.js';

const SR = 44100;

// ---- tiny offline DSP toolkit ----
function buf(sec) { return new Float32Array(Math.ceil(sec * SR)); }
function noiseFill(a, amp = 1) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * amp; return a; }
function lp(a, f0, f1 = f0) { let y = 0; const n = a.length; for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * (i / n), k = 1 - Math.exp(-6.283 * f / SR); y += k * (a[i] - y); a[i] = y; } return a; }
function hp(a, f0, f1 = f0) { let y = 0; const n = a.length; for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * (i / n), k = 1 - Math.exp(-6.283 * f / SR); y += k * (a[i] - y); a[i] = a[i] - y; } return a; }
function env(a, att, dec, pow = 1) { const n = a.length, an = att * SR; for (let i = 0; i < n; i++) { const t = i / SR; let e = i < an ? i / an : Math.exp(-(t - att) / dec); if (pow !== 1) e = Math.pow(e, pow); a[i] *= e; } return a; }
function fadeOut(a, sec = 0.02) { const n = Math.min(a.length, sec * SR | 0); for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n; return a; }
function sweep(sec, f0, f1, amp = 1, shape = 'sine', curve = 1) { const a = buf(sec); let ph = 0; for (let i = 0; i < a.length; i++) { const t = Math.pow(i / a.length, curve), f = f0 * Math.pow(f1 / f0, t); ph += f / SR; const p = ph % 1; a[i] = amp * (shape === 'sine' ? Math.sin(p * 6.283) : shape === 'saw' ? p * 2 - 1 : shape === 'sq' ? (p < 0.5 ? 1 : -1) : Math.abs(p * 4 - 2) - 1); } return a; }
function mix(...parts) { let n = 0; for (const p of parts) n = Math.max(n, (p.at || 0) * SR + p.a.length); const o = new Float32Array(Math.ceil(n)); for (const p of parts) { const off = ((p.at || 0) * SR) | 0, g = p.g ?? 1; for (let i = 0; i < p.a.length; i++) o[off + i] += p.a[i] * g; } return o; }
function drive(a, k) { for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * k); return a; }
function norm(a, peak = 0.95) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) { const k = peak / m; for (let i = 0; i < a.length; i++) a[i] *= k; } return a; }
function comb(a, delay, fb) { const d = (delay * SR) | 0; for (let i = d; i < a.length; i++) a[i] += a[i - d] * fb; return a; }

function gunshot({ len = 0.5, body = 180, bodyDec = 0.06, crack = 0.02, crackHP = 1800, tail = 0.16, tailLP = 2600, thump = 70, thumpAmp = 0.9, driveK = 2.2, mech = true }) {
  const parts = [];
  parts.push({ a: env(hp(noiseFill(buf(0.08)), crackHP), 0.0005, crack), g: 1.0 });
  parts.push({ a: env(lp(noiseFill(buf(len)), tailLP, 500), 0.001, tail), g: 0.75 });
  parts.push({ a: env(sweep(0.22, body * 2.2, body * 0.5, 1, 'tri', 0.5), 0.0008, bodyDec), g: 0.9 });
  parts.push({ a: env(sweep(0.3, thump * 2.4, thump * 0.6, 1, 'sine', 0.4), 0.001, 0.07), g: thumpAmp });
  if (mech) parts.push({ a: env(hp(noiseFill(buf(0.03)), 3500), 0.0005, 0.006), g: 0.3, at: 0.055 });
  return fadeOut(norm(drive(mix(...parts), driveK)), 0.05);
}

function buildBuffers() {
  const B = {};
  B.shot_pistol = gunshot({ len: 0.4, body: 260, bodyDec: 0.04, crack: 0.014, tail: 0.1, tailLP: 3400, thump: 90, thumpAmp: 0.6 });
  B.shot_smg = gunshot({ len: 0.32, body: 300, bodyDec: 0.03, crack: 0.011, tail: 0.075, tailLP: 4200, thump: 110, thumpAmp: 0.45, driveK: 1.9 });
  B.shot_ar = gunshot({ len: 0.5, body: 200, bodyDec: 0.05, crack: 0.018, tail: 0.14, tailLP: 2800, thump: 75, thumpAmp: 0.85 });
  B.shot_shotgun = gunshot({ len: 0.8, body: 130, bodyDec: 0.09, crack: 0.03, crackHP: 1000, tail: 0.24, tailLP: 2000, thump: 55, thumpAmp: 1.2, driveK: 3 });
  B.shot_sniper = gunshot({ len: 1.2, body: 150, bodyDec: 0.1, crack: 0.035, crackHP: 1400, tail: 0.38, tailLP: 2400, thump: 48, thumpAmp: 1.3, driveK: 3.2 });
  B.shot_launcher = norm(mix({ a: env(sweep(0.25, 240, 60, 1, 'sine', 0.5), 0.002, 0.07) }, { a: env(lp(noiseFill(buf(0.3)), 900, 200), 0.002, 0.08), g: 0.8 }, { a: env(hp(noiseFill(buf(0.05)), 2500), 0.001, 0.01), g: 0.4 }));
  B.shot_rail = fadeOut(norm(drive(mix(
    { a: env(sweep(0.7, 2400, 90, 1, 'saw', 0.35), 0.001, 0.16), g: 0.7 }, { a: env(sweep(0.6, 90, 38, 1, 'sine', 0.5), 0.001, 0.2), g: 1.0 },
    { a: env(hp(noiseFill(buf(0.5)), 2000), 0.001, 0.09), g: 0.6 }, { a: comb(env(sweep(0.9, 660, 640, 1, 'sq'), 0.01, 0.25), 0.011, 0.5), g: 0.14 }), 2.4)), 0.1);
  B.rail_charge = fadeOut(norm(mix({ a: sweep(0.75, 180, 1500, 0.6, 'saw', 1.6) }, { a: sweep(0.75, 90, 760, 0.5, 'sq', 1.6) })).map((v, i, a) => v * (i / a.length) * 0.7), 0.02);
  B.enemy_shot = fadeOut(norm(mix({ a: env(sweep(0.22, 1500, 260, 1, 'saw', 0.5), 0.001, 0.05) }, { a: env(sweep(0.2, 500, 110, 1, 'sq', 0.5), 0.001, 0.05), g: 0.5 }, { a: env(hp(noiseFill(buf(0.08)), 2500), 0.001, 0.02), g: 0.5 })), 0.03);
  B.enemy_heavy = fadeOut(norm(drive(mix({ a: env(sweep(0.3, 600, 70, 1, 'saw', 0.4), 0.001, 0.08) }, { a: env(lp(noiseFill(buf(0.35)), 1500, 300), 0.001, 0.1), g: 0.8 }), 2.5)), 0.04);
  B.lancer_charge = fadeOut(norm(mix({ a: sweep(1.5, 300, 2600, 0.5, 'sine', 2) }, { a: sweep(1.5, 304, 2630, 0.5, 'saw', 2), g: 0.4 })).map((v, i, a) => v * Math.pow(i / a.length, 1.5)), 0.01);
  B.lancer_fire = fadeOut(norm(drive(mix({ a: env(sweep(0.5, 3200, 200, 1, 'saw', 0.3), 0.001, 0.1) }, { a: env(hp(noiseFill(buf(0.4)), 1500), 0.001, 0.1), g: 0.8 }, { a: env(sweep(0.4, 110, 45, 1, 'sine'), 0.001, 0.15) }), 3)), 0.05);
  const expl = (len, lpf, th) => fadeOut(norm(drive(mix(
    { a: env(lp(noiseFill(buf(len)), lpf, 120), 0.002, len * 0.28) }, { a: env(sweep(len * 0.6, th * 2.5, th * 0.4, 1, 'sine', 0.4), 0.002, len * 0.2), g: 1.4 },
    { a: env(hp(noiseFill(buf(0.12)), 1200), 0.001, 0.03), g: 0.7 }, { a: env(lp(noiseFill(buf(len)), 500, 80), 0.08, len * 0.4), g: 0.7, at: 0.05 }), 3)), 0.2);
  B.explosion = expl(2.0, 2400, 55); B.explosion_big = expl(3.2, 1600, 38); B.explosion_small = expl(0.9, 3200, 80);
  B.reload_out = norm(mix({ a: env(hp(noiseFill(buf(0.06)), 1500), 0.001, 0.012) }, { a: env(sweep(0.05, 900, 500, 1, 'sq'), 0.001, 0.01), g: 0.4 }, { a: env(lp(noiseFill(buf(0.12)), 1800), 0.01, 0.03), g: 0.6, at: 0.05 }), 0.7);
  B.reload_in = norm(mix({ a: env(lp(noiseFill(buf(0.1)), 2400), 0.004, 0.02), g: 0.7 }, { a: env(hp(noiseFill(buf(0.05)), 2000), 0.001, 0.008), at: 0.07 }, { a: env(sweep(0.06, 500, 260, 1, 'sq'), 0.001, 0.012), g: 0.5, at: 0.07 }), 0.75);
  B.bolt = norm(mix({ a: env(hp(noiseFill(buf(0.05)), 1800), 0.001, 0.01) }, { a: env(sweep(0.04, 1200, 700, 1, 'sq'), 0.001, 0.008), g: 0.35 }, { a: env(hp(noiseFill(buf(0.06)), 1400), 0.001, 0.012), at: 0.11 }, { a: env(sweep(0.05, 800, 420, 1, 'sq'), 0.001, 0.01), g: 0.4, at: 0.11 }), 0.7);
  B.pump = norm(mix({ a: env(lp(hp(noiseFill(buf(0.12)), 700), 3000), 0.004, 0.03) }, { a: env(lp(hp(noiseFill(buf(0.12)), 900), 3500), 0.004, 0.03), at: 0.16 }, { a: env(sweep(0.04, 500, 300, 1, 'sq'), 0.001, 0.01), g: 0.4, at: 0.17 }), 0.7);
  B.shell_in = norm(mix({ a: env(hp(noiseFill(buf(0.05)), 1600), 0.001, 0.01) }, { a: env(sweep(0.05, 700, 380, 1, 'tri'), 0.001, 0.012), g: 0.5 }), 0.6);
  B.dry = norm(mix({ a: env(hp(noiseFill(buf(0.03)), 3000), 0.0005, 0.005) }, { a: env(sweep(0.03, 1800, 1200, 1, 'sq'), 0.0005, 0.004), g: 0.3 }), 0.5);
  B.swap = norm(mix({ a: env(lp(noiseFill(buf(0.16)), 1400, 500), 0.02, 0.04) }, { a: env(hp(noiseFill(buf(0.04)), 2200), 0.001, 0.008), g: 0.5, at: 0.12 }), 0.5);
  B.casing = norm(mix({ a: env(sweep(0.08, 5200, 4800, 1, 'sine'), 0.0005, 0.018) }, { a: env(sweep(0.06, 7900, 7400, 1, 'sine'), 0.0005, 0.012), g: 0.5 }), 0.4);
  B.step1 = norm(mix({ a: env(lp(noiseFill(buf(0.14)), 900, 250), 0.004, 0.03) }, { a: env(sweep(0.08, 120, 60, 1, 'sine'), 0.002, 0.025), g: 0.8 }), 0.6);
  B.step2 = norm(mix({ a: env(lp(noiseFill(buf(0.14)), 1200, 300), 0.004, 0.026) }, { a: env(sweep(0.08, 105, 55, 1, 'sine'), 0.002, 0.025), g: 0.8 }), 0.6);
  B.step_metal = norm(mix({ a: env(lp(noiseFill(buf(0.16)), 2400, 500), 0.003, 0.03) }, { a: comb(env(sweep(0.2, 420, 380, 1, 'tri'), 0.001, 0.05), 0.004, 0.55), g: 0.35 }), 0.6);
  B.land = norm(mix({ a: env(lp(noiseFill(buf(0.25)), 700, 150), 0.004, 0.06) }, { a: env(sweep(0.16, 110, 40, 1, 'sine'), 0.002, 0.05), g: 1.2 }), 0.8);
  B.jump = norm(env(lp(noiseFill(buf(0.14)), 1100, 300), 0.01, 0.035), 0.35);
  B.slide = fadeOut(norm(env(lp(hp(noiseFill(buf(0.6)), 300), 2200, 600), 0.03, 0.25), 0.5), 0.1);
  B.hit = norm(mix({ a: env(sweep(0.05, 2100, 1700, 1, 'tri'), 0.0005, 0.012) }, { a: env(hp(noiseFill(buf(0.02)), 4000), 0.0005, 0.004), g: 0.5 }), 0.55);
  B.crit = norm(mix({ a: env(sweep(0.09, 2900, 2500, 1, 'tri'), 0.0005, 0.02) }, { a: env(sweep(0.09, 4350, 3900, 1, 'sine'), 0.0005, 0.02), g: 0.5 }), 0.6);
  B.kill = norm(mix({ a: env(sweep(0.1, 1300, 1250, 1, 'tri'), 0.0005, 0.03) }, { a: env(sweep(0.16, 1950, 1900, 1, 'tri'), 0.0005, 0.05), at: 0.07 }), 0.6);
  B.metal_hit = norm(mix({ a: env(hp(noiseFill(buf(0.05)), 2500), 0.0005, 0.008) }, { a: comb(env(sweep(0.25, rand(1700, 2100), 1600, 1, 'sine'), 0.0005, 0.05), 0.0023, 0.6), g: 0.4 }), 0.5);
  B.conc_hit = norm(mix({ a: env(lp(hp(noiseFill(buf(0.1)), 500), 3500, 900), 0.0005, 0.02) }, { a: env(sweep(0.05, 300, 120, 1, 'sine'), 0.0005, 0.012), g: 0.6 }), 0.5);
  B.whiz = fadeOut(norm(mix({ a: env(hp(lp(noiseFill(buf(0.22)), 5000, 1200), 1200, 500), 0.04, 0.05) }, { a: sweep(0.22, 2600, 900, 0.15, 'sine') }), 0.4), 0.05);
  B.hurt = norm(mix({ a: env(lp(noiseFill(buf(0.2)), 800, 200), 0.002, 0.05) }, { a: env(sweep(0.18, 160, 60, 1, 'sine'), 0.002, 0.06), g: 1.2 }), 0.8);
  B.shield_hit = norm(mix({ a: env(sweep(0.16, 900, 300, 1, 'sine'), 0.001, 0.04) }, { a: env(hp(noiseFill(buf(0.08)), 3000), 0.001, 0.02), g: 0.4 }), 0.5);
  B.shield_break = fadeOut(norm(mix({ a: env(sweep(0.5, 1800, 90, 1, 'saw', 0.4), 0.001, 0.14) }, { a: env(hp(noiseFill(buf(0.4)), 2000), 0.001, 0.1), g: 0.8 }), 0.75), 0.05);
  B.shield_up = fadeOut(norm(mix({ a: sweep(0.7, 220, 880, 0.5, 'sine', 0.8) }, { a: sweep(0.7, 330, 1320, 0.3, 'sine', 0.8) })).map((v, i, a) => v * Math.sin(Math.PI * i / a.length) * 0.5), 0.02);
  B.pickup = norm(mix({ a: env(sweep(0.09, 880, 880, 1, 'tri'), 0.002, 0.03) }, { a: env(sweep(0.16, 1320, 1320, 1, 'tri'), 0.002, 0.06), at: 0.07 }), 0.45);
  B.credit = norm(mix({ a: env(sweep(0.06, 1760, 1760, 1, 'sine'), 0.001, 0.02) }, { a: env(sweep(0.1, 2640, 2640, 1, 'sine'), 0.001, 0.04), at: 0.04 }), 0.3);
  B.heal = fadeOut(norm(mix({ a: sweep(0.5, 440, 880, 0.5, 'sine', 0.7) }, { a: sweep(0.5, 660, 1320, 0.3, 'tri', 0.7) })).map((v, i, a) => v * Math.sin(Math.PI * i / a.length) * 0.5), 0.02);
  B.ui_hover = norm(env(sweep(0.03, 1500, 1500, 1, 'sine'), 0.002, 0.008), 0.18);
  B.ui_click = norm(mix({ a: env(sweep(0.05, 900, 600, 1, 'tri'), 0.001, 0.012) }, { a: env(hp(noiseFill(buf(0.02)), 3000), 0.0005, 0.004), g: 0.4 }), 0.4);
  B.ui_confirm = norm(mix({ a: env(sweep(0.1, 660, 660, 1, 'tri'), 0.002, 0.03) }, { a: env(sweep(0.18, 990, 990, 1, 'tri'), 0.002, 0.07), at: 0.08 }, { a: env(sweep(0.3, 1320, 1320, 1, 'sine'), 0.002, 0.12), at: 0.16, g: 0.7 }), 0.45);
  B.ui_deny = norm(mix({ a: env(sweep(0.12, 220, 180, 1, 'sq'), 0.002, 0.04) }, { a: env(sweep(0.16, 170, 140, 1, 'sq'), 0.002, 0.05), at: 0.1 }), 0.3);
  B.objective = norm(mix({ a: env(sweep(0.2, 523, 523, 1, 'tri'), 0.004, 0.08) }, { a: env(sweep(0.2, 784, 784, 1, 'tri'), 0.004, 0.08), at: 0.12 }, { a: env(sweep(0.5, 1046, 1046, 1, 'tri'), 0.004, 0.2), at: 0.24 }), 0.5);
  B.wave = fadeOut(norm(drive(mix({ a: env(sweep(1.2, 110, 55, 1, 'saw', 0.6), 0.02, 0.5) }, { a: env(sweep(1.2, 165, 82, 1, 'saw', 0.6), 0.02, 0.5), g: 0.6 }, { a: env(lp(noiseFill(buf(1.0)), 600, 150), 0.01, 0.3), g: 0.5 }), 1.6), 0.6), 0.2);
  B.alarm = fadeOut(norm(mix({ a: sweep(0.45, 620, 880, 0.6, 'sq', 1) }, { a: sweep(0.45, 880, 620, 0.6, 'sq', 1), at: 0.45 }), 0.3), 0.03);
  B.spawn = fadeOut(norm(mix({ a: env(sweep(0.5, 1800, 120, 1, 'saw', 0.5), 0.002, 0.14) }, { a: env(lp(noiseFill(buf(0.6)), 1500, 200), 0.002, 0.16) }, { a: env(sweep(0.4, 90, 40, 1, 'sine'), 0.002, 0.14), g: 1.2 }), 0.7), 0.1);
  B.drone_die = fadeOut(norm(mix({ a: env(sweep(0.5, 900, 60, 1, 'saw', 0.5), 0.002, 0.15) }, { a: env(hp(noiseFill(buf(0.3)), 1000), 0.001, 0.08) }), 0.6), 0.05);
  B.crawler = fadeOut(norm(comb(mix({ a: sweep(0.3, 1400, 2400, 0.5, 'saw', 1) }, { a: sweep(0.3, 1900, 900, 0.4, 'sq', 1) }), 0.003, 0.5)).map((v, i, a) => v * Math.sin(Math.PI * i / a.length)), 0.02);
  B.servo = fadeOut(norm(mix({ a: sweep(0.25, 300, 520, 0.4, 'saw', 1) }, { a: lp(noiseFill(buf(0.25)), 2500), g: 0.15 })).map((v, i, a) => v * Math.sin(Math.PI * i / a.length) * 0.4), 0.02);
  B.stomp = fadeOut(norm(drive(mix({ a: env(sweep(0.6, 90, 28, 1, 'sine', 0.5), 0.002, 0.2), g: 1.5 }, { a: env(lp(noiseFill(buf(0.7)), 500, 100), 0.004, 0.2) }, { a: env(hp(noiseFill(buf(0.1)), 900), 0.001, 0.03), g: 0.4 }), 2)), 0.1);
  B.boss_roar = fadeOut(norm(drive(comb(mix({ a: sweep(2.2, 70, 45, 0.8, 'saw', 1) }, { a: sweep(2.2, 106, 61, 0.6, 'sq', 1) }, { a: lp(noiseFill(buf(2.2)), 700, 200), g: 0.5 }), 0.021, 0.6).map((v, i, a) => v * Math.sin(Math.PI * Math.pow(i / a.length, 0.6))), 2.5)), 0.2);
  B.missile = fadeOut(norm(mix({ a: env(lp(hp(noiseFill(buf(0.9)), 400), 3000, 800), 0.02, 0.4) }, { a: sweep(0.9, 300, 140, 0.2, 'saw') }), 0.5), 0.2);
  B.focus_in = fadeOut(norm(mix({ a: sweep(0.7, 900, 110, 0.6, 'sine', 0.5) }, { a: lp(noiseFill(buf(0.7)), 3000, 200), g: 0.3 })), 0.1);
  B.focus_out = fadeOut(norm(mix({ a: sweep(0.5, 110, 800, 0.6, 'sine', 1.5) }, { a: lp(noiseFill(buf(0.5)), 300, 3000), g: 0.25 })), 0.05);
  B.melee = norm(mix({ a: env(hp(lp(noiseFill(buf(0.2)), 3000, 800), 500), 0.03, 0.04) }), 0.5);
  B.melee_hit = norm(drive(mix({ a: env(lp(noiseFill(buf(0.15)), 1800, 300), 0.001, 0.03) }, { a: env(sweep(0.1, 180, 70, 1, 'sine'), 0.001, 0.03), g: 1.2 }, { a: comb(env(sweep(0.2, 1300, 1200, 1, 'sine'), 0.001, 0.04), 0.003, 0.5), g: 0.3 }), 2), 0.8);
  B.grenade_bounce = norm(mix({ a: env(sweep(0.06, 700, 500, 1, 'tri'), 0.0005, 0.012) }, { a: env(hp(noiseFill(buf(0.03)), 2000), 0.0005, 0.006), g: 0.5 }), 0.4);
  B.pin = norm(mix({ a: env(hp(noiseFill(buf(0.03)), 3500), 0.0005, 0.005) }, { a: env(sweep(0.08, 3200, 2800, 1, 'sine'), 0.0005, 0.02), g: 0.4, at: 0.02 }), 0.4);
  B.beep = norm(env(sweep(0.07, 1250, 1250, 1, 'sq'), 0.002, 0.03), 0.25);
  B.upload = fadeOut(norm(mix({ a: sweep(0.25, 400, 1600, 0.4, 'sq', 1) })).map((v, i) => v * ((i / 1400 | 0) % 2 ? 0.5 : 0.15)), 0.02);
  B.thunder = fadeOut(norm(drive(mix({ a: env(lp(noiseFill(buf(4.5)), 420, 60), 0.05, 1.4) }, { a: env(lp(noiseFill(buf(1.2)), 1500, 300), 0.002, 0.2), g: 0.8 }, { a: env(sweep(1.6, 60, 30, 1, 'sine'), 0.01, 0.6), g: 0.8 }), 2)), 1.0);
  B.heartbeat = norm(mix({ a: env(sweep(0.14, 70, 38, 1, 'sine'), 0.004, 0.04) }, { a: env(sweep(0.14, 62, 34, 1, 'sine'), 0.004, 0.045), at: 0.22, g: 0.75 }), 0.9);
  B.levelup = norm(mix({ a: env(sweep(0.14, 523, 523, 1, 'tri'), 0.003, 0.05) }, { a: env(sweep(0.14, 659, 659, 1, 'tri'), 0.003, 0.05), at: 0.1 }, { a: env(sweep(0.14, 784, 784, 1, 'tri'), 0.003, 0.05), at: 0.2 }, { a: env(sweep(0.6, 1046, 1046, 1, 'tri'), 0.003, 0.25), at: 0.3 }), 0.5);
  // loops
  const loopN = (sec, f) => { const a = f(buf(sec)); const x = (0.25 * SR) | 0; for (let i = 0; i < x; i++) { const t = i / x; a[i] = a[i] * t + a[a.length - x + i] * (1 - t); } return a.subarray(0, a.length - x); };
  B.loop_wind = loopN(6, (a) => { noiseFill(a); lp(a, 420); hp(a, 90); for (let i = 0; i < a.length; i++) a[i] *= 0.6 + 0.4 * Math.sin(i / SR * 0.9) * Math.sin(i / SR * 0.37 + 1); return norm(a, 0.5); });
  B.loop_rain = loopN(5, (a) => { noiseFill(a); hp(a, 1400); lp(a, 7500); const b = lp(noiseFill(buf(5)), 500); for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.7 + b[i] * 0.8; return norm(a, 0.5); });
  B.loop_drone = loopN(2, (a) => { for (let i = 0; i < a.length; i++) { const t = i / SR; a[i] = (((t * 187) % 1) * 2 - 1) * 0.3 + (((t * 191.5) % 1) * 2 - 1) * 0.3 + Math.sin(t * 6.283 * 93) * 0.3; a[i] *= 0.75 + 0.25 * Math.sin(t * 6.283 * 31); } return norm(lp(a, 1800), 0.5); });
  B.loop_boss = loopN(3, (a) => { for (let i = 0; i < a.length; i++) { const t = i / SR; a[i] = (((t * 41) % 1) * 2 - 1) * 0.4 + (((t * 61.5) % 1) < 0.5 ? 0.25 : -0.25) + Math.sin(t * 6.283 * 20.5) * 0.5; a[i] *= 0.7 + 0.3 * Math.sin(t * 6.283 * 2.66); } return norm(lp(a, 600), 0.6); });
  return B;
}

function impulse(ctx, sec = 2.2, decay = 2.6) {
  const n = (sec * ctx.sampleRate) | 0, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let y = 0; for (let i = 0; i < n; i++) { const t = i / n; const x = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); y += 0.35 * (x - y) * (1 - t * 0.7) + 0.0; d[i] = (x * (1 - t) + y * t) * (i < 400 ? i / 400 : 1); } }
  return b;
}

export class AudioSys {
  constructor() {
    this.ctx = null; this.ready = false; this.buffers = {}; this.vol = { master: 0.8, sfx: 1, music: 0.6 };
    this.muted = false; this.adMuted = false; this.loops = {}; this.intensity = 0; this.musicMode = 'none';
    this.lx = 0; this.ly = 0; this.lz = 0; this._last = {};
  }
  prepare() { if (!this.raw) this.raw = buildBuffers(); }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain(); this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 5; this.comp.attack.value = 0.003; this.comp.release.value = 0.18;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.music = ctx.createGain(); this.sfx.connect(this.master); this.music.connect(this.master);
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000; this.sfxIn = ctx.createGain(); this.sfxIn.connect(this.lowpass); this.lowpass.connect(this.sfx);
    this.rev = ctx.createConvolver(); this.rev.buffer = impulse(ctx); this.revGain = ctx.createGain(); this.revGain.gain.value = 0.22; this.rev.connect(this.revGain); this.revGain.connect(this.sfx);
    const raw = this.raw || buildBuffers(); this.raw = null;
    for (const k in raw) { const b = ctx.createBuffer(1, raw[k].length, SR); b.getChannelData(0).set(raw[k]); this.buffers[k] = b; }
    this.applyVol(); this.ready = true;
    this._musicSetup();
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  applyVol() {
    if (!this.ctx) return;
    const m = (this.muted || this.adMuted) ? 0 : this.vol.master;
    this.master.gain.setTargetAtTime(m, this.ctx.currentTime, 0.03); this.sfx.gain.value = this.vol.sfx; this.music.gain.value = this.vol.music * 0.55;
  }
  setListener(cam) {
    if (!this.ctx) return; const l = this.ctx.listener, e = cam.matrixWorld.elements;
    this.lx = e[12]; this.ly = e[13]; this.lz = e[14];
    if (l.positionX) { const t = this.ctx.currentTime; l.positionX.setValueAtTime(e[12], t); l.positionY.setValueAtTime(e[13], t); l.positionZ.setValueAtTime(e[14], t); l.forwardX.setValueAtTime(-e[8], t); l.forwardY.setValueAtTime(-e[9], t); l.forwardZ.setValueAtTime(-e[10], t); l.upX.setValueAtTime(e[4], t); l.upY.setValueAtTime(e[5], t); l.upZ.setValueAtTime(e[6], t); }
    else if (l.setPosition) { l.setPosition(e[12], e[13], e[14]); l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); }
  }
  // o: {vol, rate, pos:{x,y,z}, rv (rate variance), reverb, throttle}
  play(name, o = {}) {
    if (!this.ready || this.ctx.state !== 'running') return null;
    const b = this.buffers[name]; if (!b) return null;
    const now = this.ctx.currentTime;
    if (o.throttle) { if (now - (this._last[name] || 0) < o.throttle) return null; this._last[name] = now; }
    let vol = o.vol ?? 1;
    if (o.pos) { const d = Math.hypot(o.pos.x - this.lx, o.pos.y - this.ly, o.pos.z - this.lz); if (d > (o.max || 90)) return null; }
    const src = this.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = (o.rate || 1) * (1 + rand(-1, 1) * (o.rv ?? 0.05)) * (this.timeScale || 1);
    const g = this.ctx.createGain(); g.gain.value = vol; src.connect(g);
    let out = g;
    if (o.pos) {
      const p = this.ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 4; p.rolloffFactor = o.roll || 1.1; p.maxDistance = 200;
      p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; g.connect(p); out = p;
    }
    out.connect(this.sfxIn);
    if (o.reverb !== 0) { const rg = this.ctx.createGain(); rg.gain.value = o.reverb ?? 0.5; out.connect(rg); rg.connect(this.rev); }
    src.start(now + (o.delay || 0));
    return src;
  }
  loop(name, vol, rate = 1) {
    if (!this.ready) return;
    let l = this.loops[name];
    if (!l) { if (vol <= 0) return; const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name]; src.loop = true; const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.sfx); src.start(); l = this.loops[name] = { src, g }; }
    l.g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.15); l.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
  }
  stopLoops() { for (const k in this.loops) this.loops[k].g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
  setSlowmo(k) { // k: 0..1
    if (!this.ctx) return; this.timeScale = 1 - 0.45 * k;
    this.lowpass.frequency.setTargetAtTime(20000 - 18600 * k, this.ctx.currentTime, 0.08);
  }
  setMuffle(k) { if (this.ctx) this.lowpass.frequency.setTargetAtTime(20000 - 19200 * k, this.ctx.currentTime, 0.1); }

  // ---------- adaptive music ----------
  _musicSetup() {
    const ctx = this.ctx;
    this.mBus = ctx.createGain(); this.mBus.gain.value = 0; this.mBus.connect(this.music);
    this.mFilter = ctx.createBiquadFilter(); this.mFilter.type = 'lowpass'; this.mFilter.frequency.value = 900; this.mFilter.Q.value = 0.7; this.mFilter.connect(this.mBus);
    const mrev = ctx.createGain(); mrev.gain.value = 0.5; this.mFilter.connect(mrev); mrev.connect(this.rev);
    this.step = 0; this.nextT = 0; this.bpm = 96;
    this._timer = setInterval(() => this._schedule(), 60);
  }
  setMusic(mode) { // 'menu' | 'combat' | 'none'
    this.musicMode = mode; if (!this.ctx) return;
    this.mBus.gain.setTargetAtTime(mode === 'none' ? 0 : 1, this.ctx.currentTime, 0.6);
  }
  _voice(t, freq, dur, type, vol, dest, det = 0) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq; o.detune.value = det;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02 + dur * 0.1, 0.4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  _noiseHit(t, dur, vol, hpf, dest) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.buffers.step1 ? this._nb || (this._nb = (() => { const b = ctx.createBuffer(1, SR * 0.5, SR); noiseFill(b.getChannelData(0)); return b; })()) : null;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpf; const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.3, dur + 0.02);
  }
  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running' || this.musicMode === 'none') { if (this.ctx) this.nextT = this.ctx.currentTime + 0.1; return; }
    const ctx = this.ctx, spb = 60 / this.bpm / 4; // 16th
    if (this.nextT < ctx.currentTime) this.nextT = ctx.currentTime + 0.05;
    const I = this.musicMode === 'menu' ? 0.12 : this.intensity;
    this.mFilter.frequency.setTargetAtTime(500 + 5200 * I * I + (this.musicMode === 'menu' ? 700 : 0), ctx.currentTime, 0.4);
    const roots = [36, 36, 39, 34, 36, 36, 41, 39]; // C2-based minor movement
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextT < ctx.currentTime + 0.25) {
      const t = this.nextT, s = this.step, bar = (s >> 4) % 8, st = s & 15, root = roots[bar];
      if (st === 0) { // pad chord each bar
        for (const iv of [0, 7, 12, 15, 19]) { this._voice(t, mtof(root + 12 + iv), spb * 17, 'sawtooth', 0.035, this.mFilter, -7); this._voice(t, mtof(root + 12 + iv), spb * 17, 'sawtooth', 0.035, this.mFilter, 8); }
        this._voice(t, mtof(root), spb * 16, 'sine', 0.22, this.mBus);
      }
      if (this.musicMode === 'menu') { if (st % 4 === 2) this._voice(t, mtof(root + 36 + [0, 3, 7, 10, 12, 7, 3, 10][(s >> 2) % 8]), spb * 6, 'triangle', 0.05, this.mFilter); }
      else {
        if (I > 0.15) { const pat = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0]; if (pat[st]) this._voice(t, mtof(root + 12), spb * 1.6, 'sawtooth', 0.11 * Math.min(1, I * 2), this.mFilter); }
        if (I > 0.35) { if (st % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(0.5 * I, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); o.connect(g); g.connect(this.mBus); o.start(t); o.stop(t + 0.3); }
          if (st % 2 === 1 || st === 14) this._noiseHit(t, 0.035, 0.07 * I, 6000, this.mBus); }
        if (I > 0.55 && (st === 4 || st === 12)) this._noiseHit(t, 0.14, 0.22 * I, 1400, this.mBus);
        if (I > 0.7) { const arp = [0, 12, 7, 15, 12, 19, 15, 24]; this._voice(t, mtof(root + 24 + arp[s % 8]), spb * 1.2, 'square', 0.03 * I, this.mFilter); }
      }
      this.step++; this.nextT += spb;
    }
  }
}
