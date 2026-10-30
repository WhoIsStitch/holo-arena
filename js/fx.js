// Canvas particle effects: bursts, projectiles, vortex, confetti, rings.
export const TYPE_COLOR = { Grass: '#4cc44b', Fire: '#ff6a2c', Water: '#3ea0ff', Lightning: '#ffe02a', Psychic: '#d05cf0', Fighting: '#c9742f', Darkness: '#7a5cff', Metal: '#b8c4d8', Dragon: '#e8c040', Colorless: '#ffffff', Fairy: '#ff8fc4' };

export class FX {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.p = []; this.rings = []; this.orbs = []; this.running = false; this.resize(); window.addEventListener('resize', () => this.resize()); }
  resize() { const r = devicePixelRatio || 1; this.c.width = innerWidth * r; this.c.height = innerHeight * r; this.r = r; }
  add(o) { this.p.push(o); if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame((t) => this.loop(t)); } }
  burst(x, y, color = '#fff', { n = 40, speed = 380, life = 0.8, size = 4, grav = 300, spread = Math.PI * 2, dir = 0, drag = 0.96 } = {}) {
    for (let i = 0; i < n; i++) { const a = dir + (Math.random() - 0.5) * spread, s = speed * (0.25 + Math.random() * 0.9);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life * (0.6 + Math.random() * 0.6), size: size * (0.5 + Math.random()), color, grav, drag }); }
  }
  ring(x, y, color = '#fff', { r = 180, life = 0.7, w = 6 } = {}) { this.rings.push({ x, y, color, r, life, max: life, w }); this.kick(); }
  kick() { if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame((t) => this.loop(t)); } }
  /** glowing orb flying from A to B with a particle trail, then onHit() */
  shot(x1, y1, x2, y2, color = '#fff', { dur = 0.45, size = 14, onHit } = {}) { this.orbs.push({ x1, y1, x2, y2, color, dur, t: 0, size, onHit }); this.kick(); }
  vortex(x1, y1, x2, y2, color = '#b46cff') {
    for (let i = 0; i < 26; i++) this.add({ x: x1 + (Math.random() - 0.5) * 70, y: y1 + (Math.random() - 0.5) * 90, tx: x2, ty: y2, life: 0.9 + Math.random() * 0.4, max: 1.2, size: 3 + Math.random() * 4, color, swirl: Math.random() * 6.28, delay: Math.random() * 0.3, type: 'vortex', x0: x1, y0: y1 });
  }
  confetti(n = 220) { const cols = ['#ff5c7a', '#ffd166', '#52e08a', '#3ea0ff', '#c455e6', '#ff9a3d']; for (let i = 0; i < n; i++) this.add({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5, vx: (Math.random() - 0.5) * 160, vy: 120 + Math.random() * 260, life: 5, max: 5, size: 5 + Math.random() * 6, color: cols[i % cols.length], grav: 120, drag: 0.995, type: 'conf', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 }); }
  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; const g = this.g, r = this.r;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height); g.scale(r, r);
    g.globalCompositeOperation = 'lighter';
    // orbs
    this.orbs = this.orbs.filter((o) => {
      o.t += dt; const k = Math.min(1, o.t / o.dur), e = k * k * (3 - 2 * k); const x = o.x1 + (o.x2 - o.x1) * e, y = o.y1 + (o.y2 - o.y1) * e - Math.sin(k * Math.PI) * 60;
      for (let i = 0; i < 3; i++) this.p.push({ x, y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, life: 0.45, max: 0.45, size: o.size * 0.45 * Math.random() + 2, color: o.color, grav: 0, drag: 0.92 });
      const gr = g.createRadialGradient(x, y, 0, x, y, o.size * 2.6); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, o.color); gr.addColorStop(1, 'transparent'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, o.size * 2.6, 0, 6.3); g.fill();
      if (k >= 1) { o.onHit && o.onHit(); return false; } return true;
    });
    this.rings = this.rings.filter((q) => { q.life -= dt; if (q.life <= 0) return false; const k = 1 - q.life / q.max; g.globalAlpha = 1 - k; g.strokeStyle = q.color; g.lineWidth = q.w * (1 - k) + 1; g.beginPath(); g.arc(q.x, q.y, q.r * (0.2 + k * 0.8), 0, 6.3); g.stroke(); g.globalAlpha = 1; return true; });
    this.p = this.p.filter((p) => {
      if (p.delay > 0) { p.delay -= dt; return true; }
      p.life -= dt; if (p.life <= 0) return false; const k = p.life / p.max;
      if (p.type === 'vortex') { const prog = 1 - k, ang = p.swirl + prog * 9, rad = (1 - prog) * 110; p.x = p.tx + Math.cos(ang) * rad * (1 - prog * 0.3) + (p.x0 - p.tx) * (1 - prog) * 0.2; p.y = p.ty + Math.sin(ang) * rad * 0.6; g.globalAlpha = Math.min(1, k * 3) * 0.9; g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size * (0.4 + k), 0, 6.3); g.fill(); g.globalAlpha = 1; return true; }
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'conf') { g.globalCompositeOperation = 'source-over'; p.rot += p.vr * dt; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.restore(); g.globalCompositeOperation = 'lighter'; return p.y < innerHeight + 30; }
      g.globalAlpha = Math.min(1, k * 1.6); g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size * (0.3 + k * 0.7), 0, 6.3); g.fill(); g.globalAlpha = 1; return true;
    });
    g.globalCompositeOperation = 'source-over';
    if (this.p.length || this.rings.length || this.orbs.length) requestAnimationFrame((t) => this.loop(t)); else { this.running = false; g.clearRect(0, 0, innerWidth, innerHeight); }
  }
}

/** ambient animated background for menu: drifting holo cards + stars */
export function startBackdrop(canvas, imgUrls) {
  const g = canvas.getContext('2d'); let W, H; const imgs = []; const items = [];
  const size = () => { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }; size(); addEventListener('resize', size);
  imgUrls.forEach((u) => { const i = new Image(); i.src = u; imgs.push(i); });
  for (let i = 0; i < 12; i++) items.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 0.6, vy: 0.012 + Math.random() * 0.02, r: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.12, img: i % imgs.length, a: 0.14 + Math.random() * 0.14 });
  const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
  let t0 = performance.now();
  (function frame(now) {
    const dt = (now - t0) / 1000; t0 = now; g.clearRect(0, 0, W, H);
    stars.forEach((s) => { s.y -= 0.004 * (0.3 + s.z) * dt * 6; if (s.y < 0) s.y = 1; g.globalAlpha = 0.3 + 0.5 * s.z * Math.abs(Math.sin(now / 900 + s.x * 20)); g.fillStyle = '#cfd4ff'; g.fillRect(s.x * W, s.y * H, 1 + s.z * 1.6, 1 + s.z * 1.6); });
    items.forEach((c) => { c.y -= c.vy * dt; c.r += c.vr * dt; if (c.y < -0.3) { c.y = 1.3; c.x = Math.random(); } const im = imgs[c.img]; if (!im.complete || !im.naturalWidth) return; const h = H * 0.34 * c.s, w = h * 0.716;
      g.save(); g.globalAlpha = c.a; g.translate(c.x * W, c.y * H); g.rotate(c.r); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore(); });
    g.globalAlpha = 1; requestAnimationFrame(frame);
  })(t0);
}
