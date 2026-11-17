// Procedural level kit: merged static geometry, colliders, nav flow-fields, lamps
import * as THREE from './lib/three.min.js';
import { TEX_TILE } from './textures.js';
import { RNG, clamp, TAU } from './util.js';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const PAL = {
  white: lin(0xd8d6cf), gray: lin(0x7b8087), dark: lin(0x33373c), black: lin(0x15171a), olive: lin(0x5a6144), tan: lin(0xa89572), navy: lin(0x254468),
  red: lin(0x9a3524), orange: lin(0xc9601f), yellow: lin(0xd0a11c), teal: lin(0x2e6a5c), blue: lin(0x2d5f93), cream: lin(0xcfc6ad), green: lin(0x3f6b3a), steel: lin(0x9aa0a8),
  conc: [1, 1, 1], concDark: lin(0x8c8a86), sand: lin(0xd8c9a8),
};
const CONTAINER_COLS = ['red', 'navy', 'teal', 'yellow', 'gray', 'orange', 'white', 'blue'];
const LABELS = ['KESTREL-07', 'SECTOR A', 'SECTOR B', 'SECTOR C', 'DANGER', 'HIGH VOLTAGE', 'AUTHORIZED ONLY', '04', '07', '12', '19', 'VANTA', 'NO ENTRY', 'FUEL', 'COOLANT', 'LOADING'];

let labelTex = null;
function getLabelTex() {
  if (labelTex) return labelTex;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  LABELS.forEach((t, i) => {
    const x = (i % 2) * 512 + 256, y = ((i / 2) | 0) * 128 + 66;
    let size = 96; g.font = `900 ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    while (g.measureText(t).width > 470 && size > 20) { size -= 4; g.font = `900 ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`; }
    g.fillText(t, x, y);
  });
  // stencil wear
  let s = 4242; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.7})`; const r = 1 + rnd() * rnd() * 9; g.beginPath(); g.ellipse(rnd() * 1024, rnd() * 1024, r, r * (0.3 + rnd()), rnd() * 3, 0, TAU); g.fill(); }
  for (let i = 0; i < 16; i++) { const y = ((i / 2) | 0) * 128, x = (i % 2) * 512; g.fillStyle = 'rgba(0,0,0,1)'; for (let k = 1; k < 5; k++) g.fillRect(x + k * 102 - 3 + rnd() * 20, y, 5, 128); }
  labelTex = new THREE.CanvasTexture(c); labelTex.colorSpace = THREE.SRGBColorSpace; labelTex.anisotropy = 8;
  return labelTex;
}

export class Level {
  constructor(game, def) {
    this.game = game; this.gfx = game.gfx; this.M = game.M; this.def = def;
    this.rng = new RNG(def.seed || 1);
    this.half = def.size || 54;
    this.group = new THREE.Group(); this.group.name = 'level';
    this.buckets = new Map();
    this.colliders = [];
    this.props = [];      // dynamic destructibles (barrels)
    this.lamps = [];      // {x,y,z,color}
    this.slots = [];      // free objective slots {x,z}
    this.spawns = [];     // ground spawn points
    this.anim = [];       // per-frame animated bits
    this.lights = [];
    this.sky = this.gfx.sky0;
    this.lampK = this.sky.lamps;
    this.start = { x: 0, z: this.half - 7, yaw: 0 };
    this.extraMats = [];
    this._makeAuxMats();
    if (def.theme === 'core') this._buildCore(); else this._buildGrid();
    this._buildSurround();
    this._finalize();
  }

  _makeAuxMats() {
    const g = this.game;
    this.labelMat = new THREE.MeshStandardMaterial({ map: getLabelTex(), transparent: true, vertexColors: true, roughness: 0.7, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.paintMat = new THREE.MeshStandardMaterial({ map: g.paintTex, transparent: true, vertexColors: true, roughness: 0.75, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.85 });
    this.poolMat = new THREE.MeshBasicMaterial({ map: g.poolTex, transparent: true, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false });
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uK: { value: 1 } },
      vertexShader: `attribute vec3 color; varying vec3 vC; varying vec2 vUv2; varying vec3 vN; varying vec3 vV; void main(){ vC=color; vUv2=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying vec2 vUv2; varying vec3 vN; varying vec3 vV; uniform float uK; void main(){ float f=abs(dot(normalize(vN),normalize(vV))); f=pow(f,2.2); float a=pow(vUv2.y,1.6)*f*uK; gl_FragColor=vec4(vC*a,1.); }`,
    });
    this.extraMats.push(this.labelMat, this.paintMat, this.poolMat, this.shaftMat);
    this.matByName = { ...this.M, label: this.labelMat, paint: this.paintMat, pool: this.poolMat, shaft: this.shaftMat };
  }

  // ---------- geometry accumulation ----------
  addGeo(matName, geo, color = PAL.conc, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count;
    if (!o.keepUV) {
      const tile = 1 / (TEX_TILE[matName] || 2);
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i += 3) {
        const ax = Math.abs(nrm.getX(i) + nrm.getX(i + 1) + nrm.getX(i + 2)), ay = Math.abs(nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)), az = Math.abs(nrm.getZ(i) + nrm.getZ(i + 1) + nrm.getZ(i + 2));
        for (let k = 0; k < 3; k++) {
          const j = i + k, x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
          if (ay >= ax && ay >= az) { uv[j * 2] = x * tile; uv[j * 2 + 1] = z * tile; }
          else if (ax >= az) { uv[j * 2] = z * tile; uv[j * 2 + 1] = y * tile; }
          else { uv[j * 2] = x * tile; uv[j * 2 + 1] = y * tile; }
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = color[0]; col[i * 3 + 1] = color[1]; col[i * 3 + 2] = color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
    g.computeBoundingBox();
    const c = g.boundingBox, cx = Math.floor(((c.min.x + c.max.x) / 2 + 400) / 56), cz = Math.floor(((c.min.z + c.max.z) / 2 + 400) / 56);
    const far = o.far ? 'F' : '';
    const key = `${matName}|${far || cx + ',' + cz}|${o.noShadow ? 0 : 1}`;
    let b = this.buckets.get(key);
    if (!b) { b = { mat: matName, geos: [], shadow: !o.noShadow }; this.buckets.set(key, b); }
    b.geos.push(g);
  }

  addCollider(minX, minY, minZ, maxX, maxY, maxZ, o = {}) {
    const c = { minX, minY, minZ, maxX, maxY, maxZ, move: o.move !== false, shot: o.shot !== false, kind: o.kind || 'concrete', nav: o.nav !== false, dead: false, prop: o.prop || null, cyl: null };
    this.colliders.push(c); return c;
  }
  addCylCollider(x, z, r, y0, y1, o = {}) {
    const c = this.addCollider(x - r, y0, z - r, x + r, y1, z + r, o); c.cyl = { x, z, r }; return c;
  }

  piece(x, y, z, rot = 0) { return new Piece(this, x, y, z, rot); }

  // ---------- kit ----------
  container(x, y, z, rot, colName, len = 6.06) {
    const P = this.piece(x, y, z, rot), W = 2.44, H = 2.59, col = PAL[colName], dk = mul(col, 0.7);
    P.box('corrugated', W - 0.08, H - 0.1, len - 0.1, 0, H / 2, 0, col);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box('panel', 0.14, H, 0.14, sx * (W / 2 - 0.07), H / 2, sz * (len / 2 - 0.07), dk, { bevel: 0.012 });
      for (const sy of [0, 1]) P.box('gunmetal', 0.18, 0.12, 0.18, sx * (W / 2 - 0.08), sy ? H - 0.06 : 0.06, sz * (len / 2 - 0.08), PAL.dark);
    }
    for (const sx of [-1, 1]) for (const sy of [0, 1]) P.box('panel', 0.1, 0.14, len - 0.2, sx * (W / 2 - 0.05), sy ? H - 0.07 : 0.07, 0, dk);
    for (const sz of [-1, 1]) for (const sy of [0, 1]) P.box('panel', W - 0.2, 0.14, 0.1, 0, sy ? H - 0.07 : 0.07, sz * (len / 2 - 0.05), dk);
    // doors
    for (const sx of [-1, 1]) {
      P.box('panel', W / 2 - 0.12, H - 0.34, 0.05, sx * (W / 4 - 0.03), H / 2, len / 2 - 0.02, col, { bevel: 0.01 });
      for (const k of [0.3, 0.75]) { P.cyl('gunmetal', 0.02, 0.02, H - 0.3, sx * (W / 2 - 0.12) * k, H / 2, len / 2 + 0.03, PAL.steel, { seg: 6 }); P.box('gunmetal', 0.1, 0.05, 0.05, sx * (W / 2 - 0.12) * k, 1.1, len / 2 + 0.045, PAL.dark); }
    }
    if (this.rng.chance(0.6)) P.label(this.rng.pick([0, 7, 8, 9, 10, 11, 15]), 1.5, 0.38, W / 2 - 0.035, H * 0.7, this.rng.f(-1.5, 1.5), 1, this.rng.chance(0.5) ? PAL.white : PAL.black);
    P.collide(-W / 2, 0, -len / 2, W / 2, H, len / 2, { kind: 'metal' });
    return H;
  }

  barrier(x, z, rot, variant = 0) {
    const P = this.piece(x, 0, z, rot), L = 3.0;
    const sh = new THREE.Shape(); sh.moveTo(-0.31, 0); sh.lineTo(0.31, 0); sh.lineTo(0.31, 0.08); sh.lineTo(0.16, 0.3); sh.lineTo(0.1, 0.92); sh.lineTo(-0.1, 0.92); sh.lineTo(-0.16, 0.3); sh.lineTo(-0.31, 0.08); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false }); g.translate(0, 0, -L / 2);
    if (variant === 1) { P.geo('panel', g, null, PAL.orange); P.box('panel', 0.22, 0.2, L * 0.6, 0, 0.6, 0, PAL.white); }
    else { P.geo('wall', g, null, PAL.conc); P.box('hazard', 0.215, 0.26, L - 0.3, 0, 0.75, 0, PAL.conc); }
    P.collide(-0.3, 0, -L / 2, 0.3, 0.92, L / 2);
  }

  crate(x, y, z, s = 1.1, colName = 'olive', ry = 0, h = s) {
    const P = this.piece(x, y, z, 0), col = PAL[colName];
    P.box('panel', s, h, s, 0, h / 2, 0, col, { bevel: 0.035, ry });
    P.box('panel', s + 0.04, 0.08, s + 0.04, 0, h - 0.1, 0, mul(col, 0.75), { bevel: 0.02, ry });
    P.box('panel', s + 0.04, 0.08, s + 0.04, 0, 0.1, 0, mul(col, 0.75), { bevel: 0.02, ry });
    for (const sx of [-1, 1]) P.box('gunmetal', 0.1, 0.14, 0.05, sx * s * 0.25, h - 0.16, s / 2 + 0.02, PAL.steel, { ry, pivot: true });
    const e = s / 2 + Math.abs(Math.sin(ry)) * s * 0.2;
    P.collide(-e, 0, -e, e, h, e, { kind: 'metal' });
    return h;
  }
  crateStack(x, z, n = 3) {
    const r = this.rng, cols = ['olive', 'dark', 'tan', 'gray'];
    for (let i = 0; i < n; i++) {
      const ox = r.f(-1.6, 1.6), oz = r.f(-1.6, 1.6), s = r.f(0.9, 1.3), c = r.pick(cols);
      const h = this.crate(x + ox, 0, z + oz, s, c, r.f(-0.25, 0.25), s * r.f(0.7, 1));
      if (r.chance(0.4)) this.crate(x + ox + r.f(-0.1, 0.1), h, z + oz + r.f(-0.1, 0.1), s * 0.8, r.pick(cols), r.f(-0.4, 0.4), s * 0.6);
    }
  }

  barrelGeo() {
    if (!this._barrelGeo) {
      const pts = [[0, 0], [0.28, 0], [0.29, 0.02], [0.29, 0.28], [0.305, 0.3], [0.29, 0.32], [0.29, 0.56], [0.305, 0.58], [0.29, 0.6], [0.29, 0.86], [0.28, 0.88], [0.26, 0.88], [0.26, 0.85], [0, 0.85]].map(p => new THREE.Vector2(p[0], p[1]));
      this._barrelGeo = new THREE.LatheGeometry(pts, 20);
    }
    return this._barrelGeo.clone();
  }
  barrel(x, y, z, colName = 'blue') {
    const P = this.piece(x, y, z, 0);
    P.geo('panel', this.barrelGeo(), null, PAL[colName], { cylUV: 0.29 });
    this.addCylCollider(x, z, 0.3, y, y + 0.88, { kind: 'metal', nav: false });
  }
  explosiveBarrel(x, z) {
    const g = this.barrelGeo();
    const n = g.attributes.position.count, col = new Float32Array(n * 3), surf = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const band = y > 0.32 && y < 0.56; const c = band ? PAL.yellow : PAL.red; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; surf[i * 3] = 0; surf[i * 3 + 1] = 1; surf[i * 3 + 2] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
    const uv = g.attributes.uv; for (let i = 0; i < n; i++) { uv.setXY(i, uv.getX(i) * 1, uv.getY(i) * 0.4); }
    const mesh = new THREE.Mesh(g, this.M.robot); mesh.position.set(x, 0, z); mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    const prop = { type: 'barrel', mesh, hp: 30, x, y: 0.45, z, dead: false };
    prop.collider = this.addCylCollider(x, z, 0.3, 0, 0.88, { kind: 'metal', prop, nav: false });
    this.props.push(prop);
  }

  tank(x, z, r, h, colName = 'cream') {
    const P = this.piece(x, 0, z, 0), col = PAL[colName] || PAL.cream, seg = 32;
    P.cyl('wall', r + 0.35, r + 0.4, 0.35, 0, 0.175, 0, PAL.concDark, { seg });
    P.cyl(colName === 'rustc' ? 'rust' : 'panel', r, r, h, 0, 0.35 + h / 2, 0, colName === 'rustc' ? PAL.white : col, { seg });
    const dome = new THREE.SphereGeometry(r, seg, 8, 0, TAU, 0, Math.PI / 2); dome.scale(1, 0.28, 1);
    P.geo('panel', dome, new THREE.Matrix4().makeTranslation(0, 0.35 + h, 0), mul(col, 0.92));
    for (let y = 2.4; y < h; y += 2.4) P.cyl('panel', r + 0.035, r + 0.035, 0.12, 0, 0.35 + y, 0, mul(col, 0.8), { seg });
    P.cyl('hazard', r + 0.012, r + 0.012, 0.5, 0, 1.6, 0, PAL.conc, { seg });
    // ladder
    const a = this.rng.f(0, TAU), lx = Math.cos(a) * (r + 0.18), lz = Math.sin(a) * (r + 0.18), ry = -a + Math.PI / 2;
    const LP = this.piece(x + lx, 0.35, z + lz, 0);
    for (const s of [-0.22, 0.22]) LP.box('gunmetal', 0.04, h + 1, 0.04, s, (h + 1) / 2, 0, PAL.steel, { ry, pivot: true });
    for (let y = 0.4; y < h + 0.9; y += 0.32) LP.box('gunmetal', 0.44, 0.03, 0.03, 0, y, 0, PAL.steel, { ry, pivot: true, noShadow: true });
    // top rail
    for (let i = 0; i < 16; i++) { const b = (i / 16) * TAU; P.box('gunmetal', 0.04, 1.0, 0.04, Math.cos(b) * (r - 0.1), 0.35 + h + 0.5, Math.sin(b) * (r - 0.1), PAL.yellow, { noShadow: true }); }
    const ring = new THREE.TorusGeometry(r - 0.1, 0.025, 5, 40); ring.rotateX(Math.PI / 2);
    P.geo('gunmetal', ring, new THREE.Matrix4().makeTranslation(0, 0.35 + h + 1.0, 0), PAL.yellow, { noShadow: true });
    // outlet pipe + valve
    const b2 = a + 2.2, px = Math.cos(b2) * (r + 0.5), pz = Math.sin(b2) * (r + 0.5);
    P.cyl('rust', 0.16, 0.16, 1.4, px, 0.7, pz, PAL.white, { seg: 12 });
    P.cyl('rust', 0.16, 0.16, 1.2, Math.cos(b2) * (r), 1.4, Math.sin(b2) * (r), PAL.white, { seg: 12, rz: Math.PI / 2, ry: -b2 });
    P.cyl('panel', 0.22, 0.22, 0.06, px, 1.05, pz, PAL.red, { seg: 12 });
    if (this.rng.chance(0.8)) { const la = a + 4; this.piece(x + Math.cos(la) * (r + 0.02), 0, z + Math.sin(la) * (r + 0.02), 0).label(this.rng.pick([13, 14, 4, 8, 9]), 2.6, 0.65, 0, 4.2, 0, 0, PAL.black, -la + Math.PI / 2); }
    this.addCylCollider(x, z, r + 0.05, 0, h + 0.35 + r * 0.25, { kind: 'metal' });
  }

  pipeRack(x, z, rot, len = 16) {
    const P = this.piece(x, 0, z, rot), r = this.rng;
    for (let s = -len / 2; s <= len / 2 + 0.01; s += len / Math.round(len / 5.5)) {
      for (const sx of [-1.3, 1.3]) { P.box('gunmetal', 0.22, 4.9, 0.22, sx, 2.45, s, PAL.steel, { bevel: 0.01 }); P.box('wall', 0.55, 0.3, 0.55, sx, 0.15, s, PAL.concDark); P.collide(sx - 0.14, 0, s - 0.14, sx + 0.14, 4.9, s + 0.14, { kind: 'metal', nav: false }); }
      for (const y of [3.3, 4.5]) P.box('gunmetal', 3.1, 0.18, 0.18, 0, y, s, PAL.steel);
      P.box('gunmetal', 0.08, 0.08, 3.0, 0, 3.9, s, PAL.steel, { rx: 0, rz: 0, noShadow: true });
    }
    const pipes = [[-0.9, 3.62, 0.22, 'rust', PAL.white], [-0.3, 3.56, 0.16, 'panel', PAL.yellow], [0.35, 3.66, 0.26, 'panel', PAL.cream], [1.0, 3.54, 0.14, 'rust', PAL.white], [-0.6, 4.78, 0.18, 'panel', PAL.red], [0.5, 4.86, 0.26, 'rust', PAL.white]];
    for (const [px, py, pr, mat, col] of pipes) {
      if (r.chance(0.12)) continue;
      P.cyl(mat, pr, pr, len + 1.2, px, py, 0, col, { seg: 12, rx: Math.PI / 2 });
      for (let s = -len / 2 + r.f(1, 3); s < len / 2; s += r.f(3.5, 6)) P.cyl('gunmetal', pr + 0.045, pr + 0.045, 0.09, px, py, s, PAL.steel, { seg: 12, rx: Math.PI / 2, noShadow: true });
    }
    // drop pipe + valve wheel
    const dz = r.f(-len / 3, len / 3);
    P.cyl('rust', 0.16, 0.16, 3.5, 1.0, 1.75, dz, PAL.white, { seg: 10 });
    P.cyl('panel', 0.24, 0.24, 0.05, 1.0, 1.2, dz, PAL.red, { seg: 12, rz: Math.PI / 2 });
    P.collide(0.82, 0, dz - 0.18, 1.18, 3.5, dz + 0.18, { kind: 'metal', nav: false });
    P.collide(-1.4, 3.2, -len / 2 - 0.6, 1.4, 5.1, len / 2 + 0.6, { kind: 'metal', move: false, nav: false });
  }

  building(x, z, rot, w = 10, d = 8, h = 4.6) {
    const P = this.piece(x, 0, z, rot), r = this.rng, lit = this.lampK >= 0.5;
    P.box('wall', w, h, d, 0, h / 2, 0, PAL.conc);
    P.box('wall', w + 0.16, 0.5, d + 0.16, 0, 0.25, 0, PAL.concDark);
    P.box('wall', w + 0.3, 0.35, d + 0.3, 0, h + 0.1, 0, mul(PAL.concDark, 0.9), { bevel: 0.03 });
    P.box('asphalt', w - 0.4, 0.1, d - 0.4, 0, h + 0.24, 0, PAL.conc, { noShadow: true });
    // door on +z face
    const dx = r.f(-w / 4, w / 4);
    P.box('panel', 1.5, 2.4, 0.12, dx, 1.2, d / 2 + 0.03, PAL.dark, { bevel: 0.02 });
    P.box('panel', 1.26, 2.2, 0.1, dx, 1.14, d / 2 + 0.07, PAL.gray, { bevel: 0.015 });
    P.box('gunmetal', 0.05, 0.22, 0.08, dx + 0.48, 1.1, d / 2 + 0.14, PAL.steel);
    P.box('panel', 0.6, 0.14, 0.3, dx, 2.75, d / 2 + 0.16, PAL.dark, { bevel: 0.02 });
    P.glow(0.5, 0.03, 0.22, dx, 2.675, d / 2 + 0.17, [1.0, 0.75, 0.45], 7 * this.lampK);
    P.lamp(dx, 2.6, d / 2 + 0.5, [1.0, 0.72, 0.42], 4.2, 0.7);
    // windows
    const nw = Math.max(1, Math.floor(w / 3.2));
    for (const face of [-1, 1]) for (let i = 0; i < nw; i++) {
      const wx = (i - (nw - 1) / 2) * 3.0; if (face > 0 && Math.abs(wx - dx) < 1.9) continue;
      P.box('panel', 1.5, 1.05, 0.14, wx, 2.6, face * (d / 2 + 0.01), PAL.dark, { bevel: 0.02 });
      const on = lit && r.chance(0.55);
      if (on) P.glow(1.3, 0.85, 0.05, wx, 2.6, face * (d / 2 + 0.07), r.chance(0.7) ? [1.0, 0.7, 0.38] : [0.6, 0.8, 1.0], 2.2 * this.lampK);
      else P.box('glass', 1.3, 0.85, 0.05, wx, 2.6, face * (d / 2 + 0.07), [1, 1, 1], { noShadow: true });
      for (const k of [-0.33, 0, 0.33]) P.box('gunmetal', 0.03, 0.87, 0.03, wx + k * 1.3, 2.6, face * (d / 2 + 0.1), PAL.dark, { noShadow: true });
    }
    // conduits + boxes on side walls
    for (const sx of [-1, 1]) {
      const cz = r.f(-d / 3, d / 3);
      P.cyl('gunmetal', 0.035, 0.035, h - 0.6, sx * (w / 2 + 0.05), h / 2, cz, PAL.steel, { seg: 6, noShadow: true });
      P.box('panel', 0.16, 0.6, 0.45, sx * (w / 2 + 0.08), 1.5, cz + 0.4, PAL.gray, { bevel: 0.02 });
      P.cyl('rust', 0.07, 0.07, h, sx * (w / 2 + 0.09), h / 2, -d / 2 + 0.3, PAL.white, { seg: 8 });
    }
    // roof units
    for (let i = 0; i < 2; i++) {
      const ux = r.f(-w / 2 + 1.4, w / 2 - 1.4), uz = r.f(-d / 2 + 1.2, d / 2 - 1.2);
      P.box('panel', 1.6, 0.9, 1.2, ux, h + 0.75, uz, PAL.gray, { bevel: 0.03 });
      P.cyl('gunmetal', 0.42, 0.42, 0.08, ux, h + 1.22, uz, PAL.dark, { seg: 16, noShadow: true });
      for (let k = -2; k <= 2; k++) P.box('gunmetal', 1.3, 0.04, 0.02, ux, h + 0.75 + k * 0.12, uz + 0.61, PAL.dark, { noShadow: true });
    }
    P.cyl('gunmetal', 0.03, 0.03, 3.4, w / 2 - 0.5, h + 1.9, -d / 2 + 0.5, PAL.steel, { seg: 5 });
    P.glow(0.1, 0.1, 0.1, w / 2 - 0.5, h + 3.6, -d / 2 + 0.5, [1, 0.08, 0.05], 14);
    P.label(r.pick([1, 2, 3, 0, 6]), 3.0, 0.75, r.f(-1, 1), 3.75, d / 2 + 0.012, 2, PAL.white);
    if (r.chance(0.7)) P.label(r.pick([4, 5, 12]), 1.3, 0.33, w / 2 + 0.012, 1.9, r.f(-1, 1), 1, PAL.yellow);
    P.collide(-w / 2, 0, -d / 2, w / 2, h + 0.3, d / 2);
  }

  shed(x, z, rot, w = 14, d = 11, h = 5.2) {
    const P = this.piece(x, 0, z, rot), r = this.rng;
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
      const cx = sx * (w / 2 - 0.3), cz = sz * (d / 2 - 0.3);
      P.box('gunmetal', 0.3, h, 0.3, cx, h / 2, cz, PAL.steel, { bevel: 0.015 });
      P.box('wall', 0.7, 0.4, 0.7, cx, 0.2, cz, PAL.concDark);
      P.collide(cx - 0.2, 0, cz - 0.2, cx + 0.2, h, cz + 0.2, { kind: 'metal', nav: false });
    }
    for (const sz of [-1, 0, 1]) {
      const cz = sz * (d / 2 - 0.3);
      P.box('gunmetal', w, 0.3, 0.2, 0, h - 0.15, cz, PAL.steel);
      P.box('gunmetal', w, 0.14, 0.14, 0, h - 1.0, cz, PAL.steel);
      for (let k = -3; k <= 3; k++) P.box('gunmetal', 0.08, 1.1, 0.08, k * w / 7 + w / 14, h - 0.55, cz, PAL.steel, { rz: (k % 2 ? 1 : -1) * 0.75, noShadow: true });
    }
    for (const sx of [-1, 1]) P.box('gunmetal', 0.2, 0.25, d, sx * (w / 2 - 0.3), h - 0.13, 0, PAL.steel);
    P.box('corrugated', w + 1.0, 0.12, d + 1.0, 0, h + 0.12, 0, PAL.gray);
    // back wall (corrugated) half-height gives cover feel
    P.box('corrugated', w, h - 0.4, 0.1, 0, (h - 0.4) / 2 + 0.2, -d / 2 + 0.25, PAL.teal);
    P.collide(-w / 2, 0, -d / 2 + 0.15, w / 2, h, -d / 2 + 0.35, { kind: 'metal' });
    for (const lx of [-w / 4, w / 4]) {
      P.cyl('gunmetal', 0.015, 0.015, 0.9, lx, h - 0.55, 0, PAL.dark, { seg: 4, noShadow: true });
      const cone = new THREE.CylinderGeometry(0.1, 0.34, 0.26, 12, 1, true);
      P.geo('panel', cone, new THREE.Matrix4().makeTranslation(lx, h - 1.1, 0), PAL.dark, { noShadow: true });
      P.glow(0.3, 0.04, 0.3, lx, h - 1.2, 0, [1.0, 0.86, 0.62], 10 * Math.max(0.35, this.lampK));
      P.lamp(lx, h - 1.3, 0, [1.0, 0.82, 0.58], 6.5, 1.0, true);
    }
    P.collide(-w / 2 - 0.5, h, -d / 2 - 0.5, w / 2 + 0.5, h + 0.2, d / 2 + 0.5, { kind: 'metal', nav: false });
    return P;
  }

  catwalk(x, z, rot, len = 12, w = 2.4, h = 2.8) {
    const P = this.piece(x, 0, z, rot);
    P.box('tread', w, 0.08, len, 0, h - 0.04, 0, PAL.conc);
    for (const sx of [-1, 1]) P.box('gunmetal', 0.1, 0.2, len, sx * (w / 2 - 0.05), h - 0.16, 0, PAL.steel);
    const nseg = Math.max(1, Math.round(len / 4));
    for (let i = 0; i <= nseg; i++) for (const sx of [-1, 1]) {
      const cz = -len / 2 + (i / nseg) * len, cx = sx * (w / 2 - 0.1);
      P.box('gunmetal', 0.16, h - 0.1, 0.16, cx, (h - 0.1) / 2, cz, PAL.steel, { bevel: 0.01 });
      P.collide(cx - 0.1, 0, cz - 0.1, cx + 0.1, h - 0.1, cz + 0.1, { kind: 'metal', nav: false });
      if (i < nseg) P.box('gunmetal', 0.05, 0.05, len / nseg * 1.15, cx, h * 0.5, cz + len / nseg / 2, PAL.steel, { rx: Math.atan2(h * 0.7, len / nseg) * (i % 2 ? 1 : -1), noShadow: true });
    }
    // rails
    for (const sx of [-1, 1]) {
      const cx = sx * (w / 2 - 0.03);
      for (let s = -len / 2; s <= len / 2 + 0.01; s += len / Math.round(len / 1.6)) P.box('gunmetal', 0.045, 1.05, 0.045, cx, h + 0.52, s, PAL.yellow, { noShadow: true });
      for (const y of [0.55, 1.05]) P.box('gunmetal', 0.045, 0.045, len, cx, h + y, 0, PAL.yellow);
      P.collide(cx - 0.04, h, -len / 2, cx + 0.04, h + 1.05, len / 2, { kind: 'metal', shot: false, nav: false });
    }
    P.box('gunmetal', w, 0.045, 0.045, 0, h + 1.05, -len / 2 + 0.02, PAL.yellow);
    P.box('gunmetal', w, 0.045, 0.045, 0, h + 0.55, -len / 2 + 0.02, PAL.yellow);
    P.collide(-w / 2, h, -len / 2 - 0.02, w / 2, h + 1.05, -len / 2 + 0.06, { kind: 'metal', shot: false, nav: false });
    P.collide(-w / 2, h - 0.25, -len / 2, w / 2, h, len / 2, { kind: 'metal', nav: false });
    // stairs off +z end
    const n = Math.round(h / 0.2), run = 0.29;
    for (let i = 0; i < n; i++) {
      const sy = (i + 1) * (h / n), sz = len / 2 + (n - 1 - i) * run + run / 2;
      P.box('tread', w - 0.3, 0.05, run + 0.02, 0, sy - 0.025, sz, PAL.conc);
      P.collide(-w / 2 + 0.15, Math.max(0, sy - 0.5), sz - run / 2, w / 2 - 0.15, sy, sz + run / 2, { kind: 'metal', nav: sy > 0.45 });
    }
    const slen = Math.hypot(n * run, h), ang = Math.atan2(h, n * run);
    for (const sx of [-1, 1]) {
      P.box('gunmetal', 0.06, 0.24, slen, sx * (w / 2 - 0.15), h / 2 - 0.08, len / 2 + n * run / 2, PAL.steel, { rx: ang });
      P.box('gunmetal', 0.045, 0.045, slen, sx * (w / 2 - 0.15), h / 2 + 1.0, len / 2 + n * run / 2, PAL.yellow, { rx: ang });
      for (let k = 0; k <= 3; k++) { const t = k / 3; P.box('gunmetal', 0.045, 1.0, 0.045, sx * (w / 2 - 0.15), h * (1 - t) + 0.5, len / 2 + t * n * run, PAL.yellow, { noShadow: true }); }
      P.collide(sx * (w / 2 - 0.15) - 0.04, 0, len / 2, sx * (w / 2 - 0.15) + 0.04, h + 1, len / 2 + n * run, { kind: 'metal', shot: false, nav: false });
    }
    return P;
  }

  lightPole(x, z, rot, h = 7.5, cool = false) {
    const P = this.piece(x, 0, z, rot), col = cool ? [0.72, 0.86, 1.0] : [1.0, 0.8, 0.52];
    P.box('wall', 0.6, 0.5, 0.6, 0, 0.25, 0, PAL.concDark, { bevel: 0.03 });
    P.cyl('gunmetal', 0.07, 0.11, h, 0, h / 2, 0, PAL.gray, { seg: 8 });
    P.cyl('gunmetal', 0.05, 0.05, 1.8, 0, h - 0.05, 0.85, PAL.gray, { seg: 6, rx: Math.PI / 2 });
    P.box('panel', 0.34, 0.12, 0.7, 0, h - 0.06, 1.75, PAL.dark, { bevel: 0.03 });
    P.glow(0.26, 0.03, 0.56, 0, h - 0.13, 1.75, col, 16 * Math.max(0.2, this.lampK));
    P.lamp(0, h - 0.2, 1.75, col, 8.5, 1.0, true);
    P.collide(-0.14, 0, -0.14, 0.14, h, 0.14, { kind: 'metal', nav: false });
  }

  generator(x, z, rot) {
    const P = this.piece(x, 0, z, rot), r = this.rng, col = r.pick([PAL.green, PAL.olive, PAL.gray, PAL.yellow]);
    P.box('gunmetal', 2.5, 0.16, 0.14, 0, 0.08, 0.5, PAL.dark); P.box('gunmetal', 2.5, 0.16, 0.14, 0, 0.08, -0.5, PAL.dark);
    P.box('panel', 2.3, 1.45, 1.25, 0, 0.9, 0, col, { bevel: 0.05 });
    P.box('panel', 0.9, 0.9, 0.06, -0.5, 0.95, 0.64, PAL.dark, { bevel: 0.01 });
    for (let k = 0; k < 7; k++) P.box('gunmetal', 0.8, 0.05, 0.05, -0.5, 0.6 + k * 0.115, 0.67, PAL.black, { rx: 0.5, noShadow: true });
    P.box('panel', 0.7, 0.55, 0.06, 0.62, 1.15, 0.64, PAL.gray, { bevel: 0.01 });
    const leds = [[0.2, 1, 0.25], [1, 0.15, 0.08], [1, 0.6, 0.1], [0.2, 1, 0.25]];
    for (let k = 0; k < 4; k++) P.glow(0.05, 0.05, 0.02, 0.4 + k * 0.14, 1.3, 0.68, leds[k], 5);
    P.glow(0.4, 0.16, 0.02, 0.62, 1.08, 0.68, [0.25, 0.8, 1.0], 1.6);
    P.cyl('rust', 0.07, 0.07, 0.9, 0.8, 2.0, -0.3, PAL.white, { seg: 8 });
    P.cyl('gunmetal', 0.1, 0.1, 0.12, 0.8, 2.45, -0.3, PAL.dark, { seg: 8 });
    P.box('hazard', 2.32, 0.2, 1.27, 0, 0.3, 0, PAL.conc);
    P.collide(-1.2, 0, -0.66, 1.2, 1.65, 0.66, { kind: 'metal' });
  }

  truck(x, z, rot) {
    const P = this.piece(x, 0, z, rot), r = this.rng, col = r.pick([PAL.olive, PAL.tan, PAL.dark, PAL.gray]), dk = mul(col, 0.6);
    P.box('gunmetal', 1.1, 0.3, 7.2, 0, 0.75, 0, PAL.black);
    P.box('panel', 2.4, 1.1, 1.7, 0, 1.45, -2.9, col, { bevel: 0.08 });               // hood
    P.box('panel', 2.5, 1.9, 1.9, 0, 1.85, -1.2, col, { bevel: 0.1 });                // cab
    P.box('glass', 2.2, 0.75, 0.06, 0, 2.3, -2.16, [1, 1, 1], { rx: -0.22 });
    for (const sx of [-1, 1]) { P.box('glass', 0.05, 0.65, 1.1, sx * 1.26, 2.3, -1.25, [1, 1, 1]); P.box('panel', 0.16, 0.26, 0.1, sx * 1.36, 2.2, -2.0, dk); }
    P.box('gunmetal', 2.6, 0.32, 0.25, 0, 0.72, -3.85, PAL.dark, { bevel: 0.04 });   // bumper
    for (const sx of [-1, 1]) { P.glow(0.3, 0.2, 0.04, sx * 0.85, 1.25, -3.77, [1, 0.9, 0.7], 0.6 + 3 * this.lampK * (r.chance(0.5) ? 1 : 0)); }
    for (let k = -3; k <= 3; k++) P.box('gunmetal', 0.07, 0.6, 0.05, k * 0.14, 1.4, -3.77, PAL.black, { noShadow: true });
    // bed
    P.box('panel', 2.5, 0.18, 4.6, 0, 1.05, 1.45, dk, { bevel: 0.02 });
    if (r.chance(0.6)) { P.box('dirt', 2.44, 1.75, 4.5, 0, 2.02, 1.45, lin(0x5b6248), { bevel: 0.14, seg: 2 }); P.collide(-1.25, 0.9, -0.85, 1.25, 2.95, 3.75, { kind: 'metal' }); }
    else { for (const sx of [-1, 1]) P.box('panel', 0.08, 0.7, 4.6, sx * 1.21, 1.5, 1.45, col); P.box('panel', 2.5, 0.7, 0.08, 0, 1.5, 3.72, col); P.collide(-1.25, 0.9, -0.85, 1.25, 1.85, 3.75, { kind: 'metal' }); }
    for (const sz of [-2.75, 1.0, 2.5]) for (const sx of [-1, 1]) {
      P.cyl('rubber', 0.52, 0.52, 0.38, sx * 1.08, 0.52, sz, PAL.black, { seg: 18, rz: Math.PI / 2 });
      P.cyl('gunmetal', 0.26, 0.26, 0.4, sx * 1.08, 0.52, sz, PAL.gray, { seg: 10, rz: Math.PI / 2, noShadow: true });
    }
    P.collide(-1.28, 0, -3.95, 1.28, 2.8, -0.2, { kind: 'metal' });
    P.collide(-1.28, 0, -0.2, 1.28, 1.1, 3.75, { kind: 'metal' });
  }

  sandbags(x, z, rot, n = 5, rows = 4) {
    const P = this.piece(x, 0, z, rot), r = this.rng;
    for (let row = 0; row < rows; row++) for (let i = 0; i < n - (row % 2); i++) {
      const sx = (i - (n - 1 - (row % 2)) / 2) * 0.62;
      const c = mul(PAL.sand, r.f(0.75, 1.0));
      P.box('dirt', 0.6, 0.23, 0.34, sx + r.f(-0.03, 0.03), 0.115 + row * 0.21, r.f(-0.03, 0.03), c, { bevel: 0.1, ry: r.f(-0.08, 0.08) });
    }
    P.collide(-n * 0.31, 0, -0.2, n * 0.31, rows * 0.21 + 0.03, 0.2, { kind: 'dirt' });
  }

  cone(x, z) {
    const P = this.piece(x, 0, z, 0);
    P.box('rubber', 0.36, 0.04, 0.36, 0, 0.02, 0, PAL.black, { noShadow: true });
    P.cyl('panel', 0.03, 0.14, 0.62, 0, 0.33, 0, PAL.orange, { seg: 10 });
    P.cyl('panel', 0.075, 0.1, 0.12, 0, 0.4, 0, PAL.white, { seg: 10, noShadow: true });
  }
  tires(x, z, n = 3) {
    const P = this.piece(x, 0, z, 0);
    for (let i = 0; i < n; i++) { const t = new THREE.TorusGeometry(0.36, 0.17, 8, 18); t.rotateX(Math.PI / 2); P.geo('rubber', t, new THREE.Matrix4().makeTranslation(this.rng.f(-0.04, 0.04), 0.17 + i * 0.33, this.rng.f(-0.04, 0.04)), PAL.black); }
    this.addCylCollider(x, z, 0.5, 0, n * 0.33 + 0.02, { kind: 'dirt', nav: false });
  }
  pallet(x, y, z, ry = 0) {
    const P = this.piece(x, y, z, 0), c = lin(0x8a6a44);
    for (let k = -2; k <= 2; k++) P.box('dirt', 0.14, 0.025, 1.2, k * 0.24, 0.13, 0, mul(c, this.rng.f(0.8, 1.1)), { ry, pivot: true, noShadow: true });
    for (const k of [-0.5, 0, 0.5]) P.box('dirt', 1.1, 0.1, 0.1, 0, 0.06, k, mul(c, 0.8), { ry, pivot: true });
  }

  wallRun(x0, z0, x1, z1, h = 5.2) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), alongX = Math.abs(dx) > Math.abs(dz);
    const P = this.piece((x0 + x1) / 2, 0, (z0 + z1) / 2, 0);
    const w = alongX ? len : 0.7, d = alongX ? 0.7 : len;
    P.box('wall', w, h, d, 0, h / 2, 0, PAL.conc);
    P.box('wall', w + (alongX ? 0 : 0.2), 0.25, d + (alongX ? 0.2 : 0), 0, h + 0.1, 0, PAL.concDark, { bevel: 0.03 });
    P.box('wall', w + (alongX ? 0 : 0.16), 0.6, d + (alongX ? 0.16 : 0), 0, 0.3, 0, PAL.concDark);
    const n = Math.round(len / 9);
    for (let i = 0; i <= n; i++) { const t = -len / 2 + (i / n) * len; P.box('wall', 1.0, h + 0.5, 1.0, alongX ? t : 0, (h + 0.5) / 2, alongX ? 0 : t, PAL.concDark, { bevel: 0.04 }); }
    // razor wire coil
    const coil = new THREE.TorusGeometry(0.32, 0.014, 3, 8);
    for (let t = -len / 2 + 0.3; t < len / 2; t += 0.62) { const m = new THREE.Matrix4().makeRotationY(alongX ? Math.PI / 2 + 0.25 : 0.25); m.setPosition(alongX ? t : 0, h + 0.55, alongX ? 0 : t); P.geo('gunmetal', coil.clone(), m, PAL.steel, { noShadow: true }); }
    P.collide(-w / 2, 0, -d / 2, w / 2, h + 3, d / 2);
  }

  gate(x, z, rot, w = 10, h = 5.2) {
    const P = this.piece(x, 0, z, rot);
    P.box('corrugated', w, h - 0.5, 0.25, 0, (h - 0.5) / 2, 0, PAL.gray);
    P.box('hazard', w, 0.6, 0.3, 0, 0.5, 0, PAL.conc);
    P.box('gunmetal', w + 0.4, 0.4, 0.5, 0, h - 0.2, 0, PAL.dark, { bevel: 0.03 });
    for (const sx of [-1, 1]) { P.box('wall', 1.3, h + 1.2, 1.3, sx * (w / 2 + 0.6), (h + 1.2) / 2, 0, PAL.concDark, { bevel: 0.05 }); P.glow(0.3, 0.3, 0.3, sx * (w / 2 + 0.6), h + 1.4, 0, [1, 0.25, 0.08], 6 * Math.max(0.3, this.lampK)); }
    P.label(this.rng.pick([7, 8, 9, 10]), 2.6, 1.3, 0, 3.4, -0.14, 3, PAL.white);
    P.collide(-w / 2 - 1.3, 0, -0.6, w / 2 + 1.3, h + 3, 0.6, { kind: 'metal' });
  }

  tower(x, z) {
    const P = this.piece(x, 0, z, 0), h = 9;
    P.box('wall', 3.4, h, 3.4, 0, h / 2, 0, PAL.conc);
    P.box('wall', 4.6, 0.3, 4.6, 0, h + 0.15, 0, PAL.concDark, { bevel: 0.03 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box('gunmetal', 0.14, 2.2, 0.14, sx * 2.1, h + 1.4, sz * 2.1, PAL.dark);
    P.box('corrugated', 5, 0.14, 5, 0, h + 2.55, 0, PAL.dark);
    for (const s of [-1, 1]) { P.box('panel', 4.4, 1.0, 0.08, 0, h + 0.8, s * 2.15, PAL.dark); P.box('panel', 0.08, 1.0, 4.4, s * 2.15, h + 0.8, 0, PAL.dark); }
    P.collide(-2.3, 0, -2.3, 2.3, h + 3, 2.3);
    // sweeping searchlight
    if (this.lampK >= 0.5) {
      const a0 = Math.atan2(-x, -z);
      const head = new THREE.Group(); head.position.set(x, h + 1.7, z);
      const cone = new THREE.CylinderGeometry(0.25, 5.5, 46, 20, 1, true); cone.translate(0, -23, 0); cone.rotateX(-Math.PI / 2 + 0.36);
      const n = cone.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = 0.75 * 0.11; col[i * 3 + 1] = 0.86 * 0.11; col[i * 3 + 2] = 1.0 * 0.11; }
      cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const uv = cone.attributes.uv; for (let i = 0; i < n; i++) uv.setY(i, 0.25 + uv.getY(i) * 0.75);
      const m = new THREE.Mesh(cone, this.shaftMat); m.layers.set(1); m.frustumCulled = false; head.add(m);
      const lampG = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 10, 12), toneMapped: false })); head.add(lampG);
      this.group.add(head);
      const ph = this.rng.f(0, 6);
      this.anim.push((t) => { head.rotation.y = a0 + Math.sin(t * 0.22 + ph) * 0.75; });
    }
  }

  // ---------- layouts ----------
  _floor() {
    const H = this.half, T = 9, n = Math.ceil((H * 2) / T);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = -H + (i + 0.5) * T, z = -H + (j + 0.5) * T;
      const road = this.def.theme !== 'core' && (Math.abs(x) < 4.6 || Math.abs(z) < 4.6);
      const g = new THREE.PlaneGeometry(T, T); g.rotateX(-Math.PI / 2); g.translate(x, 0, z);
      this.addGeo(road ? 'asphalt' : 'concrete', g, PAL.conc, { noShadow: false });
    }
  }
  _paintLine(x0, z0, x1, z1, w, col) {
    const len = Math.hypot(x1 - x0, z1 - z0), g = new THREE.PlaneGeometry(w, len); g.rotateX(-Math.PI / 2);
    g.rotateY(Math.atan2(x1 - x0, z1 - z0)); g.translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 2 + x0 * 0.13, uv.getY(i) * len * 0.5);
    this.addGeo('paint', g, col, { keepUV: true, noShadow: true });
  }

  _buildGrid() {
    const r = this.rng, H = this.half, theme = this.def.theme, CS = 18, N = Math.round((H * 2) / CS);
    this._floor();
    // road markings
    for (let s = -H + 3; s < H - 3; s += 6) { if (Math.abs(s + 1.5) > 6) { this._paintLine(0, s, 0, s + 3, 0.18, PAL.white); this._paintLine(s, 0, s + 3, 0, 0.18, PAL.white); } }
    for (const k of [-4.3, 4.3]) { this._paintLine(k, -H + 1, k, -5.5, 0.14, PAL.yellow); this._paintLine(k, 5.5, k, H - 1, 0.14, PAL.yellow); this._paintLine(-H + 1, k, -5.5, k, 0.14, PAL.yellow); this._paintLine(5.5, k, H - 1, k, 0.14, PAL.yellow); }
    // perimeter
    const G = 5.6;
    for (const s of [-1, 1]) {
      this.wallRun(-H - 0.35, s * (H + 0.35), -G - 1.3, s * (H + 0.35)); this.wallRun(G + 1.3, s * (H + 0.35), H + 0.35, s * (H + 0.35));
      this.wallRun(s * (H + 0.35), -H - 0.35, s * (H + 0.35), -G - 1.3); this.wallRun(s * (H + 0.35), G + 1.3, s * (H + 0.35), H + 0.35);
      this.gate(0, s * (H + 0.35), s > 0 ? 0 : 2, G * 2 - 1.2); this.gate(s * (H + 0.35), 0, s > 0 ? 1 : 3, G * 2 - 1.2);
      for (const t of [-1, 1]) this.tower(s * (H + 2.6), t * (H + 2.6));
    }
    const W = {
      yard: { containers: 5, yardstack: 3, motorpool: 2, cover: 2, depot: 1.2, catwalk: 1, shed: 1.2 },
      refinery: { tankfarm: 4, piperack: 3, catwalk: 2, depot: 1.6, cover: 2, containers: 1.2, shed: 1 },
      foundry: { shed: 3, depot: 2, piperack: 2.2, tankfarm: 1.4, containers: 2, cover: 2, catwalk: 2, motorpool: 1 },
    }[theme] || { cover: 1 };
    const names = Object.keys(W), total = names.reduce((a, k) => a + W[k], 0);
    const pickType = () => { let t = r.f(total); for (const k of names) { t -= W[k]; if (t <= 0) return k; } return names[0]; };
    const cells = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      // cell centers pushed away from central road cross
      const cx = -H + (i + 0.5) * CS, cz = -H + (j + 0.5) * CS;
      const x = cx + (cx > 0 ? 1.6 : -1.6), z = cz + (cz > 0 ? 1.6 : -1.6);
      const isStart = (j === N - 1 || (this.def.mp && j === 0)) && (i === N / 2 - 1 || i === N / 2);
      const inner = (i === N / 2 - 1 || i === N / 2) && (j === N / 2 - 1 || j === N / 2);
      cells.push({ i, j, x, z, type: isStart ? 'cover' : inner ? (r.chance(0.5) ? 'cover' : pickType()) : pickType() });
    }
    // guarantee enough objective slots: force some cells to cover
    const coverCells = cells.filter(c => c.type === 'cover');
    const need = 7 - coverCells.length;
    if (need > 0) { const cand = cells.filter(c => c.type !== 'cover'); for (let k = 0; k < need && cand.length; k++) { const idx = r.i(0, cand.length - 1); cand[idx].type = 'cover'; cand.splice(idx, 1); } }
    for (const c of cells) this['_f_' + c.type](c.x, c.z, c);
    // light poles on lane intersections
    for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
      const x = -H + i * CS, z = -H + j * CS;
      if (i === N / 2 && j === N / 2) continue;
      const onRoad = i === N / 2 || j === N / 2;
      const ox = x + (i === N / 2 ? 5.4 * ((j % 2) ? 1 : -1) : (x > 0 ? 1.6 : -1.6)), oz = z + (j === N / 2 && i !== N / 2 ? 5.4 * ((i % 2) ? 1 : -1) : (i === N / 2 ? 0 : (z > 0 ? 1.6 : -1.6)));
      if ((i + j) % 2 === 0 || onRoad) this.lightPole(ox, oz, i === N / 2 ? (ox > 0 ? 3 : 1) : (j === N / 2 ? (oz > 0 ? 2 : 0) : r.i(0, 3)), 7.5, r.chance(0.3));
      this.spawns.push({ x: x + (i === N / 2 ? 0 : (x > 0 ? 1.6 : -1.6)), z: z + (j === N / 2 ? 0 : (z > 0 ? 1.6 : -1.6)) });
    }
    for (const s of [-1, 1]) { this.spawns.push({ x: 0, z: s * (H - 4) }, { x: s * (H - 4), z: 0 }, { x: s * (H - 3), z: s * (H - 3) }, { x: s * (H - 3), z: -s * (H - 3) }); }
    if (this.def.mp) { this._mpLayout(); return; }
    // scattered explosive barrels
    for (let k = 0; k < 14; k++) { const c = r.pick(cells); const a = r.f(TAU); this._tryBarrel(c.x + Math.cos(a) * r.f(6.8, 8), c.z + Math.sin(a) * r.f(6.8, 8)); }
    // zone labels on asphalt
    this.piece(0, 0, 0, 0).floorLabel(0, 7, 1.8, 0, H - 14, PAL.white);
    this.piece(0, 0, 0, 0).floorLabel(15, 5, 1.2, 0, -H + 12, PAL.yellow);
  }

  // multiplayer arena: capture points on the centre road, cover around them, team spawn lines on the two far edges
  _mpLayout() {
    const H = this.half, r = this.rng, px = H - 10;
    this.points = [{ id: 'A', x: -px, z: 0 }, { id: 'B', x: 0, z: 0 }, { id: 'C', x: px, z: 0 }];
    for (const p of this.points) {
      for (const s of [-1, 1]) this._paintLine(p.x - 4.5, s * 4.5, p.x + 4.5, s * 4.5, 0.2, PAL.yellow);
      if (p.id === 'B') { for (const [ox, oz, rot] of [[-5.2, 0, 0], [5.2, 0, 0]]) this.barrier(p.x + ox, p.z + oz, rot, 0); this.sandbags(p.x, -2.9, 0, 4, 4); this.sandbags(p.x, 2.9, 0, 4, 4); }
      else { const out = Math.sign(p.x); this.barrier(p.x - out * 4.8, -1.6, 0, 1); this.barrier(p.x + out * 3.2, 1.8, 0, 0); this.sandbags(p.x, -3.0, 0, 5, 4); this.crate(p.x + out * 1.2, 0, 3.1, 1.1, 'olive', r.f(-0.2, 0.2)); }
      this.piece(0, 0, 0, 0).floorLabel(p.id === 'A' ? 7 : p.id === 'B' ? 8 : 9, 2.2, 1.1, p.x, p.z + 3.6, PAL.white);
    }
    // extra cover on the lanes leading out of each spawn
    for (const s of [-1, 1]) { this.barrier(-7.5, s * (H - 13), 1, 0); this.barrier(7.5, s * (H - 13), 1, 0); this.sandbags(0, s * (H - 17), 0, 5, 3); }
    this.start = { x: 0, z: H - 4, yaw: 0 };
  }
  // spawn candidates computed once nav is built
  _mpSpawns() {
    const H = this.half, ok = (x, z) => !this.navBlocked(x, z, 2);
    this.teamSpawns = [[], []];
    for (let t = 0; t < 2; t++) {
      const z0 = (t === 0 ? 1 : -1) * (H - 3);
      for (let dz = 0; dz < 6 && this.teamSpawns[t].length < 8; dz += 1.5) for (let x = -24; x <= 24; x += 2.5) { const z = z0 - Math.sign(z0) * dz; if (ok(x, z) && this.teamSpawns[t].every((p) => Math.hypot(p.x - x, p.z - z) > 2.4)) this.teamSpawns[t].push({ x, z, yaw: t === 0 ? 0 : Math.PI }); }
    }
    this.dmSpawns = this.spawns.filter((s) => ok(s.x, s.z)).map((s) => ({ x: s.x, z: s.z, yaw: Math.atan2(s.x, s.z) }));
    for (const t of this.teamSpawns) for (const s of t) this.dmSpawns.push(s);
  }

  _tryBarrel(x, z) {
    if (Math.abs(x) > this.half - 2 || Math.abs(z) > this.half - 2) return;
    if (Math.hypot(x - this.start.x, z - this.start.z) < 10) return;
    for (const c of this.colliders) if (x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6 && c.minY < 1) return;
    this.explosiveBarrel(x, z);
  }

  _f_cover(x, z, c) {
    const r = this.rng;
    this.slots.push({ x, z });
    const P = this.piece(x, 0, z, 0);
    // hazard square
    for (const s of [-1, 1]) { this._paintLine(x - 3, z + s * 3, x + 3, z + s * 3, 0.16, PAL.yellow); this._paintLine(x + s * 3, z - 3, x + s * 3, z + 3, 0.16, PAL.yellow); }
    const n = r.i(4, 6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + r.f(-0.3, 0.3), d = r.f(4.6, 6.6), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const rot = Math.abs(Math.cos(a)) > 0.7 ? 0 : 1, t = r.f(1);
      if (t < 0.4) this.barrier(px, pz, rot, r.chance(0.25) ? 1 : 0);
      else if (t < 0.65) this.sandbags(px, pz, rot ? 0 : 1, r.i(4, 6), r.i(3, 5));
      else if (t < 0.85) this.crateStack(px, pz, 2);
      else { this.generator(px, pz, r.i(0, 3)); }
    }
    if (r.chance(0.5)) for (let k = 0; k < 3; k++) this.cone(x + r.f(-3.5, 3.5), z + r.f(-3.5, 3.5));
  }
  _f_containers(x, z) {
    const r = this.rng, rot = r.i(0, 1), n = r.i(2, 4);
    for (let k = 0; k < n; k++) {
      const long = r.chance(0.3) && n <= 3, off = (k - (n - 1) / 2) * r.f(3.3, 3.9), slide = long ? 0 : r.f(-2.5, 2.5);
      const cx = rot ? x + slide : x + off, cz = rot ? z + off : z + slide;
      const h = this.container(cx, 0, cz, rot, r.pick(CONTAINER_COLS), long ? 12.19 : 6.06);
      if (r.chance(0.4)) this.container(cx + (rot ? r.f(-0.5, 0.5) : 0), h, cz + (rot ? 0 : r.f(-0.5, 0.5)), rot, r.pick(CONTAINER_COLS), 6.06);
    }
    this.crateStack(x + (rot ? 0 : r.sign() * 7.2), z + (rot ? r.sign() * 7.2 : 0), 2);
    if (r.chance(0.6)) this.pallet(x + r.f(-6, 6), 0, z + r.f(-6, 6), r.f(3));
  }
  _f_yardstack(x, z) {
    const r = this.rng, rot = r.i(0, 1);
    for (let k = -1; k <= 1; k++) {
      const cx = rot ? x : x + k * 2.6, cz = rot ? z + k * 2.6 : z;
      let y = 0; const levels = k === 0 ? 3 : r.i(1, 2);
      for (let l = 0; l < levels; l++) y += this.container(cx, y, cz, rot, r.pick(CONTAINER_COLS), 12.19);
    }
    const s = r.sign();
    this.container(rot ? x + s * 5.4 : x + r.f(-2, 2), 0, rot ? z + r.f(-2, 2) : z + s * 5.4 + (s * 2), rot ? 0 : 1, r.pick(CONTAINER_COLS), 6.06);
    this.barrier(rot ? x - s * 6.5 : x, rot ? z : z - s * 7.2, rot ? 0 : 1);
  }
  _f_motorpool(x, z) {
    const r = this.rng, rot = r.i(0, 3);
    this.truck(x - 2.4, z + r.f(-1, 1), rot);
    if (r.chance(0.6)) this.truck(x + 2.6 + (rot % 2 ? 0 : 0.6), z + r.f(-1.5, 1.5) + (rot % 2 ? 3.4 : 0), rot % 2 ? rot : (rot + 2) % 4);
    for (let k = 0; k < 3; k++) { const a = r.f(TAU); this.tires(x + Math.cos(a) * 6.6, z + Math.sin(a) * 6.6, r.i(2, 4)); }
    for (let k = 0; k < 3; k++) { const a = r.f(TAU); this.barrel(x + Math.cos(a) * 6.2, 0, z + Math.sin(a) * 6.2, r.pick(['blue', 'olive', 'gray'])); }
    for (let k = 0; k < 4; k++) this.cone(x + r.f(-7, 7), z + r.f(-7, 7));
    this.sandbags(x + r.f(-2, 2), z + r.sign() * 7, 0, 5, 4);
  }
  _f_depot(x, z) {
    const r = this.rng, rot = r.i(0, 3);
    this.building(x, z, rot, r.f(9, 11), r.f(7, 8.5), r.f(4.2, 5.2));
    const P = this.piece(x, 0, z, rot), p = (lx, lz) => { _p.set(lx, 0, lz).applyMatrix4(P.m); return [_p.x, _p.z]; };
    let q = p(r.f(2.5, 4), 6.0); this.crateStack(q[0], q[1], 2);
    q = p(-6.8, r.f(-2, 2)); this.generator(q[0], q[1], (rot + 1) % 4);
    q = p(r.f(-4, -2), 5.6); this.barrel(q[0], 0, q[1], 'blue'); this.barrel(q[0] + 0.7, 0, q[1] + 0.2, 'olive');
    q = p(6.9, r.f(-2, 2)); this.barrier(q[0], q[1], rot % 2 ? 1 : 0);
  }
  _f_shed(x, z) {
    const r = this.rng, rot = r.i(0, 3);
    const P = this.shed(x, z, rot, 14, 11, 5.4), p = (lx, lz) => { _p.set(lx, 0, lz).applyMatrix4(P.m); return [_p.x, _p.z]; };
    let q = p(-4, -2.5); this.generator(q[0], q[1], rot);
    q = p(3.5, -2.2); this.crateStack(q[0], q[1], 3);
    q = p(0, 2.5); this.pallet(q[0], 0, q[1], r.f(3)); this.crate(q[0], 0.16, q[1], 1.0, 'tan', r.f(1));
    q = p(-5.2, 3); this.barrel(q[0], 0, q[1], 'gray'); this.barrel(q[0] + 0.65, 0, q[1] - 0.3, 'blue');
    q = p(5, 4.2); this.barrier(q[0], q[1], rot % 2 ? 0 : 1, 1);
  }
  _f_tankfarm(x, z) {
    const r = this.rng;
    if (r.chance(0.45)) { this.tank(x, z, r.f(4.2, 5), r.f(8, 11), r.pick(['cream', 'white', 'rustc'])); }
    else { const s = r.sign(); this.tank(x - 3.3, z - s * 3.2, 2.9, r.f(6, 8), r.pick(['cream', 'white', 'rustc'])); this.tank(x + 3.3, z + s * 3.2, 2.9, r.f(6, 8), r.pick(['cream', 'white', 'gray'])); }
    for (let k = 0; k < 2; k++) { const a = r.f(TAU); this.barrier(x + Math.cos(a) * 7.2, z + Math.sin(a) * 7.2, Math.abs(Math.cos(a)) > 0.7 ? 0 : 1); }
    const a = r.f(TAU); this.generator(x + Math.cos(a) * 6.9, z + Math.sin(a) * 6.9, r.i(0, 3));
  }
  _f_piperack(x, z) {
    const r = this.rng, rot = r.i(0, 1);
    this.pipeRack(x, z, rot, 14);
    const s = r.sign();
    const px = rot ? x : x + s * 4.5, pz = rot ? z + s * 4.5 : z;
    this.generator(px, pz, rot ? 0 : 1);
    this.crateStack(rot ? x + r.f(-4, 4) : x - s * 4.5, rot ? z - s * 4.5 : z + r.f(-4, 4), 2);
    this.barrier(rot ? x + 5 : x - s * 6.6, rot ? z - s * 6.6 : z + 5, rot ? 0 : 1);
  }
  _f_catwalk(x, z) {
    const r = this.rng, rot = r.i(0, 3);
    const P = this.catwalk(x, z, rot, 9, 2.6, 2.8), p = (lx, lz) => { _p.set(lx, 0, lz).applyMatrix4(P.m); return [_p.x, _p.z]; };
    P.pieceCrate = 1;
    let q = p(0, -1.5); this.crate(q[0], 2.8, q[1], 0.9, 'olive', r.f(1), 0.7);
    q = p(3.6, -2); this.crateStack(q[0], q[1], 2);
    q = p(-3.8, 1); this.generator(q[0], q[1], (rot + 1) % 4);
    q = p(-3.6, -4); this.barrel(q[0], 0, q[1], 'blue');
    q = p(4.4, 3.5); this.sandbags(q[0], q[1], rot % 2, 5, 4);
  }

  _buildCore() {
    const r = this.rng, H = this.half, R = H;
    this._floor();
    // ring wall (octagon-ish from segments)
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, x = Math.cos(a) * (R + 1.5), z = Math.sin(a) * (R + 1.5);
      const P = this.piece(x, 0, z, 0), w = (TAU * (R + 1.5)) / N + 0.9, ry = -a + Math.PI / 2;
      P.box('wall', w, 9, 2.2, 0, 4.5, 0, PAL.conc, { ry });
      P.box('wall', w, 0.5, 2.6, 0, 9.2, 0, PAL.concDark, { ry });
      P.box('hazard', w, 0.7, 2.3, 0, 1.2, 0, PAL.conc, { ry });
      if (i % 2 === 0) { P.glow(0.5, 4.5, 0.12, 0, 5, -1.14, [1.0, 0.28, 0.1], 3.2, ry); }
      else P.glow(1.6, 0.14, 0.12, 0, 7.6, -1.14, [0.5, 0.75, 1.0], 5, ry);
    }
    // collision ring: boxes
    for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, x = Math.cos(a) * (R + 1.4), z = Math.sin(a) * (R + 1.4); this.addCollider(x - 3.6, 0, z - 3.6, x + 3.6, 14, z + 3.6, { nav: true }); }
    // pillars
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.39, d = i % 2 ? 30 : 21, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const P = this.piece(x, 0, z, 0);
      P.box('wall', 3.2, 8.5, 3.2, 0, 4.25, 0, PAL.conc, { bevel: 0.08 });
      P.box('hazard', 3.26, 0.8, 3.26, 0, 0.9, 0, PAL.conc);
      P.box('panel', 3.5, 0.4, 3.5, 0, 8.6, 0, PAL.dark, { bevel: 0.05 });
      for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P.glow(s[0] ? 0.06 : 1.2, 0.12, s[1] ? 0.06 : 1.2, s[0] * 1.63, 6.6, s[1] * 1.63, [0.45, 0.72, 1.0], 6);
      P.lamp(0, 6.4, 0, [0.5, 0.74, 1.0], 9, 0.8);
      P.collide(-1.6, 0, -1.6, 1.6, 8.8, 1.6);
    }
    // low cover
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13, d = i % 2 ? 37 : 14, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (i % 3 === 0) this.sandbags(x, z, Math.abs(Math.cos(a)) > 0.7 ? 1 : 0, 6, 4); else this.barrier(x, z, Math.abs(Math.cos(a)) > 0.7 ? 0 : 1, i % 2);
    }
    for (let i = 0; i < 10; i++) { const a = r.f(TAU), d = r.f(12, 40); this._tryBarrel(Math.cos(a) * d, Math.sin(a) * d); }
    // floor rings
    for (const rr of [8, 8.5, 26]) for (let i = 0; i < 48; i++) { const a0 = (i / 48) * TAU, a1 = ((i + 0.72) / 48) * TAU; this._paintLine(Math.cos(a0) * rr, Math.sin(a0) * rr, Math.cos(a1) * rr, Math.sin(a1) * rr, rr === 26 ? 0.3 : 0.2, rr === 26 ? PAL.yellow : PAL.white); }
    this.piece(0, 0, 0, 0).floorLabel(11, 9, 2.2, 0, 0, PAL.white);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + 0.2, d = i % 2 ? 40 : 28; this.spawns.push({ x: Math.cos(a) * d, z: Math.sin(a) * d }); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; this.slots.push({ x: Math.cos(a) * 33, z: Math.sin(a) * 33 }); }
    this.start = { x: 0, z: R - 8, yaw: 0 };
    this.isCore = true;
  }

  _buildSurround() {
    const r = new RNG((this.def.seed || 1) * 7 + 3), sky = this.sky;
    // outer ground
    const g = new THREE.RingGeometry(0.1, 900, 48, 1); g.rotateX(-Math.PI / 2); g.translate(0, -0.06, 0);
    this.addGeo('dirt', g, mul(PAL.conc, 0.85), { far: true, noShadow: true });
    // distant structures
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + r.f(-0.08, 0.08), d = this.half + r.f(26, 150), x = Math.cos(a) * d, z = Math.sin(a) * d, t = r.f(1);
      const P = this.piece(x, 0, z, r.i(0, 3)), far = { far: true, noShadow: d > this.half + 60 };
      if (t < 0.3) { const rr = r.f(5, 9), h = r.f(10, 20); P.cyl('panel', rr, rr, h, 0, h / 2, 0, r.pick([PAL.cream, PAL.white, PAL.gray]), { seg: 24, ...far }); }
      else if (t < 0.55) { const w = r.f(14, 30), h = r.f(8, 18), dd = r.f(12, 20); P.box('wall', w, h, dd, 0, h / 2, 0, PAL.conc, far); P.box('corrugated', w + 1, 0.4, dd + 1, 0, h + 0.2, 0, PAL.gray, far); if (this.lampK > 0.5) for (let k = 0; k < 5; k++) P.glow(1.4, 0.9, 0.2, r.f(-w / 2 + 1, w / 2 - 1), r.f(3, h - 2), (dd / 2 + 0.1) * r.sign(), [1, 0.72, 0.4], 2.5); }
      else if (t < 0.75) { // crane
        const h = r.f(26, 40); P.box('gunmetal', 1.4, h, 1.4, 0, h / 2, 0, PAL.yellow, far); P.box('gunmetal', 1.2, 1.2, 34, 0, h, 8, PAL.yellow, far); P.box('panel', 3, 3, 4, 0, h - 1, -4, PAL.dark, far);
        P.box('gunmetal', 0.1, h * 0.55, 0.1, 0, h - h * 0.275, 18, PAL.black, far); P.glow(0.4, 0.4, 0.4, 0, h + 1, 24, [1, 0.1, 0.05], 16);
      } else if (t < 0.9) { // chimney stack
        const h = r.f(30, 55); P.cyl('wall', 1.6, 2.6, h, 0, h / 2, 0, PAL.conc, { seg: 14, ...far }); P.cyl('hazard', 1.75, 1.85, 3, 0, h - 4, 0, PAL.conc, { seg: 14, ...far }); P.glow(0.5, 0.5, 0.5, 0, h + 0.5, 0, [1, 0.1, 0.05], 16);
      } else { for (let k = 0; k < 3; k++) { let y = 0; for (let l = 0; l < r.i(1, 3); l++) { const PP = this.piece(x + k * 3, y, z, P.rotQ); PP.box('corrugated', 2.44, 2.59, 12.2, 0, 1.3, 0, PAL[r.pick(CONTAINER_COLS)], far); y += 2.59; } } }
    }
    // mountains (two silhouette rings)
    const hz = new THREE.Color().fromArray(sky.horizon), zn = new THREE.Color().fromArray(sky.zenith), fg = new THREE.Color().fromArray(sky.fog);
    const ridge = (rad, hMax, seed, col) => {
      const rr = new RNG(seed), seg = 160, pos = [], idx = [];
      const ph = [rr.f(6), rr.f(6), rr.f(6), rr.f(6)];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU, n = Math.sin(a * 3 + ph[0]) * 0.5 + Math.sin(a * 7 + ph[1]) * 0.28 + Math.sin(a * 17 + ph[2]) * 0.14 + Math.sin(a * 41 + ph[3]) * 0.08;
        const h = hMax * (0.42 + 0.58 * Math.abs(n));
        pos.push(Math.cos(a) * rad, -4, Math.sin(a) * rad, Math.cos(a) * rad, h, Math.sin(a) * rad);
        if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx);
      const m = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide, toneMapped: false }));
      m.frustumCulled = false; this.group.add(m); this.extraMats.push(m.material);
    };
    const k = sky.skyInt;
    ridge(880, 170, 11 + (this.def.seed || 0), hz.clone().lerp(zn, 0.35).multiplyScalar(0.62 * k));
    ridge(640, 90, 23 + (this.def.seed || 0), fg.clone().lerp(hz, 0.3).multiplyScalar(0.5 * k));
  }

  _finalize() {
    // merge buckets
    for (const [key, b] of this.buckets) {
      const geo = b.geos.length === 1 ? b.geos[0] : THREE.mergeGeometries(b.geos, false);
      if (!geo) { console.warn('merge failed', key); continue; }
      for (const g of b.geos) if (g !== geo) g.dispose();
      const mat = this.matByName[b.mat];
      const mesh = new THREE.Mesh(geo, mat);
      const decal = b.mat === 'label' || b.mat === 'paint' || b.mat === 'pool' || b.mat === 'shaft';
      mesh.castShadow = b.shadow && !decal && b.mat !== 'glow'; mesh.receiveShadow = !decal && b.mat !== 'glow';
      if (decal) { mesh.layers.set(1); mesh.renderOrder = b.mat === 'pool' ? 3 : b.mat === 'shaft' ? 4 : 2; }
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.buckets.clear();
    // real lights: pick most central lamps
    const q = this.gfx.q;
    if (this.lampK > 0.2) {
      const sorted = this.lamps.filter(l => l.real).sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));
      const chosen = [];
      for (const l of sorted) { if (chosen.length >= q.lights) break; if (chosen.every(c => Math.hypot(c.x - l.x, c.z - l.z) > 16)) chosen.push(l); }
      for (const l of chosen) { const pl = new THREE.PointLight(new THREE.Color(l.color[0], l.color[1], l.color[2]), 95 * this.lampK, 26, 2); pl.position.set(l.x, l.y - 0.3, l.z); this.group.add(pl); this.lights.push(pl); }
    }
    // spatial hash for movement queries
    this.cellSize = 4; this.hash = new Map();
    this.colliders.forEach((c) => this._hashInsert(c));
    this._buildNav();
    // sanitize spawns / slots
    this.spawns = this.spawns.filter(s => !this.navBlocked(s.x, s.z, 1));
    if (this.def.mp) this._mpSpawns();
    this.gfx.scene.add(this.group);
  }
  _hashInsert(c) {
    const cs = this.cellSize;
    for (let i = Math.floor(c.minX / cs); i <= Math.floor(c.maxX / cs); i++) for (let j = Math.floor(c.minZ / cs); j <= Math.floor(c.maxZ / cs); j++) {
      const k = i * 4096 + j; let a = this.hash.get(k); if (!a) { a = []; this.hash.set(k, a); } a.push(c);
    }
  }
  near(x, z, rad, out) {
    out.length = 0; const cs = this.cellSize;
    for (let i = Math.floor((x - rad) / cs); i <= Math.floor((x + rad) / cs); i++) for (let j = Math.floor((z - rad) / cs); j <= Math.floor((z + rad) / cs); j++) {
      const a = this.hash.get(i * 4096 + j); if (a) for (const c of a) if (!c.dead && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }

  // ---------- physics ----------
  moveBody(b, dt) {
    const sp = Math.hypot(b.vx, b.vz) * dt, steps = clamp(Math.ceil(sp / (b.r * 0.5)), 1, 8), sdt = dt / steps;
    const list = this._near || (this._near = []);
    const stepH = b.onGround ? 0.5 : 0.12;
    for (let s = 0; s < steps; s++) {
      let nx = b.x + b.vx * sdt, nz = b.z + b.vz * sdt;
      this.near(nx, nz, b.r + 0.5, list);
      for (let it = 0; it < 2; it++) for (const c of list) {
        if (!c.move || c.maxY <= b.y + stepH || c.minY >= b.y + b.h) continue;
        if (c.cyl) {
          const dx = nx - c.cyl.x, dz = nz - c.cyl.z, d = Math.hypot(dx, dz), R = c.cyl.r + b.r;
          if (d < R) { if (d > 1e-5) { nx = c.cyl.x + dx / d * R; nz = c.cyl.z + dz / d * R; } else nx += R; b.hitWall = true; }
          continue;
        }
        const cx = clamp(nx, c.minX, c.maxX), cz = clamp(nz, c.minZ, c.maxZ), dx = nx - cx, dz = nz - cz, d2 = dx * dx + dz * dz;
        if (d2 < b.r * b.r) {
          if (d2 > 1e-10) { const d = Math.sqrt(d2), push = b.r - d; nx += dx / d * push; nz += dz / d * push; }
          else { const l = nx - c.minX, rr = c.maxX - nx, f = nz - c.minZ, bk = c.maxZ - nz, m = Math.min(l, rr, f, bk); if (m === l) nx = c.minX - b.r; else if (m === rr) nx = c.maxX + b.r; else if (m === f) nz = c.minZ - b.r; else nz = c.maxZ + b.r; }
          b.hitWall = true;
        }
      }
      b.x = nx; b.z = nz;
    }
    // vertical
    b.vy -= (b.gravity ?? 22) * dt;
    let ny = b.y + b.vy * dt, ground = 0;
    this.near(b.x, b.z, b.r + 0.3, list);
    const fr = b.r * 0.72;
    for (const c of list) {
      if (!c.move) continue;
      let over;
      if (c.cyl) over = Math.hypot(b.x - c.cyl.x, b.z - c.cyl.z) < c.cyl.r + fr * 0.5;
      else over = b.x > c.minX - fr && b.x < c.maxX + fr && b.z > c.minZ - fr && b.z < c.maxZ + fr;
      if (!over) continue;
      if (c.maxY <= b.y + stepH + 0.02) { if (c.maxY > ground) ground = c.maxY; }
      else if (c.minY >= b.y + b.h - 0.05 && ny + b.h > c.minY && b.vy > 0) { ny = c.minY - b.h; b.vy = 0; }
    }
    const was = b.onGround;
    if (ny <= ground) { b.landV = was ? 0 : -b.vy; ny = ground; b.vy = 0; b.onGround = true; }
    else if (was && b.vy <= 0 && ny - ground < 0.35) { ny = ground; b.vy = 0; b.onGround = true; b.landV = 0; }
    else { b.onGround = false; b.landV = 0; }
    b.y = ny; b.groundY = ground;
  }

  // ray vs world. returns hit object (reused) or null
  raycast(ox, oy, oz, dx, dy, dz, maxT, shotOnly = true) {
    let best = maxT, bn = 0, bc = null;
    const x1 = ox + dx * maxT, z1 = oz + dz * maxT, y1 = oy + dy * maxT;
    const mnx = Math.min(ox, x1), mxx = Math.max(ox, x1), mnz = Math.min(oz, z1), mxz = Math.max(oz, z1), mny = Math.min(oy, y1), mxy = Math.max(oy, y1);
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const cols = this.colliders;
    for (let i = 0, n = cols.length; i < n; i++) {
      const c = cols[i];
      if (c.dead || (shotOnly && !c.shot) || c.minX > mxx || c.maxX < mnx || c.minZ > mxz || c.maxZ < mnz || c.minY > mxy || c.maxY < mny) continue;
      if (c.cyl) {
        // vertical cylinder
        const fx = ox - c.cyl.x, fz = oz - c.cyl.z, a = dx * dx + dz * dz;
        let t = -1, nrm = 6;
        if (a > 1e-9) {
          const bq = fx * dx + fz * dz, cq = fx * fx + fz * fz - c.cyl.r * c.cyl.r, disc = bq * bq - a * cq;
          if (disc >= 0) { const tt = (-bq - Math.sqrt(disc)) / a; const yy = oy + dy * tt; if (tt > 0 && yy >= c.minY && yy <= c.maxY) t = tt; }
        }
        if (t < 0 && dy < 0 && oy > c.maxY) { const tt = (c.maxY - oy) / dy, hx = ox + dx * tt - c.cyl.x, hz = oz + dz * tt - c.cyl.z; if (hx * hx + hz * hz <= c.cyl.r * c.cyl.r) { t = tt; nrm = 2; } }
        if (t > 0 && t < best) { best = t; bn = nrm; bc = c; }
        continue;
      }
      let t0 = (c.minX - ox) * ix, t1 = (c.maxX - ox) * ix, ax = 0; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; ax = 1; }
      let tmin = t0, tmax = t1, na = ax;
      t0 = (c.minY - oy) * iy; t1 = (c.maxY - oy) * iy; ax = 2; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; ax = 3; }
      if (t0 > tmin) { tmin = t0; na = ax; } if (t1 < tmax) tmax = t1;
      if (tmin > tmax) continue;
      t0 = (c.minZ - oz) * iz; t1 = (c.maxZ - oz) * iz; ax = 4; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; ax = 5; }
      if (t0 > tmin) { tmin = t0; na = ax; } if (t1 < tmax) tmax = t1;
      if (tmin > tmax || tmin < 0 || tmin >= best) continue;
      best = tmin; bn = na; bc = c;
    }
    // ground
    if (dy < 0) { const t = -oy / dy; if (t > 0 && t < best) { best = t; bn = 3; bc = null; } }
    if (best >= maxT) return null;
    const h = this._hit || (this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, c: null, kind: 'concrete' });
    h.t = best; h.x = ox + dx * best; h.y = oy + dy * best; h.z = oz + dz * best; h.c = bc; h.kind = bc ? bc.kind : 'concrete';
    h.nx = h.ny = h.nz = 0;
    if (bn === 6) { const lx = h.x - bc.cyl.x, lz = h.z - bc.cyl.z, l = Math.hypot(lx, lz) || 1; h.nx = lx / l; h.nz = lz / l; }
    else if (bn === 0) h.nx = -1; else if (bn === 1) h.nx = 1; else if (bn === 2) h.ny = -1; else if (bn === 3) h.ny = 1; else if (bn === 4) h.nz = -1; else h.nz = 1;
    if (bn === 2 && bc && bc.cyl) h.ny = 1;
    return h;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05);
    return !h;
  }

  // ---------- nav ----------
  _buildNav() {
    const H = Math.ceil(this.half) + 2, N = H * 2;
    this.navN = N; this.navH = H;
    const blocked = this.blocked = new Uint8Array(N * N);
    for (const c of this.colliders) {
      if (!c.move || !c.nav || c.minY > 1.5 || c.maxY < 0.45) continue;
      const x0 = Math.max(0, Math.floor(c.minX - 0.35 + H)), x1 = Math.min(N - 1, Math.floor(c.maxX + 0.35 + H)), z0 = Math.max(0, Math.floor(c.minZ - 0.35 + H)), z1 = Math.min(N - 1, Math.floor(c.maxZ + 0.35 + H));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (c.cyl) { const px = x - H + 0.5, pz = z - H + 0.5; if (Math.hypot(px - c.cyl.x, pz - c.cyl.z) > c.cyl.r + 0.75) continue; }
        blocked[z * N + x] = 1;
      }
    }
    for (let i = 0; i < N; i++) { blocked[i] = blocked[(N - 1) * N + i] = blocked[i * N] = blocked[i * N + N - 1] = 1; }
    // clearance (chebyshev distance to nearest blocked), capped
    const cl = this.clear = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) cl[i] = blocked[i] ? 0 : 9;
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) { const i = z * N + x; if (!cl[i]) continue; cl[i] = Math.min(cl[i], cl[i - 1] + 1, cl[i - N] + 1, cl[i - N - 1] + 1, cl[i - N + 1] + 1); }
      for (let z = N - 2; z > 0; z--) for (let x = N - 2; x > 0; x--) { const i = z * N + x; if (!cl[i]) continue; cl[i] = Math.min(cl[i], cl[i + 1] + 1, cl[i + N] + 1, cl[i + N + 1] + 1, cl[i + N - 1] + 1); }
    }
    this.flow = [new Uint16Array(N * N), new Uint16Array(N * N)]; // distance fields for small (clear>=1) and large (clear>=2)
    this._queue = new Int32Array(N * N);
    this.flowTarget = [-1, -1];
  }
  navIdx(x, z) { const N = this.navN, H = this.navH; const ix = clamp(Math.floor(x + H), 0, N - 1), iz = clamp(Math.floor(z + H), 0, N - 1); return iz * N + ix; }
  navBlocked(x, z, size = 1) { return this.clear[this.navIdx(x, z)] < size; }
  // BFS distance field from the target, for agents needing 'size' clearance
  updateFlow(which, tx, tz) {
    const N = this.navN, size = which + 1, cl = this.clear, dist = this.flow[which], q = this._queue;
    let start = this.navIdx(tx, tz);
    if (cl[start] < size) { // nearest free cell
      let best = -1, bd = 1e9; const H = this.navH, sx = Math.floor(tx + H), sz = Math.floor(tz + H);
      for (let r = 1; r < 14 && best < 0; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const x = sx + dx, z = sz + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x; if (cl[i] >= size) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
      }
      if (best < 0) return; start = best;
    }
    if (this.flowTarget[which] === start) return;
    this.flowTarget[which] = start;
    dist.fill(65535); dist[start] = 0; let qh = 0, qt = 0; q[qt++] = start;
    while (qh < qt) {
      const i = q[qh++], d = dist[i] + 1;
      let j = i - 1; if (cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
      j = i + 1; if (cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
      j = i - N; if (j >= 0 && cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
      j = i + N; if (j < N * N && cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
    }
  }
  // cached distance field to an arbitrary target (used by multiplayer AI); returns Uint16Array or null
  flowField(tx, tz, size = 1) {
    const N = this.navN, cl = this.clear, H = this.navH;
    let start = this.navIdx(tx, tz);
    if (cl[start] < size) { let best = -1, bd = 1e9; const sx = Math.floor(tx + H), sz = Math.floor(tz + H);
      for (let r = 1; r < 10 && best < 0; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const x = sx + dx, z = sz + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue; const i = z * N + x; if (cl[i] >= size) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } } }
      if (best < 0) return null; start = best; }
    const key = start * 4 + size; this._ff = this._ff || new Map();
    let dist = this._ff.get(key);
    if (dist) { this._ff.delete(key); this._ff.set(key, dist); return dist; }
    if (this._ff.size >= 24) { const k0 = this._ff.keys().next().value; dist = this._ff.get(k0); this._ff.delete(k0); } else dist = new Uint16Array(N * N);
    const q = this._queue; dist.fill(65535); dist[start] = 0; let qh = 0, qt = 0; q[qt++] = start;
    while (qh < qt) { const i = q[qh++], d = dist[i] + 1;
      let j = i - 1; if (cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
      j = i + 1; if (cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
      j = i - N; if (j >= 0 && cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; }
      j = i + N; if (j < N * N && cl[j] >= size && dist[j] > d) { dist[j] = d; q[qt++] = j; } }
    this._ff.set(key, dist); return dist;
  }
  flowDir(which, x, z, out) { return this.flowDirIn(this.flow[which], x, z, out); }
  // direction of steepest descent toward target; writes into out {x,z}; returns distance in cells
  flowDirIn(dist, x, z, out) {
    const N = this.navN, H = this.navH;
    const ix = clamp(Math.floor(x + H), 1, N - 2), iz = clamp(Math.floor(z + H), 1, N - 2), i = iz * N + ix;
    let best = dist[i], bx = 0, bz = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue; const j = i + dz * N + dx, d = dist[j];
      if (d < best) { if (dx && dz && (dist[i + dx] === 65535 || dist[i + dz * N] === 65535)) continue; best = d; bx = dx; bz = dz; }
    }
    if (dist[i] === 65535) { // inside blocked cell: escape to any free neighbour
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const d = dist[i + dz * N + dx]; if (d < best) { best = d; bx = dx; bz = dz; } }
    }
    // aim at centre of next cell for smoother paths
    const tx = ix + bx - H + 0.5, tz = iz + bz - H + 0.5; let ox = tx - x, oz = tz - z; const l = Math.hypot(ox, oz) || 1;
    out.x = (bx || bz) ? ox / l : 0; out.z = (bx || bz) ? oz / l : 0;
    return dist[i];
  }

  removeProp(prop) { prop.dead = true; prop.collider.dead = true; this.group.remove(prop.mesh); }

  update(t) { for (const f of this.anim) f(t); }

  dispose() {
    this.gfx.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.extraMats) m.dispose();
  }
}

class Piece {
  constructor(L, x, y, z, rot) { this.L = L; this.rotQ = rot; this.m = new THREE.Matrix4().makeRotationY(rot * Math.PI / 2).setPosition(x, y, z); }
  _local(x, y, z, o) {
    if (o.pivot && o.ry) { const c = Math.cos(o.ry), s = Math.sin(o.ry), px = x * c + z * s, pz = -x * s + z * c; x = px; z = pz; }
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e);
    return _m.compose(_p.set(x, y, z), _q, _s).premultiply(this.m);
  }
  geo(mat, g, lm, color, o = {}) {
    if (o.cylUV) { const uv = g.attributes.uv, tile = TEX_TILE[mat] || 2, rep = Math.max(1, Math.round((TAU * o.cylUV) / tile)); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rep, uv.getY(i) * (o.cylH || 1)); o.keepUV = true; }
    if (lm) g.applyMatrix4(_m2.copy(lm).premultiply(this.m)); else g.applyMatrix4(this.m);
    this.L.addGeo(mat, g, color, o);
  }
  box(mat, w, h, d, x, y, z, color, o = {}) {
    const g = o.bevel ? new THREE.RoundedBoxGeometry(w, h, d, o.seg || 1, o.bevel) : new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(this._local(x, y, z, o));
    this.L.addGeo(mat, g, color, o);
  }
  cyl(mat, rt, rb, h, x, y, z, color, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 16);
    // cylindrical UVs with integer wrap count
    const tile = TEX_TILE[mat] || 2, R = Math.max(rt, rb), rep = Math.max(1, Math.round((TAU * R) / tile)), uv = g.attributes.uv, nr = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) { if (Math.abs(nr.getY(i)) > 0.9) uv.setXY(i, uv.getX(i) * 2 * R / tile, uv.getY(i) * 2 * R / tile); else uv.setXY(i, uv.getX(i) * rep, uv.getY(i) * h / tile); }
    g.applyMatrix4(this._local(x, y, z, o));
    this.L.addGeo(mat, g, color, { ...o, keepUV: true });
  }
  glow(w, h, d, x, y, z, color, k, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(this._local(x, y, z, { ry }));
    this.L.addGeo('glow', g, [color[0] * k, color[1] * k, color[2] * k], { noShadow: true, keepUV: true });
  }
  // lamp: ground light pool (+optional shaft), registered as candidate for a real light
  lamp(x, y, z, color, radius, k = 1, shaft = false) {
    const L = this.L, K = L.lampK * k;
    _p.set(x, y, z).applyMatrix4(this.m);
    const wx = _p.x, wy = _p.y, wz = _p.z;
    L.lamps.push({ x: wx, y: wy, z: wz, color, real: radius >= 6 });
    if (K < 0.05) return;
    const g = new THREE.PlaneGeometry(radius * 2, radius * 2); g.rotateX(-Math.PI / 2); g.translate(wx, 0.03, wz);
    L.addGeo('pool', g, [color[0] * K * 0.5, color[1] * K * 0.5, color[2] * K * 0.5], { keepUV: true, noShadow: true });
    if (shaft && K > 0.4) {
      const c = new THREE.CylinderGeometry(0.2, radius * 0.5, wy, 18, 1, true); c.translate(wx, wy / 2, wz);
      L.addGeo('shaft', c, [color[0] * K * 0.07, color[1] * K * 0.07, color[2] * K * 0.07], { keepUV: true, noShadow: true });
    }
  }
  // wall label: face 0:+x 1:... (ry given by face index) ; faces: 0=+z? we use explicit: face 1 => facing +x, 2 => facing +z, 3 => facing -z, 0 => custom ry
  label(idx, w, h, x, y, z, face, color, ryCustom = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    const u0 = (idx % 2) * 0.5, v0 = 1 - (((idx / 2) | 0) + 1) * 0.125, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.125);
    const ry = face === 1 ? Math.PI / 2 * Math.sign(x || 1) : face === 2 ? 0 : face === 3 ? Math.PI : ryCustom;
    g.applyMatrix4(this._local(x, y, z, { ry }));
    this.L.addGeo('label', g, color, { keepUV: true, noShadow: true });
  }
  floorLabel(idx, w, h, x, z, color) {
    const g = new THREE.PlaneGeometry(w, h); g.rotateX(-Math.PI / 2);
    const u0 = (idx % 2) * 0.5, v0 = 1 - (((idx / 2) | 0) + 1) * 0.125, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.125);
    g.applyMatrix4(this._local(x, 0.022, z, {}));
    this.L.addGeo('label', g, color, { keepUV: true, noShadow: true });
  }
  collide(x0, y0, z0, x1, y1, z1, o) {
    const a = _p.set(x0, y0, z0).applyMatrix4(this.m), ax = a.x, ay = a.y, az = a.z;
    const b = _p.set(x1, y1, z1).applyMatrix4(this.m);
    return this.L.addCollider(Math.min(ax, b.x), Math.min(ay, b.y), Math.min(az, b.z), Math.max(ax, b.x), Math.max(ay, b.y), Math.max(az, b.z), o);
  }
}
