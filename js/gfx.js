// Renderer + HDR post pipeline: depth prepass -> SSAO -> MSAA HDR scene -> bloom -> god rays -> filmic composite
import * as THREE from './lib/three.min.js';
import { clamp } from './util.js';

export const QUALITY = {
  low: { label: 'Low', scale: 0.72, dpr: 1, msaa: 0, ao: false, rays: false, shadow: 1024, shadowR: 36, tex: 512, fx: 0.5, lights: 3, aniso: 2 },
  medium: { label: 'Medium', scale: 0.9, dpr: 1, msaa: 2, ao: true, rays: true, shadow: 2048, shadowR: 44, tex: 1024, fx: 0.8, lights: 5, aniso: 4 },
  high: { label: 'High', scale: 1, dpr: 1.25, msaa: 4, ao: true, rays: true, shadow: 2048, shadowR: 48, tex: 1024, fx: 1, lights: 6, aniso: 8 },
  ultra: { label: 'Ultra', scale: 1, dpr: 2, msaa: 4, ao: true, rays: true, shadow: 4096, shadowR: 56, tex: 2048, fx: 1.3, lights: 8, aniso: 16 },
};

// Uniforms shared by every patched world material
export const shared = {
  uSSAO: { value: null },
  uInvRes: { value: new THREE.Vector2(1, 1) },
  uWet: { value: 0 },
  uTime: { value: 0 },
};

const FS_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

const SSAO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uRes; uniform float uRadius, uProjScale, uIntensity;
vec3 vpos(vec2 uv){ float d=texture2D(tDepth,uv).x; vec4 c=vec4(uv*2.-1.,d*2.-1.,1.); vec4 v=uProjInv*c; return v.xyz/v.w; }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
void main(){
  float d0=texture2D(tDepth,vUv).x;
  if(d0>=.99999){ gl_FragColor=vec4(1.,1.,1.,1.); return; }
  vec3 p=vpos(vUv); vec2 px=1./uRes;
  vec3 pr=vpos(vUv+vec2(px.x,0.)), pl=vpos(vUv-vec2(px.x,0.)), pu=vpos(vUv+vec2(0.,px.y)), pd=vpos(vUv-vec2(0.,px.y));
  vec3 dx=abs(pr.z-p.z)<abs(p.z-pl.z)?pr-p:p-pl; vec3 dy=abs(pu.z-p.z)<abs(p.z-pd.z)?pu-p:p-pd;
  vec3 n=normalize(cross(dx,dy));
  float dist=-p.z;
  float rad=uRadius*clamp(dist*.25,.02,1.);
  float rs=min(rad*uProjScale/dist,.18);
  float noise=ign(gl_FragCoord.xy);
  float ao=0.; const int N=14;
  for(int i=0;i<N;i++){
    float fi=float(i)+noise; float a=fi*2.399963; float r=sqrt((float(i)+.5)/float(N))*rs;
    vec2 o=vec2(cos(a),sin(a))*r; o.x*=uRes.y/uRes.x;
    vec3 q=vpos(vUv+o); vec3 v=q-p; float d2=dot(v,v);
    float f=max(rad*rad-d2,0.); float vn=dot(v,n)-.012*dist-.004;
    ao+=f*f*f*max(vn/(d2+.008),0.);
  }
  ao=max(0.,1.-ao*uIntensity*5./(pow(rad,6.)*float(N)));
  ao=mix(1.,ao,smoothstep(260.,120.,dist));
  gl_FragColor=vec4(ao,dist/400.,0.,1.);
}`;

const SSAO_BLUR = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tAO; uniform vec2 uDir;
void main(){
  vec2 c=texture2D(tAO,vUv).xy; float sum=c.x*2., w=2.;
  for(int i=-3;i<=3;i++){ if(i==0)continue; vec2 s=texture2D(tAO,vUv+uDir*float(i)).xy;
    float wt=(1.-abs(float(i))*.2)*max(0.,1.-abs(s.y-c.y)*400./max(c.y*400.,.5)*3.); sum+=s.x*wt; w+=wt; }
  gl_FragColor=vec4(sum/w,c.y,0.,1.);
}`;

const RAYS_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect, uStr;
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
void main(){
  if(uStr<=0.){ gl_FragColor=vec4(0.); return; }
  vec2 d=(uSun-vUv); float len=length(d*vec2(uAspect,1.));
  vec2 stepv=d/28.*min(1.,.9/max(len,.001));
  float j=ign(gl_FragCoord.xy); vec2 uv=vUv+stepv*j; float acc=0., w=1.;
  for(int i=0;i<28;i++){ float s=step(.99999,texture2D(tDepth,uv).x);
    vec2 sd=(uv-uSun)*vec2(uAspect,1.); s*=smoothstep(.55,.0,length(sd));
    acc+=s*w; w*=.955; uv+=stepv; if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)break; }
  acc/=28.;
  gl_FragColor=vec4(vec3(acc*uStr*smoothstep(1.6,.1,len)),1.);
}`;

const BLOOM_PRE = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uPx; uniform float uTh, uKnee;
vec3 S(vec2 o){ return min(texture2D(tSrc,vUv+o*uPx).rgb,vec3(48.)); }
float luma(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
void main(){
  vec3 a=S(vec2(-1.,-1.)),b=S(vec2(1.,-1.)),c=S(vec2(-1.,1.)),d=S(vec2(1.,1.));
  float wa=1./(1.+luma(a)),wb=1./(1.+luma(b)),wc=1./(1.+luma(c)),wd=1./(1.+luma(d));
  vec3 col=(a*wa+b*wb+c*wc+d*wd)/(wa+wb+wc+wd);
  float br=max(col.r,max(col.g,col.b)); float soft=clamp(br-uTh+uKnee,0.,2.*uKnee); soft=soft*soft/(4.*uKnee+1e-4);
  col*=max(soft,br-uTh)/max(br,1e-4);
  gl_FragColor=vec4(col,1.);
}`;
const BLOOM_DOWN = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uPx;
vec3 S(float x,float y){ return texture2D(tSrc,vUv+vec2(x,y)*uPx).rgb; }
void main(){
  vec3 a=S(-2.,2.),b=S(0.,2.),c=S(2.,2.),d=S(-2.,0.),e=S(0.,0.),f=S(2.,0.),g=S(-2.,-2.),h=S(0.,-2.),i=S(2.,-2.);
  vec3 j=S(-1.,1.),k=S(1.,1.),l=S(-1.,-1.),m=S(1.,-1.);
  vec3 col=e*.125+(a+c+g+i)*.03125+(b+d+f+h)*.0625+(j+k+l+m)*.125;
  gl_FragColor=vec4(col,1.);
}`;
const BLOOM_UP = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc, tAdd; uniform vec2 uPx; uniform float uMix;
vec3 S(float x,float y){ return texture2D(tSrc,vUv+vec2(x,y)*uPx).rgb; }
void main(){
  vec3 col=S(0.,0.)*4.+(S(-1.,0.)+S(1.,0.)+S(0.,-1.)+S(0.,1.))*2.+S(-1.,-1.)+S(1.,-1.)+S(-1.,1.)+S(1.,1.);
  col/=16.;
  gl_FragColor=vec4(texture2D(tAdd,vUv).rgb+col*uMix,1.);
}`;

const FINAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tBloom, tRays;
uniform vec2 uPx;
uniform float uExposure, uBloom, uVignette, uGrain, uCA, uTime, uSat, uContrast, uDamage, uLow, uFocus, uFlash, uFade, uRays, uDirt, uSharp, uShield;
uniform vec3 uLift, uGain, uRayCol, uFlashCol;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y); }
vec3 RRTAndODTFit(vec3 v){ vec3 a=v*(v+.0245786)-.000090537; vec3 b=v*(.983729*v+.4329510)+.238081; return a/b; }
vec3 aces(vec3 color){
  const mat3 I=mat3(vec3(.59719,.07600,.02840),vec3(.35458,.90834,.13383),vec3(.04823,.01566,.83777));
  const mat3 O=mat3(vec3(1.60475,-.10208,-.00327),vec3(-.53108,1.10813,-.07276),vec3(-.07367,-.00605,1.07602));
  color=I*color; color=RRTAndODTFit(color); color=O*color; return clamp(color,0.,1.);
}
void main(){
  vec2 uv=vUv; vec2 c=uv-.5; float r2=dot(c,c);
  float ca=uCA*(1.+uFocus*3.+uDamage*2.);
  vec3 col;
  vec3 mid=texture2D(tColor,uv).rgb;
  col.r=texture2D(tColor,uv+c*r2*ca).r; col.g=mid.g; col.b=texture2D(tColor,uv-c*r2*ca).b;
  if(uSharp>0.){ vec3 nb=texture2D(tColor,uv+vec2(uPx.x,0.)).rgb+texture2D(tColor,uv-vec2(uPx.x,0.)).rgb+texture2D(tColor,uv+vec2(0.,uPx.y)).rgb+texture2D(tColor,uv-vec2(0.,uPx.y)).rgb;
    vec3 sh=(mid-nb*.25); col+=clamp(sh,-.25,.25)*uSharp; }
  vec3 bloom=texture2D(tBloom,uv).rgb;
  float dirt=smoothstep(.5,.95,vn(uv*vec2(7.,4.)+3.))*.9+smoothstep(.62,.97,vn(uv*vec2(19.,11.)+9.))*.6;
  col+=bloom*uBloom*(1.+dirt*uDirt);
  col+=texture2D(tRays,uv).r*uRayCol*uRays;
  col*=uExposure;
  col*=mix(1.,smoothstep(.72,.12,r2),uVignette);
  col=max(col,0.);
  col=aces(col*1.15);
  // grade
  float l=dot(col,vec3(.2126,.7152,.0722));
  col=mix(vec3(l),col,uSat*(1.-uLow*.75)*(1.-uFocus*.35));
  col=(col-.5)*uContrast+.5;
  col=col*uGain+uLift*(1.-col);
  col=mix(col,col*vec3(.75,.95,1.15)+vec3(0.,.01,.03),uFocus*.6);
  col=pow(max(col,0.),vec3(1./2.2));
  // overlays
  float edge=smoothstep(.08,.5,r2);
  col=mix(col,vec3(.55,.0,.0),clamp(edge*uDamage*1.3,0.,.75));
  col=mix(col,col*vec3(.45,.1,.1),clamp(edge*uLow*1.2,0.,.8));
  col+=vec3(.1,.45,.9)*edge*uShield*.5;
  col+=uFlashCol*uFlash;
  float g=hash12(uv*vec2(1920.,1080.)+fract(uTime)*311.7)-.5;
  col+=g*uGrain*(1.-l*.6);
  col*=1.-uFade;
  gl_FragColor=vec4(col,1.);
}`;

const SKY_VERT = `varying vec3 vDir; void main(){ vDir=position; vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_Position.z=gl_Position.w*.99999; }`;
const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir,uZenith,uHorizon,uGround,uSunCol,uCloudLit,uCloudDark;
uniform float uSunDisk,uSunGlow,uCloud,uCloudScale,uTime,uStars,uEnv,uEclipse,uHazeExp,uIntensity;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<6;i++){ s+=a*vn(p); p=p*2.03+vec2(11.7,3.1); a*=.5; } return s; }
void main(){
  vec3 d=normalize(vDir); float y=d.y;
  float t=pow(clamp(y,0.,1.),uHazeExp);
  vec3 col=mix(uHorizon,uZenith,t);
  float sd=max(dot(d,uSunDir),0.);
  float hz=1.-clamp(y,0.,1.);
  col+=uSunCol*(pow(sd,6.)*.05+pow(sd,48.)*.18+pow(sd,400.)*.5)*uSunGlow*(.35+.65*hz*hz);
  if(uStars>0.&&y>0.){ vec3 sp=d*220.; vec3 id=floor(sp); float h=hash13(id); float st=step(.9972,h)*smoothstep(.45,.05,length(fract(sp)-.5));
    float tw=.7+.3*sin(uTime*2.+h*400.); col+=vec3(.8,.9,1.)*st*uStars*tw*clamp(y*3.,0.,1.)*(h-.9972)*900.; }
  float cov=0.;
  if(y>.005&&uCloud>0.){
    vec2 cuv=d.xz/(y+.14)*uCloudScale+vec2(uTime*.006,uTime*.002);
    float dn=fbm(cuv); cov=smoothstep(1.-uCloud,1.-uCloud+.3,dn);
    vec2 sdir=normalize(uSunDir.xz+vec2(1e-4))*.22; float dn2=fbm(cuv+sdir);
    float shade=clamp((dn-dn2)*2.6+.55,0.,1.);
    float det=fbm(cuv*3.1+7.);
    vec3 cc=mix(uCloudDark,uCloudLit,shade*(.6+.4*det));
    cc+=uSunCol*pow(sd,5.)*(1.-cov)*.22*uSunGlow;
    float fade=smoothstep(.005,.22,y);
    cov*=fade; col=mix(col,mix(uHorizon,cc,fade),cov*.96);
  }
  if(uEnv<.5){
    float disk=smoothstep(.99962,.99982,dot(d,uSunDir));
    if(uEclipse>.5){
      float dd=dot(d,uSunDir); float ang=acos(clamp(dd,-1.,1.));
      float R=.034; float corona=exp(-max(ang-R,0.)*60.)*1.0+exp(-max(ang-R,0.)*14.)*.12;
      float rays=.75+.5*vn(vec2(atan(d.z-uSunDir.z,d.x-uSunDir.x)*9.,1.));
      col+=uSunCol*corona*rays*step(R,ang)*1.6;
      col=mix(col,vec3(0.),smoothstep(R,R-.002,ang));
      col+=vec3(1.,.9,.8)*smoothstep(R+.003,R,ang)*smoothstep(R-.001,R,ang)*9.;
    } else {
      col+=uSunCol*disk*uSunDisk*(1.-cov);
    }
  }
  if(y<0.) col=mix(uGround,col,smoothstep(-.06,0.,y));
  gl_FragColor=vec4(col*uIntensity,1.);
}`;

export const SKIES = {
  golden: {
    sunDir: [-0.55, 0.26, -0.62], sunCol: [1.0, 0.62, 0.32], sunInt: 5.2, zenith: [0.13, 0.26, 0.52], horizon: [0.95, 0.56, 0.30], ground: [0.16, 0.12, 0.09],
    cloud: 0.5, cloudScale: 0.55, cloudLit: [1.25, 0.82, 0.55], cloudDark: [0.26, 0.24, 0.32], sunDisk: 70, sunGlow: 1.5, stars: 0, hazeExp: 0.42, skyInt: 1.0,
    fog: [0.78, 0.50, 0.32], fogDensity: 0.0085, hemiSky: [0.55, 0.62, 0.9], hemiGround: [0.45, 0.32, 0.22], hemiInt: 0.75, envInt: 1.15, exposure: 1.0,
    lift: [0.02, 0.012, 0.0], gain: [1.03, 1.0, 0.95], sat: 1.12, contrast: 1.06, rays: 0.55, lamps: 0.25, wet: 0, bloom: 0.65,
  },
  dusk: {
    sunDir: [0.62, 0.075, 0.35], sunCol: [1.0, 0.42, 0.22], sunInt: 2.0, zenith: [0.035, 0.07, 0.19], horizon: [0.62, 0.30, 0.26], ground: [0.05, 0.05, 0.07],
    cloud: 0.62, cloudScale: 0.5, cloudLit: [0.95, 0.42, 0.34], cloudDark: [0.07, 0.08, 0.15], sunDisk: 40, sunGlow: 1.3, stars: 0.5, hazeExp: 0.5, skyInt: 0.8,
    fog: [0.30, 0.21, 0.26], fogDensity: 0.011, hemiSky: [0.25, 0.32, 0.6], hemiGround: [0.2, 0.14, 0.12], hemiInt: 0.5, envInt: 1.0, exposure: 1.25,
    lift: [0.0, 0.006, 0.02], gain: [1.03, 0.98, 1.0], sat: 1.08, contrast: 1.07, rays: 0.5, lamps: 1.0, wet: 0, bloom: 0.8,
  },
  storm: {
    sunDir: [0.3, 0.55, 0.5], sunCol: [0.62, 0.72, 0.9], sunInt: 0.55, zenith: [0.025, 0.035, 0.055], horizon: [0.10, 0.125, 0.16], ground: [0.02, 0.025, 0.03],
    cloud: 0.98, cloudScale: 0.42, cloudLit: [0.13, 0.155, 0.2], cloudDark: [0.018, 0.022, 0.035], sunDisk: 0, sunGlow: 0.1, stars: 0, hazeExp: 0.6, skyInt: 1.0,
    fog: [0.075, 0.095, 0.125], fogDensity: 0.017, hemiSky: [0.3, 0.38, 0.52], hemiGround: [0.1, 0.11, 0.13], hemiInt: 0.55, envInt: 1.5, exposure: 1.55,
    lift: [0.0, 0.01, 0.022], gain: [0.95, 1.0, 1.06], sat: 0.92, contrast: 1.08, rays: 0, lamps: 1.25, wet: 1, rain: 1, bloom: 0.9,
  },
  dawn: {
    sunDir: [0.5, 0.16, -0.7], sunCol: [1.0, 0.8, 0.66], sunInt: 2.6, zenith: [0.22, 0.34, 0.5], horizon: [0.80, 0.76, 0.74], ground: [0.2, 0.2, 0.21],
    cloud: 0.42, cloudScale: 0.6, cloudLit: [1.1, 0.95, 0.9], cloudDark: [0.4, 0.42, 0.5], sunDisk: 45, sunGlow: 1.4, stars: 0, hazeExp: 0.36, skyInt: 0.95,
    fog: [0.66, 0.67, 0.70], fogDensity: 0.021, hemiSky: [0.62, 0.7, 0.85], hemiGround: [0.36, 0.34, 0.33], hemiInt: 0.5, envInt: 1.0, exposure: 0.95,
    lift: [0.012, 0.016, 0.024], gain: [1.0, 1.0, 1.02], sat: 0.9, contrast: 1.03, rays: 0.8, lamps: 0.5, wet: 0.25, bloom: 0.7,
  },
  ember: {
    sunDir: [-0.7, 0.11, 0.3], sunCol: [1.0, 0.30, 0.10], sunInt: 3.2, zenith: [0.07, 0.03, 0.035], horizon: [0.75, 0.22, 0.07], ground: [0.06, 0.03, 0.02],
    cloud: 0.68, cloudScale: 0.45, cloudLit: [1.1, 0.36, 0.12], cloudDark: [0.06, 0.03, 0.035], sunDisk: 60, sunGlow: 1.6, stars: 0, hazeExp: 0.5, skyInt: 0.9,
    fog: [0.36, 0.13, 0.06], fogDensity: 0.013, hemiSky: [0.6, 0.3, 0.25], hemiGround: [0.4, 0.15, 0.08], hemiInt: 0.45, envInt: 1.0, exposure: 1.1,
    lift: [0.02, 0.004, 0.0], gain: [1.05, 0.98, 0.93], sat: 1.1, contrast: 1.1, rays: 0.6, lamps: 0.8, wet: 0, embers: 1, bloom: 0.95,
  },
  eclipse: {
    sunDir: [0.0, 0.42, -0.9], sunCol: [0.75, 0.82, 1.0], sunInt: 0.9, zenith: [0.006, 0.008, 0.02], horizon: [0.11, 0.07, 0.14], ground: [0.012, 0.012, 0.02],
    cloud: 0.4, cloudScale: 0.5, cloudLit: [0.16, 0.13, 0.22], cloudDark: [0.012, 0.012, 0.03], sunDisk: 0, sunGlow: 0.5, stars: 1.6, hazeExp: 0.55, skyInt: 1.0, eclipse: 1,
    fog: [0.05, 0.04, 0.08], fogDensity: 0.011, hemiSky: [0.3, 0.32, 0.6], hemiGround: [0.14, 0.1, 0.16], hemiInt: 0.55, envInt: 1.4, exposure: 1.7,
    lift: [0.008, 0.0, 0.022], gain: [1.0, 0.97, 1.06], sat: 1.05, contrast: 1.1, rays: 0.35, lamps: 1.3, wet: 0.15, bloom: 1.0,
  },
};

export class Gfx {
  constructor(canvas, qualityName = 'high') {
    this.canvas = canvas;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // we tonemap + encode ourselves
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.04, 1600);
    this.camera.layers.enable(1);
    this.scene.add(this.camera);
    this.qualityName = qualityName; this.q = QUALITY[qualityName];
    this.time = 0;

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00035; this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.scene.fog = new THREE.FogExp2(0x888888, 0.01);

    // dynamic flash lights pool (always in scene so shader light count is stable)
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.userData = { t: 0, dur: 0, peak: 0 };
      this.scene.add(l); this.flashes.push(l);
    }

    // sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
        uSunDisk: { value: 50 }, uSunGlow: { value: 1 }, uCloud: { value: 0.5 }, uCloudScale: { value: 0.5 }, uTime: { value: 0 }, uStars: { value: 0 }, uEnv: { value: 0 }, uEclipse: { value: 0 }, uHazeExp: { value: 0.45 }, uIntensity: { value: 1 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -100; this.sky.layers.set(1);
    this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    // fullscreen helpers
    this.fsScene = new THREE.Scene();
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.fsQuad.frustumCulled = false; this.fsScene.add(this.fsQuad);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mSSAO = mk(SSAO_FRAG, { tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uRadius: { value: 0.9 }, uProjScale: { value: 1 }, uIntensity: { value: 1.0 } });
    this.mBlur = mk(SSAO_BLUR, { tAO: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mRays = mk(RAYS_FRAG, { tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uStr: { value: 0 } });
    this.mPre = mk(BLOOM_PRE, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uTh: { value: 1.0 }, uKnee: { value: 0.5 } });
    this.mDown = mk(BLOOM_DOWN, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } });
    this.mUp = mk(BLOOM_UP, { tSrc: { value: null }, tAdd: { value: null }, uPx: { value: new THREE.Vector2() }, uMix: { value: 1 } });
    this.mFinal = mk(FINAL_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, tRays: { value: null }, uPx: { value: new THREE.Vector2() },
      uExposure: { value: 1 }, uBloom: { value: 0.7 }, uVignette: { value: 0.55 }, uGrain: { value: 0.035 }, uCA: { value: 0.012 }, uTime: { value: 0 },
      uSat: { value: 1 }, uContrast: { value: 1 }, uDamage: { value: 0 }, uLow: { value: 0 }, uFocus: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 0 }, uRays: { value: 0 }, uDirt: { value: 0.6 }, uSharp: { value: 0.35 }, uShield: { value: 0 },
      uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uRayCol: { value: new THREE.Color(1, 1, 1) }, uFlashCol: { value: new THREE.Color(1, 1, 1) },
    });
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.white.needsUpdate = true;
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    shared.uSSAO.value = this.white;
    this.fx = this.mFinal.uniforms;
    this.sky0 = SKIES.golden;
    this.rts = [];
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.shake = 0;
    this.applyQuality(qualityName);
  }

  applyQuality(name) {
    this.qualityName = name; this.q = QUALITY[name];
    const s = this.q.shadow;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(s, s);
    const R = this.q.shadowR, c = this.sun.shadow.camera;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 320; c.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const w = Math.max(2, this.canvas.clientWidth || window.innerWidth), h = Math.max(2, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr) * this.q.scale;
    const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
    this.W = W; this.H = H;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    for (const rt of this.rts) rt.dispose();
    this.rts.length = 0;
    const reg = (rt) => { this.rts.push(rt); return rt; };
    const hdr = THREE.HalfFloatType;
    this.rtMain = reg(new THREE.WebGLRenderTarget(W, H, { type: hdr, samples: this.q.msaa, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    if (this.q.ao || this.q.rays) {
      this.rtDepth = reg(new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
      this.rtDepth.depthTexture = new THREE.DepthTexture(hw, hh);
      this.rtDepth.depthTexture.minFilter = this.rtDepth.depthTexture.magFilter = THREE.NearestFilter;
      this.rtAO = reg(new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: false, type: hdr }));
      this.rtAO2 = reg(new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: false, type: hdr }));
      this.rtRays = reg(new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), { depthBuffer: false }));
    } else { this.rtDepth = null; shared.uSSAO.value = this.white; }
    this.bloomDown = []; this.bloomUp = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < 6 && bw > 8 && bh > 8; i++) {
      this.bloomDown.push(reg(new THREE.WebGLRenderTarget(bw, bh, { type: hdr, depthBuffer: false })));
      this.bloomUp.push(reg(new THREE.WebGLRenderTarget(bw, bh, { type: hdr, depthBuffer: false })));
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
    }
    shared.uInvRes.value.set(1 / W, 1 / H);
    this.mFinal.uniforms.uPx.value.set(1 / W, 1 / H);
  }

  setSky(name) {
    const s = this.sky0 = SKIES[name] || SKIES.golden; this.skyName = name;
    const u = this.skyMat.uniforms;
    this.sunDir.fromArray(s.sunDir).normalize();
    u.uSunDir.value.copy(this.sunDir);
    u.uZenith.value.fromArray(s.zenith); u.uHorizon.value.fromArray(s.horizon); u.uGround.value.fromArray(s.ground);
    u.uSunCol.value.fromArray(s.sunCol); u.uCloudLit.value.fromArray(s.cloudLit); u.uCloudDark.value.fromArray(s.cloudDark);
    u.uSunDisk.value = s.sunDisk; u.uSunGlow.value = s.sunGlow; u.uCloud.value = s.cloud; u.uCloudScale.value = s.cloudScale; u.uStars.value = s.stars;
    u.uEclipse.value = s.eclipse ? 1 : 0; u.uHazeExp.value = s.hazeExp; u.uIntensity.value = s.skyInt;
    this.sun.color.fromArray(s.sunCol); this.sun.intensity = s.sunInt; this.sunBase = s.sunInt;
    this.hemi.color.fromArray(s.hemiSky); this.hemi.groundColor.fromArray(s.hemiGround); this.hemi.intensity = s.hemiInt;
    this.scene.fog.color.fromArray(s.fog); this.scene.fog.density = s.fogDensity;
    shared.uWet.value = s.wet || 0;
    const f = this.mFinal.uniforms;
    f.uExposure.value = s.exposure; f.uLift.value.fromArray(s.lift); f.uGain.value.fromArray(s.gain); f.uSat.value = s.sat; f.uContrast.value = s.contrast;
    f.uRayCol.value.fromArray(s.sunCol); f.uBloom.value = s.bloom;
    this.raysStr = this.q.rays ? s.rays : 0;
    // environment map from sky
    const envScene = new THREE.Scene();
    const m = this.skyMat.clone(); m.uniforms.uEnv.value = 1; m.uniforms.uIntensity.value = s.skyInt;
    for (const k in u) if (k !== 'uEnv') m.uniforms[k].value = u[k].value;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), m); envScene.add(mesh);
    const prev = this.envRT;
    this.envRT = this.pmrem.fromScene(envScene, 0, 0.1, 100);
    this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = s.envInt;
    if (prev) prev.dispose();
    mesh.geometry.dispose(); m.dispose();
    this.renderer.setRenderTarget(null);
  }

  flash(pos, color, intensity, dur = 0.08, dist = 18) {
    let best = this.flashes[0];
    for (const l of this.flashes) if (l.userData.t >= l.userData.dur) { best = l; break; } else if (l.userData.peak * (1 - l.userData.t / l.userData.dur) < best.userData.peak * (1 - best.userData.t / best.userData.dur)) best = l;
    best.position.copy(pos); best.color.set(color); best.distance = dist;
    best.userData.t = 0; best.userData.dur = dur; best.userData.peak = intensity; best.intensity = intensity;
  }

  _pass(mat, target) {
    this.fsQuad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  render(dt, realDt = dt) {
    const r = this.renderer, cam = this.camera, sc = this.scene;
    this.time += realDt;
    shared.uTime.value += dt;
    r.info.reset();
    for (const l of this.flashes) { const d = l.userData; if (d.t < d.dur) { d.t += dt; const k = Math.max(0, 1 - d.t / d.dur); l.intensity = d.peak * k * k; } else l.intensity = 0; }
    // sun shadow follows camera, snapped to texels
    const R = this.q.shadowR, texel = (2 * R) / this.q.shadow;
    cam.getWorldPosition(this._v);
    cam.getWorldDirection(this._v2); this._v2.y = 0; this._v2.normalize();
    const tx = this._v.x + this._v2.x * R * 0.45, tz = this._v.z + this._v2.z * R * 0.45;
    this.sun.target.position.set(Math.round(tx / texel) * texel, 0, Math.round(tz / texel) * texel);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 160);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(this._v);
    this.skyMat.uniforms.uTime.value = this.time;
    cam.updateMatrixWorld();

    // 1. depth prepass + SSAO
    if (this.rtDepth) {
      const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
      cam.layers.set(0);
      sc.overrideMaterial = this.depthMat;
      r.setRenderTarget(this.rtDepth); r.clear(true, true, false); r.render(sc, cam);
      sc.overrideMaterial = null; cam.layers.enable(1);
      r.shadowMap.autoUpdate = sh;
      if (this.q.ao) {
        const u = this.mSSAO.uniforms;
        u.tDepth.value = this.rtDepth.depthTexture; u.uProjInv.value.copy(cam.projectionMatrixInverse);
        u.uRes.value.set(this.rtDepth.width, this.rtDepth.height); u.uProjScale.value = cam.projectionMatrix.elements[5] * 0.5;
        this._pass(this.mSSAO, this.rtAO);
        this.mBlur.uniforms.tAO.value = this.rtAO.texture; this.mBlur.uniforms.uDir.value.set(1 / this.rtAO.width, 0); this._pass(this.mBlur, this.rtAO2);
        this.mBlur.uniforms.tAO.value = this.rtAO2.texture; this.mBlur.uniforms.uDir.value.set(0, 1 / this.rtAO.height); this._pass(this.mBlur, this.rtAO);
        shared.uSSAO.value = this.rtAO.texture;
      } else shared.uSSAO.value = this.white;
    }
    // 2. main HDR scene
    r.setRenderTarget(this.rtMain); r.clear(true, true, false); r.render(sc, cam);
    // 3. bloom
    const bd = this.bloomDown, bu = this.bloomUp, n = bd.length;
    this.mPre.uniforms.tSrc.value = this.rtMain.texture; this.mPre.uniforms.uPx.value.set(0.5 / this.W, 0.5 / this.H);
    this._pass(this.mPre, bd[0]);
    for (let i = 1; i < n; i++) { this.mDown.uniforms.tSrc.value = bd[i - 1].texture; this.mDown.uniforms.uPx.value.set(1 / bd[i - 1].width, 1 / bd[i - 1].height); this._pass(this.mDown, bd[i]); }
    let src = bd[n - 1];
    for (let i = n - 2; i >= 0; i--) { const u = this.mUp.uniforms; u.tSrc.value = src.texture; u.tAdd.value = bd[i].texture; u.uPx.value.set(1 / src.width, 1 / src.height); u.uMix.value = 1.0; this._pass(this.mUp, bu[i]); src = bu[i]; }
    // 4. god rays
    let rays = 0;
    if (this.rtDepth && this.raysStr > 0) {
      this._v2.copy(this._v).addScaledVector(this.sunDir, 1000).project(cam);
      cam.getWorldDirection(this._v);
      const facing = this._v.dot(this.sunDir);
      if (facing > 0.05 && this._v2.z < 1) {
        rays = this.raysStr * clamp((facing - 0.05) * 2.2, 0, 1);
        const u = this.mRays.uniforms; u.tDepth.value = this.rtDepth.depthTexture; u.uSun.value.set(this._v2.x * 0.5 + 0.5, this._v2.y * 0.5 + 0.5); u.uAspect.value = cam.aspect; u.uStr.value = 1;
        this._pass(this.mRays, this.rtRays);
      }
    }
    // 5. final
    const f = this.mFinal.uniforms;
    f.tColor.value = this.rtMain.texture; f.tBloom.value = src.texture; f.tRays.value = rays > 0 ? this.rtRays.texture : this.black; f.uRays.value = rays; f.uTime.value = this.time;
    this._pass(this.mFinal, null);
  }
}
