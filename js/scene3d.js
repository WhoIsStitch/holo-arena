// Holo Arena 3D prototype: one card, a table, lights, foil shader, bloom + vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CW = 2.1, CH = CW * 88 / 63, CT = 0.03;

const FOIL_VS = `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FOIL_FS = `
uniform sampler2D map; uniform float foil; uniform vec2 tilt;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  vec4 c = texture2D(map, vUv);
  float ang = dot(normalize(vN), normalize(vV));
  float band = vUv.x * 0.8 + vUv.y * 0.6 + tilt.x * 0.9 + tilt.y * 0.6;
  vec3 rainbow = hue(fract(band * 1.3));
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float mask = foil * (0.25 + 0.75 * smoothstep(0.35, 0.9, lum)) * (1.0 - ang * 0.5);
  vec3 col = mix(c.rgb, c.rgb * 0.75 + rainbow * 0.45, mask * 0.4);
  col += rainbow * pow(max(0.0, 1.0 - abs(fract(band * 2.0) - 0.5) * 6.0), 2.0) * foil * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, amt: { value: 0.55 }, ca: { value: 0.0015 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amt; uniform float ca; varying vec2 vUv;
  void main(){
    vec2 d = vUv - 0.5; float r = dot(d, d);
    vec2 o = d * ca * (1.0 + r * 4.0);
    vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
    c *= 1.0 - smoothstep(0.15, 0.75, r) * amt;
    gl_FragColor = vec4(c, 1.0);
  }`,
};

const TIERS = { low: { bloom: 0, scale: 1, pr: 1 }, medium: { bloom: 0.35, scale: 1, pr: 1.5 }, high: { bloom: 0.6, scale: 1, pr: 2 } };

export function start(canvas, { cardImg, backImg, foil = 1, tier = 'high', onFps } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1026);
  scene.fog = new THREE.Fog(0x0b1026, 9, 20);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  cam.position.set(0, 3.2, 8.6); cam.lookAt(0, 1.3, 0);

  scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x1a1030, 0.7));
  const key = new THREE.SpotLight(0xfff2dd, 90, 20, 0.6, 0.6, 1.4);
  key.position.set(2.5, 7, 4); key.target.position.set(0, 0.5, 0); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); scene.add(key, key.target);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const rim = new THREE.PointLight(0x6a7cff, 25, 14); rim.position.set(-4, 2, -2); scene.add(rim);

  const table = new THREE.Mesh(
    new THREE.CircleGeometry(12, 64),
    new THREE.MeshStandardMaterial({ color: 0x1b2a55, roughness: 0.55, metalness: 0.1 }),
  );
  table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);

  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const tex = (u) => { const t = loader.load(u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const uni = { map: { value: tex(cardImg) }, foil: { value: foil }, tilt: { value: new THREE.Vector2() } };
  const front = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: FOIL_VS, fragmentShader: FOIL_FS });
  const back = new THREE.MeshStandardMaterial({ map: tex(backImg), roughness: 0.4 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
  const card = new THREE.Mesh(new THREE.BoxGeometry(CW, CH, CT), [edge, edge, edge, edge, front, back]);
  card.castShadow = true; card.rotation.x = -0.35; card.position.y = 1.7;
  const pivot = new THREE.Group(); pivot.add(card); scene.add(pivot);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.95); composer.addPass(bloom);
  const vig = new ShaderPass(VIGNETTE); composer.addPass(vig);
  composer.addPass(new OutputPass());

  const st = { tier, mx: 0, my: 0, hit: 0 };
  const setTier = (t) => { st.tier = t; const c = TIERS[t]; bloom.enabled = c.bloom > 0; bloom.strength = c.bloom; renderer.setPixelRatio(Math.min(devicePixelRatio, c.pr)); resize(); };
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  const move = (e) => { const r = canvas.getBoundingClientRect(); st.mx = ((e.clientX - r.left) / r.width) * 2 - 1; st.my = ((e.clientY - r.top) / r.height) * 2 - 1; };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', (e) => { move(e); st.hit = 1; });

  const clock = new THREE.Clock(); let frames = 0, acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    pivot.rotation.y += ((st.mx * 0.6) - pivot.rotation.y) * Math.min(1, dt * 6);
    pivot.rotation.x += ((st.my * 0.4) - pivot.rotation.x) * Math.min(1, dt * 6);
    card.position.y = 1.7 + Math.sin(t * 1.4) * 0.08;
    uni.tilt.value.set(pivot.rotation.y, pivot.rotation.x);
    st.hit = Math.max(0, st.hit - dt * 3);
    vig.uniforms.ca.value = 0.0015 + st.hit * 0.012;
    composer.render();
    frames++; acc += dt; if (acc >= 1) { onFps?.(Math.round(frames / acc)); frames = 0; acc = 0; }
  });
  setTier(tier);
  return { setTier, renderer, scene, cam };
}
