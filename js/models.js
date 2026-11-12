// Procedural mesh builder (vertex colour + per-vertex surface params) and first-person weapon models
import * as THREE from './lib/three.min.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

export class Builder {
  constructor(tile = 0.4) { this.geos = []; this.tile = tile; }
  add(g, color, o = {}) {
    if (g.index) g = g.toNonIndexed();
    const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count, tile = 1 / this.tile;
    const uv = new Float32Array(n * 2), col = new Float32Array(n * 3), surf = new Float32Array(n * 3);
    const emi = o.emi || 0, metal = o.metal ?? 1, rough = o.rough ?? 1;
    for (let i = 0; i < n; i += 3) {
      const ax = Math.abs(nrm.getX(i) + nrm.getX(i + 1) + nrm.getX(i + 2)), ay = Math.abs(nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)), az = Math.abs(nrm.getZ(i) + nrm.getZ(i + 1) + nrm.getZ(i + 2));
      for (let k = 0; k < 3; k++) {
        const j = i + k, x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
        if (ay >= ax && ay >= az) { uv[j * 2] = x * tile; uv[j * 2 + 1] = z * tile; } else if (ax >= az) { uv[j * 2] = z * tile; uv[j * 2 + 1] = y * tile; } else { uv[j * 2] = x * tile; uv[j * 2 + 1] = y * tile; }
        col[j * 3] = color[0]; col[j * 3 + 1] = color[1]; col[j * 3 + 2] = color[2];
        surf[j * 3] = emi; surf[j * 3 + 1] = metal; surf[j * 3 + 2] = rough;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aSurf'].includes(k)) g.deleteAttribute(k);
    this.geos.push(g); return this;
  }
  _mat(x, y, z, o) { _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s); }
  box(w, h, d, x, y, z, color, o = {}) {
    const g = o.bevel ? new THREE.RoundedBoxGeometry(w, h, d, o.seg || 1, o.bevel) : new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(this._mat(x, y, z, o)); return this.add(g, color, o);
  }
  // cylinder; default axis Y. o.axis 'z' or 'x' to orient
  cyl(rt, rb, h, x, y, z, color, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 12, 1, !!o.open);
    if (o.axis === 'z') g.rotateX(Math.PI / 2); else if (o.axis === 'x') g.rotateZ(Math.PI / 2);
    g.applyMatrix4(this._mat(x, y, z, o)); return this.add(g, color, o);
  }
  sphere(r, x, y, z, color, o = {}) {
    const g = new THREE.SphereGeometry(r, o.seg || 12, o.seg2 || 8); if (o.sx) g.scale(o.sx, o.sy || 1, o.sz || 1);
    g.applyMatrix4(this._mat(x, y, z, o)); return this.add(g, color, o);
  }
  cone(r, h, x, y, z, color, o = {}) { const g = new THREE.ConeGeometry(r, h, o.seg || 10); if (o.axis === 'z') g.rotateX(-Math.PI / 2); g.applyMatrix4(this._mat(x, y, z, o)); return this.add(g, color, o); }
  torus(R, r, x, y, z, color, o = {}) { const g = new THREE.TorusGeometry(R, r, o.seg2 || 6, o.seg || 14); if (o.axis === 'y') g.rotateX(Math.PI / 2); g.applyMatrix4(this._mat(x, y, z, o)); return this.add(g, color, o); }
  build() { const g = this.geos.length === 1 ? this.geos[0] : THREE.mergeGeometries(this.geos, false); for (const x of this.geos) if (x !== g) x.dispose(); this.geos = []; g.computeBoundingSphere(); return g; }
  mesh(mat, shadow = true) { const m = new THREE.Mesh(this.build(), mat); m.castShadow = shadow; m.receiveShadow = true; return m; }
}

// ---- weapon palette (gunmetal texture: colour is F0 for metal parts, albedo for polymer) ----
const C = {
  steel: [0.30, 0.31, 0.33], dark: [0.10, 0.10, 0.11], black: [0.035, 0.035, 0.04], tan: [0.36, 0.29, 0.19], olive: [0.14, 0.16, 0.10], brass: [0.75, 0.56, 0.22],
  red: [0.5, 0.05, 0.04], wood: [0.22, 0.11, 0.05], silver: [0.62, 0.63, 0.65], glove: [0.05, 0.052, 0.055], sleeve: [0.11, 0.12, 0.10], cyan: [0.25, 0.85, 1.0], orange: [1.0, 0.45, 0.1],
};
const POLY = { metal: 0, rough: 1.5 }, MET = { metal: 1, rough: 0.9 }, WORN = { metal: 1, rough: 0.65 };

function rail(b, x, y, z0, z1, color = C.dark) { for (let z = z0; z <= z1 + 1e-4; z += 0.02) b.box(0.021, 0.007, 0.011, x, y, z, color, MET); b.box(0.016, 0.006, z1 - z0 + 0.02, x, y - 0.005, (z0 + z1) / 2, color, MET); }
function reflex(b, y, z, dot = [1.0, 0.1, 0.05]) {
  b.box(0.03, 0.012, 0.055, 0, y, z, C.black, MET);
  for (const s of [-1, 1]) b.box(0.004, 0.036, 0.012, s * 0.017, y + 0.024, z - 0.018, C.black, MET);
  b.box(0.038, 0.004, 0.012, 0, y + 0.043, z - 0.018, C.black, MET);
  b.box(0.0024, 0.0024, 0.001, 0, y + 0.024, z - 0.018, dot, { emi: 30, metal: 0 });
  return new THREE.Vector3(0, y + 0.024, z - 0.018);
}

function hand(b, x, y, z, o = {}) { // simple gloved fist + forearm; o.rx/ry/rz orientation of forearm
  const g = new Builder(0.5);
  g.box(0.085, 0.045, 0.1, 0, 0, 0, C.glove, { bevel: 0.018, ...POLY });
  g.box(0.08, 0.05, 0.04, 0, -0.012, -0.06, C.glove, { bevel: 0.016, rx: 0.5, ...POLY });        // curled fingers
  g.box(0.03, 0.03, 0.07, -0.05 * (o.left ? -1 : 1), 0.0, -0.03, C.glove, { bevel: 0.012, ry: 0.4 * (o.left ? -1 : 1), ...POLY }); // thumb
  g.box(0.09, 0.016, 0.03, 0, 0.026, 0.01, [0.02, 0.02, 0.022], { bevel: 0.006, ...POLY });       // knuckle guard
  g.cyl(0.036, 0.046, 0.34, 0, -0.005, 0.22, C.sleeve, { axis: 'z', seg: 10, ...POLY, rough: 1.6 });
  g.cyl(0.04, 0.04, 0.03, 0, -0.005, 0.06, [0.03, 0.03, 0.03], { axis: 'z', seg: 10, ...POLY });
  const geo = g.build(); geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  return geo;
}

// Returns { group, parts:{mag,bolt,pump,lhand,rhand}, muzzle, sight, eject, hip, emissive }
export function buildWeapon(id, mat) {
  const group = new THREE.Group(); const parts = {}; let muzzle, sight, eject = new THREE.Vector3(0.035, 0.03, -0.02), hip = new THREE.Vector3(0.2, -0.2, -0.5);
  const body = new Builder(), mag = new Builder(), bolt = new Builder();
  const mk = (b, name, shadow = false) => { const m = b.mesh(mat, shadow); m.castShadow = false; m.frustumCulled = false; parts[name] = m; group.add(m); return m; };
  let lh = [0, -0.02, -0.3, { left: true, rx: 0.3, ry: -0.6, rz: 1.2 }], rh = [0.0, -0.105, 0.09, { rx: 0.4, ry: 0.3, rz: -1.35 }];

  if (id === 'rifle') {
    body.box(0.05, 0.062, 0.27, 0, 0.02, -0.02, C.dark, { bevel: 0.006, ...MET });
    body.box(0.044, 0.05, 0.19, 0, -0.03, 0.0, C.black, { bevel: 0.005, ...MET });
    body.box(0.052, 0.058, 0.3, 0, 0.018, -0.305, C.tan, { bevel: 0.008, ...POLY });
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) body.box(0.004, 0.012, 0.045, s * 0.0255, 0.02, -0.2 - k * 0.062, C.black, POLY);
    rail(body, 0, 0.056, -0.44, 0.1);
    body.cyl(0.0105, 0.0105, 0.24, 0, 0.018, -0.55, C.steel, { axis: 'z', ...WORN });
    body.cyl(0.017, 0.017, 0.07, 0, 0.018, -0.69, C.dark, { axis: 'z', ...MET });
    for (let k = 0; k < 3; k++) body.box(0.04, 0.006, 0.008, 0, 0.018, -0.67 - k * 0.018, C.black, MET);
    body.box(0.022, 0.03, 0.03, 0, 0.03, -0.47, C.dark, MET);
    body.cyl(0.016, 0.016, 0.2, 0, 0.012, 0.21, C.dark, { axis: 'z', ...MET });
    body.box(0.04, 0.105, 0.13, 0, -0.005, 0.31, C.tan, { bevel: 0.012, ...POLY });
    body.box(0.042, 0.115, 0.018, 0, -0.005, 0.382, C.black, { bevel: 0.006, ...POLY });
    body.box(0.034, 0.1, 0.045, 0, -0.095, 0.075, C.black, { bevel: 0.01, rx: 0.32, ...POLY });
    body.box(0.008, 0.006, 0.07, 0, -0.068, 0.01, C.black, MET); body.box(0.008, 0.028, 0.006, 0, -0.056, -0.025, C.black, MET); body.box(0.006, 0.022, 0.008, 0, -0.052, 0.012, C.steel, { rx: 0.3, ...WORN });
    body.box(0.003, 0.02, 0.055, 0.0255, 0.022, -0.02, C.black, MET);
    body.cyl(0.016, 0.014, 0.085, 0, -0.058, -0.3, C.black, { ...POLY });
    body.cyl(0.012, 0.012, 0.07, 0.036, 0.02, -0.36, C.dark, { axis: 'z', ...MET }); body.cyl(0.013, 0.013, 0.004, 0.036, 0.02, -0.396, [1, 1, 1], { axis: 'z', emi: 0.6, metal: 0 });
    sight = reflex(body, 0.067, 0.02);
    mag.box(0.028, 0.1, 0.058, 0, -0.1, -0.075, C.dark, { bevel: 0.005, rx: -0.1, ...MET }); mag.box(0.028, 0.09, 0.056, 0, -0.185, -0.092, C.dark, { bevel: 0.005, rx: -0.26, ...MET });
    mag.box(0.03, 0.012, 0.06, 0, -0.232, -0.105, C.black, { rx: -0.26, ...POLY });
    bolt.box(0.012, 0.014, 0.05, 0.03, 0.03, 0.02, C.steel, WORN); bolt.cyl(0.006, 0.006, 0.02, 0.042, 0.03, 0.02, C.steel, { axis: 'x', ...WORN });
    muzzle = new THREE.Vector3(0, 0.018, -0.74); hip.set(0.19, -0.185, -0.42);
  } else if (id === 'pistol') {
    body.box(0.027, 0.024, 0.15, 0, -0.008, -0.03, C.black, { bevel: 0.005, ...POLY });
    body.box(0.03, 0.1, 0.048, 0, -0.07, 0.03, C.black, { bevel: 0.01, rx: 0.2, ...POLY });
    body.box(0.031, 0.06, 0.03, 0, -0.07, 0.034, C.dark, { bevel: 0.006, rx: 0.2, ...POLY });
    body.box(0.007, 0.005, 0.055, 0, -0.045, -0.02, C.black, POLY); body.box(0.007, 0.028, 0.005, 0, -0.033, -0.047, C.black, POLY); body.box(0.005, 0.02, 0.007, 0, -0.03, -0.01, C.steel, { rx: 0.3, ...WORN });
    body.box(0.02, 0.012, 0.04, 0, -0.024, -0.085, C.black, POLY);
    body.cyl(0.0065, 0.0065, 0.03, 0, 0.018, -0.118, C.steel, { axis: 'z', ...WORN });
    bolt.box(0.029, 0.03, 0.19, 0, 0.02, -0.03, C.dark, { bevel: 0.005, ...MET });
    for (let k = 0; k < 6; k++) bolt.box(0.031, 0.02, 0.003, 0, 0.02, 0.03 + k * 0.007, C.black, MET);
    bolt.box(0.004, 0.008, 0.004, 0, 0.039, -0.115, C.black, MET); bolt.box(0.002, 0.002, 0.001, 0, 0.041, -0.1125, [0.3, 1, 0.4], { emi: 12, metal: 0 });
    for (const s of [-1, 1]) { bolt.box(0.006, 0.008, 0.006, s * 0.008, 0.039, 0.058, C.black, MET); bolt.box(0.002, 0.002, 0.001, s * 0.008, 0.041, 0.0612, [0.3, 1, 0.4], { emi: 12, metal: 0 }); }
    bolt.box(0.003, 0.012, 0.03, 0.0146, 0.022, -0.03, C.black, MET);
    mag.box(0.022, 0.1, 0.034, 0, -0.075, 0.032, C.steel, { rx: 0.2, ...WORN }); mag.box(0.03, 0.012, 0.046, 0, -0.127, 0.043, C.black, { rx: 0.2, ...POLY });
    sight = new THREE.Vector3(0, 0.0445, 0.06); muzzle = new THREE.Vector3(0, 0.018, -0.14); eject.set(0.02, 0.03, -0.03); hip.set(0.17, -0.16, -0.42);
    rh = [0, -0.075, 0.045, { rx: 0.4, ry: 0.3, rz: -1.35 }]; lh = [-0.03, -0.085, 0.03, { left: true, rx: 0.35, ry: -0.5, rz: 1.25 }];
  } else if (id === 'smg') {
    body.box(0.046, 0.066, 0.3, 0, 0.012, -0.03, C.dark, { bevel: 0.008, ...MET });
    body.box(0.04, 0.04, 0.14, 0, 0.012, -0.24, C.black, { bevel: 0.006, ...MET });
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) body.cyl(0.007, 0.007, 0.004, s * 0.02, 0.016, -0.195 - k * 0.03, C.black, { axis: 'x', seg: 8, ...POLY });
    body.cyl(0.022, 0.022, 0.2, 0, 0.012, -0.4, C.black, { axis: 'z', seg: 14, ...MET }); body.cyl(0.023, 0.023, 0.012, 0, 0.012, -0.33, C.steel, { axis: 'z', seg: 14, ...WORN });
    rail(body, 0, 0.05, -0.16, 0.1);
    body.box(0.034, 0.095, 0.045, 0, -0.07, 0.08, C.black, { bevel: 0.01, rx: 0.28, ...POLY });
    body.box(0.03, 0.04, 0.05, 0, -0.04, -0.075, C.black, { bevel: 0.005, ...MET });
    body.box(0.008, 0.005, 0.07, 0, -0.045, 0.01, C.black, MET); body.box(0.005, 0.02, 0.007, 0, -0.033, 0.03, C.steel, { rx: 0.3, ...WORN });
    for (const s of [-1, 1]) { body.box(0.006, 0.01, 0.22, s * 0.02, 0.03, 0.23, C.dark, MET); } body.box(0.05, 0.09, 0.014, 0, 0.0, 0.345, C.black, { bevel: 0.005, ...POLY });
    body.cyl(0.013, 0.012, 0.07, 0, -0.045, -0.2, C.black, POLY);
    sight = reflex(body, 0.06, 0.03, [0.2, 1.0, 0.35]);
    mag.box(0.024, 0.2, 0.038, 0, -0.15, -0.075, C.dark, { bevel: 0.004, rx: -0.04, ...MET }); mag.box(0.026, 0.01, 0.04, 0, -0.252, -0.079, C.black, POLY);
    bolt.cyl(0.007, 0.007, 0.022, -0.034, 0.03, -0.06, C.steel, { axis: 'x', ...WORN }); bolt.box(0.002, 0.016, 0.05, 0.0235, 0.02, -0.03, C.black, MET);
    muzzle = new THREE.Vector3(0, 0.012, -0.51); hip.set(0.18, -0.175, -0.4); lh = [0, -0.05, -0.2, { left: true, rx: 0.3, ry: -0.6, rz: 1.2 }]; rh = [0, -0.08, 0.095, { rx: 0.4, ry: 0.3, rz: -1.35 }];
  } else if (id === 'shotgun') {
    body.box(0.046, 0.07, 0.24, 0, 0.005, 0.0, C.dark, { bevel: 0.008, ...MET });
    body.cyl(0.0135, 0.0135, 0.56, 0, 0.022, -0.4, C.steel, { axis: 'z', ...WORN }); body.cyl(0.0125, 0.0125, 0.44, 0, -0.012, -0.34, C.dark, { axis: 'z', ...MET });
    body.box(0.02, 0.05, 0.016, 0, 0.005, -0.5, C.dark, MET); body.cyl(0.014, 0.014, 0.015, 0, -0.012, -0.565, C.steel, { axis: 'z', ...WORN });
    body.sphere(0.004, 0, 0.04, -0.665, C.brass, { metal: 1, rough: 0.5 });
    body.box(0.04, 0.062, 0.1, 0, -0.012, 0.16, C.wood, { bevel: 0.012, rx: 0.12, ...POLY, rough: 1.1 }); body.box(0.038, 0.09, 0.2, 0, -0.03, 0.3, C.wood, { bevel: 0.014, rx: 0.1, ...POLY, rough: 1.1 });
    body.box(0.04, 0.1, 0.02, 0, -0.04, 0.405, C.black, { bevel: 0.006, rx: 0.1, ...POLY });
    body.box(0.034, 0.09, 0.042, 0, -0.07, 0.1, C.wood, { bevel: 0.01, rx: 0.45, ...POLY, rough: 1.1 });
    body.box(0.008, 0.005, 0.065, 0, -0.04, 0.03, C.black, MET); body.box(0.005, 0.02, 0.007, 0, -0.028, 0.05, C.steel, { rx: 0.3, ...WORN });
    body.box(0.003, 0.022, 0.06, 0.0235, 0.012, -0.02, C.black, MET);
    for (let k = 0; k < 4; k++) { body.cyl(0.0085, 0.0085, 0.05, -0.031, 0.012 - 0.0, -0.07 + k * 0.03, C.red, { ...POLY, rough: 0.8, rz: 0 }); body.cyl(0.009, 0.009, 0.012, -0.031, -0.014, -0.07 + k * 0.03, C.brass, { metal: 1, rough: 0.5 }); }
    body.box(0.006, 0.03, 0.13, -0.025, 0.004, -0.025, C.black, POLY);
    bolt.box(0.048, 0.046, 0.15, 0, -0.012, -0.3, C.wood, { bevel: 0.012, ...POLY, rough: 1.1 }); for (let k = 0; k < 6; k++) bolt.box(0.05, 0.03, 0.006, 0, -0.012, -0.36 + k * 0.024, [0.12, 0.06, 0.03], POLY);
    sight = new THREE.Vector3(0, 0.046, 0.05); muzzle = new THREE.Vector3(0, 0.022, -0.69); eject.set(0.035, 0.02, -0.02); hip.set(0.19, -0.18, -0.4);
    lh = [0, -0.04, -0.3, { left: true, rx: 0.3, ry: -0.6, rz: 1.2 }]; rh = [0, -0.085, 0.115, { rx: 0.45, ry: 0.3, rz: -1.35 }]; parts.pumpHand = true;
  } else if (id === 'marksman') {
    body.box(0.05, 0.066, 0.3, 0, 0.02, -0.02, C.dark, { bevel: 0.006, ...MET });
    body.box(0.044, 0.05, 0.2, 0, -0.03, 0.0, C.black, { bevel: 0.005, ...MET });
    body.box(0.05, 0.05, 0.4, 0, 0.018, -0.37, C.olive, { bevel: 0.01, ...POLY });
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) body.box(0.004, 0.01, 0.04, s * 0.0245, 0.022, -0.22 - k * 0.058, C.black, POLY);
    rail(body, 0, 0.058, -0.5, 0.1);
    body.cyl(0.012, 0.012, 0.34, 0, 0.018, -0.72, C.steel, { axis: 'z', ...WORN });
    body.box(0.05, 0.03, 0.08, 0, 0.018, -0.92, C.dark, { bevel: 0.006, ...MET }); for (let k = 0; k < 3; k++) body.box(0.054, 0.012, 0.012, 0, 0.018, -0.895 - k * 0.022, C.black, MET);
    body.cyl(0.017, 0.017, 0.16, 0, 0.012, 0.2, C.dark, { axis: 'z', ...MET });
    body.box(0.04, 0.12, 0.16, 0, -0.01, 0.33, C.olive, { bevel: 0.012, ...POLY }); body.box(0.036, 0.03, 0.12, 0, 0.065, 0.31, C.black, { bevel: 0.01, ...POLY }); body.box(0.042, 0.13, 0.018, 0, -0.01, 0.415, C.black, { bevel: 0.006, ...POLY });
    body.box(0.034, 0.1, 0.045, 0, -0.095, 0.075, C.black, { bevel: 0.01, rx: 0.3, ...POLY });
    body.box(0.008, 0.006, 0.07, 0, -0.068, 0.01, C.black, MET); body.box(0.006, 0.022, 0.008, 0, -0.052, 0.012, C.steel, { rx: 0.3, ...WORN });
    for (const s of [-1, 1]) body.cyl(0.006, 0.006, 0.24, s * 0.018, -0.02, -0.44, C.black, { axis: 'z', ...MET });
    // scope
    body.cyl(0.02, 0.02, 0.2, 0, 0.105, -0.03, C.black, { axis: 'z', seg: 16, ...MET }); body.cyl(0.03, 0.024, 0.07, 0, 0.105, -0.16, C.black, { axis: 'z', seg: 16, ...MET }); body.cyl(0.026, 0.022, 0.05, 0, 0.105, 0.09, C.black, { axis: 'z', seg: 16, ...MET });
    body.cyl(0.027, 0.027, 0.003, 0, 0.105, -0.196, [0.2, 0.35, 0.8], { axis: 'z', seg: 16, metal: 1, rough: 0.1 });
    body.cyl(0.012, 0.012, 0.03, 0, 0.133, -0.03, C.dark, { seg: 10, ...MET }); body.cyl(0.012, 0.012, 0.03, 0.028, 0.105, -0.03, C.dark, { axis: 'x', seg: 10, ...MET });
    for (const z of [-0.09, 0.03]) body.box(0.03, 0.045, 0.018, 0, 0.085, z, C.dark, { bevel: 0.004, ...MET });
    mag.box(0.03, 0.1, 0.075, 0, -0.1, -0.07, C.dark, { bevel: 0.005, rx: -0.06, ...MET }); mag.box(0.032, 0.012, 0.078, 0, -0.152, -0.075, C.black, POLY);
    bolt.box(0.012, 0.014, 0.05, 0.03, 0.03, 0.02, C.steel, WORN); bolt.cyl(0.007, 0.007, 0.03, 0.045, 0.026, 0.02, C.steel, { axis: 'x', ...WORN }); bolt.sphere(0.01, 0.062, 0.024, 0.02, C.black, POLY);
    sight = new THREE.Vector3(0, 0.105, 0.1); muzzle = new THREE.Vector3(0, 0.018, -0.97); hip.set(0.19, -0.2, -0.38); lh = [0, -0.025, -0.36, { left: true, rx: 0.3, ry: -0.6, rz: 1.2 }];
  } else if (id === 'launcher') {
    body.cyl(0.036, 0.036, 0.3, 0, 0.02, -0.33, C.dark, { axis: 'z', seg: 16, ...MET }); body.cyl(0.04, 0.04, 0.03, 0, 0.02, -0.47, C.steel, { axis: 'z', seg: 16, ...WORN }); body.cyl(0.03, 0.03, 0.005, 0, 0.02, -0.486, C.black, { axis: 'z', seg: 16, ...POLY });
    body.box(0.05, 0.08, 0.12, 0, 0.0, 0.03, C.dark, { bevel: 0.01, ...MET });
    body.box(0.03, 0.03, 0.2, 0, 0.07, -0.08, C.dark, { bevel: 0.006, ...MET }); body.box(0.03, 0.03, 0.22, 0, -0.045, -0.2, C.dark, { bevel: 0.006, ...MET });
    body.cyl(0.016, 0.014, 0.09, 0, -0.1, -0.26, C.black, POLY);
    body.box(0.034, 0.1, 0.046, 0, -0.085, 0.07, C.black, { bevel: 0.01, rx: 0.3, ...POLY });
    body.cyl(0.015, 0.015, 0.2, 0, 0.01, 0.19, C.dark, { axis: 'z', ...MET }); body.box(0.04, 0.11, 0.1, 0, -0.005, 0.32, C.olive, { bevel: 0.012, ...POLY }); body.box(0.042, 0.12, 0.018, 0, -0.005, 0.378, C.black, { bevel: 0.006, ...POLY });
    body.box(0.03, 0.05, 0.004, 0, 0.11, -0.12, C.black, MET); body.box(0.004, 0.012, 0.004, 0, 0.126, -0.12, [1, 0.5, 0.1], { emi: 6, metal: 0 });
    body.box(0.008, 0.005, 0.07, 0, -0.05, 0.01, C.black, MET);
    mag.cyl(0.062, 0.062, 0.11, 0, 0.012, -0.1, C.olive, { axis: 'z', seg: 18, ...POLY, rough: 1 });
    for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; mag.cyl(0.017, 0.017, 0.006, Math.cos(a) * 0.038, 0.012 + Math.sin(a) * 0.038, -0.157, C.brass, { axis: 'z', seg: 10, metal: 1, rough: 0.5 }); mag.box(0.01, 0.01, 0.08, Math.cos(a + 0.52) * 0.061, 0.012 + Math.sin(a + 0.52) * 0.061, -0.1, C.black, { rz: a + 0.52, ...POLY }); }
    sight = new THREE.Vector3(0, 0.128, -0.1); muzzle = new THREE.Vector3(0, 0.02, -0.5); hip.set(0.2, -0.2, -0.42); lh = [0, -0.085, -0.25, { left: true, rx: 0.3, ry: -0.6, rz: 1.2 }];
  } else if (id === 'rail') {
    body.box(0.05, 0.085, 0.3, 0, 0.012, 0.0, C.dark, { bevel: 0.01, ...MET });
    for (const s of [-1, 1]) body.box(0.016, 0.026, 0.62, 0, 0.012 + s * 0.033, -0.44, C.steel, { bevel: 0.004, ...WORN });
    for (let k = 0; k < 7; k++) { body.box(0.03, 0.094, 0.012, 0, 0.012, -0.2 - k * 0.08, C.dark, { bevel: 0.003, ...MET }); body.torus(0.016, 0.004, 0, 0.012, -0.24 - k * 0.08, C.cyan, { emi: 9, metal: 0, seg: 12 }); }
    body.cyl(0.006, 0.006, 0.58, 0, 0.012, -0.45, C.cyan, { axis: 'z', seg: 8, emi: 5, metal: 0 });
    for (const s of [-1, 1]) { body.box(0.004, 0.012, 0.2, s * 0.026, 0.03, 0.0, C.cyan, { emi: 7, metal: 0 }); for (let k = 0; k < 5; k++) body.box(0.01, 0.06, 0.006, s * 0.03, 0.0, 0.07 + k * 0.014, C.steel, WORN); }
    body.box(0.06, 0.06, 0.1, 0, 0.012, 0.17, C.black, { bevel: 0.012, ...POLY }); body.cyl(0.016, 0.016, 0.14, 0, 0.0, 0.26, C.dark, { axis: 'z', ...MET });
    body.box(0.04, 0.12, 0.1, 0, -0.01, 0.36, C.black, { bevel: 0.014, ...POLY });
    body.box(0.034, 0.1, 0.046, 0, -0.095, 0.07, C.black, { bevel: 0.01, rx: 0.3, ...POLY });
    body.box(0.03, 0.04, 0.2, 0, -0.05, -0.2, C.black, { bevel: 0.008, ...POLY }); body.cyl(0.015, 0.014, 0.08, 0, -0.1, -0.24, C.black, POLY);
    rail(body, 0, 0.062, -0.1, 0.1);
    sight = reflex(body, 0.073, 0.02, [0.2, 0.9, 1.0]);
    mag.box(0.04, 0.07, 0.09, 0, -0.07, -0.02, C.dark, { bevel: 0.008, ...MET }); mag.box(0.042, 0.016, 0.07, 0, -0.065, -0.02, C.cyan, { emi: 6, metal: 0 }); mag.box(0.03, 0.01, 0.08, 0, -0.108, -0.02, C.black, POLY);
    muzzle = new THREE.Vector3(0, 0.012, -0.76); hip.set(0.2, -0.2, -0.4); lh = [0, -0.09, -0.24, { left: true, rx: 0.3, ry: -0.6, rz: 1.2 }];
  }
  mk(body, 'body'); if (mag.geos.length) mk(mag, 'mag'); if (bolt.geos.length) mk(bolt, 'bolt');
  const mkHand = (spec, name) => { const m = new THREE.Mesh(hand(null, spec[0], spec[1], spec[2], spec[3]), mat); m.frustumCulled = false; m.receiveShadow = true; parts[name] = m; group.add(m); };
  mkHand(rh, 'rhand'); mkHand(lh, 'lhand');
  return { group, parts, muzzle, sight, eject, hip };
}
