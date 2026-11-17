// GPU-baked procedural PBR texture sets (albedo+paint mask / normal / ORM). All tileable.
import * as THREE from './lib/three.min.js';

const COMMON = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p,float per){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*f*(f*(f*6.-15.)+10.);
  float a=hash12(mod(i,per)+uSeed),b=hash12(mod(i+vec2(1,0),per)+uSeed),c=hash12(mod(i+vec2(0,1),per)+uSeed),d=hash12(mod(i+vec2(1,1),per)+uSeed);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbm(vec2 uv,float freq,int oct){ float a=.5,s=0.,n=0.; for(int i=0;i<8;i++){ if(i>=oct)break; s+=a*vnoise(uv*freq+float(i)*17.3,freq); n+=a; a*=.5; freq*=2.; } return s/n; }
// anisotropic fbm: separate x/y frequencies (both integer => tileable)
float vnoise2(vec2 p,vec2 per){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.-2.*f);
  float a=hash12(mod(i,per)+uSeed+3.1),b=hash12(mod(i+vec2(1,0),per)+uSeed+3.1),c=hash12(mod(i+vec2(0,1),per)+uSeed+3.1),d=hash12(mod(i+vec2(1,1),per)+uSeed+3.1);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbm2(vec2 uv,vec2 freq,int oct){ float a=.5,s=0.,n=0.; for(int i=0;i<6;i++){ if(i>=oct)break; s+=a*vnoise2(uv*freq+float(i)*9.7,freq); n+=a; a*=.5; freq*=2.; } return s/n; }
vec3 worley(vec2 uv,float freq){ vec2 p=uv*freq; vec2 i=floor(p),f=fract(p); float f1=9.,f2=9.,id=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 c=mod(i+g,freq); vec2 o=hash22(c+uSeed); float d=length(g+o-f);
    if(d<f1){f2=f1;f1=d;id=hash12(c+7.3+uSeed);} else if(d<f2){f2=d;} }
  return vec3(f1,f2,id); }
vec3 s2l(vec3 c){ return pow(c,vec3(2.2)); }
float sat(float x){ return clamp(x,0.,1.); }
`;

// Each material defines: void surf(vec2 uv, out vec3 col, out float h, out float r, out float m, out float mask)
// col in sRGB-ish authoring space, h height 0..1, r roughness, m metalness, mask = paint mask (tintable area)
const MATS = {
  concrete: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,4.,6), n2=fbm(uv+3.7,16.,5), n3=fbm(uv+1.3,96.,3);
  vec2 g=abs(fract(uv*2.)-.5); float joint=smoothstep(.488,.497,max(g.x,g.y));
  vec2 wuv=uv+(vec2(fbm(uv,8.,3),fbm(uv+.5,8.,3))-.5)*.06;
  vec3 w=worley(wuv,5.); float crack=(1.-smoothstep(0.,.02,w.y-w.x))*smoothstep(.56,.7,fbm(uv+9.1,3.,3));
  vec3 w3=worley(wuv+.31,11.); crack=max(crack,(1.-smoothstep(0.,.016,w3.y-w3.x))*smoothstep(.64,.74,fbm(uv+4.1,4.,3))*.7);
  vec3 w2=worley(uv,56.); float pit=smoothstep(.2,.04,w2.x)*step(.93,w2.z);
  float stain=smoothstep(.35,.75,fbm(uv+5.5,3.,5));
  float oil=smoothstep(.6,.78,fbm(uv+2.2,5.,4))*smoothstep(.4,.6,fbm(uv+6.6,2.,2));
  float tire=smoothstep(.55,.7,fbm2(uv+.2,vec2(2.,40.),3))*smoothstep(.5,.7,fbm(uv+8.,2.,2));
  vec3 base=mix(vec3(.47,.46,.44),vec3(.66,.65,.61),n1); base*=.82+.36*n2; base*=.93+.14*n3;
  base=mix(base,base*vec3(.72,.69,.64),stain*.65);
  base=mix(base,vec3(.10,.095,.09),oil*.6);
  base*=1.-.25*tire;
  base*=1.-.7*crack; base*=1.-.55*joint; base*=1.-.35*pit;
  col=base; h=.5+(n2-.5)*.10+(n3-.5)*.05-crack*.4-joint*.5-pit*.25+(n1-.5)*.06;
  r=clamp(.86-.22*n1+.12*n3-oil*.5-stain*.08,.18,1.); m=0.; mask=0.;
}`,
  asphalt: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,3.,5), n2=fbm(uv+2.,24.,4);
  vec3 w=worley(uv,90.); float agg=smoothstep(.45,.1,w.x);
  vec3 wb=worley(uv+.2,40.);
  vec2 wuv=uv+(vec2(fbm(uv,6.,3),fbm(uv+.7,6.,3))-.5)*.08;
  vec3 wc=worley(wuv,4.); float crack=(1.-smoothstep(0.,.014,wc.y-wc.x))*smoothstep(.45,.6,fbm(uv+1.1,3.,3));
  float patchm=smoothstep(.6,.64,fbm(uv+7.,2.,3));
  float wet=smoothstep(.55,.8,fbm(uv+4.4,4.,4));
  vec3 base=mix(vec3(.15,.15,.155),vec3(.25,.245,.24),n1);
  base=mix(base,base*.72,patchm);
  base+=agg*(w.z-.4)*.07; base+= (smoothstep(.3,.0,wb.x)*step(.9,wb.z))*.10;
  base*=.85+.3*n2; base*=1.-.75*crack;
  col=base; h=.5+agg*.12*(w.z)+(n2-.5)*.08-crack*.5-patchm*.03;
  r=clamp(.93-wet*.16-agg*.05,.5,1.); m=0.; mask=0.;
}`,
  wall: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,5.,6), n2=fbm(uv+3.,32.,4), n3=fbm(uv+1.,128.,2);
  vec2 pg=uv*vec2(2.,2.); vec2 pf=fract(pg); vec2 pid=floor(pg);
  float seam=max(smoothstep(.485,.497,abs(pf.x-.5)),smoothstep(.485,.497,abs(pf.y-.5)));
  vec2 tg=abs(fract(uv*4.+.5)-.5); float tie=smoothstep(.06,.045,length(tg));
  float pour=smoothstep(.6,.9,fbm2(uv+.3,vec2(3.,48.),3));
  float drip=smoothstep(.5,.85,fbm2(uv+.9,vec2(48.,2.),4))*smoothstep(.3,.7,fbm(uv+2.7,3.,3));
  float tone=hash12(mod(pid,2.)+uSeed+1.7);
  vec3 w2=worley(uv,70.); float pit=smoothstep(.22,.03,w2.x)*step(.75,w2.z);
  vec3 base=mix(vec3(.50,.49,.47),vec3(.68,.67,.64),n1)*(.92+.12*tone); base*=.85+.3*n2;
  base=mix(base,base*vec3(.6,.57,.52),drip*.7); base*=1.-.08*pour;
  base*=1.-.55*seam; base*=1.-.6*tie; base*=1.-.3*pit;
  col=base; h=.5+(n2-.5)*.08+(n3-.5)*.04-seam*.45-tie*.5-pit*.2+pour*.03;
  r=clamp(.88-.18*n1-drip*.1,.3,1.); m=0.; mask=0.;
}`,
  corrugated: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float t=fract(uv.x*12.); float rib=smoothstep(.08,.26,t)-smoothstep(.58,.76,t);
  float redge=smoothstep(.08,.17,t)*smoothstep(.26,.17,t)+smoothstep(.58,.67,t)*smoothstep(.76,.67,t);
  float n1=fbm(uv,6.,5), n2=fbm(uv+5.,40.,3);
  float chipn=fbm(uv+2.3,20.,5)+redge*.05+smoothstep(.55,.9,fbm(uv+8.8,3.,3))*.2;
  float chip=smoothstep(.76,.8,chipn);
  float rustHalo=smoothstep(.66,.78,chipn);
  float streak=smoothstep(.5,.9,fbm2(uv+.4,vec2(36.,2.),4))*smoothstep(.35,.7,fbm(uv+3.3,3.,3));
  float dirt=smoothstep(.4,.8,fbm(uv+6.1,4.,5));
  float scr=smoothstep(.8,.86,fbm2(uv+.77,vec2(3.,120.),2))*smoothstep(.55,.7,fbm(uv+1.9,5.,2));
  vec3 paint=vec3(.86)*(.9+.14*n1)*(.95+.08*n2);
  paint=mix(paint,paint*vec3(.62,.55,.47),dirt*.5);
  vec3 rust=mix(vec3(.30,.13,.05),vec3(.16,.08,.04),fbm(uv+9.,48.,3)); rust=mix(rust,vec3(.42,.24,.10),n2*.5);
  col=mix(paint,vec3(.5,.36,.24),max(streak*.45,rustHalo*.4)); col=mix(col,rust,chip); col=mix(col,vec3(.55,.56,.58),scr*(1.-chip));
  col*=.86+.14*rib;
  mask=(1.-chip)*(1.-max(streak*.45,rustHalo*.4))*(1.-scr*.8);
  h=.2+rib*.6+(n2-.5)*.03-chip*.04+scr*.01;
  r=mix(.46+.15*dirt+.1*n2,.9,chip); r=mix(r,.3,scr*(1.-chip)); m=mix(0.,.35,chip); m=mix(m,.9,scr*(1.-chip));
}`,
  panel: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,5.,5), n2=fbm(uv+4.,48.,3);
  vec2 pg=uv*2.; vec2 pf=fract(pg);
  vec2 ed=min(pf,1.-pf); float edge=min(ed.x,ed.y);
  float seam=smoothstep(.012,.004,edge);
  vec2 rg=fract(uv*16.)-.5; float rivLine=step(edge,.075)*step(.03,edge);
  float riv=smoothstep(.2,.12,length(rg))*step(min(ed.x,ed.y),.062)*step(.0315,min(ed.x,ed.y));
  float chipn=fbm(uv+2.9,28.,5)+smoothstep(.06,.0,edge)*.16+riv*.1;
  float chip=smoothstep(.76,.8,chipn);
  float scr=smoothstep(.83,.88,fbm2(uv+.17,vec2(160.,5.),2))*smoothstep(.5,.7,fbm(uv+7.7,4.,2));
  scr=max(scr,smoothstep(.85,.9,fbm2(uv+.57,vec2(6.,140.),2))*smoothstep(.55,.7,fbm(uv+3.7,4.,2)));
  float grime=smoothstep(.35,.8,fbm(uv+1.1,3.,5))+smoothstep(.1,.0,edge)*.35;
  float streak=smoothstep(.55,.9,fbm2(uv+.4,vec2(40.,2.),3))*.6;
  vec3 paint=vec3(.84)*(.92+.12*n1)*(.96+.07*n2);
  paint=mix(paint,paint*vec3(.55,.5,.44),sat(grime*.45+streak*.3));
  vec3 metal=mix(vec3(.50,.50,.52),vec3(.33,.30,.27),fbm(uv+6.,30.,3));
  col=mix(paint,metal,chip); col=mix(col,vec3(.62,.63,.65),scr*(1.-chip)); col*=1.-.75*seam;
  mask=(1.-chip)*(1.-scr*.85)*(1.-seam);
  h=.5-seam*.5+riv*.35+(n2-.5)*.025-chip*.05-scr*.02;
  r=mix(.42+.2*sat(grime),.55+.25*n2,chip); r=mix(r,.28,scr*(1.-chip));
  m=mix(0.,.85,chip); m=mix(m,.95,scr*(1.-chip));
}`,
  gunmetal: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,6.,5), n2=fbm(uv+4.,64.,3), n3=fbm(uv+2.,200.,2);
  float wear=smoothstep(.58,.8,fbm(uv+2.9,10.,5));
  float scr=smoothstep(.8,.87,fbm2(uv+.17,vec2(200.,6.),2))*smoothstep(.45,.7,fbm(uv+7.7,5.,2));
  scr=max(scr,smoothstep(.84,.9,fbm2(uv+.47,vec2(8.,180.),2))*smoothstep(.5,.7,fbm(uv+5.7,5.,2))*.8);
  vec3 base=vec3(.82)*(.9+.14*n1)*(.94+.1*n2);
  col=mix(base,vec3(1.25),sat(wear*.35+scr*.6));
  mask=1.;
  h=.5+(n3-.5)*.10+(n2-.5)*.05-scr*.05;
  r=clamp(.5+.14*n2-.2*wear-scr*.2+(n1-.5)*.1,.15,1.); m=1.;
}`,
  rust: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,4.,6), n2=fbm(uv+4.,32.,4), n3=fbm(uv+2.,128.,2);
  vec3 w=worley(uv+(n1-.5)*.1,9.);
  float rustm=smoothstep(.38,.62,n1*.65+fbm(uv+7.2,9.,5)*.5-w.x*.12);
  float streak=smoothstep(.45,.9,fbm2(uv+.4,vec2(30.,2.),4));
  float seam=smoothstep(.494,.499,abs(fract(uv.y*2.)-.5));
  float riv=smoothstep(.22,.12,length(fract(uv*vec2(24.,2.)+vec2(0.,.5))-.5)/vec2(1.,1.).x)*step(abs(fract(uv.y*2.+.5)-.5),.04*2.);
  vec3 steel=vec3(.80)*(.88+.16*n2);
  vec3 rust=mix(vec3(.33,.15,.06),vec3(.50,.27,.11),n2); rust=mix(rust,vec3(.18,.09,.05),smoothstep(.5,.8,fbm(uv+1.,60.,3)));
  col=mix(steel,rust,sat(rustm+streak*.3)); col*=1.-.5*seam;
  mask=(1.-sat(rustm+streak*.3))*(1.-seam);
  h=.5+(n3-.5)*.08+rustm*(n2-.5)*.35-seam*.4;
  r=mix(.42+.1*n2,.92,sat(rustm+streak*.3)); m=mix(.0,.25,sat(rustm));
}`,
  tread: /* glsl */`
float lozenge(vec2 p,float a){ float c=cos(a),s=sin(a); p=mat2(c,-s,s,c)*p; p.x*=3.2; return smoothstep(.42,.3,length(p)); }
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  vec2 g=uv*12.; vec2 id=floor(g); vec2 f=fract(g)-.5;
  float alt=mod(id.x+id.y,2.);
  float d=lozenge(f,alt>.5?.785:-.785);
  float n1=fbm(uv,5.,5), n2=fbm(uv+3.,60.,3);
  float wear=smoothstep(.45,.8,fbm(uv+1.4,4.,4));
  float grime=smoothstep(.4,.8,fbm(uv+5.4,6.,4))*(1.-d);
  vec3 base=vec3(.40,.41,.43)*(.85+.25*n1)*(.94+.1*n2);
  base=mix(base,vec3(.68,.69,.71),d*wear*.7);
  base=mix(base,vec3(.12,.10,.08),grime*.55);
  col=base; mask=0.;
  h=.3+d*.6+(n2-.5)*.04;
  r=clamp(.5-.25*d*wear+.3*grime+.1*n2,.15,1.); m=mix(1.,.3,grime);
}`,
  hazard: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,5.,5), n2=fbm(uv+4.,48.,3);
  float s=fract((uv.x+uv.y)*4.); float stripe=smoothstep(.48,.5,s)-smoothstep(.98,1.,s)+ (1.-smoothstep(.0,.02,s));
  float chipn=fbm(uv+2.9,24.,5); float chip=smoothstep(.62,.66,chipn);
  float grime=smoothstep(.3,.8,fbm(uv+1.1,3.,5));
  vec3 paint=mix(vec3(.92,.66,.06),vec3(.06,.06,.065),sat(stripe));
  paint*=(.9+.14*n1); paint=mix(paint,paint*vec3(.5,.45,.4),grime*.5);
  vec3 metal=mix(vec3(.45,.45,.47),vec3(.30,.20,.13),fbm(uv+6.,30.,3));
  col=mix(paint,metal,chip); mask=0.;
  h=.5+(n2-.5)*.03-chip*.06;
  r=mix(.5+.2*grime,.7,chip); m=mix(0.,.7,chip);
}`,
  dirt: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,3.,7), n2=fbm(uv+4.,20.,5), n3=fbm(uv+2.,100.,3);
  vec3 w=worley(uv,36.); float peb=smoothstep(.3,.08,w.x)*step(.6,w.z);
  vec3 w2=worley(uv+.3,90.); float grit=smoothstep(.3,.1,w2.x)*step(.5,w2.z);
  float ruts=smoothstep(.5,.75,fbm2(uv+.3,vec2(2.,14.),3));
  vec3 base=mix(vec3(.36,.30,.23),vec3(.56,.49,.39),n1); base*=.8+.4*n2;
  base=mix(base,vec3(.5,.48,.45)*(.6+.6*w.z),peb*.8); base*=1.-.2*grit; base*=1.-.18*ruts;
  col=base; mask=0.;
  h=.4+(n1-.5)*.3+(n2-.5)*.2+(n3-.5)*.06+peb*.3+grit*.06-ruts*.1;
  r=clamp(.92-.1*peb,.4,1.); m=0.;
}`,
  rubber: /* glsl */`
void surf(vec2 uv,out vec3 col,out float h,out float r,out float m,out float mask){
  float n1=fbm(uv,6.,4), n2=fbm(uv+4.,90.,2);
  vec3 w=worley(uv,60.);
  col=vec3(.8)*(.9+.14*n1)*(.92+.12*n2); mask=1.;
  h=.5+(.5-w.x)*.25+(n2-.5)*.1;
  r=clamp(.72+.15*n1,.2,1.); m=0.;
}`,
};

const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

export const TEX_TILE = { // meters per UV tile
  concrete: 5, asphalt: 5, wall: 4, corrugated: 2.6, panel: 2.2, gunmetal: 0.4, rust: 3, tread: 1.1, hazard: 1.0, dirt: 7, rubber: 0.5,
};
const NRM_STRENGTH = { concrete: 2.2, asphalt: 2.0, wall: 2.0, corrugated: 7, panel: 2.0, gunmetal: 0.7, rust: 2.6, tread: 4.5, hazard: 1.2, dirt: 5, rubber: 1.6 };
const BIG = { concrete: 1, asphalt: 1, wall: 1, corrugated: 1, panel: 1, rust: 1, dirt: 1 };

export function bakeTextures(renderer, baseSize = 1024, onProgress) {
  const out = {};
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const floatOK = !!renderer.extensions.get('EXT_color_buffer_float') || !!renderer.extensions.get('EXT_color_buffer_half_float');
  const names = Object.keys(MATS);
  const prevRT = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = true;

  const mkRT = (size, srgb, type = THREE.UnsignedByteType, mips = true) => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: mips,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.anisotropy = maxAniso;
    return rt;
  };

  names.forEach((name, idx) => {
    const size = BIG[name] ? baseSize : Math.max(256, baseSize >> 1);
    const src = MATS[name];
    const seed = 11.7 + idx * 13.37;
    // pass A: albedo + mask
    const matA = new THREE.ShaderMaterial({
      uniforms: { uSeed: { value: seed } }, vertexShader: VERT, depthTest: false,
      fragmentShader: COMMON + src + `void main(){ vec3 c; float h,r,m,k; surf(vUv,c,h,r,m,k); gl_FragColor=vec4(s2l(clamp(c,0.,1.)),k); }`,
    });
    const rtA = mkRT(size, true);
    quad.material = matA; renderer.setRenderTarget(rtA); renderer.render(scene, cam);
    // pass B: height/rough/metal (float if possible)
    const matB = new THREE.ShaderMaterial({
      uniforms: { uSeed: { value: seed } }, vertexShader: VERT, depthTest: false,
      fragmentShader: COMMON + src + `void main(){ vec3 c; float h,r,m,k; surf(vUv,c,h,r,m,k); gl_FragColor=vec4(h,r,m,1.); }`,
    });
    const rtB = mkRT(size, false, floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType, false);
    quad.material = matB; renderer.setRenderTarget(rtB); renderer.render(scene, cam);
    // pass C: normal from height
    const px = 1 / size;
    const matC = new THREE.ShaderMaterial({
      uniforms: { tD: { value: rtB.texture }, uPx: { value: px }, uStr: { value: NRM_STRENGTH[name] * (size / 1024) } }, vertexShader: VERT, depthTest: false,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tD; uniform float uPx,uStr;
        float H(vec2 o){ return texture2D(tD,vUv+o*uPx).x; }
        void main(){ float dx=(H(vec2(1,0))-H(vec2(-1,0)))*2.+(H(vec2(1,1))-H(vec2(-1,1)))+(H(vec2(1,-1))-H(vec2(-1,-1)));
          float dy=(H(vec2(0,1))-H(vec2(0,-1)))*2.+(H(vec2(1,1))-H(vec2(1,-1)))+(H(vec2(-1,1))-H(vec2(-1,-1)));
          vec3 n=normalize(vec3(-dx*uStr*3.,-dy*uStr*3.,1.)); gl_FragColor=vec4(n*.5+.5,1.); }`,
    });
    const rtC = mkRT(size, false);
    quad.material = matC; renderer.setRenderTarget(rtC); renderer.render(scene, cam);
    // pass D: ORM (ao from height cavity)
    const matD = new THREE.ShaderMaterial({
      uniforms: { tD: { value: rtB.texture }, uPx: { value: px * (size / 512) } }, vertexShader: VERT, depthTest: false,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tD; uniform float uPx;
        void main(){ vec4 d=texture2D(tD,vUv); float a=0.;
          for(int i=0;i<8;i++){ float an=float(i)*.7854; vec2 o=vec2(cos(an),sin(an)); a+=texture2D(tD,vUv+o*uPx*2.).x+texture2D(tD,vUv+o*uPx*5.).x; }
          a/=16.; float ao=clamp(1.-(a-d.x)*4.,.35,1.);
          gl_FragColor=vec4(ao,d.y,d.z,1.); }`,
    });
    const rtD = mkRT(size, false);
    quad.material = matD; renderer.setRenderTarget(rtD); renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    matA.dispose(); matB.dispose(); matC.dispose(); matD.dispose(); rtB.dispose();
    out[name] = { map: rtA.texture, normalMap: rtC.texture, orm: rtD.texture };
    if (onProgress) onProgress((idx + 1) / names.length);
  });
  renderer.setRenderTarget(prevRT);
  renderer.autoClear = prevAuto;
  quad.geometry.dispose();
  return out;
}

// ---------- canvas-generated sprite / decal textures ----------
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 4x4 atlas of fx sprites. frames:
// 0 soft glow, 1 smoke A, 2 smoke B, 3 spark/streak, 4 muzzle star, 5 ring, 6 debris chip, 7 dust wisp
// 8 flare cross, 9 hard dot, 10 rain streak, 11 ember, 12 shock disk, 13 smoke C, 14 beam, 15 hex shield
export function makeFxAtlas() {
  const S = 1024, C = 256;
  return canvasTex(S, (g) => {
    g.clearRect(0, 0, S, S);
    const cell = (i, fn) => { g.save(); g.translate((i % 4) * C, ((i / 4) | 0) * C); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
    const rnd = (() => { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const radial = (x, y, r, stops) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    cell(0, () => radial(128, 128, 126, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,.55)'], [0.5, 'rgba(255,255,255,.14)'], [1, 'rgba(255,255,255,0)']]));
    const smoke = (seedN) => () => {
      for (let i = 0; i < 46; i++) {
        const a = rnd() * 6.283, d = Math.pow(rnd(), 0.8) * 70, r = 26 + rnd() * 44;
        const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
        const v = 150 + rnd() * 105 | 0;
        radial(x, y, Math.min(r, 124 - Math.max(Math.abs(x - 128), Math.abs(y - 128))), [[0, `rgba(${v},${v},${v},${0.10 + rnd() * 0.12})`], [1, `rgba(${v},${v},${v},0)`]]);
      }
    };
    cell(1, smoke(1)); cell(2, smoke(2)); cell(13, smoke(3));
    cell(3, () => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      const gx = g.createLinearGradient(96, 0, 160, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gx; g.fillRect(96, 0, 64, 256); g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(0, 0, 256, 256); g.globalCompositeOperation = 'source-over'; });
    cell(4, () => {
      g.translate(128, 128);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.283 + rnd() * 0.5, len = 60 + rnd() * 62, w = 10 + rnd() * 16;
        g.save(); g.rotate(a);
        const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, -w); g.quadraticCurveTo(len * 0.6, -w * 0.3, len, 0); g.quadraticCurveTo(len * 0.6, w * 0.3, 0, w); g.fill(); g.restore();
      }
      radial(0, 0, 70, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    });
    cell(5, () => { g.strokeStyle = 'rgba(255,255,255,1)'; for (let i = 0; i < 14; i++) { g.globalAlpha = 0.08 * (1 - Math.abs(i - 7) / 7) + 0.02; g.lineWidth = 2 + i * 2; g.beginPath(); g.arc(128, 128, 100, 0, 6.283); g.stroke(); } g.globalAlpha = 1; g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 100, 0, 6.283); g.stroke(); });
    cell(6, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(70, 90); g.lineTo(150, 60); g.lineTo(196, 120); g.lineTo(160, 190); g.lineTo(84, 176); g.closePath(); g.fill(); });
    cell(7, () => { for (let i = 0; i < 30; i++) { const x = 40 + rnd() * 176, y = 90 + rnd() * 76, r = 18 + rnd() * 30; radial(x, y, Math.min(r, x, 256 - x, y, 256 - y), [[0, `rgba(255,255,255,${0.06 + rnd() * 0.1})`], [1, 'rgba(255,255,255,0)']]); } });
    cell(8, () => { g.translate(128, 128); for (let k = 0; k < 2; k++) { g.save(); g.rotate(k * Math.PI / 2); const gr = g.createLinearGradient(-124, 0, 124, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 124, 5, 0, 0, 6.283); g.fill(); g.restore(); } radial(0, 0, 60, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]); });
    cell(9, () => radial(128, 128, 120, [[0, 'rgba(255,255,255,1)'], [0.7, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]));
    cell(10, () => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.3, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(122, 4, 12, 248); });
    cell(11, () => radial(128, 128, 90, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]));
    cell(12, () => radial(128, 128, 124, [[0, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,.12)'], [0.88, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']]));
    cell(14, () => { const gx = g.createLinearGradient(64, 0, 192, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(.42, 'rgba(255,255,255,.5)'); gx.addColorStop(.5, 'rgba(255,255,255,1)'); gx.addColorStop(.58, 'rgba(255,255,255,.5)'); gx.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gx; g.fillRect(64, 0, 128, 256); });
    cell(15, () => { g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3; const R = 30; for (let row = -1; row < 7; row++) for (let colm = -1; colm < 7; colm++) { const cx = colm * R * 1.732 + (row % 2 ? R * 0.866 : 0), cy = row * R * 1.5; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * 1.0472 + 0.5236; const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); } g.globalCompositeOperation = 'destination-in'; radial(128, 128, 126, [[0, 'rgba(255,255,255,1)'], [0.7, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']]); g.globalCompositeOperation = 'source-over'; });
  }, false);
}

// 2x2 decal atlas: 0 bullet hole (concrete), 1 bullet hole (metal), 2 scorch, 3 crack/oil splat
export function makeDecalAtlas() {
  const S = 512, C = 256;
  return canvasTex(S, (g) => {
    g.clearRect(0, 0, S, S);
    const rnd = (() => { let s = 7654321; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const cell = (i, fn) => { g.save(); g.translate((i % 2) * C, ((i / 2) | 0) * C); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
    const radial = (x, y, r, stops) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    cell(0, () => {
      radial(128, 128, 110, [[0, 'rgba(20,18,16,.9)'], [0.35, 'rgba(40,38,35,.55)'], [1, 'rgba(60,58,55,0)']]);
      for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, l = 30 + rnd() * 70; g.strokeStyle = `rgba(15,14,13,${0.25 + rnd() * 0.4})`; g.lineWidth = 1 + rnd() * 3; g.beginPath(); g.moveTo(128 + Math.cos(a) * 14, 128 + Math.sin(a) * 14); g.lineTo(128 + Math.cos(a + (rnd() - .5) * .4) * l, 128 + Math.sin(a + (rnd() - .5) * .4) * l); g.stroke(); }
      for (let i = 0; i < 30; i++) { const a = rnd() * 6.283, d = 28 + rnd() * 50; g.fillStyle = `rgba(190,185,175,${rnd() * 0.5})`; g.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + rnd() * 5, 2 + rnd() * 5); }
      radial(128, 128, 30, [[0, 'rgba(0,0,0,1)'], [0.7, 'rgba(5,5,5,.95)'], [1, 'rgba(10,10,10,0)']]);
    });
    cell(1, () => {
      radial(128, 128, 80, [[0, 'rgba(30,30,32,.8)'], [0.5, 'rgba(60,60,64,.35)'], [1, 'rgba(60,60,64,0)']]);
      g.strokeStyle = 'rgba(215,220,230,.85)'; g.lineWidth = 7; g.beginPath(); g.arc(128, 128, 30, 0, 6.283); g.stroke();
      g.strokeStyle = 'rgba(120,125,135,.6)'; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 37, 0, 6.283); g.stroke();
      radial(128, 128, 27, [[0, 'rgba(0,0,0,1)'], [0.85, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']]);
    });
    cell(2, () => {
      for (let i = 0; i < 60; i++) { const a = rnd() * 6.283, d = rnd() * 60, r = 20 + rnd() * 50; const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d; radial(x, y, Math.min(r, 126 - Math.max(Math.abs(x - 128), Math.abs(y - 128))), [[0, `rgba(8,7,6,${0.12 + rnd() * 0.15})`], [1, 'rgba(8,7,6,0)']]); }
      for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, l = 50 + rnd() * 70; g.strokeStyle = `rgba(5,5,5,${0.1 + rnd() * 0.2})`; g.lineWidth = 2 + rnd() * 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * l, 128 + Math.sin(a) * l); g.stroke(); }
    });
    cell(3, () => {
      for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, d = Math.pow(rnd(), 1.5) * 90, r = 6 + rnd() * 30 * (1 - d / 100); const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d; g.fillStyle = `rgba(10,9,8,${0.5 + rnd() * 0.4})`; g.beginPath(); g.arc(x, y, Math.max(2, r), 0, 6.283); g.fill(); }
    });
  });
}

export function makeLightPoolTex() {
  return canvasTex(256, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.62)'); gr.addColorStop(0.55, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }, false);
}

// worn paint marking strip (alpha) — used for floor lines
export function makePaintTex() {
  const t = canvasTex(256, (g, S) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    let s = 99; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.8})`; const r = 1 + rnd() * rnd() * 14; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, r, r * (0.4 + rnd()), rnd() * 3, 0, 6.283); g.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeHexTex() {
  const t = canvasTex(256, (g, S) => {
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2.5; const R = S / 6 / 0.866 / 2 * 1.0;
    const w = Math.sqrt(3) * R, hh = 1.5 * R;
    for (let row = -1; row < S / hh + 1; row++) for (let c = -1; c < S / w + 1; c++) { const cx = c * w + (row % 2 ? w / 2 : 0), cy = row * hh; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); }
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3);
  return t;
}
