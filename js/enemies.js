// Enemy machines: procedural models, AI, hit zones, boss
import * as THREE from './lib/three.min.js';
import { Builder } from './models.js';
import { ENEMIES } from './config.js';
import { patch } from './materials.js';
import { rand, clamp, lerp, damp, angleDelta, TAU, randSign } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = { x: 0, z: 0 };
const A = { // armour palette (paint colours)
  white: [0.62, 0.64, 0.66], grey: [0.3, 0.31, 0.33], joint: [0.035, 0.035, 0.04], yellow: [0.78, 0.55, 0.06], navy: [0.06, 0.09, 0.16], olive: [0.2, 0.23, 0.15], black: [0.05, 0.05, 0.055],
  red: [1.0, 0.16, 0.05], orange: [1.0, 0.42, 0.08], cyan: [0.2, 0.8, 1.0], green: [0.3, 1.0, 0.35], magenta: [1.0, 0.2, 0.7], elite: [0.42, 0.06, 0.05],
};
const J = { metal: 1, rough: 0.8 }, PA = { metal: 1, rough: 1 };
const GEO = {};

function legGeo(len, w, col, foot = false) { // segment hanging down from pivot
  const b = new Builder(2.2);
  b.box(w, len, w * 1.15, 0, -len / 2, 0, col, { bevel: w * 0.18, ...PA });
  b.cyl(w * 0.62, w * 0.62, w * 1.3, 0, 0, 0, A.joint, { axis: 'x', seg: 10, ...J });
  if (foot) { b.box(w * 1.25, w * 0.5, w * 2.3, 0, -len + w * 0.25, -w * 0.5, A.joint, { bevel: w * 0.12, ...J }); }
  return b.build();
}

function geos(type) {
  if (GEO[type]) return GEO[type];
  const g = {}; let b;
  if (type === 'trooper' || type === 'trooperE') {
    const arm = type === 'trooperE' ? A.elite : A.white, eye = type === 'trooperE' ? A.magenta : A.orange;
    b = new Builder(2.2);
    b.box(0.42, 0.24, 0.3, 0, 0.0, 0, A.joint, { bevel: 0.05, ...J });                      // pelvis
    b.box(0.3, 0.2, 0.22, 0, 0.2, 0, A.joint, { bevel: 0.04, ...J });                       // waist
    b.box(0.58, 0.44, 0.36, 0, 0.5, 0, arm, { bevel: 0.07, ...PA });                        // chest
    b.box(0.4, 0.2, 0.1, 0, 0.52, -0.2, A.grey, { bevel: 0.03, rx: -0.15, ...PA });         // chest plate
    b.box(0.06, 0.03, 0.02, -0.12, 0.6, -0.26, eye, { emi: 5, metal: 0 });
    b.box(0.44, 0.36, 0.16, 0, 0.5, 0.24, A.grey, { bevel: 0.04, ...PA });                  // pack
    for (const s of [-1, 1]) { b.cyl(0.03, 0.03, 0.3, s * 0.14, 0.72, 0.26, A.joint, { seg: 6, ...J }); b.box(0.2, 0.14, 0.26, s * 0.38, 0.66, 0, arm, { bevel: 0.04, ...PA }); b.box(0.2, 0.03, 0.27, s * 0.38, 0.7, 0, A.yellow, PA); }
    b.cyl(0.07, 0.08, 0.1, 0, 0.76, 0, A.joint, { seg: 8, ...J });                           // neck
    b.box(0.26, 0.25, 0.3, 0, 0.92, -0.01, arm, { bevel: 0.08, ...PA });                    // head
    b.box(0.22, 0.07, 0.06, 0, 0.93, -0.15, eye, { bevel: 0.02, emi: 9, metal: 0 });        // visor
    b.box(0.28, 0.06, 0.2, 0, 1.03, 0.02, A.grey, { bevel: 0.02, ...PA });
    b.cyl(0.008, 0.008, 0.22, 0.11, 1.12, 0.1, A.joint, { seg: 4, ...J });
    g.torso = b.build();
    b = new Builder(2.2); // arms + rifle, pivot at shoulder line; forward = -Z
    for (const s of [-1, 1]) {
      b.box(0.11, 0.3, 0.12, s * 0.4, -0.13, -0.02, arm, { bevel: 0.03, rx: 0.5 * (s > 0 ? 1 : 1.4), ...PA });
      b.box(0.09, 0.3, 0.1, s * (s > 0 ? 0.36 : 0.26), -0.26, -0.26, A.joint, { bevel: 0.025, rx: 1.35, rz: s > 0 ? 0 : -0.5, ...J });
    }
    b.box(0.07, 0.11, 0.6, 0.3, -0.24, -0.5, A.joint, { bevel: 0.015, ...J });
    b.box(0.05, 0.07, 0.24, 0.3, -0.21, -0.9, A.grey, { bevel: 0.01, ...J });
    b.cyl(0.02, 0.02, 0.16, 0.3, -0.22, -1.08, A.joint, { axis: 'z', seg: 8, ...J });
    b.box(0.075, 0.02, 0.3, 0.3, -0.175, -0.6, eye, { emi: 3, metal: 0 });
    b.box(0.05, 0.16, 0.07, 0.3, -0.36, -0.42, A.joint, { rx: 0.2, ...J });
    g.arms = b.build();
    g.thigh = legGeo(0.46, 0.15, arm); g.shin = legGeo(0.5, 0.12, A.grey, true);
  } else if (type === 'lancer') {
    b = new Builder(2.2);
    b.box(0.3, 0.2, 0.24, 0, 0, 0, A.joint, { bevel: 0.04, ...J });
    b.box(0.2, 0.3, 0.18, 0, 0.24, 0, A.joint, { bevel: 0.03, ...J });
    b.box(0.46, 0.4, 0.28, 0, 0.58, 0, A.navy, { bevel: 0.08, ...PA });
    b.box(0.5, 0.08, 0.3, 0, 0.74, 0, A.grey, { bevel: 0.03, ...PA });
    for (const s of [-1, 1]) { b.box(0.05, 0.6, 0.26, s * 0.2, 0.8, 0.22, A.navy, { bevel: 0.02, rx: -0.5, rz: s * -0.25, ...PA }); b.box(0.02, 0.5, 0.02, s * 0.2, 0.82, 0.28, A.cyan, { emi: 4, metal: 0, rx: -0.5, rz: s * -0.25 }); }
    b.cyl(0.05, 0.06, 0.12, 0, 0.86, 0, A.joint, { seg: 8, ...J });
    b.box(0.2, 0.3, 0.26, 0, 1.06, -0.02, A.navy, { bevel: 0.08, ...PA });
    b.sphere(0.075, 0, 1.08, -0.14, A.cyan, { emi: 12, metal: 0, seg: 12 });
    b.torus(0.09, 0.016, 0, 1.08, -0.145, A.joint, { ...J, seg: 14 });
    g.torso = b.build();
    b = new Builder(2.2);
    b.box(0.09, 0.34, 0.1, 0.3, -0.14, -0.04, A.navy, { bevel: 0.03, rx: 0.5, ...PA }); b.box(0.09, 0.34, 0.1, -0.3, -0.14, -0.1, A.navy, { bevel: 0.03, rx: 0.9, ...PA });
    b.box(0.07, 0.3, 0.08, -0.2, -0.24, -0.42, A.joint, { bevel: 0.02, rx: 1.4, rz: -0.6, ...J });
    b.box(0.08, 0.13, 0.7, 0.24, -0.2, -0.5, A.joint, { bevel: 0.02, ...J });
    b.cyl(0.028, 0.028, 1.1, 0.24, -0.17, -1.3, A.grey, { axis: 'z', seg: 8, ...J });
    for (let k = 0; k < 5; k++) b.torus(0.045, 0.01, 0.24, -0.17, -0.95 - k * 0.2, A.cyan, { emi: 6, metal: 0, seg: 10 });
    b.cyl(0.045, 0.03, 0.1, 0.24, -0.17, -1.88, A.joint, { axis: 'z', seg: 8, ...J });
    b.cyl(0.04, 0.04, 0.2, 0.24, -0.08, -0.5, A.joint, { axis: 'z', seg: 10, ...J });
    g.arms = b.build();
    g.thigh = legGeo(0.52, 0.11, A.navy); g.shin = legGeo(0.6, 0.085, A.grey, true);
  } else if (type === 'heavy') {
    b = new Builder(2.2);
    b.box(0.9, 0.5, 0.7, 0, 0, 0, A.joint, { bevel: 0.1, ...J });
    b.box(0.6, 0.3, 0.5, 0, 0.36, 0, A.joint, { bevel: 0.08, ...J });
    b.box(1.5, 0.95, 1.0, 0, 0.98, 0, A.olive, { bevel: 0.16, seg: 2, ...PA });
    b.box(1.1, 0.5, 0.2, 0, 0.9, -0.52, A.grey, { bevel: 0.06, rx: -0.12, ...PA });
    for (let k = -2; k <= 2; k++) b.box(0.12, 0.3, 0.03, k * 0.19, 0.9, -0.63, A.red, { emi: k % 2 ? 0 : 3.5, metal: 0, rx: -0.12 });
    b.box(1.6, 0.14, 1.05, 0, 1.5, 0, A.yellow, { bevel: 0.04, ...PA });
    b.box(0.5, 0.34, 0.5, 0, 1.68, -0.06, A.olive, { bevel: 0.1, ...PA });
    b.box(0.4, 0.09, 0.06, 0, 1.7, -0.32, A.red, { bevel: 0.02, emi: 10, metal: 0 });
    b.cyl(0.26, 0.26, 0.3, 0, 1.0, 0.56, A.grey, { axis: 'z', seg: 14, ...J });
    b.cyl(0.2, 0.2, 0.06, 0, 1.0, 0.73, A.orange, { axis: 'z', seg: 14, emi: 8, metal: 0 });  // reactor (weak point)
    for (const s of [-1, 1]) { b.box(0.5, 0.5, 0.6, s * 0.95, 1.2, 0, A.olive, { bevel: 0.12, ...PA }); b.box(0.36, 0.3, 0.44, s * 0.6, 1.72, 0.25, A.grey, { bevel: 0.05, ...PA }); for (let k = 0; k < 4; k++) b.cyl(0.055, 0.055, 0.03, s * 0.6 + (k % 2 ? 0.08 : -0.08), 1.72 + (k > 1 ? 0.07 : -0.07), 0.02, A.black, { axis: 'z', seg: 8, ...J }); }
    g.torso = b.build();
    b = new Builder(2.2);
    for (const s of [-1, 1]) {
      b.box(0.3, 0.6, 0.34, s * 1.0, -0.35, 0, A.joint, { bevel: 0.07, ...J });
      b.box(0.4, 0.42, 0.9, s * 1.0, -0.75, -0.3, A.olive, { bevel: 0.1, ...PA });
      b.box(0.42, 0.06, 0.6, s * 1.0, -0.56, -0.3, A.yellow, PA);
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; b.cyl(0.04, 0.04, 0.7, s * 1.0 + Math.cos(a) * 0.09, -0.75 + Math.sin(a) * 0.09, -1.0, A.joint, { axis: 'z', seg: 6, ...J }); }
      b.cyl(0.15, 0.15, 0.08, s * 1.0, -0.75, -0.9, A.grey, { axis: 'z', seg: 12, ...J }); b.cyl(0.15, 0.15, 0.06, s * 1.0, -0.75, -1.3, A.grey, { axis: 'z', seg: 12, ...J });
    }
    g.arms = b.build();
    g.thigh = legGeo(0.72, 0.34, A.olive); g.shin = legGeo(0.78, 0.28, A.grey, true);
  } else if (type === 'crawler') {
    b = new Builder(2.2);
    b.box(0.62, 0.26, 0.8, 0, 0, 0, A.yellow, { bevel: 0.09, ...PA });
    b.box(0.5, 0.1, 0.5, 0, 0.15, 0.05, A.black, { bevel: 0.03, ...PA });
    b.box(0.36, 0.2, 0.24, 0, 0.02, -0.46, A.joint, { bevel: 0.06, ...J });
    for (const x of [-0.1, 0, 0.1]) b.sphere(0.035, x, 0.05, -0.585, A.green, { emi: 12, metal: 0, seg: 8 });
    b.sphere(0.24, 0, 0.14, 0.34, A.orange, { emi: 2.6, metal: 0, seg: 12, sy: 0.8 });
    b.torus(0.24, 0.03, 0, 0.14, 0.34, A.joint, { ...J, axis: 'y', seg: 14 }); b.torus(0.21, 0.025, 0, 0.14, 0.34, A.joint, { ...J, seg: 14 });
    for (const s of [-1, 1]) b.box(0.05, 0.05, 0.3, s * 0.12, -0.02, -0.66, A.joint, { ry: s * -0.4, bevel: 0.015, ...J });
    g.torso = b.build();
    const legs = (sign) => { const lb = new Builder(2.2); for (const [sx, sz] of sign > 0 ? [[1, -1], [-1, 1]] : [[-1, -1], [1, 1]]) {
      lb.box(0.5, 0.08, 0.1, sx * 0.5, 0.1, sz * 0.26, A.joint, { bevel: 0.025, rz: sx * 0.5, ry: sz * sx * -0.35, ...J });
      lb.box(0.09, 0.62, 0.09, sx * 0.78, -0.08, sz * 0.36, A.yellow, { bevel: 0.025, rz: sx * 0.22, ...PA });
      lb.cyl(0.06, 0.06, 0.12, sx * 0.7, 0.22, sz * 0.33, A.joint, { axis: 'z', seg: 8, ...J });
      lb.cone(0.05, 0.14, sx * 0.85, -0.4, sz * 0.36, A.joint, { rx: Math.PI, ...J }); } return lb.build(); };
    g.legsA = legs(1); g.legsB = legs(-1);
  } else if (type === 'drone') {
    b = new Builder(2.2);
    b.box(0.42, 0.2, 0.6, 0, 0, 0, A.grey, { bevel: 0.08, seg: 2, ...PA });
    b.box(0.3, 0.08, 0.4, 0, 0.12, 0.02, A.black, { bevel: 0.03, ...PA });
    b.sphere(0.085, 0, -0.01, -0.3, A.red, { emi: 12, metal: 0, seg: 12 }); b.torus(0.1, 0.02, 0, -0.01, -0.3, A.joint, { ...J, seg: 14 });
    b.box(0.1, 0.1, 0.34, 0, -0.14, -0.12, A.joint, { bevel: 0.02, ...J }); b.cyl(0.022, 0.022, 0.26, 0, -0.15, -0.4, A.joint, { axis: 'z', seg: 8, ...J });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(0.4, 0.04, 0.06, sx * 0.34, 0.03, sz * 0.3, A.joint, { ry: sx * sz * 0.6, ...J });
      b.cyl(0.05, 0.05, 0.09, sx * 0.5, 0.06, sz * 0.42, A.joint, { seg: 8, ...J });
      b.torus(0.25, 0.018, sx * 0.5, 0.1, sz * 0.42, A.yellow, { axis: 'y', seg: 18, ...PA });
      b.box(0.03, 0.02, 0.02, sx * 0.5, 0.0, sz * 0.42 + sz * 0.26, sz < 0 ? A.red : A.green, { emi: 8, metal: 0 });
    }
    g.torso = b.build();
    const discs = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const c = new THREE.CircleGeometry(0.235, 16); c.rotateX(-Math.PI / 2); c.translate(sx * 0.5, 0.1, sz * 0.42); discs.push(c); }
    g.rotors = THREE.mergeGeometries(discs);
  } else if (type === 'boss') {
    b = new Builder(2.2);
    b.box(4.2, 1.9, 6.2, 0, 0, 0, A.black, { bevel: 0.35, seg: 2, ...PA });
    b.box(4.5, 0.5, 5.0, 0, 0.9, 0.2, A.grey, { bevel: 0.14, ...PA });
    b.box(3.4, 0.7, 3.6, 0, 1.45, 0.4, A.black, { bevel: 0.2, ...PA });
    b.box(4.3, 0.22, 6.3, 0, -0.35, 0, A.yellow, { bevel: 0.05, ...PA });
    for (const s of [-1, 1]) {
      b.box(0.6, 1.5, 5.0, s * 2.3, 0.1, 0, A.grey, { bevel: 0.14, ...PA });
      for (let k = 0; k < 6; k++) b.box(0.08, 0.8, 0.3, s * 2.62, 0.1, -2 + k * 0.8, A.orange, { emi: 2.5, metal: 0 });
      b.box(1.5, 1.1, 1.6, s * 1.5, 1.9, 1.6, A.grey, { bevel: 0.12, ...PA });                                   // missile pods
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) b.cyl(0.17, 0.17, 0.06, s * 1.5 + (i - 1) * 0.42, 2.48, 1.3 + j * 0.6, A.joint, { seg: 10, ...J });
      b.box(0.5, 0.5, 1.3, s * 1.2, -1.15, -1.9, A.joint, { bevel: 0.08, ...J });                                 // chin guns
      b.cyl(0.11, 0.11, 1.3, s * 1.2, -1.15, -3.1, A.joint, { axis: 'z', seg: 10, ...J });
    }
    b.box(2.6, 0.9, 0.3, 0, -0.1, -3.15, A.grey, { bevel: 0.08, rx: 0.2, ...PA });
    for (let k = -3; k <= 3; k++) b.box(0.22, 0.5, 0.05, k * 0.34, -0.1, -3.33, A.orange, { emi: 4, metal: 0, rx: 0.2 });
    b.cyl(0.9, 1.1, 0.5, 0, 2.0, -0.6, A.joint, { seg: 18, ...J });
    g.torso = b.build();
    b = new Builder(2.2); // head turret (pivot at its base)
    b.box(1.9, 1.0, 2.2, 0, 0.6, 0, A.black, { bevel: 0.25, seg: 2, ...PA });
    b.box(2.0, 0.2, 2.0, 0, 1.1, 0.1, A.yellow, { bevel: 0.05, ...PA });
    b.box(1.5, 0.22, 0.12, 0, 0.72, -1.12, A.red, { bevel: 0.05, emi: 12, metal: 0 });
    b.cyl(0.26, 0.3, 2.6, 0, 0.42, -2.3, A.joint, { axis: 'z', seg: 14, ...J });
    for (let k = 0; k < 4; k++) b.torus(0.33, 0.05, 0, 0.42, -1.5 - k * 0.6, A.orange, { emi: 5, metal: 0, seg: 14 });
    b.cyl(0.38, 0.3, 0.4, 0, 0.42, -3.7, A.grey, { axis: 'z', seg: 14, ...J });
    for (const s of [-1, 1]) { b.box(0.3, 0.6, 1.2, s * 1.1, 0.6, 0.2, A.grey, { bevel: 0.08, ...PA }); b.cyl(0.03, 0.03, 1.6, s * 0.7, 1.9, 0.8, A.joint, { seg: 5, ...J }); }
    g.head = b.build();
    b = new Builder(2.2); b.box(0.9, 3.4, 1.0, 0, -1.7, 0, A.grey, { bevel: 0.2, ...PA }); b.cyl(0.62, 0.62, 1.1, 0, 0, 0, A.joint, { axis: 'x', seg: 14, ...J }); b.box(0.95, 0.5, 1.06, 0, -1.2, 0, A.yellow, PA); g.legU = b.build();
    b = new Builder(2.2); b.box(0.7, 4.0, 0.8, 0, -2.0, 0, A.black, { bevel: 0.16, ...PA }); b.cyl(0.5, 0.5, 0.95, 0, 0, 0, A.joint, { axis: 'x', seg: 14, ...J }); b.box(1.5, 0.5, 1.9, 0, -4.0, 0, A.joint, { bevel: 0.14, ...J }); b.box(0.74, 0.3, 0.84, 0, -3.0, 0, A.orange, { emi: 1.5, metal: 0 }); g.legL = b.build();
    b = new Builder(2.2); b.sphere(0.62, 0, 0, 0, A.orange, { emi: 7, metal: 0, seg: 16, seg2: 12 }); b.torus(0.66, 0.1, 0, 0, 0, A.joint, { ...J, seg: 18 }); b.torus(0.66, 0.1, 0, 0, 0, A.joint, { ...J, seg: 18, axis: 'y' }); g.core = b.build();
  }
  GEO[type] = g; return g;
}

let rotorMat = null, shieldMat = null;

class Enemy {
  constructor(sys, type, x, z, opts = {}) {
    const game = sys.game, def = ENEMIES[type], diff = game.diff;
    this.sys = sys; this.game = game; this.type = type; this.def = def; this.elite = !!opts.elite;
    const hk = diff.hp * (this.elite ? 1.9 : 1) * (opts.hpMul || 1);
    this.maxHp = this.hp = def.hp * hk; this.dmgMul = (this.elite ? 1.3 : 1) * (opts.dmgMul || 1);
    this.pos = new THREE.Vector3(x, 0, z); this.vel = new THREE.Vector3(); this.yaw = rand(TAU); this.radius = def.radius; this.h = 1.9; this.boundR = 1.3;
    this.dead = false; this.t = rand(10); this.flash = 0; this.seeT = rand(0.3); this.see = false; this.lastSeen = 0; this.atkT = rand(1, 2.5); this.burst = 0; this.burstT = 0; this.stateT = 0; this.strafe = randSign(); this.walk = rand(6);
    this.hurtShow = 0; this.stagger = 0; this.navSize = 0; this.flying = false; this.zones = []; this.spawnT = 0.5;
    this.group = new THREE.Group();
    this.mat = sys.makeMat(); this.meshes = [];
    this.build(geos(this.elite && type === 'trooper' ? 'trooperE' : type));
    this.group.position.copy(this.pos); game.gfx.scene.add(this.group);
  }
  mesh(geo, parent = this.group, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, this.mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); this.meshes.push(m); return m; }
  biped(g, hipY, thighLen, legX, shoulderY) {
    this.torso = this.mesh(g.torso, this.group, 0, hipY, 0);
    this.arms = this.mesh(g.arms, this.torso, 0, shoulderY, 0);
    this.legs = [];
    for (const s of [-1, 1]) { const th = this.mesh(g.thigh, this.group, s * legX, hipY - 0.02, 0); const sh = this.mesh(g.shin, th, 0, -thighLen, 0); this.legs.push({ th, sh, s }); }
    this.hipY = hipY;
  }
  animBiped(dt, speedK, stride = 0.6) {
    const sp = Math.hypot(this.vel.x, this.vel.z); this.walk += sp * dt * speedK;
    const k = clamp(sp / 1.2, 0, 1);
    for (const l of this.legs) { const ph = this.walk + (l.s > 0 ? 0 : Math.PI); l.th.rotation.x = Math.sin(ph) * stride * k; l.sh.rotation.x = -Math.max(0, Math.cos(ph)) * stride * 1.5 * k - 0.08; }
    this.torso.position.y = this.hipY + Math.abs(Math.sin(this.walk)) * 0.04 * k - 0.03 * k;
    this.torso.rotation.z = Math.sin(this.walk) * 0.03 * k;
  }
  aimArms(dt, eyeY) { // pitch arms toward the player
    const p = this.game.player.body, dx = p.x - this.pos.x, dz = p.z - this.pos.z, dy = (p.y + 1.2) - (this.pos.y + eyeY);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)); this.arms.rotation.x = damp(this.arms.rotation.x, clamp(pitch, -0.9, 0.9), 8, dt);
  }
  face(dt, rate = 6, tx, tz) { const p = this.game.player.body; const want = Math.atan2(this.pos.x - (tx ?? p.x), this.pos.z - (tz ?? p.z)); this.yaw += angleDelta(this.yaw, want) * Math.min(1, rate * dt); }
  distToPlayer() { const p = this.game.player.body; return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  updateSee(dt, eyeY) {
    this.seeT -= dt; if (this.seeT > 0) return; this.seeT = 0.22 + rand(0.1);
    const p = this.game.player.body; this.see = !this.game.player.dead && this.game.level.los(this.pos.x, this.pos.y + eyeY, this.pos.z, p.x, p.y + 1.25, p.z);
    if (this.see) this.lastSeen = this.t;
  }
  // ground locomotion with nav-grid collision. (dx,dz) desired direction (normalised), speed
  moveGround(dt, dx, dz, speed, accel = 8) {
    const L = this.game.level; this.vel.x = damp(this.vel.x, dx * speed, accel, dt); this.vel.z = damp(this.vel.z, dz * speed, accel, dt);
    const size = this.navSize + 1; let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (L.navBlocked(nx, this.pos.z, size)) { nx = this.pos.x; this.vel.x *= 0.3; this.strafe *= -1; } if (L.navBlocked(nx, nz, size)) { nz = this.pos.z; this.vel.z *= 0.3; this.strafe *= -1; }
    this.pos.x = nx; this.pos.z = nz;
  }
  flow(out) { const p = this.game.player.body; return this.game.level.flowDir(this.navSize, this.pos.x, this.pos.z, out); }
  muzzleWorld(mesh, x, y, z) { return mesh.localToWorld(_v.set(x, y, z)); }
  shootAt(from, speed, dmg, color, spread = 0.03, size = 0.09, lead = 0.5) {
    const g = this.game, p = g.player.body; const d = Math.hypot(p.x - from.x, p.z - from.z), tt = d / speed * lead;
    let tx = p.x + p.vx * tt - from.x, ty = p.y + (g.player.crouchT > 0.5 ? 0.75 : 1.15) - from.y, tz = p.z + p.vz * tt - from.z; const l = Math.hypot(tx, ty, tz) || 1;
    tx = tx / l + rand(-spread, spread); ty = ty / l + rand(-spread, spread) * 0.6; tz = tz / l + rand(-spread, spread);
    g.projectiles.spawnBolt(from.x, from.y, from.z, tx * speed, ty * speed, tz * speed, dmg * this.dmgMul, color, size);
    g.fx.glow(from.x, from.y, from.z, 0.5, color, 0.06, 4, 5);
  }
  hit(dmg, x, y, z, dx, dy, dz, o = {}) {
    if (this.dead) return null; const g = this.game;
    if (this.onHit) { const r = this.onHit(dmg, x, y, z, o); if (r === 'shield') return 'shield'; if (typeof r === 'number') dmg = r; }
    this.hp -= dmg; this.flash = 1; this.hurtShow = 3; this.stagger = Math.min(0.25, this.stagger + dmg / this.maxHp * 0.6);
    g.fx.robotHit(x, y, z, -dx, -dy + 0.3, -dz, [1, 0.8, 0.5], o.crit);
    g.stats.damage += dmg; g.player.addFocus(dmg / 2600 + (o.crit ? 0.004 : 0));
    if (g.settings.dmgNumbers) g.ui.dmgNumber(x, y, z, dmg, o.crit);
    if (this.hp <= 0) { this.die(dx, dy, dz, o); return 'kill'; }
    return 'hit';
  }
  die(dx = 0, dy = 0, dz = 0, o = {}) {
    if (this.dead) return; this.dead = true; const g = this.game, fx = g.fx, c = this.pos, cy = c.y + this.h * 0.5;
    const big = this.type === 'heavy' ? 2 : this.type === 'boss' ? 5 : 1;
    fx.sparks(c.x, cy, c.z, 0, 0.7, 0, 24 * big, [1, 0.7, 0.3], 10, 1.4); fx.glow(c.x, cy, c.z, 2.4 * big, [1, 0.6, 0.3], 0.14, 0, 7); fx.glow(c.x, cy, c.z, 1.4 * big, [1, 0.8, 0.5], 0.16, 4, 8);
    fx.puff(c.x, cy, c.z, 0, 0.6, 0, 5 * big, [0.05, 0.05, 0.055], 0.5 * big, 2.5, 1.8, 0.7);
    g.gfx.flash(_v.set(c.x, cy, c.z), new THREE.Color(1, 0.6, 0.3), 120 * big, 0.25, 16 * big);
    g.audio.play(this.type === 'drone' ? 'drone_die' : big > 1 ? 'explosion' : 'explosion_small', { pos: { x: c.x, y: cy, z: c.z }, vol: 0.85, ref: 7 });
    if (this.flying || this.pos.y < 0.5) fx.decal({ x: c.x, y: 0, z: c.z, nx: 0, ny: 1, nz: 0 }, 3, 0.9 * big, 0.7);
    // break apart
    this.mat.emissive.setScalar(0); this.mat.userData.emiBoost.value = 0.12;
    for (const m of this.meshes) { if (m.userData.noDebris) { m.visible = false; continue; } const k = o.explosive || o.melee ? 9 : 5; fx.addDebris(m, new THREE.Vector3(dx * k + rand(-3, 3), rand(2, 6) + dy * 2, dz * k + rand(-3, 3)).multiplyScalar(big > 1 ? 1.3 : 1), rand(3.5, 5.5)); }
    this.sys.pendingMats.push({ mat: this.mat, t: 7 });
    g.gfx.scene.remove(this.group);
    if (this.onDie) this.onDie();
    g.onEnemyKilled(this, o);
  }
  remove() { if (!this.dead) { this.dead = true; this.game.gfx.scene.remove(this.group); this.mat.dispose(); } }
  common(dt) {
    this.t += dt; this.atkT -= dt; this.spawnT = Math.max(0, this.spawnT - dt);
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 8); this.mat.emissive.setScalar(this.flash * 0.9); }
    this.hurtShow -= dt; this.stagger = Math.max(0, this.stagger - dt);
    this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
    const s = 1 - this.spawnT * 2 * 0.25; if (this.spawnT > 0) this.group.scale.setScalar(s); else if (this.group.scale.x !== 1) this.group.scale.setScalar(1);
  }
  healthBar(add, cam, yOff, w = 0.9) {
    if (this.hurtShow <= 0 && !this.elite) return; const f = clamp(this.hp / this.maxHp, 0, 1);
    _v.setFromMatrixColumn(cam.matrixWorld, 0); const x = this.pos.x - _v.x * w / 2, y = this.pos.y + yOff, z = this.pos.z - _v.z * w / 2;
    add.push(x, y, z, _v.x * w, 0, _v.z * w, 0.09, 0, 14, 1, 0.25, 0.25, 0.25, 0.8);
    const c = this.elite ? [3, 0.3, 1.5] : [3, 0.5, 0.2]; add.push(x, y, z, _v.x * w * f, 0, _v.z * w * f, 0.07, 0, 14, 1, c[0], c[1], c[2], 1);
  }
}

class Trooper extends Enemy {
  build(g) { this.biped(g, 0.98, 0.46, 0.16, 0.66); this.h = 1.95; this.zones = [[0, 1.88, 0, 0.2, 2], [0, 1.45, 0, 0.36, 1], [0, 0.98, 0, 0.3, 1], [0, 0.45, 0, 0.28, 0.8]]; this.range = rand(11, 19); }
  update(dt) {
    const g = this.game, d = this.distToPlayer(); this.updateSee(dt, 1.7); this.stateT -= dt;
    let mx = 0, mz = 0, sp = this.def.speed * (this.elite ? 1.15 : 1);
    if (this.stagger > 0.12) sp *= 0.3;
    if (!this.see || d > this.range + 5) { this.flow(_f); mx = _f.x; mz = _f.z; if (this.see) this.face(dt, 5); else if (mx || mz) this.face(dt, 5, this.pos.x + mx * 4, this.pos.z + mz * 4); }
    else {
      this.face(dt, 7); if (this.stateT <= 0) { this.stateT = rand(0.8, 2.2); this.strafe = Math.random() < 0.25 ? 0 : randSign(); }
      const p = g.player.body, tx = (p.x - this.pos.x) / (d || 1), tz = (p.z - this.pos.z) / (d || 1), fw = d > this.range ? 0.7 : d < 6.5 ? -0.8 : 0;
      mx = tx * fw - tz * this.strafe * 0.7; mz = tz * fw + tx * this.strafe * 0.7; sp *= 0.62;
    }
    this.moveGround(dt, mx, mz, sp); this.animBiped(dt, 2.3); this.aimArms(dt, 1.6);
    if (this.see && d < 46 && this.spawnT <= 0) {
      if (this.burst <= 0 && this.atkT <= 0) { this.burst = this.elite ? 5 : 3 + ((Math.random() * 2) | 0); this.burstT = 0.25; }
      if (this.burst > 0) { this.burstT -= dt; if (this.burstT <= 0) { this.burstT = 0.13; this.burst--; const m = this.muzzleWorld(this.arms, 0.3, -0.22, -1.18); this.shootAt(m, 46, 9, this.elite ? [1, 0.2, 0.7] : [1, 0.35, 0.1], 0.035 + d * 0.0006); g.audio.play('enemy_shot', { pos: m, vol: 0.55, ref: 6, rv: 0.08 }); if (this.burst <= 0) this.atkT = rand(1.3, 2.4); } }
    }
    this.common(dt);
  }
}

class Lancer extends Enemy {
  build(g) { this.biped(g, 1.14, 0.52, 0.12, 0.7); this.h = 2.3; this.zones = [[0, 2.2, 0, 0.19, 2.2], [0, 1.7, 0, 0.3, 1], [0, 1.15, 0, 0.26, 1], [0, 0.5, 0, 0.24, 0.8]]; this.charge = -1; this.aim = new THREE.Vector3(); this.cool = rand(1, 3); }
  update(dt) {
    const g = this.game, p = g.player.body, d = this.distToPlayer(); this.updateSee(dt, 2.1);
    let mx = 0, mz = 0; this.cool -= dt;
    if (this.charge < 0) {
      if (!this.see || d > 52) { this.flow(_f); mx = _f.x; mz = _f.z; if (mx || mz) this.face(dt, 5, this.pos.x + mx * 4, this.pos.z + mz * 4); }
      else { this.face(dt, 6); if (d < 14) { mx = -(p.x - this.pos.x) / d; mz = -(p.z - this.pos.z) / d; } if (this.cool <= 0 && this.spawnT <= 0) { this.charge = 0; this.aim.set(p.x, p.y + 1.1, p.z); g.audio.play('lancer_charge', { pos: this.pos, vol: 0.8, ref: 14 }); } }
      this.moveGround(dt, mx, mz, this.def.speed);
    } else {
      this.moveGround(dt, 0, 0, 0); this.charge += dt; const T = this.elite ? 1.25 : 1.6;
      if (this.charge < T - 0.32) { const k = 1 - Math.exp(-5.5 * dt); this.aim.x += (p.x - this.aim.x) * k; this.aim.y += (p.y + (g.player.crouchT > 0.5 ? 0.7 : 1.1) - this.aim.y) * k; this.aim.z += (p.z - this.aim.z) * k; this.face(dt, 8); }
      const m = this.muzzleWorld(this.arms, 0.24, -0.17, -1.95), mx0 = m.x, my0 = m.y, mz0 = m.z;
      let dx = this.aim.x - mx0, dy = this.aim.y - my0, dz = this.aim.z - mz0; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const h = g.level.raycast(mx0, my0, mz0, dx, dy, dz, 120), len = h ? h.t : 120, kk = this.charge / T;
      g.fx.add.push(mx0, my0, mz0, dx * len, dy * len, dz * len, 0.02 + 0.05 * kk * kk, 0, 14, 1, 0.5 + 6 * kk, 0.6 + 2 * kk, 4 + 6 * kk, 0.35 + 0.65 * kk);
      g.fx.add.push(mx0, my0, mz0, 0, 0, 0, 0.3 + kk * 0.6, 0, 0, 0, 1, 2.5, 6, 1);
      if (!this.see && this.charge < T - 0.4 && this.t - this.lastSeen > 0.9) { this.charge = -1; this.cool = 1; }
      else if (this.charge >= T) {
        this.charge = -1; this.cool = rand(2.6, 3.8);
        g.fx.beam(mx0, my0, mz0, mx0 + dx * len, my0 + dy * len, mz0 + dz * len, [0.4, 0.7, 1], 0.14, 0.4, 12); g.audio.play('lancer_fire', { pos: { x: mx0, y: my0, z: mz0 }, vol: 1, ref: 14 });
        if (h) { g.fx.impact(h, dx, dy, dz, 2); }
        // hit test vs player capsule
        const px = p.x - mx0, pz = p.z - mz0, tt = clamp((px * dx + pz * dz) / Math.max(1e-6, dx * dx + dz * dz), 0, len), cx = mx0 + dx * tt, cy = my0 + dy * tt, cz = mz0 + dz * tt;
        if (Math.hypot(cx - p.x, cz - p.z) < p.r + 0.2 && cy > p.y - 0.1 && cy < p.y + p.h + 0.15) g.player.damage(58 * this.dmgMul, { x: mx0, y: my0, z: mz0 });
      }
    }
    this.animBiped(dt, 2.0, 0.5); this.aimArms(dt, 1.85); this.common(dt);
  }
}

class Heavy extends Enemy {
  build(g) {
    this.biped(g, 1.6, 0.72, 0.48, 1.5); this.h = 3.5; this.boundR = 2.4; this.navSize = 1;
    this.zones = [[0, 3.3, -0.05, 0.3, 2], [0, 2.6, 0, 0.85, 1], [0, 2.6, 0.72, 0.32, 2.6], [0, 1.6, 0, 0.6, 1], [0, 0.7, 0, 0.5, 0.8], [1.0, 1.9, -0.4, 0.4, 0.9], [-1.0, 1.9, -0.4, 0.4, 0.9]];
    this.maxShield = this.shield = this.def.shield * this.game.diff.hp; this.shieldT = 0;
    if (!shieldMat) shieldMat = new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, map: this.game.shieldTex, toneMapped: false, side: THREE.DoubleSide });
    this.sMat = shieldMat.clone(); const sg = this.sys.shieldGeo || (this.sys.shieldGeo = new THREE.SphereGeometry(2.3, 24, 16));
    this.bubble = new THREE.Mesh(sg, this.sMat); this.bubble.position.y = 1.9; this.bubble.scale.set(1, 1.05, 1); this.bubble.layers.set(1); this.bubble.userData.noDebris = true; this.bubble.renderOrder = 8; this.group.add(this.bubble); this.meshes.push(this.bubble);
    this.spin = 0; this.fireT = 0; this.salvo = rand(5, 8); this.firing = 0;
  }
  onHit(dmg, x, y, z, o) {
    if (this.shield > 0) {
      const k = o.explosive ? 2.2 : o.weapon === 'rail' ? 2 : o.melee ? 0.4 : 1; this.shield -= dmg * k; this.shieldT = 5; this.sFlash = 1;
      this.game.fx.shieldHit(x, y, z); this.game.audio.play('shield_hit', { pos: this.pos, vol: 0.5, throttle: 0.05 });
      if (this.shield <= 0) { this.shield = 0; this.stagger = 0.25; this.stunT = 1.6; this.game.audio.play('shield_break', { pos: this.pos, vol: 1, ref: 10 }); this.game.fx.ring(this.pos.x, 2, this.pos.z, 1, 7, [0.3, 0.7, 1], 0.4, 3); this.game.ui.toast('SHIELD DOWN', 'good', 1.2); }
      this.hurtShow = 3; return 'shield';
    }
    this.shieldT = 6; return dmg;
  }
  update(dt) {
    const g = this.game, d = this.distToPlayer(), p = g.player.body; this.updateSee(dt, 3.2);
    this.stunT = Math.max(0, (this.stunT || 0) - dt);
    if (this.shieldT > 0) this.shieldT -= dt; else if (this.shield < this.maxShield) { this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.35 * dt); }
    this.sFlash = Math.max(0, (this.sFlash || 0) - dt * 3); this.sMat.opacity = this.shield > 0 ? 0.05 + this.sFlash * 0.55 + (this.shield < this.maxShield ? 0.05 : 0) : 0; this.bubble.visible = this.shield > 0; this.bubble.rotation.y += dt * 0.3;
    let mx = 0, mz = 0;
    if (this.stunT <= 0) { if (!this.see || d > 15) { this.flow(_f); mx = _f.x; mz = _f.z; } if (this.see) this.face(dt, 2.2); else if (mx || mz) this.face(dt, 2.5, this.pos.x + mx * 4, this.pos.z + mz * 4); }
    this.moveGround(dt, mx, mz, this.def.speed, 4); this.animBiped(dt, 1.25, 0.42); this.aimArms(dt, 2.3);
    if (this.stunT <= 0 && this.spawnT <= 0) {
      this.firing -= dt;
      if (this.see && d < 55 && this.atkT <= 0) { this.firing = 2.4; this.atkT = 4.6; }
      if (this.firing > 0 && this.see) { this.fireT -= dt; if (this.fireT <= 0) { this.fireT = 0.085; const s = (this.side = -(this.side || 1)); const m = this.muzzleWorld(this.arms, s * 1.0, -0.75, -1.42); this.shootAt(m, 52, 6.5, [1, 0.5, 0.12], 0.06, 0.1, 0.7); g.audio.play('enemy_heavy', { pos: m, vol: 0.5, ref: 9, rv: 0.1, throttle: 0.05 }); } }
      this.salvo -= dt;
      if (this.salvo <= 0 && d < 60 && d > 7) { this.salvo = rand(8, 11); for (let i = 0; i < 4; i++) { const s = i % 2 ? 1 : -1; const m = this.muzzleWorld(this.torso, s * 0.6, 1.9, 0.25); g.projectiles.spawnMissile(m.x, m.y, m.z, p.x + p.vx * 1.2 + rand(-3.5, 3.5), p.z + p.vz * 1.2 + rand(-3.5, 3.5), 42 * this.dmgMul, 3.6, 2.0 + i * 0.22); } }
    }
    this.common(dt);
  }
  healthBar(add, cam, yOff) { super.healthBar(add, cam, 4.1, 1.8); if (this.shield > 0 && this.hurtShow > 0) { const w = 1.8, f = this.shield / this.maxShield; _v.setFromMatrixColumn(cam.matrixWorld, 0); add.push(this.pos.x - _v.x * w / 2, this.pos.y + 4.25, this.pos.z - _v.z * w / 2, _v.x * w * f, 0, _v.z * w * f, 0.07, 0, 14, 1, 0.4, 1.4, 3, 1); } }
}

class Crawler extends Enemy {
  build(g) { this.torso = this.mesh(g.torso, this.group, 0, 0.5, 0); this.lA = this.mesh(g.legsA, this.torso); this.lB = this.mesh(g.legsB, this.torso); this.h = 0.9; this.boundR = 1.0; this.zones = [[0, 0.52, 0, 0.5, 1], [0, 0.62, 0.34, 0.26, 2]]; this.leap = 0; this.air = false; this.cool = 0; }
  onDie() { const c = this.pos; this.game.projectiles.explode(c.x, c.y + 0.5, c.z, 3.4, this.hitPlayer ? 34 * this.dmgMul : 26, this.hitPlayer ? 'enemy' : 'player'); }
  update(dt) {
    const g = this.game, p = g.player.body, d = this.distToPlayer(); this.updateSee(dt, 0.7); this.cool -= dt;
    if (!this.air) {
      this.flow(_f); let mx = _f.x, mz = _f.z; if (this.see && d < 9) { mx = (p.x - this.pos.x) / d; mz = (p.z - this.pos.z) / d; }
      const wob = Math.sin(this.t * 3 + this.walk) * 0.5; const ox = -mz * wob, oz = mx * wob;
      this.moveGround(dt, mx + ox * 0.5, mz + oz * 0.5, this.def.speed * (this.stagger > 0.1 ? 0.4 : 1), 9);
      if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.5) this.face(dt, 10, this.pos.x + this.vel.x, this.pos.z + this.vel.z);
      if (this.see && d < 6.5 && this.cool <= 0 && this.spawnT <= 0) { this.air = true; const T = 0.55, dy = p.y + 0.9 - this.pos.y; this.vel.set((p.x + p.vx * 0.3 - this.pos.x) / T, dy / T + 0.5 * 18 * T, (p.z + p.vz * 0.3 - this.pos.z) / T); g.audio.play('crawler', { pos: this.pos, vol: 0.8, ref: 6 }); }
      const sp = Math.hypot(this.vel.x, this.vel.z); this.walk += sp * dt * 3.2;
      this.lA.rotation.y = Math.sin(this.walk) * 0.4; this.lB.rotation.y = -Math.sin(this.walk) * 0.4; this.lA.position.y = Math.max(0, Math.sin(this.walk)) * 0.08; this.lB.position.y = Math.max(0, -Math.sin(this.walk)) * 0.08;
      this.torso.position.y = 0.5 + Math.sin(this.walk * 2) * 0.02; this.torso.rotation.x = 0;
    } else {
      this.vel.y -= 18 * dt; this.pos.addScaledVector(this.vel, dt); this.torso.rotation.x = clamp(this.vel.y * 0.06, -0.6, 0.6);
      this.lA.rotation.y = 0.5; this.lB.rotation.y = -0.5;
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.25 && Math.abs(p.y + 0.9 - this.pos.y) < 1.4) { this.hitPlayer = true; this.die(0, 0, 0, {}); return; }
      if (this.pos.y <= 0 && this.vel.y < 0) { this.pos.y = 0; this.air = false; this.cool = 1.6; this.vel.y = 0; if (g.level.navBlocked(this.pos.x, this.pos.z, 1)) { this.hitPlayer = false; this.die(0, 0, 0, {}); return; } }
      if (g.level.raycast(this.pos.x, this.pos.y + 0.4, this.pos.z, this.vel.x, 0, this.vel.z, 0.02)) { this.vel.x *= -0.2; this.vel.z *= -0.2; }
    }
    this.mat.userData.emiBoost.value = 1 + (d < 8 ? 0.8 + 0.8 * Math.sin(this.t * 22) : 0.2 * Math.sin(this.t * 4));
    this.common(dt);
  }
}

class Drone extends Enemy {
  build(g) {
    this.torso = this.mesh(g.torso, this.group); if (!rotorMat) rotorMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const r = new THREE.Mesh(g.rotors, rotorMat); r.layers.set(1); r.userData.noDebris = true; this.group.add(r); this.meshes.push(r);
    this.flying = true; this.h = 0.5; this.boundR = 0.9; this.zones = [[0, 0, 0, 0.5, 1], [0, 0, -0.1, 0.2, 2]]; this.pos.y = 14; this.alt = rand(3.2, 5.5); this.orbit = rand(TAU); this.orbitDir = randSign(); this.orbitR = rand(8, 15); this.avoid = 0;
  }
  update(dt) {
    const g = this.game, p = g.player.body; this.updateSee(dt, 0); this.orbit += this.orbitDir * dt * 0.45;
    const tx = p.x + Math.cos(this.orbit) * this.orbitR, tz = p.z + Math.sin(this.orbit) * this.orbitR; let ty = p.y + this.alt + Math.sin(this.t * 1.3) * 0.5;
    this.avoid -= dt;
    if (this.avoid <= 0) { this.avoid = 0.25; const sp = Math.hypot(this.vel.x, this.vel.z); if (sp > 0.5) { const h = g.level.raycast(this.pos.x, this.pos.y - 0.2, this.pos.z, this.vel.x / sp, 0, this.vel.z / sp, 3.5); this.lift = h ? 1 : 0; if (h && Math.random() < 0.2) this.orbitDir *= -1; } }
    if (this.lift) ty = this.pos.y + 4;
    const H = g.level.half - 2; const cx = clamp(tx, -H, H), cz = clamp(tz, -H, H);
    let ax = (cx - this.pos.x), ay = (ty - this.pos.y) * 2.2, az = (cz - this.pos.z); const l = Math.hypot(ax, az) || 1, sp = this.def.speed * (this.elite ? 1.25 : 1);
    this.vel.x = damp(this.vel.x, ax / l * Math.min(sp, l * 1.5), 2.2, dt); this.vel.z = damp(this.vel.z, az / l * Math.min(sp, l * 1.5), 2.2, dt); this.vel.y = damp(this.vel.y, clamp(ay, -5, 6), 4, dt);
    this.pos.addScaledVector(this.vel, dt); if (this.pos.y < 1.4) { this.pos.y = 1.4; this.vel.y = 1; }
    this.face(dt, 5); this.group.rotation.z = clamp(-this.vel.x * 0.03, -0.4, 0.4); this.torso.rotation.x = clamp(Math.hypot(this.vel.x, this.vel.z) * -0.035, -0.35, 0);
    const d = this.distToPlayer();
    if (this.see && d < 40 && this.spawnT <= 0) {
      if (this.burst <= 0 && this.atkT <= 0) { this.burst = this.elite ? 4 : 2; this.burstT = 0.3; }
      if (this.burst > 0) { this.burstT -= dt; if (this.burstT <= 0) { this.burstT = 0.16; this.burst--; const m = this.muzzleWorld(this.torso, 0, -0.15, -0.55); this.shootAt(m, 40, 7, [1, 0.25, 0.1], 0.045); g.audio.play('enemy_shot', { pos: m, vol: 0.45, ref: 6, rate: 1.3, rv: 0.1 }); if (this.burst <= 0) this.atkT = rand(1.6, 3); } }
    }
    this.common(dt); this.group.rotation.z = clamp(-(this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) * 0.05, -0.45, 0.45);
  }
  healthBar(add, cam) { super.healthBar(add, cam, 0.6, 0.8); }
}

// two-bone IK helper: orients upper & lower segment groups (segments hang along -Y from their pivot)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _k = new THREE.Vector3(), _dn = new THREE.Vector3(0, -1, 0), _q = new THREE.Quaternion(), _pole = new THREE.Vector3();
function solveLeg(upper, lower, hip, foot, l1, l2, pole) {
  _a.subVectors(foot, hip); let d = _a.length(); const dc = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01); _a.multiplyScalar(1 / (d || 1));
  const ca = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  _pole.copy(pole).addScaledVector(_a, -pole.dot(_a)).normalize();
  _k.copy(hip).addScaledVector(_a, l1 * ca).addScaledVector(_pole, l1 * sa);
  upper.position.copy(hip); _b.subVectors(_k, hip).normalize(); upper.quaternion.setFromUnitVectors(_dn, _b);
  lower.position.copy(_k); _b.copy(hip).addScaledVector(_a, dc).sub(_k).normalize(); lower.quaternion.setFromUnitVectors(_dn, _b);
}

class Boss extends Enemy {
  build(g) {
    this.h = 9; this.boundR = 9; this.radius = 4.2; this.navSize = 1; this.bodyY = 6.2; this.bodyYNow = 6.2;
    this.torso = this.mesh(g.torso, this.group, 0, this.bodyY, 0);
    this.head = this.mesh(g.head, this.torso, 0, 2.2, -0.6);
    this.cores = [];
    for (const [x, y, z] of [[2.75, 0.2, -1.2], [-2.75, 0.2, -1.2], [2.75, 0.2, 1.6], [-2.75, 0.2, 1.6], [0, -1.15, 0.6], [0, 0.6, 3.2]]) { const m = this.mesh(g.core, this.torso, x, y, z); this.cores.push({ m, x, y, z, hp: this.maxHp * 0.085, alive: true }); }
    this.legs = [];
    for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const u = this.mesh(g.legU, this.group), l = this.mesh(g.legL, this.group);
      this.legs.push({ u, l, hx: sx * 2.6, hz: sz * 2.3, home: new THREE.Vector3(sx * 5.4, 0, sz * 4.4), foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), st: 1, pole: new THREE.Vector3(sx * 0.9, 1, sz * 0.25) });
    }
    this.legInit = false; this.phase = 1; this.stepIdx = 0; this.stompT = 5; this.cannonT = 3; this.missT = 9; this.laserT = -1; this.laserCool = 14; this.laserAng = 0; this.spawnCool = 16; this.headYaw = 0; this.roarT = 1.0;
    this.zones = [[0, 6.2, 0, 3.0, 0.35], [0, 6.2, -2.4, 2.2, 0.35], [0, 6.2, 2.4, 2.2, 0.35], [0, 8.9, -0.6, 1.3, 0.5]];
    this.yaw = Math.PI; this.spawnT = 0;
  }
  // custom ray test so cores are precise and armour is spongy
  customRay(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null; const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (let i = 0; i < this.cores.length; i++) {
      const k = this.cores[i]; if (!k.alive) continue;
      const wx = this.pos.x + k.x * c + k.z * s, wy = this.bodyYNow + k.y, wz = this.pos.z - k.x * s + k.z * c;
      const lx = wx - ox, ly = wy - oy, lz = wz - oz, tc = lx * dx + ly * dy + lz * dz; if (tc < 0) continue; const d2 = lx * lx + ly * ly + lz * lz - tc * tc, R = 0.85; if (d2 > R * R) continue;
      const t = tc - Math.sqrt(R * R - d2); if (t > 0 && t < maxT && (!best || t < best.t)) best = { enemy: this, t, mult: 3, zone: 100 + i };
    }
    return best;
  }
  onHit(dmg, x, y, z, o) {
    if (o.zone >= 100) {
      const k = this.cores[o.zone - 100]; if (k && k.alive) { k.hp -= dmg; if (k.hp <= 0) { k.alive = false; k.m.visible = false; const g = this.game; g.projectiles.explode(x, y, z, 4, 0, 'enemyOnly'); g.ui.toast('HEAT CORE DESTROYED', 'good', 1.6); g.audio.play('boss_roar', { pos: this.pos, vol: 0.8, ref: 30, rate: 1.3 }); this.stunT = 2.2; return this.maxHp * 0.11; } }
      return dmg;
    }
    if (o.explosive) return dmg * 0.6;
    return dmg; // armour multiplier already applied via zones (0.35)
  }
  update(dt) {
    const g = this.game, p = g.player.body, d = this.distToPlayer(), fx = g.fx;
    this.stunT = Math.max(0, (this.stunT || 0) - dt);
    const hpK = this.hp / this.maxHp; const ph = hpK < 0.33 ? 3 : hpK < 0.66 ? 2 : 1;
    if (ph !== this.phase) { this.phase = ph; g.audio.play('boss_roar', { pos: this.pos, vol: 1, ref: 40 }); g.ui.toast(ph === 2 ? 'COLOSSUS: MISSILE SYSTEMS ONLINE' : 'COLOSSUS: CORE OVERLOAD', 'warn', 2.5); g.player.shake = 1; this.laserCool = Math.min(this.laserCool, 3); }
    if (this.roarT > 0) { this.roarT -= dt; if (this.roarT <= 0) g.audio.play('boss_roar', { pos: this.pos, vol: 1, ref: 40 }); }
    // movement: stalk the player, keep ~18m
    let mx = 0, mz = 0; const sp = this.def.speed * (1 + (ph - 1) * 0.3) * (this.stunT > 0 ? 0 : 1) * (this.laserT >= 0 ? 0.25 : 1);
    if (d > 20) { mx = (p.x - this.pos.x) / d; mz = (p.z - this.pos.z) / d; } else if (d < 11) { mx = -(p.x - this.pos.x) / d * 0.6; mz = -(p.z - this.pos.z) / d * 0.6; }
    const R = g.level.half - 12, nd = Math.hypot(this.pos.x, this.pos.z); if (nd > R) { mx -= this.pos.x / nd; mz -= this.pos.z / nd; }
    this.vel.x = damp(this.vel.x, mx * sp, 1.5, dt); this.vel.z = damp(this.vel.z, mz * sp, 1.5, dt); this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.stunT <= 0) this.face(dt, 0.9 + ph * 0.25);
    // legs
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let moving = 0; for (const l of this.legs) if (l.st < 1) moving++;
    let bodyDip = 0;
    for (let i = 0; i < 4; i++) {
      const l = this.legs[i]; const hxw = this.pos.x + l.home.x * c + l.home.z * s + this.vel.x * 0.9, hzw = this.pos.z - l.home.x * s + l.home.z * c + this.vel.z * 0.9;
      if (!this.legInit) { l.foot.set(hxw, 0, hzw); }
      if (l.st >= 1) { const err = Math.hypot(l.foot.x - hxw, l.foot.z - hzw); if (err > 2.6 && moving < 2 && (this.stepIdx % 4 === i || err > 4.5)) { l.st = 0; l.from.copy(l.foot); l.to.set(hxw, 0, hzw); moving++; this.stepIdx++; } }
      else { l.st = Math.min(1, l.st + dt * 2.3); const k = l.st * l.st * (3 - 2 * l.st); l.foot.lerpVectors(l.from, l.to, k); l.foot.y = Math.sin(l.st * Math.PI) * 1.6;
        if (l.st >= 1) { l.foot.y = 0; fx.puff(l.foot.x, 0.2, l.foot.z, 0, 0.3, 0, 5, [fx.amb.r * 0.5, fx.amb.g * 0.5, fx.amb.b * 0.5], 0.9, 3, 1.3, 0.4); g.audio.play('stomp', { pos: l.foot, vol: 0.9, ref: 14 }); const pd = Math.hypot(p.x - l.foot.x, p.z - l.foot.z); g.player.shake = Math.min(1, g.player.shake + clamp(0.7 - pd / 40, 0, 0.7)); if (pd < 2.6 && p.y < 1) g.player.damage(40, l.foot); }
        bodyDip += Math.sin(l.st * Math.PI) * 0.12; }
      // to local space of group
      const fxl = l.foot.x - this.pos.x, fzl = l.foot.z - this.pos.z;
      _v.set(fxl * c - fzl * s, l.foot.y + 0.25, fxl * s + fzl * c); _v2.set(l.hx, this.bodyYNow, l.hz);
      solveLeg(l.u, l.l, _v2, _v, 3.6, 4.0, l.pole);
    }
    this.legInit = true;
    this.bodyYNow = this.bodyY + Math.sin(this.t * 1.1) * 0.15 - bodyDip - (this.stunT > 0 ? 0.8 * Math.min(1, this.stunT) : 0);
    this.torso.position.y = this.bodyYNow; this.torso.rotation.z = Math.sin(this.t * 0.8) * 0.02 + (this.vel.x * c - this.vel.z * s) * 0.02; this.torso.rotation.x = Math.sin(this.t * 0.6) * 0.015;
    // head tracks player
    const want = angleDelta(this.yaw, Math.atan2(this.pos.x - p.x, this.pos.z - p.z));
    if (this.laserT < 0) this.headYaw = damp(this.headYaw, clamp(want, -1.4, 1.4), 3, dt);
    this.head.rotation.y = this.headYaw; const hy = this.bodyYNow + 2.6; this.head.rotation.x = damp(this.head.rotation.x, clamp(Math.atan2(p.y + 1.2 - hy, d), -0.6, 0.3), 3, dt);
    // attacks
    if (this.stunT <= 0 && !g.player.dead) {
      this.cannonT -= dt;
      if (this.cannonT <= 0 && this.laserT < 0) {
        if (!this.volley) { this.volley = 3 + ph; this.volleyT = 0; }
        this.volleyT -= dt; if (this.volleyT <= 0) { this.volleyT = 0.28; this.volley--; const m = this.head.localToWorld(_v.set(0, 0.42, -3.95)); const mm = { x: m.x, y: m.y, z: m.z }; this.shootAt(mm, 44, 22, [1, 0.45, 0.1], 0.03, 0.3, 0.9); g.audio.play('enemy_heavy', { pos: mm, vol: 1, ref: 20, rate: 0.7 }); g.gfx.flash(m, new THREE.Color(1, 0.5, 0.2), 200, 0.12, 30);
          for (const sx of [-1, 1]) { const m2 = this.torso.localToWorld(_v.set(sx * 1.2, -1.15, -3.8)); this.shootAt({ x: m2.x, y: m2.y, z: m2.z }, 50, 8, [1, 0.3, 0.1], 0.08, 0.11, 0.6); }
          if (this.volley <= 0) { this.volley = 0; this.cannonT = rand(2.4, 3.6) - ph * 0.4; } }
      }
      if (ph >= 2) { this.missT -= dt; if (this.missT <= 0) { this.missT = rand(8, 11) - ph; const n = 5 + ph * 2; for (let i = 0; i < n; i++) { const sx = i % 2 ? 1 : -1; const m = this.torso.localToWorld(_v.set(sx * 1.5, 2.6, 1.6)); g.projectiles.spawnMissile(m.x, m.y, m.z, p.x + p.vx * 1.5 + rand(-9, 9), p.z + p.vz * 1.5 + rand(-9, 9), 48, 4.2, 2.2 + i * 0.16); } } }
      this.stompT -= dt;
      if (d < 12 && this.stompT <= 0) { this.stompT = 6; this.shock = 0; g.audio.play('stomp', { pos: this.pos, vol: 1, ref: 30, rate: 0.7 }); g.player.shake = 1; fx.puff(this.pos.x, 0.3, this.pos.z, 0, 0.4, 0, 14, [fx.amb.r * 0.5, fx.amb.g * 0.5, fx.amb.b * 0.5], 2, 9, 1.6, 0.5); }
      this.spawnCool -= dt; if (this.spawnCool <= 0 && g.enemies.alive() < 7) { this.spawnCool = 20 - ph * 3; g.director.spawnGroup([[ph >= 3 ? 'crawler' : 'drone', 3 + ph]], true); }
      if (ph >= 3) { this.laserCool -= dt; if (this.laserCool <= 0 && this.laserT < 0) { this.laserT = 0; this.laserCool = 16; this.laserDir = randSign(); this.laserAng = this.headYaw - this.laserDir * 1.2; g.audio.play('lancer_charge', { pos: this.pos, vol: 1, ref: 40, rate: 0.6 }); g.ui.toast('SWEEP BEAM — TAKE COVER', 'warn', 2); } }
    }
    // expanding shockwave ring (jump over it)
    if (this.shock !== undefined) { this.shock += dt * 16; const r = this.shock; fx.marker(this.pos.x, 0.08, this.pos.z, r * 2, 4, 1.6, 0.4, 12); fx.marker(this.pos.x, 0.09, this.pos.z, r * 2 - 1, 2, 0.6, 0.2, 5);
      if (!this.shockHit && Math.abs(d - r) < 1.0 && p.y < 0.5 && p.onGround) { this.shockHit = true; g.player.damage(30, this.pos); p.vy = 5; } if (r > 34) { this.shock = undefined; this.shockHit = false; } }
    // sweeping laser
    if (this.laserT >= 0) {
      this.laserT += dt; const warm = 1.6, dur = 4.2; const m = this.head.localToWorld(_v.set(0, 0.42, -3.95)), ox = m.x, oy = m.y, oz = m.z;
      if (this.laserT > warm) this.laserAng += this.laserDir * dt * 0.62; this.headYaw = damp(this.headYaw, clamp(this.laserAng, -1.5, 1.5), 6, dt);
      const ya = this.yaw + this.headYaw; let dx = -Math.sin(ya), dz = -Math.cos(ya), dy = -(oy - 1.0) / 26; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const h = g.level.raycast(ox, oy, oz, dx, dy, dz, 140), len = h ? h.t : 140, hot = this.laserT > warm;
      fx.add.push(ox, oy, oz, dx * len, dy * len, dz * len, hot ? 0.55 : 0.06, 0, 14, 1, hot ? 14 : 3, hot ? 4 : 1, hot ? 1 : 0.3, 1); if (hot) fx.add.push(ox, oy, oz, dx * len, dy * len, dz * len, 1.8, 0, 14, 1, 3, 0.8, 0.2, 0.6);
      fx.add.push(ox, oy, oz, 0, 0, 0, hot ? 3 : 1, 0, 0, 0, 8, 3, 1, 1);
      if (hot && h) { if (Math.random() < dt * 40) { fx.sparks(h.x, h.y, h.z, h.nx, h.ny + 0.5, h.nz, 5, [1, 0.6, 0.2], 8); fx.puff(h.x, h.y, h.z, h.nx, h.ny, h.nz, 1, [0.2, 0.2, 0.2], 0.4, 2, 1, 0.5); } fx.add.push(h.x, h.y, h.z, 0, 0, 0, 2.2, 0, 0, 0, 9, 3, 1, 1); if (Math.random() < dt * 8) fx.decal(h, 2, 0.5, 0.8); }
      if (hot) { const px = p.x - ox, py = p.y + 0.9 - oy, pz = p.z - oz, tt = clamp(px * dx + py * dy + pz * dz, 0, len), cx = ox + dx * tt - p.x, cy = oy + dy * tt - (p.y + 0.9), cz = oz + dz * tt - p.z; if (Math.hypot(cx, cz) < 0.75 && Math.abs(cy) < 1.1) g.player.damage(95 * dt, { x: ox, y: oy, z: oz }); g.audio.loop('loop_boss', 0.9, 2.2); }
      if (this.laserT > dur) { this.laserT = -1; }
    }
    g.audio.loop('loop_boss', this.laserT > 1.6 ? 0.9 : 0.35, this.laserT > 1.6 ? 2.2 : 1);
    // core glow pulse
    this.mat.userData.emiBoost.value = 0.9 + 0.25 * Math.sin(this.t * 3) + (ph - 1) * 0.35 + (this.laserT >= 0 ? 0.8 : 0);
    this.common(dt);
  }
  onDie() { const g = this.game; g.audio.loop('loop_boss', 0); for (let i = 0; i < 7; i++) setTimeout(() => { if (g.level) g.projectiles.explode(this.pos.x + rand(-4, 4), rand(1, 7), this.pos.z + rand(-4, 4), 6, 0, 'enemyOnly'); }, i * 260); }
  healthBar() { }
}

const CLASSES = { trooper: Trooper, lancer: Lancer, heavy: Heavy, crawler: Crawler, drone: Drone, boss: Boss };

export class Enemies {
  constructor(game) { this.game = game; this.list = []; this.pendingMats = []; this._hits = []; this.flowT = 0; this.boss = null; }
  makeMat() {
    const t = this.game.tex.panel;
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, aoMap: t.orm, roughness: 1, metalness: 1, vertexColors: true, emissive: 0x000000 });
    m.emissive.setRGB(0, 0, 0); return patch(m, { surf: true });
  }
  prewarm() { for (const t of ['trooper', 'trooperE', 'lancer', 'heavy', 'crawler', 'drone']) geos(t); }
  spawn(type, x, z, opts) { const e = new CLASSES[type](this, type, x, z, opts); this.list.push(e); if (type === 'boss') this.boss = e; return e; }
  alive() { let n = 0; for (const e of this.list) if (!e.dead) n++; return n; }
  clear() { for (const e of this.list) e.remove(); this.list.length = 0; for (const p of this.pendingMats) p.mat.dispose(); this.pendingMats.length = 0; this.boss = null; }

  raycastAll(ox, oy, oz, dx, dy, dz, maxT) {
    const out = this._hits; out.length = 0;
    for (const e of this.list) {
      if (e.dead) continue;
      const cx = e.pos.x - ox, cy = e.pos.y + (e.flying ? 0 : e.h * 0.5) - oy, cz = e.pos.z - oz, tc = cx * dx + cy * dy + cz * dz;
      if (tc < -e.boundR || tc > maxT + e.boundR) continue; const d2 = cx * cx + cy * cy + cz * cz - tc * tc; if (d2 > e.boundR * e.boundR * (e.flying ? 1 : 1) + e.h * e.h * 0.25) continue;
      let best = null;
      if (e.customRay) best = e.customRay(ox, oy, oz, dx, dy, dz, maxT);
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw); let bt = 1e9, bm = 0, bz = -1;
      for (let i = 0; i < e.zones.length; i++) {
        const z = e.zones[i], wx = e.pos.x + z[0] * c + z[2] * s - ox, wy = e.pos.y + z[1] - oy, wz = e.pos.z - z[0] * s + z[2] * c - oz;
        const t0 = wx * dx + wy * dy + wz * dz; if (t0 < 0) continue; const dd = wx * wx + wy * wy + wz * wz - t0 * t0, R = z[3]; if (dd > R * R) continue;
        const t = t0 - Math.sqrt(R * R - dd); if (t > maxT) continue; if (t < bt) bt = Math.max(0.01, t); if (z[4] > bm) { bm = z[4]; bz = i; }
      }
      if (bz >= 0 && (!best || bt < best.t - 0.8)) best = { enemy: e, t: bt, mult: bm, zone: bz };
      if (best) out.push(best);
    }
    out.sort((a, b) => a.t - b.t); return out;
  }

  update(dt, cam) {
    const g = this.game, p = g.player.body, L = g.level;
    this.flowT -= dt; if (this.flowT <= 0) { this.flowT = 0.3; L.updateFlow(0, p.x, p.z); L.updateFlow(1, p.x, p.z); }
    const list = this.list, add = g.fx.add; let drones = 0, near = 1e9;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]; if (e.dead) { list[i] = list[list.length - 1]; list.pop(); if (e === this.boss) this.boss = null; continue; }
      e.update(dt); if (e.dead) continue;
      e.healthBar(add, cam, e.h + 0.3);
      if (e.type === 'drone') { drones++; near = Math.min(near, Math.hypot(e.pos.x - p.x, e.pos.y - p.y, e.pos.z - p.z)); }
    }
    // separation (ground units)
    for (let i = 0; i < list.length; i++) { const a = list[i]; if (a.dead || a.type === 'boss') continue; for (let j = i + 1; j < list.length; j++) { const b = list[j]; if (b.dead || b.type === 'boss' || a.flying !== b.flying) continue; const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, R = a.radius + b.radius + 0.25, d2 = dx * dx + dz * dz; if (d2 < R * R && d2 > 1e-6) { const d = Math.sqrt(d2), k = (R - d) / d * 0.5 * Math.min(1, dt * 10); const ax = a.pos.x - dx * k, az = a.pos.z - dz * k, bx = b.pos.x + dx * k, bz = b.pos.z + dz * k; if (a.flying || !L.navBlocked(ax, az, a.navSize + 1)) { a.pos.x = ax; a.pos.z = az; } if (b.flying || !L.navBlocked(bx, bz, b.navSize + 1)) { b.pos.x = bx; b.pos.z = bz; } } } }
    g.audio.loop('loop_drone', drones ? clamp(1.1 - near / 30, 0.05, 0.6) : 0, 1 + clamp(1 - near / 20, 0, 0.3));
    for (let i = this.pendingMats.length - 1; i >= 0; i--) { const pm = this.pendingMats[i]; pm.t -= dt; if (pm.t <= 0) { pm.mat.dispose(); this.pendingMats.splice(i, 1); } }
  }
}
