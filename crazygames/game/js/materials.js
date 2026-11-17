// PBR material library built on baked textures + "uber" shader patch
// (paint-mask tinting via vertex colours, per-vertex emissive/metal/rough, SSAO on indirect light, rain wetness)
import * as THREE from './lib/three.min.js';
import { shared } from './gfx.js';

export function patch(mat, o = {}) {
  const paint = o.paint !== false, surf = !!o.surf, wet = !!o.wet;
  mat.userData.emiBoost = { value: o.emiBoost ?? 1 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSSAO = shared.uSSAO; sh.uniforms.uInvRes = shared.uInvRes; sh.uniforms.uWet = shared.uWet; sh.uniforms.uEmiBoost = mat.userData.emiBoost;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${surf ? 'attribute vec3 aSurf;\nvarying vec3 vSurf;' : ''}\nvarying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${surf ? 'vSurf = aSurf;' : ''}\n#ifdef USE_INSTANCING\n vWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;\n#else\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\n#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSSAO; uniform vec2 uInvRes; uniform float uWet; uniform float uEmiBoost;
varying vec3 vWPos;
${surf ? 'varying vec3 vSurf;' : ''}
float wHash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float wNoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(wHash(i),wHash(i+vec2(1,0)),f.x),mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),f.x),f.y); }`)
      .replace('#include <color_fragment>', `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  #if defined( USE_MAP ) && ${paint ? 1 : 0}
    float paintMask = sampledDiffuseColor.a;
  #else
    float paintMask = 1.0;
  #endif
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vColor.rgb, paintMask );
#endif`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
${surf ? 'metalnessFactor = clamp(metalnessFactor * vSurf.y, 0.0, 1.0); roughnessFactor = clamp(roughnessFactor * vSurf.z, 0.04, 1.0);' : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${wet ? `if (uWet > 0.0) {
  vec3 wN = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  float up = smoothstep(0.7, 0.95, wN.y);
  float pn = wNoise(vWPos.xz * 0.19) * 0.6 + wNoise(vWPos.xz * 0.71 + 5.0) * 0.4;
  float pud = smoothstep(0.50, 0.60, pn) * up * uWet;
  float wetAll = uWet * (0.5 + 0.5 * up);
  diffuseColor.rgb *= mix(1.0, 0.58, wetAll);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.5, wetAll);
  roughnessFactor = mix(roughnessFactor, 0.035, pud);
  normal = normalize(mix(normal, nonPerturbedNormal, pud * 0.96));
}` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${surf ? 'totalEmissiveRadiance += vColor.rgb * vSurf.x * uEmiBoost;' : ''}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{ float ssao = texture2D(uSSAO, gl_FragCoord.xy * uInvRes).r;
  reflectedLight.indirectDiffuse *= ssao; reflectedLight.indirectSpecular *= mix(1.0, ssao, 0.85);
  reflectedLight.directDiffuse *= mix(1.0, ssao, 0.3); }`);
  };
  mat.customProgramCacheKey = () => `uber_${paint ? 1 : 0}${surf ? 1 : 0}${wet ? 1 : 0}`;
  return mat;
}

export function makeMaterials(tex, quality) {
  const M = {};
  const std = (t, o = {}, po = {}) => {
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, aoMap: t.orm,
      roughness: 1, metalness: 1, vertexColors: true, ...o,
    });
    return patch(m, po);
  };
  M.concrete = std(tex.concrete, {}, { paint: false, wet: true });
  M.asphalt = std(tex.asphalt, {}, { paint: false, wet: true });
  M.wall = std(tex.wall, {}, { paint: false, wet: true });
  M.corrugated = std(tex.corrugated, {}, { wet: true });
  M.panel = std(tex.panel, {}, { wet: true });
  M.rust = std(tex.rust, {}, { wet: true });
  M.tread = std(tex.tread, {}, { paint: false, wet: true });
  M.hazard = std(tex.hazard, {}, { paint: false, wet: true });
  M.dirt = std(tex.dirt, {}, { paint: false, wet: true });
  M.gunmetal = std(tex.gunmetal, {}, { wet: true });
  M.rubber = std(tex.rubber, { metalness: 0 }, { wet: true });
  // dynamic (per-vertex surf) variants for robots, weapons and props
  M.robot = std(tex.panel, {}, { surf: true });
  M.weapon = std(tex.gunmetal, { envMapIntensity: 1.25 }, { surf: true });
  // emissive, HDR via vertex colours
  M.glow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: false });
  M.glass = patch(new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.08, metalness: 0.9, vertexColors: true }), { paint: false });
  return M;
}
