// Particles, decals, shell casings, debris, weather
import * as THREE from './lib/three.min.js';
import { rand, clamp, TAU } from './util.js';

const PVERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iTail; attribute vec4 iData; attribute vec4 iCol;
uniform float uFogD;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){
  vec4 mv=viewMatrix*vec4(iPos,1.);
  vec2 c=position.xy; float size=iData.x;
  if(iData.w>.5){
    vec3 tv=(viewMatrix*vec4(iTail,0.)).xyz; vec3 head=mv.xyz, tail=mv.xyz+tv; vec3 dir=tail-head;
    vec3 side=cross(dir,head); float sl=length(side); side=sl>1e-6?side/sl:vec3(1.,0.,0.);
    mv.xyz=mix(head,tail,c.y+.5)+side*c.x*size;
  } else { float s=sin(iData.y), co=cos(iData.y); mv.xy+=vec2(c.x*co-c.y*s,c.x*s+c.y*co)*size; }
  gl_Position=projectionMatrix*mv;
  float f=iData.z; vUv=(vec2(mod(f,4.),3.-floor(f/4.))+uv)/4.;
  vCol=iCol; float d=uFogD*mv.z; vFog=exp(-d*d);
}`;
const PFRAG_ADD = `precision highp float; uniform sampler2D tAtlas; varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){ vec4 t=texture2D(tAtlas,vUv); float a=t.a*vCol.a*vFog; if(a<.002)discard; gl_FragColor=vec4(vCol.rgb*t.rgb*a,1.); }`;
const PFRAG_ALPHA = `precision highp float; uniform sampler2D tAtlas; uniform vec3 uFogC; varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){ vec4 t=texture2D(tAtlas,vUv); float a=t.a*vCol.a; if(a<.004)discard; gl_FragColor=vec4(mix(uFogC,vCol.rgb*t.rgb,vFog),a); }`;

class Layer {
  constructor(max, atlas, additive) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 3); this.tail = new Float32Array(max * 3); this.data = new Float32Array(max * 4); this.col = new Float32Array(max * 4);
    const mk = (arr, n, name) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk(this.pos, 3, 'iPos'); this.aTail = mk(this.tail, 3, 'iTail'); this.aData = mk(this.data, 4, 'iData'); this.aCol = mk(this.col, 4, 'iCol');
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: additive ? PFRAG_ADD : PFRAG_ALPHA, transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      uniforms: { tAtlas: { value: atlas }, uFogD: { value: 0.01 }, uFogC: { value: new THREE.Color() } },
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.layers.set(1); this.mesh.renderOrder = additive ? 11 : 10;
    this.geo = g;
  }
  push(x, y, z, tx, ty, tz, size, rot, frame, stretch, r, g, b, a) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z; this.tail[i3] = tx; this.tail[i3 + 1] = ty; this.tail[i3 + 2] = tz;
    this.data[i4] = size; this.data[i4 + 1] = rot; this.data[i4 + 2] = frame; this.data[i4 + 3] = stretch;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = a;
  }
  flush() {
    this.geo.instanceCount = this.n;
    const u = (a, n) => { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * n); a.needsUpdate = true; };
    if (this.n) { u(this.aPos, 3); u(this.aTail, 3); u(this.aData, 4); u(this.aCol, 4); }
    this.n = 0;
  }
}

export class FX {
  constructor(game) {
    this.game = game; const gfx = this.gfx = game.gfx; this.scene = gfx.scene;
    const k = gfx.q.fx;
    this.MAX = Math.round(1400 * k);
    this.add = new Layer(this.MAX + 900, game.fxAtlas, true);
    this.alpha = new Layer(Math.round(700 * k) + 100, game.fxAtlas, false);
    this.scene.add(this.add.mesh, this.alpha.mesh);
    // particle pool (object based for simplicity)
    this.P = []; this.free = [];
    for (let i = 0; i < this.MAX; i++) this.free.push({});
    this._sort = [];
    // decals
    const DM = this.DM = 220;
    const dg = new THREE.InstancedBufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    dg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); dg.setIndex([0, 1, 2, 0, 2, 3]);
    this.dC = new Float32Array(DM * 3); this.dT = new Float32Array(DM * 3); this.dB = new Float32Array(DM * 3); this.dD = new Float32Array(DM * 2);
    this.adC = new THREE.InstancedBufferAttribute(this.dC, 3); this.adT = new THREE.InstancedBufferAttribute(this.dT, 3); this.adB = new THREE.InstancedBufferAttribute(this.dB, 3); this.adD = new THREE.InstancedBufferAttribute(this.dD, 2);
    dg.setAttribute('iC', this.adC); dg.setAttribute('iT', this.adT); dg.setAttribute('iB', this.adB); dg.setAttribute('iD', this.adD);
    dg.instanceCount = 0; this.dGeo = dg; this.dN = 0; this.dI = 0;
    this.dMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { tMap: { value: game.decalAtlas }, uFogD: { value: 0.01 }, uFogC: { value: new THREE.Color() }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `attribute vec3 iC,iT,iB; attribute vec2 iD; uniform float uFogD; varying vec2 vUv; varying float vA; varying float vFog;
        void main(){ vec3 p=iC+iT*position.x+iB*position.y; vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; float f=iD.x; vUv=(vec2(mod(f,2.),1.-floor(f/2.))+uv)*.5; vA=iD.y; float d=uFogD*mv.z; vFog=exp(-d*d); }`,
      fragmentShader: `precision highp float; uniform sampler2D tMap; uniform vec3 uFogC,uLight; varying vec2 vUv; varying float vA; varying float vFog;
        void main(){ vec4 t=texture2D(tMap,vUv); float a=t.a*vA; if(a<.01)discard; gl_FragColor=vec4(mix(uFogC,t.rgb*uLight,vFog),a); }`,
    });
    this.dMesh = new THREE.Mesh(dg, this.dMat); this.dMesh.frustumCulled = false; this.dMesh.layers.set(1); this.dMesh.renderOrder = 5;
    this.scene.add(this.dMesh);
    // shell casings
    const cg = new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6);
    this.cMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 });
    this.casings = new THREE.InstancedMesh(cg, this.cMat, 40); this.casings.frustumCulled = false; this.casings.count = 40;
    this.cState = []; const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 40; i++) { this.cState.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), s: 1 }); this.casings.setMatrixAt(i, zero); }
    this.cI = 0; this.scene.add(this.casings);
    // flat ground markers (additive, rebuilt every frame)
    const MM = this.MM = 40, mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
    mg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); mg.setIndex([0, 2, 1, 0, 3, 2]);
    this.mA = new Float32Array(MM * 4); this.mB = new Float32Array(MM * 4);
    this.amA = new THREE.InstancedBufferAttribute(this.mA, 4); this.amB = new THREE.InstancedBufferAttribute(this.mB, 4); this.amA.setUsage(THREE.DynamicDrawUsage); this.amB.setUsage(THREE.DynamicDrawUsage);
    mg.setAttribute('iA', this.amA); mg.setAttribute('iB', this.amB); mg.instanceCount = 0; this.mGeo = mg; this.mN = 0;
    this.mMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { tAtlas: { value: game.fxAtlas } },
      vertexShader: `attribute vec4 iA,iB; varying vec2 vUv; varying vec3 vC; void main(){ vec3 p=iA.xyz+position*iA.w; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.); float f=iB.w; vUv=(vec2(mod(f,4.),3.-floor(f/4.))+uv)/4.; vC=iB.xyz; }`,
      fragmentShader: `precision highp float; uniform sampler2D tAtlas; varying vec2 vUv; varying vec3 vC; void main(){ vec4 t=texture2D(tAtlas,vUv); gl_FragColor=vec4(vC*t.rgb*t.a,1.); }`,
    });
    this.mMesh = new THREE.Mesh(mg, this.mMat); this.mMesh.frustumCulled = false; this.mMesh.layers.set(1); this.mMesh.renderOrder = 6; this.scene.add(this.mMesh);
    this.debris = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.t = 0;
  }

  reset() {
    for (const p of this.P) this.free.push(p); this.P.length = 0;
    this.dN = 0; this.dI = 0; this.dGeo.instanceCount = 0;
    for (const d of this.debris) { d.mesh.parent && d.mesh.parent.remove(d.mesh); if (d.own) d.mesh.geometry.dispose(); } this.debris.length = 0;
    const s = this.gfx.sky0, fc = this.add.mat.uniforms;
    for (const m of [this.add.mat, this.alpha.mat, this.dMat]) { m.uniforms.uFogD.value = s.fogDensity; if (m.uniforms.uFogC) m.uniforms.uFogC.value.fromArray(s.fog); }
    // approximate ambient for unlit smoke/decals
    const a = new THREE.Color().fromArray(s.hemiSky).multiplyScalar(s.hemiInt * 0.9).add(new THREE.Color().fromArray(s.sunCol).multiplyScalar(s.sunInt * 0.16));
    this.amb = a; this.dMat.uniforms.uLight.value.copy(a).multiplyScalar(1.3);
    this.weather = { rain: !!s.rain, embers: !!s.embers, dust: !s.rain };
  }

  // flat additive disc/ring on the ground for this frame only (size = diameter)
  marker(x, y, z, size, r, g, b, frame = 5) {
    if (this.mN >= this.MM) return; const i = this.mN++ * 4;
    this.mA[i] = x; this.mA[i + 1] = y; this.mA[i + 2] = z; this.mA[i + 3] = size; this.mB[i] = r; this.mB[i + 1] = g; this.mB[i + 2] = b; this.mB[i + 3] = frame;
  }

  // generic particle
  emit(o) {
    const p = this.free.pop(); if (!p) return null;
    p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0; p.max = o.life || 1; p.s0 = o.s0 ?? 0.1; p.s1 = o.s1 ?? p.s0; p.r = o.r ?? 1; p.g = o.g ?? 1; p.b = o.b ?? 1; p.a = o.a ?? 1;
    p.grav = o.grav || 0; p.drag = o.drag || 0; p.rot = o.rot ?? rand(TAU); p.rv = o.rv || 0; p.frame = o.frame || 0; p.add = o.add !== false; p.stretch = o.stretch || 0;
    p.fadeIn = o.fadeIn || 0; p.bounce = o.bounce || 0; p.tail = o.tail || null;
    this.P.push(p); return p;
  }

  sparks(x, y, z, nx, ny, nz, n, color = [1.0, 0.72, 0.3], speed = 7, k = 1) {
    n = Math.round(n * this.gfx.q.fx);
    for (let i = 0; i < n; i++) {
      const s = speed * rand(0.3, 1);
      this.emit({ x, y, z, vx: (nx + rand(-0.9, 0.9)) * s, vy: (ny + rand(-0.6, 1.0)) * s, vz: (nz + rand(-0.9, 0.9)) * s, life: rand(0.18, 0.55) * k, s0: rand(0.012, 0.03) * k, s1: 0.004, r: color[0] * 9, g: color[1] * 9, b: color[2] * 9, grav: 14, drag: 1.2, frame: 3, stretch: 0.035, bounce: 0.4 });
    }
  }
  puff(x, y, z, nx, ny, nz, n, col, size = 0.3, speed = 1.2, life = 0.9, alpha = 0.5) {
    n = Math.max(1, Math.round(n * this.gfx.q.fx));
    for (let i = 0; i < n; i++) {
      const s = speed * rand(0.3, 1);
      this.emit({ x, y, z, vx: (nx * 1.2 + rand(-0.6, 0.6)) * s, vy: (ny * 1.2 + rand(-0.3, 0.8)) * s, vz: (nz * 1.2 + rand(-0.6, 0.6)) * s, life: life * rand(0.6, 1.2), s0: size * rand(0.5, 0.9), s1: size * rand(2.2, 3.6), r: col[0], g: col[1], b: col[2], a: alpha, drag: 2.2, grav: -0.25, rv: rand(-1, 1), frame: [1, 2, 13][(Math.random() * 3) | 0], add: false, fadeIn: 0.08 });
    }
  }
  chips(x, y, z, nx, ny, nz, n, col) {
    n = Math.round(n * this.gfx.q.fx);
    for (let i = 0; i < n; i++) { const s = rand(2, 6); this.emit({ x, y, z, vx: (nx + rand(-0.8, 0.8)) * s, vy: (ny + rand(-0.2, 1.1)) * s, vz: (nz + rand(-0.8, 0.8)) * s, life: rand(0.5, 1.1), s0: rand(0.02, 0.055), s1: 0.02, r: col[0], g: col[1], b: col[2], a: 1, grav: 16, drag: 0.4, rv: rand(-14, 14), frame: 6, add: false, bounce: 0.35 }); }
  }
  glow(x, y, z, size, col, life = 0.08, frame = 0, k = 1) {
    this.emit({ x, y, z, life, s0: size, s1: size * 1.6, r: col[0] * k, g: col[1] * k, b: col[2] * k, frame, rot: rand(TAU) });
  }
  ring(x, y, z, s0, s1, col, life = 0.4, k = 2) { this.emit({ x, y, z, life, s0, s1, r: col[0] * k, g: col[1] * k, b: col[2] * k, frame: 5, rot: 0 }); }

  impact(h, dx, dy, dz, power = 1) {
    const a = this.amb, kind = h.kind;
    const x = h.x + h.nx * 0.02, y = h.y + h.ny * 0.02, z = h.z + h.nz * 0.02;
    if (kind === 'metal') {
      this.sparks(x, y, z, h.nx - dx * 0.4, h.ny - dy * 0.4, h.nz - dz * 0.4, 7 * power, [1.0, 0.75, 0.35], 8);
      this.glow(x, y, z, 0.28 * power, [1.0, 0.8, 0.5], 0.06, 0, 5);
      this.puff(x, y, z, h.nx, h.ny, h.nz, 1, [a.r * 0.6, a.g * 0.6, a.b * 0.6], 0.14, 1, 0.5, 0.3);
      this.decal(h, 1, rand(0.07, 0.1) * power);
    } else {
      const c = kind === 'dirt' ? [0.5 * a.r, 0.43 * a.g, 0.33 * a.b] : [0.62 * a.r, 0.6 * a.g, 0.57 * a.b];
      this.puff(x, y, z, h.nx, h.ny, h.nz, 3 * power, c, 0.2 * power, 2.2, 0.9, 0.5);
      this.chips(x, y, z, h.nx, h.ny, h.nz, 4 * power, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]);
      this.sparks(x, y, z, h.nx, h.ny, h.nz, 2, [1, 0.8, 0.5], 5);
      this.decal(h, 0, rand(0.14, 0.2) * power);
    }
  }

  decal(h, frame, size, alpha = 1) {
    const i = this.dI; this.dI = (this.dI + 1) % this.DM; this.dN = Math.min(this.DM, this.dN + 1);
    const n = this._v.set(h.nx, h.ny, h.nz), t = this._s;
    if (Math.abs(n.y) > 0.9) t.set(1, 0, 0); else t.set(0, 1, 0);
    const bx = n.y * t.z - n.z * t.y, by = n.z * t.x - n.x * t.z, bz = n.x * t.y - n.y * t.x; // b = n x t
    const ang = rand(TAU), c = Math.cos(ang) * size, s = Math.sin(ang) * size;
    const i3 = i * 3;
    this.dC[i3] = h.x + h.nx * 0.012; this.dC[i3 + 1] = h.y + h.ny * 0.012; this.dC[i3 + 2] = h.z + h.nz * 0.012;
    this.dT[i3] = t.x * c + bx * s; this.dT[i3 + 1] = t.y * c + by * s; this.dT[i3 + 2] = t.z * c + bz * s;
    this.dB[i3] = -t.x * s + bx * c; this.dB[i3 + 1] = -t.y * s + by * c; this.dB[i3 + 2] = -t.z * s + bz * c;
    this.dD[i * 2] = frame; this.dD[i * 2 + 1] = alpha;
    this.adC.needsUpdate = this.adT.needsUpdate = this.adB.needsUpdate = this.adD.needsUpdate = true;
    this.dGeo.instanceCount = this.dN;
  }

  tracer(ax, ay, az, bx, by, bz, col = [1, 0.8, 0.45], width = 0.035, speed = 300) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz); if (d < 2) return;
    const len = Math.min(d * 0.5, 9), life = d / speed;
    this.emit({ x: ax, y: ay, z: az, vx: dx / life, vy: dy / life, vz: dz / life, life, s0: width, s1: width, r: col[0] * 6, g: col[1] * 6, b: col[2] * 6, frame: 14, tail: [-dx / d * len, -dy / d * len, -dz / d * len] });
  }
  beam(ax, ay, az, bx, by, bz, col, width = 0.12, life = 0.35, k = 8) {
    this.emit({ x: bx, y: by, z: bz, life, s0: width, s1: width * 0.2, r: col[0] * k, g: col[1] * k, b: col[2] * k, frame: 14, tail: [ax - bx, ay - by, az - bz] });
    this.emit({ x: bx, y: by, z: bz, life: life * 0.6, s0: width * 4, s1: width * 0.6, r: col[0] * k * 0.25, g: col[1] * k * 0.25, b: col[2] * k * 0.25, frame: 14, tail: [ax - bx, ay - by, az - bz] });
  }

  // first-person muzzle flash. The view-model is rendered scaled-down close to the camera, so sprites are scaled to match (vm)
  muzzle(pos, dir, size = 1, col = [1.0, 0.75, 0.4], vm = 0.17, lightPos = null) {
    this.glow(pos.x, pos.y, pos.z, 0.42 * size * vm, col, 0.045, 4, 6);
    this.glow(pos.x + dir.x * 0.1 * vm, pos.y + dir.y * 0.1 * vm, pos.z + dir.z * 0.1 * vm, 0.75 * size * vm, col, 0.04, 0, 1.6);
    const a = this.amb;
    this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 0.5, vy: dir.y * 0.5 + 0.08, vz: dir.z * 0.5, life: 0.5, s0: 0.05 * size * vm, s1: 0.6 * size * vm, r: a.r * 0.8, g: a.g * 0.8, b: a.b * 0.8, a: 0.16, drag: 4, rv: rand(-1, 1), frame: 1, add: false, fadeIn: 0.04 });
    this.gfx.flash(lightPos || pos, new THREE.Color(col[0], col[1], col[2]), 9 * size, 0.07, 13);
  }

  explosion(x, y, z, radius = 5, col = [1.0, 0.55, 0.2]) {
    const k = radius / 5, a = this.amb, q = this.gfx.q.fx;
    this.glow(x, y, z, 5 * k, col, 0.12, 0, 9);
    this.glow(x, y, z, 2.6 * k, [1, 0.9, 0.7], 0.2, 4, 12);
    this.ring(x, y + 0.1, z, 0.5, radius * 2.2, [1, 0.8, 0.6], 0.3, 2.5);
    for (let i = 0; i < 12 * q; i++) { const d = rand(0.2, 1) * k, th = rand(TAU), ph = rand(0, 1.3); const vx = Math.cos(th) * Math.cos(ph), vy = Math.sin(ph), vz = Math.sin(th) * Math.cos(ph);
      this.emit({ x: x + vx * d, y: y + vy * d, z: z + vz * d, vx: vx * 6 * k, vy: vy * 6 * k + 1, vz: vz * 6 * k, life: rand(0.25, 0.5), s0: 0.9 * k, s1: 2.4 * k, r: col[0] * 7, g: col[1] * 5, b: col[2] * 3, drag: 4, frame: [1, 2, 13][i % 3], rv: rand(-2, 2) }); }
    for (let i = 0; i < 10 * q; i++) { const th = rand(TAU), ph = rand(0, 1.2), s = rand(1.5, 4) * k; 
      this.emit({ x, y: y + 0.3, z, vx: Math.cos(th) * Math.cos(ph) * s, vy: Math.sin(ph) * s + 1.5, vz: Math.sin(th) * Math.cos(ph) * s, life: rand(1.6, 3.2), s0: 1.0 * k, s1: 4.2 * k, r: a.r * 0.22, g: a.g * 0.22, b: a.b * 0.22, a: 0.75, drag: 1.6, grav: -0.5, rv: rand(-0.6, 0.6), frame: [1, 2, 13][i % 3], add: false, fadeIn: 0.15 }); }
    this.sparks(x, y + 0.2, z, 0, 0.6, 0, 26, [1, 0.7, 0.3], 16 * Math.sqrt(k), 1.8);
    this.chips(x, y + 0.2, z, 0, 0.8, 0, 10, [0.15 * a.r, 0.15 * a.g, 0.15 * a.b]);
    if (y < 1.6) this.decal({ x, y: 0, z, nx: 0, ny: 1, nz: 0 }, 2, radius * 0.9, 0.9);
    this.gfx.flash(this._v.set(x, y + 0.6, z), new THREE.Color(col[0], col[1], col[2]), 420 * k, 0.4, 40 * Math.sqrt(k));
  }

  robotHit(x, y, z, nx, ny, nz, col = [0.5, 0.8, 1.0], crit = false) {
    this.sparks(x, y, z, nx, ny, nz, crit ? 12 : 6, crit ? [1, 0.85, 0.4] : [1, 0.75, 0.4], 7);
    this.glow(x, y, z, crit ? 0.5 : 0.3, crit ? [1, 0.8, 0.3] : col, 0.07, 0, 5);
    if (Math.random() < 0.35) this.puff(x, y, z, nx, ny, nz, 1, [0.05, 0.05, 0.06], 0.14, 1.2, 0.7, 0.5);
  }
  shieldHit(x, y, z, col = [0.3, 0.7, 1.0]) { this.glow(x, y, z, 0.9, col, 0.16, 15, 4); this.glow(x, y, z, 0.5, col, 0.1, 0, 3); }
  spawnBeam(x, z, col = [1, 0.3, 0.15]) {
    this.beam(x, 60, z, x, 0, z, col, 0.6, 0.5, 6);
    this.ring(x, 0.15, z, 0.4, 6, col, 0.5, 3); this.glow(x, 1, z, 4, col, 0.3, 0, 4);
    const a = this.amb; this.puff(x, 0.2, z, 0, 0.4, 0, 6, [a.r * 0.5, a.g * 0.5, a.b * 0.5], 0.8, 3, 1.4, 0.4);
    this.sparks(x, 0.3, z, 0, 1, 0, 14, col, 9, 1.4);
  }

  casing(pos, vel, scale = 1) {
    const c = this.cState[this.cI]; this.cI = (this.cI + 1) % this.cState.length;
    c.life = 2.2; c.p.copy(pos); c.v.copy(vel); c.r.set(rand(3), rand(3), rand(3)); c.rv.set(rand(-20, 20), rand(-20, 20), rand(-20, 20)); c.s = scale; c.floor = Math.max(0, this.game.player ? this.game.player.body.groundY : 0);
  }

  // detach meshes as physical debris. o: { floor, grow (scale-up factor for parts leaving the scaled view-model), rad, sound, sparks, av }
  addDebris(mesh, vel, life = 4, own = false, o = {}) {
    mesh.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); mesh.matrixWorld.decompose(p, q, s);
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.position.copy(p); mesh.quaternion.copy(q); mesh.scale.copy(s); this.scene.add(mesh);
    if (this.debris.length > 80) { const d = this.debris.shift(); this.scene.remove(d.mesh); if (d.own) d.mesh.geometry.dispose(); }
    const k = o.av ?? 8;
    this.debris.push({ mesh, v: vel, av: new THREE.Vector3(rand(-k, k), rand(-k, k), rand(-k, k)), life, max: life, s0: s.clone(), own, rad: o.rad ?? 0.18 * s.x, floor: o.floor || 0, grow: o.grow || 1, sound: o.sound || null, sparks: !!o.sparks, smoke: Math.random() < 0.5, burn: o.sparks && Math.random() < 0.35, hit: false });
  }

  update(dt, cam) {
    this.t += dt;
    const add = this.add, alp = this.alpha, P = this.P;
    const cp = cam.getWorldPosition(this._v), cx = cp.x, cy = cp.y, cz = cp.z;
    // simulate
    const sort = this._sort; sort.length = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life += dt;
      if (p.life >= p.max) { P[i] = P[P.length - 1]; P.pop(); this.free.push(p); continue; }
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.rv * dt;
      if (p.bounce && p.y < 0.02 && p.vy < 0) { p.y = 0.02; p.vy *= -p.bounce; p.vx *= 0.6; p.vz *= 0.6; }
      const t = p.life / p.max, size = p.s0 + (p.s1 - p.s0) * (p.add ? t : 1 - (1 - t) * (1 - t));
      let a = p.a * (p.add ? (1 - t) * (1 - t) : (1 - t)); if (p.fadeIn && p.life < p.fadeIn) a *= p.life / p.fadeIn;
      if (p.add) {
        if (p.tail) add.push(p.x, p.y, p.z, p.tail[0], p.tail[1], p.tail[2], size, 0, p.frame, 1, p.r, p.g, p.b, a);
        else if (p.stretch) add.push(p.x, p.y, p.z, -p.vx * p.stretch, -p.vy * p.stretch, -p.vz * p.stretch, size, 0, p.frame, 1, p.r, p.g, p.b, a);
        else add.push(p.x, p.y, p.z, 0, 0, 0, size, p.rot, p.frame, 0, p.r, p.g, p.b, a);
      } else { p._d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) + (p.z - cz) * (p.z - cz); p._s = size; p._a = a; sort.push(p); }
    }
    sort.sort((a, b) => b._d - a._d);
    for (const p of sort) alp.push(p.x, p.y, p.z, 0, 0, 0, p._s, p.rot, p.frame, 0, p.r, p.g, p.b, p._a);
    // weather (stateless, wraps around camera)
    const w = this.weather, t = this.t, q = this.gfx.q.fx;
    if (w) {
      if (w.rain) {
        const n = Math.round(520 * q), R = 16, Hh = 14;
        for (let i = 0; i < n; i++) {
          const hx = Math.sin(i * 12.9898) * 43758.5453, hz = Math.sin(i * 78.233) * 43758.5453, hy = Math.sin(i * 39.425) * 43758.5453;
          let x = (hx - Math.floor(hx)) * 2 * R, z = (hz - Math.floor(hz)) * 2 * R, y = (hy - Math.floor(hy)) * Hh;
          y = Hh - ((t * 21 + y) % Hh); x += t * 2.2;
          x = ((x - cx) % (2 * R) + 3 * R) % (2 * R) - R + cx; z = ((z - cz) % (2 * R) + 3 * R) % (2 * R) - R + cz;
          const yy = y + cy - 5; if (yy < 0) continue;
          add.push(x, yy, z, -0.09, 0.85, 0, 0.014, 0, 10, 1, 0.3, 0.36, 0.44, 0.5);
        }
        // splashes
        for (let i = 0; i < 5 * q; i++) { const x = cx + rand(-11, 11), z = cz + rand(-11, 11); this.emit({ x, y: 0.03, z, life: 0.22, s0: 0.05, s1: 0.3, r: 0.4, g: 0.46, b: 0.55, frame: 5, a: 0.8, tail: null }); }
      }
      const n2 = Math.round((w.embers ? 90 : w.dust ? 60 : 0) * q), R2 = 12;
      for (let i = 0; i < n2; i++) {
        const hx = Math.sin(i * 91.17) * 43758.5453, hz = Math.sin(i * 17.31) * 43758.5453, hy = Math.sin(i * 55.71) * 43758.5453, f = hx - Math.floor(hx);
        let x = f * 2 * R2 + Math.sin(t * 0.3 + i) * 0.8 + t * 0.4, z = (hz - Math.floor(hz)) * 2 * R2 + Math.cos(t * 0.23 + i * 1.7) * 0.8, y = (hy - Math.floor(hy)) * 7;
        if (w.embers) y = (y + t * (0.5 + f)) % 7; else y = (y + Math.sin(t * 0.2 + i) * 0.4 + 7) % 7;
        x = ((x - cx) % (2 * R2) + 3 * R2) % (2 * R2) - R2 + cx; z = ((z - cz) % (2 * R2) + 3 * R2) % (2 * R2) - R2 + cz;
        const dd = Math.hypot(x - cx, z - cz), fade = clamp(dd - 0.8, 0, 1) * clamp((R2 - dd) / 3, 0, 1);
        if (w.embers) add.push(x, y + 0.1, z, 0, 0, 0, 0.035 + 0.03 * f, 0, 11, 0, 3.0, 0.9 + f, 0.2, fade * (0.6 + 0.4 * Math.sin(t * 5 + i)));
        else add.push(x, y + 0.1, z, 0, 0, 0, 0.02 + 0.02 * f, 0, 0, 0, this.amb.r * 1.4, this.amb.g * 1.3, this.amb.b * 1.2, fade * 0.42);
      }
    }
    // casings
    let cdirty = false;
    for (let i = 0; i < this.cState.length; i++) {
      const c = this.cState[i]; if (c.life <= 0) continue; cdirty = true;
      c.life -= dt; c.v.y -= 15 * dt; c.p.addScaledVector(c.v, dt);
      if (c.p.y < c.floor + 0.012) { c.p.y = c.floor + 0.012; if (c.v.y < -1) { c.v.y *= -0.4; c.v.x *= 0.6; c.v.z *= 0.6; c.rv.multiplyScalar(0.6); if (c.life > 0.3) this.game.audio && this.game.audio.play('casing', { pos: c.p, vol: 0.25 }); } else { c.v.set(0, 0, 0); c.rv.set(0, 0, 0); } }
      c.r.x += c.rv.x * dt; c.r.y += c.rv.y * dt; c.r.z += c.rv.z * dt;
      const s = c.life > 0 ? c.s * Math.min(1, c.life * 4) * Math.min(1, 0.22 + (2.2 - c.life) * 3.2) : 0;
      this._m.compose(c.p, this._q.setFromEuler(c.r), this._s.set(s, s, s)); this.casings.setMatrixAt(i, this._m);
    }
    if (cdirty) this.casings.instanceMatrix.needsUpdate = true;
    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.life -= dt;
      if (d.life <= 0) { this.scene.remove(d.mesh); if (d.own) d.mesh.geometry.dispose(); this.debris.splice(i, 1); continue; }
      const m = d.mesh; d.v.y -= 18 * dt; m.position.addScaledVector(d.v, dt);
      const fl = d.floor + d.rad;
      if (m.position.y < fl) {
        m.position.y = fl;
        if (d.v.y < -1.5) {
          if (!d.hit) { d.hit = true; if (d.sparks) { this.sparks(m.position.x, fl, m.position.z, 0, 1, 0, 4, [1, 0.75, 0.4], 4, 0.8); this.game.audio && this.game.audio.play('metal_hit', { pos: m.position, vol: 0.3, rv: 0.3, throttle: 0.06, ref: 3 }); } if (d.sound) this.game.audio && this.game.audio.play(d.sound, { pos: m.position, vol: 0.5, rv: 0.2, ref: 2 }); }
          d.v.y *= -0.35; d.v.x *= 0.55; d.v.z *= 0.55; d.av.multiplyScalar(0.5);
        } else { d.v.set(0, 0, 0); d.av.multiplyScalar(0.8); }
      }
      m.rotation.x += d.av.x * dt; m.rotation.y += d.av.y * dt; m.rotation.z += d.av.z * dt;
      const sk = (1 + (d.grow - 1) * Math.min(1, (d.max - d.life) / 0.3)) * (d.life < 0.6 ? Math.max(0.001, d.life / 0.6) : 1);
      if (d.grow !== 1 || d.life < 0.6) m.scale.set(d.s0.x * sk, d.s0.y * sk, d.s0.z * sk);
      if (d.burn && d.life > d.max - 2.4) { const f = 0.7 + 0.3 * Math.sin(this.t * 40 + i); add.push(m.position.x, m.position.y + 0.1, m.position.z, 0, 0, 0, 0.5 * f, 0, 11, 0, 6, 2.4, 0.5, Math.min(1, (d.life - d.max + 2.4))); }
      if (d.smoke && d.life > d.max - 1.5 && Math.random() < dt * 14) this.emit({ x: m.position.x, y: m.position.y, z: m.position.z, vy: 0.6, life: 0.8, s0: 0.12, s1: 0.5, r: 0.04, g: 0.04, b: 0.045, a: 0.55, add: false, frame: 1, rv: rand(-1, 1), fadeIn: 0.1 });
    }
    add.flush(); alp.flush();
    this.mGeo.instanceCount = this.mN; if (this.mN) { this.amA.needsUpdate = this.amB.needsUpdate = true; } this.mN = 0;
  }
}
