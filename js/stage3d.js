// Holo Arena 3D stage. BoardUI keeps owning layout, input and game flow; this draws the board in WebGL
// underneath its DOM cards (which stay as invisible hit targets plus the HP/energy overlays).
// Every frame each DOM card's animated transform is read and applied to a real 3D card mesh.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { D } from './engine.js';
import { TYPE_COLOR } from './fx.js';

const $ = (s, r = document) => r.querySelector(s);
const pref = (k, d) => { try { const v = localStorage.getItem('holo.' + k); return v === null ? d : v; } catch (e) { return d; } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Reduced motion is an in-game setting (Settings > Effects). The OS flag is not used: many PCs have it on by default.
const reduced = () => pref('reduce', '0') === '1';
const fxOff = () => pref('fx', '1') === '0';
const spd = () => parseFloat(pref('speed', '1')) || 1;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const hex = (c) => new THREE.Color(c || '#ffffff');

const R1 = 88 / 63, CORNER = 0.05, THICK = 0.018;

// ------------------------------------------------------------------ geometry
function roundedShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function faceGeo(back) {
  const g = new THREE.ShapeGeometry(roundedShape(1, R1, CORNER), 6), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + 0.5, p.getY(i) / R1 + 0.5);
  if (back) g.rotateY(Math.PI); return g;
}
const BODY_G = new THREE.ExtrudeGeometry(roundedShape(1, R1, CORNER), { depth: THICK, bevelEnabled: false, curveSegments: 6 });
BODY_G.translate(0, 0, -THICK / 2);
const FRONT_G = faceGeo(false), BACK_G = faceGeo(true);

// ------------------------------------------------------------------ shaders
const CARD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CARD_FS = `
uniform sampler2D map; uniform float foil, time, vis, flash, dim, seed; uniform vec2 tilt; uniform vec4 rim; uniform vec3 burn;
varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main(){
  float n = vn(vUv * 9.0 + seed) * 0.7 + vn(vUv * 23.0 + seed) * 0.3;
  if (vis < 0.999 && n > vis) discard;
  vec3 c = texture2D(map, vUv).rgb;
  float band = vUv.x * 0.8 + vUv.y * 0.6 + tilt.x * 1.1 + tilt.y * 0.8;
  vec3 rb = hue(fract(band * 1.2));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float m = foil * (0.3 + 0.7 * smoothstep(0.3, 0.9, lum));
  c = mix(c, c * 0.8 + rb * 0.5, m * 0.42);
  float streak = pow(max(0.0, 1.0 - abs(fract(band * 1.6 + time * 0.03) - 0.5) * 5.5), 2.0);
  c += rb * streak * foil * 0.35;
  float gl = step(0.992, h21(floor(vUv * 150.0) + floor(band * 7.0))) * foil;
  c += vec3(1.6, 1.5, 1.2) * gl * (0.4 + 0.6 * streak + 0.2);
  float d = min(min(vUv.x, 1.0 - vUv.x) * 0.72, min(vUv.y, 1.0 - vUv.y));
  c *= 1.0 - (1.0 - smoothstep(0.0, 0.007, d)) * 0.55;
  c = mix(c, rim.rgb * 1.5, (1.0 - smoothstep(0.0, 0.032, d)) * rim.a * (0.65 + 0.35 * sin(time * 5.0)));
  c *= 1.0 - dim * 0.45;
  c += vec3(flash);
  if (vis < 0.999) c += burn * smoothstep(vis - 0.13, vis, n) * 3.2;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
const PART_VS = `attribute float size; attribute vec4 color; uniform float pr; varying vec4 vC;
void main(){ vC = color; gl_PointSize = size * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PART_FS = `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
  gl_FragColor = vec4(vC.rgb, vC.a * a);
  #include <colorspace_fragment>
}`;
const MOTE_VS = `attribute float seed; uniform float time, pr, W, H; varying float vA;
void main(){ float t = time * 0.05 + seed * 40.0; vec3 p = position;
  p.x += sin(t * 1.3 + seed * 9.0) * 60.0; p.y = mod(p.y + time * (6.0 + seed * 14.0) + H * 0.5, H) - H * 0.5; vA = 0.25 + 0.75 * fract(seed * 7.0);
  gl_PointSize = (2.0 + seed * 5.0) * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const MOTE_FS = `uniform vec3 tint; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(tint * 1.5, a * a * vA * 0.5);
  #include <colorspace_fragment>
}`;
const RING_FS = `uniform float t, w; uniform vec3 col; varying vec2 vUv;
void main(){ float d = length(vUv - 0.5) * 2.0; float r = 1.0 - pow(1.0 - t, 2.4); float th = w * (1.0 - t * 0.7);
  float a = smoothstep(th, 0.0, abs(d - r)) * (1.0 - t); gl_FragColor = vec4(col * 2.2, a);
  #include <colorspace_fragment>
}`;
const GLOW_FS = `uniform float time, amt; uniform vec3 col; uniform vec2 size; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * size; vec2 b = size * 0.5 - 6.0; vec2 q = abs(p) - b; float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 6.0;
  float a = exp(-max(sd, 0.0) * 0.09) * (sd < 0.0 ? 0.0 : 1.0) * (0.55 + 0.25 * sin(time * 3.0)); gl_FragColor = vec4(col * 1.4, a * amt);
  #include <colorspace_fragment>
}`;
const PORTAL_FS = `uniform float time, amt; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
  float sw = sin(a * 3.0 + r * 9.0 - time * 2.6) * 0.5 + 0.5; float sw2 = sin(a * 5.0 - r * 14.0 + time * 3.4) * 0.5 + 0.5;
  float core = exp(-r * 3.2); float mask = smoothstep(1.02, 0.55, max(abs(p.x), abs(p.y * 0.72)));
  vec3 c = mix(vec3(0.12, 0.03, 0.3), vec3(0.62, 0.3, 1.0), sw * 0.6 + sw2 * 0.3) + vec3(0.9, 0.7, 1.6) * core * amt;
  gl_FragColor = vec4(c, mask * (0.55 + 0.4 * (1.0 - r)));
  #include <colorspace_fragment>
}`;
const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const CINEMA = {
  uniforms: { tDiffuse: { value: null }, uC: { value: new THREE.Vector2(0.5, 0.5) }, uBlur: { value: 0 }, uCA: { value: 0 }, uVig: { value: 0.4 },
    uSpot: { value: new THREE.Vector4(0.5, 0.5, 0.3, 0) }, uGrain: { value: 0.035 }, uTime: { value: 0 }, uAsp: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uC; uniform float uBlur, uCA, uVig, uGrain, uTime, uAsp; uniform vec4 uSpot; uniform vec3 uTint; varying vec2 vUv;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 d = vUv - uC; vec3 col;
    if (uBlur > 0.002) { col = vec3(0.0); for (int i = 0; i < 7; i++) { float k = float(i) / 7.0; col += texture2D(tDiffuse, vUv - d * k * uBlur).rgb; } col /= 7.0; }
    else col = texture2D(tDiffuse, vUv).rgb;
    if (uCA > 0.0002) { vec2 o = d * uCA * (1.0 + dot(d, d) * 5.0); col.r = texture2D(tDiffuse, vUv + o).r; col.b = texture2D(tDiffuse, vUv - o).b; }
    vec2 sp = (vUv - uSpot.xy) * vec2(uAsp, 1.0); float sm = smoothstep(uSpot.z, uSpot.z * 2.0, length(sp));
    col *= 1.0 - sm * uSpot.w * 0.72; col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), sm * uSpot.w * 0.5);
    float r = dot(vUv - 0.5, vUv - 0.5); col *= 1.0 - smoothstep(0.12, 0.62, r) * uVig;
    col *= uTint;
    col += (h21(vUv * 900.0 + uTime) - 0.5) * uGrain;
    gl_FragColor = vec4(col, 1.0);
  }`,
};

// ------------------------------------------------------------------ particles (CPU-simulated points)
class Parts {
  constructor(cap, additive, scene, pr) {
    this.cap = cap; this.head = 0; this.live = 0; this.px = new Float32Array(cap); this.py = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.tx = new Float32Array(cap); this.ty = new Float32Array(cap); this.hasT = new Uint8Array(cap);
    this.cr = new Float32Array(cap * 3); this.sz0 = new Float32Array(cap);
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.size = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ uniforms: { pr: { value: pr } }, vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthTest: false, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 10; this.pts.position.z = 260; this.pts.visible = false; scene.add(this.pts);
  }
  spawn(x, y, vx, vy, life, size, c, grav, drag, tx = null, ty = null) {
    const i = this.head; this.head = (this.head + 1) % this.cap; if (this.life[i] <= 0) this.live++;
    this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.sz0[i] = size;
    this.cr[i * 3] = c.r; this.cr[i * 3 + 1] = c.g; this.cr[i * 3 + 2] = c.b; this.hasT[i] = tx === null ? 0 : 1; this.tx[i] = tx; this.ty[i] = ty;
  }
  update(dt, W, H) {
    if (!this.live) { this.pts.visible = false; return; }
    const g = this.pts.geometry; const f60 = dt * 60;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt; if (this.life[i] <= 0) { this.live--; this.size[i] = 0; continue; }
      if (this.hasT[i]) { const dx = this.tx[i] - this.px[i], dy = this.ty[i] - this.py[i], d = Math.hypot(dx, dy) || 1; this.vx[i] += (dx / d * 1100 - dy / d * 520) * dt; this.vy[i] += (dy / d * 1100 + dx / d * 520) * dt; if (d < 24) { this.life[i] = 0; this.live--; this.size[i] = 0; continue; } }
      this.vy[i] += this.grav[i] * dt; const dr = Math.pow(this.drag[i], f60); this.vx[i] *= dr; this.vy[i] *= dr; this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt;
      const k = this.life[i] / this.max[i];
      this.pos[i * 3] = this.px[i] - W / 2; this.pos[i * 3 + 1] = H / 2 - this.py[i]; this.pos[i * 3 + 2] = 0;
      this.col[i * 4] = this.cr[i * 3]; this.col[i * 4 + 1] = this.cr[i * 3 + 1]; this.col[i * 4 + 2] = this.cr[i * 3 + 2]; this.col[i * 4 + 3] = Math.min(1, k * 1.6);
      this.size[i] = this.sz0[i] * (0.4 + 0.6 * k);
    }
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true; this.pts.visible = this.live > 0;
  }
}

// ------------------------------------------------------------------ text helpers (DOM, animated with CSS)
const letters = (txt, step = 28) => [...String(txt)].map((ch, i) => `<i style="--i:${i};--st:${step}ms">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('');
const COND_TEXT = { poisoned: 'Poisoned: 1 damage counter between turns.', burned: 'Burned: 2 damage counters between turns, then flip a coin to heal.', asleep: 'Asleep: cannot attack or retreat. Flip a coin between turns to wake.', paralyzed: 'Paralyzed: cannot attack or retreat until the end of the next turn.', confused: 'Confused: flip a coin to attack. Tails: 3 damage counters on itself.' };

export class Stage3D {
  constructor(ui) {
    this.ui = ui; this.on = false; this.ready = false; this.cm = new Map(); this.tex = new Map(); this.tier = 'high'; this.ptr = { x: -999, y: -999 };
    this.orig = {}; this.shots = []; this.rings = []; this.imp = { blur: 0, ca: 0, flash: 0 }; this.spot = null; this.frames = 0; this.acc = 0; this.low = 0; this.t = 0; this.W = 0; this.H = 0; this.zoomAnim = null;
  }

  // ---------------------------------------------------------------- setup
  init() {
    const ui = this.ui;
    this.canvas = document.createElement('canvas'); this.canvas.id = 'gl3d'; this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x070a1c);
    this.cam = new THREE.PerspectiveCamera(14, 1, 1, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.3); this.sun.castShadow = true; this.scene.add(this.sun, this.sun.target);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 })); this.floor.receiveShadow = true; this.floor.position.z = -3; this.scene.add(this.floor);
    this.edge = new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.85 });
    const ph = new THREE.DataTexture(new Uint8Array([40, 58, 110, 255]), 1, 1); ph.colorSpace = THREE.SRGBColorSpace; ph.needsUpdate = true; this.ph = ph;
    this.back = this.getTex('./assets/cardback.jpg');
    this.pr = 1; this.add = new Parts(3500, true, this.scene, 1); this.nrm = new Parts(900, false, this.scene, 1);
    // ambient motes
    const N = 46, mp = new Float32Array(N * 3), ms = new Float32Array(N); for (let i = 0; i < N; i++) { mp[i * 3] = (Math.random() - 0.5) * 1800; mp[i * 3 + 1] = (Math.random() - 0.5) * 1000; mp[i * 3 + 2] = -1; ms[i] = Math.random(); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('seed', new THREE.BufferAttribute(ms, 1));
    this.moteMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, pr: { value: 1 }, W: { value: 1 }, H: { value: 1 }, tint: { value: new THREE.Color(0.6, 0.75, 1) } }, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.motes = new THREE.Points(mg, this.moteMat); this.motes.frustumCulled = false; this.motes.position.z = -2; this.scene.add(this.motes);
    // ring pool
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: { t: { value: 0 }, w: { value: 0.08 }, col: { value: new THREE.Color() } }, vertexShader: QUAD_VS, fragmentShader: RING_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; m.renderOrder = 9; m.position.z = 250; this.scene.add(m); this.rings.push({ m, t: 1, dur: 1, r: 1 }); }
    // decks / glows / portals are built per layout
    this.deckMeshes = []; this.glows = []; this.portals = []; this.decor = new THREE.Group(); this.scene.add(this.decor);
    // post
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 1.0); this.composer.addPass(this.bloom);
    this.cin = new ShaderPass(CINEMA); this.composer.addPass(this.cin); this.composer.addPass(new OutputPass());
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.fail('Graphics context lost'); });
    addEventListener('resize', () => this.layout());
    document.addEventListener('pointermove', (e) => { const r = this.canvas.getBoundingClientRect(); this.ptr.x = (e.clientX - r.left) * (this.W / (r.width || 1)); this.ptr.y = (e.clientY - r.top) * (this.H / (r.height || 1)); }, { passive: true });
    this.clock = new THREE.Clock(); this.ready = true;
  }
  fail(msg) { console.warn('3D disabled:', msg); try { localStorage.setItem('holo.gfx', 'lite'); } catch (e) { /* ignore */ } this.disable(); const t = $('#toast'); if (t) { const d = document.createElement('div'); d.textContent = 'Switched to Lite mode: ' + msg; t.append(d); setTimeout(() => d.remove(), 4000); } }

  // ---------------------------------------------------------------- enable / disable / tiers
  enable(mode = 'auto') {
    if (!this.ready) this.init();
    const phone = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 520;
    this.auto = mode === 'auto'; this.setTier(mode === 'auto' ? (phone ? 'medium' : 'high') : mode);
    if (this.on) return; this.on = true;
    const ui = this.ui; ui.table.prepend(this.canvas); $('#game').classList.add('r3d'); const fxc = $('#fx'); if (fxc) fxc.style.display = 'none';
    // swap 2D helpers for 3D versions
    this.orig = { fx: ui.fx, popText: ui.popText, banner: ui.banner, shake: ui.shake };
    ui.fx = this.shim(); ui.popText = (x, y, t, c) => this.popText(x, y, t, c); ui.banner = (t, c) => this.banner(t, c);
    ui.shake = (big) => { this.orig.shake.call(ui, big); this.impact(big ? 1 : 0.5); };
    ui.hook = (e, ph, v) => this.onEvent(e, ph, v);
    this.layout(); this.floorDirty = true; this.skip = 90; this.low = 0; this.frames = 0; this.acc = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }
  disable() {
    if (!this.on) return; this.on = false; const ui = this.ui; this.renderer && this.renderer.setAnimationLoop(null);
    $('#game').classList.remove('r3d'); const fxc = $('#fx'); if (fxc) fxc.style.display = ''; this.canvas.remove();
    if (this.orig.fx) { ui.fx = this.orig.fx; ui.popText = this.orig.popText; ui.banner = this.orig.banner; ui.shake = this.orig.shake; ui.hook = null; }
    for (const cm of this.cm.values()) this.scene.remove(cm.g); this.cm.clear();
    if (this.zoomAnim) { this.zoomAnim.cancel(); this.zoomAnim = null; }
  }
  setTier(t) {
    this.tier = t; const high = t === 'high', dpr = devicePixelRatio || 1;
    this.pr = Math.min(dpr, 2); this.renderer.setPixelRatio(this.pr);
    this.renderer.shadowMap.enabled = true; this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.bloom.enabled = high; this.motes.visible = high || t === 'medium'; this.usePost = high;
    this.add.mat.uniforms.pr.value = this.nrm.mat.uniforms.pr.value = this.moteMat.uniforms.pr.value = this.pr;
    this.floor.material.needsUpdate = true; this.layout();
  }
  downgrade() {
    const next = this.tier === 'high' ? 'medium' : null; const t = $('#toast');
    if (next) { this.setTier(next); this.say('Graphics lowered to Medium for smoother play'); } else { this.say('Switching to Lite mode for smoother play'); this.disable(); try { localStorage.setItem('holo.gfx', 'lite'); } catch (e) { /* ignore */ } }
  }
  say(msg) { const t = $('#toast'); if (!t) return; const d = document.createElement('div'); d.textContent = msg; t.append(d); setTimeout(() => d.remove(), 3500); }

  // ---------------------------------------------------------------- layout
  layout() {
    if (!this.ready || !this.on) return; const ui = this.ui; const W = ui.table.clientWidth || innerWidth, H = ui.table.clientHeight || innerHeight; if (!W || !H) return;
    this.W = W; this.H = H; this.renderer.setSize(W, H, false); this.composer.setPixelRatio(this.pr); this.composer.setSize(W, H);
    const dist = (H / 2) / Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)); this.cam.near = dist * 0.5; this.cam.far = dist * 1.6; this.cam.aspect = W / H;
    this.cam.position.set(0, 0, dist); this.cam.lookAt(0, 0, 0); this.cam.updateProjectionMatrix(); this.dist = dist;
    this.floor.scale.set(W, H, 1); this.moteMat.uniforms.W.value = W; this.moteMat.uniforms.H.value = H; this.cin.uniforms.uAsp.value = W / H;
    this.sun.position.set(-W * 0.18, H * 0.3, dist * 0.6); this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera; sc.left = -W * 0.58; sc.right = W * 0.58; sc.top = H * 0.62; sc.bottom = -H * 0.62; sc.near = 1; sc.far = dist * 2; sc.updateProjectionMatrix(); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6; this.sun.shadow.radius = 3;
    this.floorDirty = true;
  }
  toLocal(x, y) { const r = this.canvas.getBoundingClientRect(); return { x: (x - r.left) * (this.W / (r.width || 1)), y: (y - r.top) * (this.H / (r.height || 1)) }; }

  rebuildArena() {
    const ui = this.ui, W = this.W, H = this.H, k = Math.min(this.pr * 1, 2); const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k); const g = cv.getContext('2d'); g.scale(k, k);
    const hue = (225 + (parseFloat(pref('hue', '0')) || 0)) % 360; this.hue = hue;
    const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75); bg.addColorStop(0, `hsl(${hue},48%,24%)`); bg.addColorStop(0.55, `hsl(${hue},55%,13%)`); bg.addColorStop(1, `hsl(${hue + 20},60%,6%)`);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.06; g.strokeStyle = `hsl(${hue},80%,75%)`; g.lineWidth = 1; const hs = Math.max(34, ui.cw * 0.5), hh = hs * 0.866;
    for (let r = -1; r < H / hh + 1; r++) for (let c = -1; c < W / hs / 1.5 + 1; c++) { const x = c * hs * 3 + (r % 2 ? hs * 1.5 : 0), y = r * hh; g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; g.lineTo(x + Math.cos(a) * hs, y + Math.sin(a) * hs); } g.closePath(); g.stroke(); }
    g.globalAlpha = 1;
    // Poké Ball emblem + centre line
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.19; g.save(); g.translate(cx, cy); g.strokeStyle = `hsla(${hue},90%,80%,.16)`; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.2, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, R * 1.18, 0, Math.PI * 2); g.lineWidth = 1.5; g.setLineDash([4, 10]); g.stroke(); g.restore();
    const ln = g.createLinearGradient(0, 0, W, 0); ln.addColorStop(0, 'transparent'); ln.addColorStop(0.5, `hsla(${hue},95%,75%,.55)`); ln.addColorStop(1, 'transparent'); g.fillStyle = ln; g.fillRect(W * 0.04, cy - 1.5, W * 0.92, 3);
    // slots
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
    for (const [key, z] of Object.entries(ui.zones || {})) {
      const x = z.offsetLeft, y = z.offsetTop, w = z.offsetWidth, h = z.offsetHeight, r = ui.cw * 0.09; if (/Lost$/.test(key)) continue;
      const act = /Active$/.test(key), stad = key === 'stadium', pr = /Prize$/.test(key);
      g.save(); rr(x, y, w, h, r); g.fillStyle = act ? 'rgba(255,214,120,.09)' : stad ? 'rgba(120,255,190,.07)' : 'rgba(180,205,255,.055)'; g.fill();
      g.lineWidth = act ? 2.5 : 1.8; g.strokeStyle = act ? 'rgba(255,205,110,.75)' : stad ? 'rgba(110,240,180,.6)' : pr ? 'rgba(255,150,190,.5)' : 'rgba(150,185,255,.5)'; if (!act) g.setLineDash([7, 6]); g.shadowColor = g.strokeStyle; g.shadowBlur = 10; g.stroke(); g.restore();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.floor.material.map?.dispose(); this.floor.material.map = t; this.floor.material.needsUpdate = true;
    // decks, glows, portals
    this.decor.clear(); this.deckMeshes = []; this.glows = []; this.portals = []; const L = ui.L, cw = ui.cw, ch = ui.ch;
    for (const side of ['me', 'op']) {
      const P = L.pos[side]; const dg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [this.edge, this.edge, this.edge, this.edge, this.deckTopMat(), this.edge]);
      dg.castShadow = true; dg.receiveShadow = true; dg.userData.side = side; dg.position.set(P.deck[0] - W / 2, H / 2 - P.deck[1], 0); this.decor.add(dg); this.deckMeshes.push(dg);
      const az = ui.zones[side + 'Active']; if (az) { const gm = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, amt: { value: 0 }, col: { value: new THREE.Color(1, 0.8, 0.35) }, size: { value: new THREE.Vector2(az.offsetWidth + 40, az.offsetHeight + 40) } }, vertexShader: QUAD_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(az.offsetWidth + 40, az.offsetHeight + 40), gm); m.position.set(az.offsetLeft + az.offsetWidth / 2 - W / 2, H / 2 - (az.offsetTop + az.offsetHeight / 2), -2); this.decor.add(m); this.glows.push({ m, side }); }
      const lz = ui.zones[side + 'Lost']; if (lz) { const pm = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, amt: { value: 0.4 } }, vertexShader: QUAD_VS, fragmentShader: PORTAL_FS, transparent: true, depthWrite: false });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(lz.offsetWidth, lz.offsetHeight), pm); m.position.set(lz.offsetLeft + lz.offsetWidth / 2 - W / 2, H / 2 - (lz.offsetTop + lz.offsetHeight / 2), -1.5); this.decor.add(m); this.portals.push({ m, side }); }
    }
    this.deckW = cw; this.deckH = ch;
  }
  deckTopMat() { const m = new THREE.MeshStandardMaterial({ map: this.back.tex, roughness: 0.5 }); m.userData.back = true; return m; }

  getTex(src) {
    let e = this.tex.get(src); if (e) return e; e = { tex: this.ph, ready: false }; this.tex.set(src, e);
    const L = new THREE.TextureLoader(); L.setCrossOrigin('anonymous');
    L.load(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); e.tex = t; e.ready = true; }, undefined, () => { /* keep placeholder */ });
    return e;
  }
  cardMat(map) {
    return new THREE.ShaderMaterial({ uniforms: { map: { value: map || this.ph }, foil: { value: 0 }, time: { value: 0 }, vis: { value: 1 }, flash: { value: 0 }, dim: { value: 0 }, seed: { value: 0 }, tilt: { value: new THREE.Vector2() }, rim: { value: new THREE.Vector4() }, burn: { value: new THREE.Color(1, 0.5, 0.2) } }, vertexShader: CARD_VS, fragmentShader: CARD_FS });
  }
  make(el) {
    const g = new THREE.Group(), fm = this.cardMat(), bm = this.cardMat(); const body = new THREE.Mesh(BODY_G, this.edge); body.castShadow = true;
    const f = new THREE.Mesh(FRONT_G, fm), b = new THREE.Mesh(BACK_G, bm); f.position.z = THICK / 2 + 0.0006; b.position.z = -THICK / 2 - 0.0006; g.add(body, f, b); g.rotation.order = 'ZYX'; this.scene.add(g);
    const seed = Math.random() * 40; fm.uniforms.seed.value = bm.uniforms.seed.value = seed; bm.uniforms.foil.value = 0.22;
    const cm = { el, g, fm, bm, body, inner: el.querySelector('.inner'), px: 0, py: 0, first: true, flip: el.classList.contains('down') ? Math.PI : 0, hv: 0, fl: 0, fo: 0, id: null, seed, tx: 0, ty: 0, rx: 0, ry: 0 };
    this.cm.set(el, cm); return cm;
  }

  // ---------------------------------------------------------------- frame
  frame() {
    const raw = this.clock.getDelta(); const dt = Math.min(raw, 0.05); this.t += dt; const t = this.t;
    if (!$('#game').classList.contains('active')) return;
    if (this.W !== this.ui.table.clientWidth || this.H !== this.ui.table.clientHeight) this.layout();
    if (this.floorDirty) { this.rebuildArena(); this.floorDirty = false; }
    this.sync(dt, t); this.fxUpdate(dt, t);
    const u = this.cin.uniforms; u.uTime.value = t % 100;
    if (this.usePost) this.composer.render(); else this.renderer.render(this.scene, this.cam);
    // fps watchdog
    if (raw < 0.25) { this.frames++; this.acc += raw; }
    if (this.skip > 0) { this.skip--; this.frames = 0; this.acc = 0; return; }
    if (this.acc >= 2.5) { const fps = this.frames / this.acc; this.fps = fps; this.frames = 0; this.acc = 0; if (this.auto && fps < 34) { if (++this.low >= 2) { this.low = 0; this.downgrade(); } } else this.low = 0; }
  }
  mat(s) { try { return s && s !== 'none' ? new DOMMatrix(s) : new DOMMatrix(); } catch (e) { return new DOMMatrix(); } }

  sync(dt, t) {
    const ui = this.ui, cw = ui.cw, ch = ui.ch, W = this.W, H = this.H, myturn = ui.table.classList.contains('myturn'), view = ui.view;
    const els = [...ui.table.querySelectorAll('.card')]; const info = els.map((el, i) => ({ el, i, cs: getComputedStyle(el) }));
    info.sort((a, b) => ((parseInt(a.cs.zIndex) || 0) - (parseInt(b.cs.zIndex) || 0)) || (a.i - b.i));
    const dz = cw * 0.03; const kdt = 1 - Math.exp(-dt * 14);
    info.forEach(({ el, cs }, rank) => {
      let cm = this.cm.get(el) || this.make(el);
      const M = this.mat(cs.transform).multiply(this.mat(cm.inner ? getComputedStyle(cm.inner).transform : 'none'));
      const cx = cw / 2 + M.e, cy = ch / 2 + M.f, s = Math.hypot(M.a, M.b) || 1, rot = Math.atan2(M.b, M.a);
      const uid = +el.dataset.uid; const live = ui.cards.get(uid); const id = (live && live.id) || cm.id;
      if (id && id !== cm.id) { cm.id = id; const d = D(id); cm.fe = this.getTex(d.img); cm.col = hex(TYPE_COLOR[(d.types && d.types[0]) || 'Colorless'] || '#ffd9a0'); }
      cm.fm.uniforms.map.value = cm.fe ? cm.fe.tex : this.ph; cm.bm.uniforms.map.value = this.back.tex;
      // velocity (px/s), hover, flip
      const vx = cm.first ? 0 : (cx - cm.px) / Math.max(dt, 1e-3), vy = cm.first ? 0 : (cy - cm.py) / Math.max(dt, 1e-3); cm.px = cx; cm.py = cy;
      const down = el.classList.contains('down'), snap = el.classList.contains('snap'), hov = !down && el.matches(':hover') && !el.classList.contains('dragging');
      if (cm.first || snap) cm.flip = down ? Math.PI : 0; else cm.flip += ((down ? Math.PI : 0) - cm.flip) * (1 - Math.exp(-dt * 11));
      cm.hv += ((hov ? 1 : 0) - cm.hv) * kdt;
      let rx = clamp(vy * 0.00055, -0.45, 0.45), ry = clamp(-vx * 0.00055, -0.45, 0.45);
      if (cm.hv > 0.01) { const u = clamp((this.ptr.x - cx) / (cw * s), -0.6, 0.6), v = clamp((this.ptr.y - cy) / (ch * s), -0.6, 0.6); rx += v * 0.55 * cm.hv; ry += u * 0.55 * cm.hv; }
      if (el.classList.contains('idle')) { rx += Math.cos(t * 0.9 + cm.seed) * 0.03; ry += Math.sin(t * 1.1 + cm.seed) * 0.05; }
      cm.rx += (rx - cm.rx) * kdt; cm.ry += (ry - cm.ry) * kdt;
      const speed = Math.hypot(vx, vy), lift = clamp(speed * 0.045, 0, cw * 0.55) + Math.sin(cm.flip) * cw * 0.35 + cm.hv * cw * 0.12 + Math.max(0, s - 1) * cw * 1.4;
      cm.g.position.set(cx - W / 2, H / 2 - cy, rank * dz + lift); cm.g.rotation.set(cm.rx, cm.ry + cm.flip, -rot); cm.g.scale.setScalar(cw * s);
      // look
      const fu = cm.fm.uniforms, bu = cm.bm.uniforms; const foilT = el.classList.contains('foil') ? 1 : 0; cm.fo += (foilT - cm.fo) * kdt; fu.foil.value = cm.fo;
      fu.tilt.value.set(cm.ry + cm.flip * 0, cm.rx); fu.time.value = bu.time.value = t; bu.tilt.value.set(cm.ry, cm.rx);
      let vis = parseFloat(cs.opacity); if (el.classList.contains('dragging')) { vis = 1; cm.dim = 0.7; } else cm.dim = (myturn && el.classList.contains('hand') && !el.classList.contains('playable')) ? 0.55 : 0;
      fu.vis.value = bu.vis.value = isNaN(vis) ? 1 : vis; cm.g.visible = vis > 0.01; cm.body.visible = vis > 0.98; cm.body.castShadow = vis > 0.98;
      const burn = el.classList.contains('snap-keep') ? [0.75, 0.4, 1] : cm.col ? [cm.col.r, cm.col.g, cm.col.b] : [1, 0.5, 0.2]; fu.burn.value.setRGB(burn[0], burn[1], burn[2]); bu.burn.value.setRGB(burn[0], burn[1], burn[2]);
      fu.dim.value = bu.dim.value = cm.dim; cm.fl += ((el.classList.contains('hit') ? 0.55 : 0) - cm.fl) * (1 - Math.exp(-dt * 16)); fu.flash.value = bu.flash.value = cm.fl;
      const r = fu.rim.value; if (el.classList.contains('targetable')) r.set(1, 0.4, 0.5, 1); else if (el.classList.contains('playable')) r.set(0.25, 0.9, 1, 1); else if (el.classList.contains('canact')) r.set(0.25, 0.9, 1, 0.8); else r.set(0, 0, 0, 0);
      cm.first = false;
    });
    for (const [el, cm] of this.cm) if (!el.isConnected) { this.scene.remove(cm.g); this.cm.delete(el); }
    // decks
    for (const dm of this.deckMeshes) dm.material[4].map = this.back.tex;
    if (view) for (const dm of this.deckMeshes) { const i = dm.userData.side === 'me' ? view.me : 1 - view.me, n = view.pl[i].deckN; const hgt = n ? clamp(2 + n * 0.55, 2, ch * 0.28) : 0.01; dm.userData.h = (dm.userData.h ?? hgt) + (hgt - (dm.userData.h ?? hgt)) * (1 - Math.exp(-dt * 6)); dm.scale.set(cw, ch, dm.userData.h); dm.position.z = dm.userData.h / 2 - 2.5; dm.visible = n > 0; }
    for (const gl of this.glows) { const i = gl.side === 'me' ? view && view.me : view && 1 - view.me; const on = view && view.cur === i && !view.winner; const u = gl.m.material.uniforms; u.time.value = t; u.amt.value += ((on ? 1 : 0) - u.amt.value) * kdt * 0.5; gl.m.visible = u.amt.value > 0.02; }
    for (const p of this.portals) { const i = view ? (p.side === 'me' ? view.me : 1 - view.me) : 0; const n = view ? view.pl[i].lost.length : 0; const u = p.m.material.uniforms; u.time.value = t; u.amt.value = 0.35 + Math.min(n, 20) / 20 * 0.9; }
    this.moteMat.uniforms.time.value = t;
  }

  // ---------------------------------------------------------------- effects: particles, rings, shots, impact, cutscenes
  fxUpdate(dt) {
    const im = this.imp; im.blur *= Math.exp(-dt * 5); im.ca *= Math.exp(-dt * 4.5); im.flash *= Math.exp(-dt * 6); const u = this.cin.uniforms;
    let sa = 0, sx = 0.5, sy = 0.5, sr = 0.3; if (this.spot) { const k = (performance.now() - this.spot.t0) / this.spot.dur; if (k >= 1) this.spot = null; else { sa = Math.pow(Math.sin(Math.PI * clamp(k, 0, 1)), 0.6) * this.spot.a; sx = this.spot.x / this.W; sy = 1 - this.spot.y / this.H; sr = this.spot.r / this.H; u.uBlur.value = Math.max(im.blur, sa * 0.018); } }
    if (!this.spot) u.uBlur.value = im.blur; u.uSpot.value.set(sx, sy, sr, sa); u.uCA.value = 0.0012 + im.ca; this.bloom.strength = 0.5 + im.flash * 1.4; u.uC.value.set(this.impC ? this.impC.x / this.W : 0.5, this.impC ? 1 - this.impC.y / this.H : 0.5);
    for (const s of this.shots) { s.t += dt; const k = clamp(s.t / s.dur, 0, 1), x = s.x1 + (s.x2 - s.x1) * k, y = s.y1 + (s.y2 - s.y1) * k - Math.sin(Math.PI * k) * 60; this.add.spawn(x, y, 0, 0, 0.08, s.size * 2.4, s.c, 0, 1);
      for (let j = 0; j < 3; j++) this.add.spawn(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 0.35, s.size * 0.5, s.c, 0, 0.92);
      if (k >= 1) { s.done = true; s.onHit && s.onHit(); } }
    this.shots = this.shots.filter((s) => !s.done);
    for (const r of this.rings) { if (r.t >= 1) { r.m.visible = false; continue; } r.t += dt / r.dur; r.m.material.uniforms.t.value = Math.min(1, r.t); r.m.visible = r.t < 1; }
    this.add.update(dt, this.W, this.H); this.nrm.update(dt, this.W, this.H);
  }
  impact(amt = 1, at = null) { if (fxOff() || reduced()) return; this.imp.blur = Math.max(this.imp.blur, 0.016 * amt); this.imp.ca = Math.max(this.imp.ca, 0.004 * amt); this.imp.flash = Math.max(this.imp.flash, 0.3 * amt); if (at) this.impC = this.toLocal(at.x, at.y); }
  shim() {
    const me = this;
    return {
      burst(x, y, color = '#fff', { n = 40, speed = 380, life = 0.8, size = 4, grav = 300, spread = Math.PI * 2, dir = 0, drag = 0.96 } = {}) {
        if (fxOff()) return; const p = me.toLocal(x, y), c = hex(color).multiplyScalar(0.85);
        for (let i = 0; i < n; i++) { const a = dir + (Math.random() - 0.5) * spread, sp = speed * (0.25 + Math.random() * 0.9); me.add.spawn(p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.6 + Math.random() * 0.6), size * (1.1 + Math.random() * 1.5), c, grav, drag); } },
      ring(x, y, color = '#fff', { r = 180, life = 0.7, w = 6 } = {}) {
        if (fxOff()) return; const p = me.toLocal(x, y); const slot = me.rings.find((q) => q.t >= 1) || me.rings[0]; slot.t = 0; slot.dur = life; slot.m.position.set(p.x - me.W / 2, me.H / 2 - p.y, 250); slot.m.scale.set(r * 2.2, r * 2.2, 1); slot.m.material.uniforms.col.value.set(color); slot.m.material.uniforms.w.value = clamp(w / r, 0.03, 0.2) * 1.6; slot.m.visible = true; me.impact(0.25, { x, y }); },
      shot(x1, y1, x2, y2, color = '#fff', { dur = 0.45, size = 14, onHit } = {}) {
        if (fxOff()) { onHit && onHit(); return; } const a = me.toLocal(x1, y1), b = me.toLocal(x2, y2); me.shots.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, c: hex(color).multiplyScalar(1.8), dur, t: 0, size: size * 0.9, onHit }); },
      vortex(x1, y1, x2, y2, color = '#b46cff') {
        if (fxOff()) return; const a = me.toLocal(x1, y1), b = me.toLocal(x2, y2), c = hex(color).multiplyScalar(1.7);
        for (let i = 0; i < 40; i++) me.add.spawn(a.x + (Math.random() - 0.5) * 70, a.y + (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.9 + Math.random() * 0.5, 6 + Math.random() * 8, c, 0, 0.97, b.x, b.y); },
      confetti(n = 200) {
        if (fxOff()) return; const pal = ['#ff5c7a', '#ffd166', '#52e08a', '#3ea0ff', '#d05cf0', '#ffffff'];
        for (let i = 0; i < n; i++) me.nrm.spawn(Math.random() * me.W, -20 - Math.random() * 240, (Math.random() - 0.5) * 140, 80 + Math.random() * 200, 3 + Math.random() * 1.6, 7 + Math.random() * 7, hex(pal[i % pal.length]), 230, 0.994); },
      resize() {}, kick() {},
    };
  }
  cut(kind, x, y) {
    if (reduced() || fxOff()) return; const p = this.toLocal(x, y); const cfg = { ko: [1100, 1.22, 0.9], evolve: [1200, 1.28, 0.85], vstar: [1500, 1.14, 0.7], win: [2300, 1.1, 0.6], atk: [800, 1.08, 0.55] }[kind]; if (!cfg) return;
    const dur = cfg[0] * spd(); this.spot = { x: p.x, y: p.y, r: this.ui.ch * 1.5, a: cfg[2], t0: performance.now(), dur }; this.impC = p; this.imp.blur = Math.max(this.imp.blur, 0.02);
    const tb = this.ui.table; if (this.zoomAnim) this.zoomAnim.cancel(); tb.style.transformOrigin = `${p.x}px ${p.y}px`;
    this.zoomAnim = tb.animate([{ transform: 'scale(1)' }, { transform: `scale(${cfg[1]})`, offset: 0.3 }, { transform: `scale(${cfg[1]})`, offset: 0.65 }, { transform: 'scale(1)' }], { duration: dur, easing: 'ease-in-out' });
    this.zoomAnim.onfinish = this.zoomAnim.oncancel = () => { tb.style.transformOrigin = ''; this.zoomAnim = null; };
  }

  // ---------------------------------------------------------------- events from BoardUI
  onEvent(e, ph, v) {
    const ui = this.ui; if (!this.on) return;
    if (ph === 'fit') { this.floorDirty = true; return; }
    const cardOf = (uid) => { const c = ui.cards.get(uid); return c && c.id ? D(c.id) : null; };
    if (ph === 'pre') {
      if (e.type === 'attack') { const d = cardOf(e.uid), atk = d && (d.attacks || []).find((a) => a.name === e.name); const c = ui.center(e.pid); this.readout('attack', e.name, atk && atk.effect, e.dmg ? String(e.dmg) : '', c); if (c) this.cut('atk', c.x, c.y); }
      if (e.type === 'ko') { const c = ui.center(e.pid); if (c) { this.cut('ko', c.x, c.y); this.impact(1.2, c); } }
    } else if (ph === 'post') {
      if (e.type === 'ability') { const d = cardOf(e.uid), ab = d && (d.abilities || []).find((a) => a.name === e.name); this.readout('ability', e.name, (ab && ab.effect) || (D(e.id || (d && d.id) || '') || {}).effect, '', e.pid ? ui.center(e.pid) : null); }
      else if (e.type === 'trainer') { const d = D(e.id); this.readout('trainer', d.name, d.effect, e.kind || 'Trainer', null); }
      else if (e.type === 'status') { this.readout('cond', e.cond.toUpperCase(), COND_TEXT[e.cond], '', ui.center(e.pid)); }
      else if (e.type === 'evolve') { const c = ui.center(e.pid); if (c) { this.cut('evolve', c.x, c.y); this.impact(0.9, c); } }
      else if (e.type === 'vstar') { this.cut('vstar', innerWidth / 2, innerHeight / 2); this.impact(1.4); }
      else if (e.type === 'damage' && e.amount > 0) { const c = ui.center(e.pid); this.impact(clamp(e.amount / 80, 0.3, 1.5), c); }
      else if (e.type === 'win') { this.cut('win', innerWidth / 2, innerHeight / 2); }
    }
  }

  // ---------------------------------------------------------------- text
  popText(x, y, text, cls = '') {
    document.documentElement.classList.toggle('reduce-motion', reduced());
    const d = document.createElement('div'); d.className = 'pop3 ' + cls; d.style.left = x + 'px'; d.style.top = y + 'px'; const m = /^-(\d+)$/.exec(text);
    const dur = 1400 * spd(); document.body.append(d);
    if (m && !reduced()) { const n = +m[1], t0 = performance.now(), roll = 380 * spd(); d.innerHTML = `<span class="num"></span>`; const el = d.firstChild;
      const tick = () => { const k = clamp((performance.now() - t0) / roll, 0, 1); el.textContent = '-' + Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); else d.classList.add('land'); }; tick(); }
    else d.innerHTML = reduced() ? esc(text) : letters(text, cls === 'small' ? 22 : 34);
    d.style.setProperty('--dur', dur + 'ms'); setTimeout(() => d.remove(), dur + 300);
  }
  banner(text, color = '#8a5cff') {
    document.documentElement.classList.toggle('reduce-motion', reduced());
    const b = $('#banner'); clearTimeout(this.bnT); b.innerHTML = `<div class="bn3" style="--bc:${color}"><span class="bar"></span><b>${reduced() ? esc(text) : letters(text, 38)}</b></div>`; this.bnT = setTimeout(() => (b.innerHTML = ''), 1900 * spd());
  }
  readout(kind, name, body, tag, at) {
    document.documentElement.classList.toggle('reduce-motion', reduced());
    if (fxOff() && kind !== 'trainer') return; let host = $('#t3layer'); if (!host) { host = document.createElement('div'); host.id = 't3layer'; document.body.append(host); }
    const old = host.querySelector('.rd'); if (old) old.remove(); const words = String(body || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 38); if (body && String(body).split(' ').length > 38) words.push('…');
    const per = kind === 'trainer' ? 0 : 1; const label = { attack: 'ATTACK', ability: 'ABILITY', trainer: String(tag || 'TRAINER').toUpperCase(), cond: 'SPECIAL CONDITION' }[kind];
    const txt = kind === 'trainer' ? [...words.join(' ')].map((ch, i) => `<i class="c" style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('') : words.map((w, i) => `<i class="w" style="--i:${i}">${esc(w)}</i>`).join(' ');
    const div = document.createElement('div'); div.className = 'rd k-' + kind + (reduced() ? ' still' : ''); div.innerHTML = `<div class="rk">${label}</div><div class="rn">${reduced() ? esc(name) : letters(name, 32)}${kind === 'attack' && tag ? `<b class="rdm">${esc(tag)}</b>` : ''}</div>${words.length ? `<div class="rt">${txt}</div>` : ''}`;
    const total = (words.length ? (kind === 'trainer' ? words.join(' ').length * 14 : words.length * 55) : 0) + 1300; div.style.setProperty('--tot', total * spd() + 'ms'); host.append(div); void per;
    setTimeout(() => div.classList.add('out'), total * spd()); setTimeout(() => div.remove(), total * spd() + 500);
  }
}
