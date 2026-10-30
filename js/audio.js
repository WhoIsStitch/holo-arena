// All sound is synthesized with WebAudio — no audio files to download.
let ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
let musicOn = true, vol = 0.9; try { musicOn = localStorage.getItem('holo.music') !== '0'; const v0 = parseFloat(localStorage.getItem('holo.vol')); if (!isNaN(v0)) vol = v0; } catch (e) { /* ignore */ }
let sfxOn = true; try { sfxOn = localStorage.getItem('holo.sfx') !== '0'; } catch (e) { /* ignore */ }
let muted = false; try { muted = localStorage.getItem('holo.muted') === '1'; } catch (e) {}
let mood = null, timer = null, nextBar = 0, barIdx = 0;

function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : vol; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(comp);
  musBus = ctx.createGain(); musBus.gain.value = musicOn ? 0.2 : 0; musBus.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (mood) startMusic(mood);
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function tone(f, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, bus = sfxBus, attack = 0.005, lp = 0 } = {}) {
  if (!ctx) return; const t = ctx.currentTime + delay; const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = o; if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); out = fl; }
  out.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { vol = 0.3, f = 2000, f2 = 0, type = 'bandpass', q = 1, delay = 0, bus = sfxBus } = {}) {
  if (!ctx) return; const t = ctx.currentTime + delay; const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(bus || sfxBus); s.start(t); s.stop(t + dur + 0.05);
}

const SFX = {
  click: () => tone(900, 0.05, { type: 'square', vol: 0.08 }),
  draw: () => { noise(0.18, { f: 1200, f2: 4200, vol: 0.14, q: 2 }); tone(500, 0.08, { type: 'triangle', vol: 0.06, slide: 300 }); },
  place: () => { tone(140, 0.14, { type: 'sine', vol: 0.4, slide: -70 }); noise(0.06, { f: 1800, vol: 0.12 }); },
  attach: () => { [880, 1320, 1760].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.12, delay: i * 0.05 })); noise(0.2, { f: 5000, f2: 9000, type: 'highpass', vol: 0.05 }); },
  hit: () => { tone(110, 0.35, { type: 'sawtooth', vol: 0.35, slide: -80, lp: 700 }); noise(0.25, { f: 900, f2: 200, type: 'lowpass', vol: 0.5 }); },
  crit: () => { SFX.hit(); tone(1400, 0.4, { type: 'square', vol: 0.12, slide: -800 }); noise(0.4, { f: 3000, f2: 8000, type: 'highpass', vol: 0.18 }); },
  zap: () => { tone(1800, 0.3, { type: 'sawtooth', vol: 0.14, slide: -1500 }); noise(0.25, { f: 4000, f2: 600, vol: 0.2 }); },
  ko: () => { tone(300, 0.9, { type: 'sawtooth', vol: 0.25, slide: -260, lp: 900 }); noise(0.9, { f: 1500, f2: 100, type: 'lowpass', vol: 0.5 }); tone(60, 0.8, { type: 'sine', vol: 0.5, slide: -30 }); },
  lost: () => { noise(0.9, { f: 300, f2: 3200, q: 6, vol: 0.28 }); tone(220, 0.9, { type: 'sine', vol: 0.18, slide: 700 }); tone(1100, 0.7, { type: 'triangle', vol: 0.08, slide: -900, delay: 0.2 }); },
  coin: () => { [1568, 2093].forEach((f, i) => tone(f, 0.7, { type: 'sine', vol: 0.18, delay: i * 0.09 })); },
  turn: () => { [523, 659, 784].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.16, delay: i * 0.08 })); },
  evolve: () => { for (let i = 0; i < 8; i++) tone(400 * Math.pow(1.12, i * 2), 0.3, { type: 'triangle', vol: 0.1, delay: i * 0.06 }); noise(0.7, { f: 800, f2: 7000, vol: 0.14, q: 3 }); },
  vstar: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 1.0, { type: 'sawtooth', vol: 0.09, delay: i * 0.07, lp: 2400 })); tone(65, 1.4, { type: 'sine', vol: 0.5 }); noise(1.2, { f: 400, f2: 9000, vol: 0.2, q: 2 }); },
  heal: () => [660, 880, 1175].forEach((f, i) => tone(f, 0.3, { vol: 0.12, delay: i * 0.07 })),
  status: () => { tone(300, 0.4, { type: 'square', vol: 0.12, slide: -150 }); tone(210, 0.4, { type: 'square', vol: 0.12, slide: 100, delay: 0.1 }); },
  search: () => { noise(0.35, { f: 600, f2: 2400, vol: 0.12, q: 4 }); },
  shuffle: () => { for (let i = 0; i < 6; i++) noise(0.05, { f: 2500, vol: 0.1, delay: i * 0.05 }); },
  prize: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.14, delay: i * 0.07 })); },
  trainer: () => { noise(0.3, { f: 800, f2: 3500, vol: 0.16, q: 2 }); tone(660, 0.2, { type: 'triangle', vol: 0.1, slide: 400 }); },
  ability: () => { tone(880, 0.5, { type: 'sine', vol: 0.16 }); tone(1320, 0.5, { type: 'sine', vol: 0.1, delay: 0.06 }); },
  win: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => { tone(f, 0.5, { type: 'sawtooth', vol: 0.13, delay: i * 0.14, lp: 3000 }); tone(f / 2, 0.5, { type: 'triangle', vol: 0.14, delay: i * 0.14 }); }); },
  lose: () => { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.7, { type: 'triangle', vol: 0.16, delay: i * 0.25 })); },
};

// ------------------------------------------------------------ generative music
const MOODS = {
  menu:   { bpm: 84,  prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [45, 41, 36, 43], arp: true, drums: false },
  battle: { bpm: 112, prog: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], bass: [38, 34, 41, 36], arp: true, drums: true },
};
function bar(m, t, i) {
  const c = m.prog[i % 4], beat = 60 / m.bpm, len = beat * 4;
  c.forEach((n, k) => { [-0.006, 0.006].forEach((dt) => { const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = hz(n) * (1 + dt); fl.type = 'lowpass'; fl.frequency.setValueAtTime(500, t); fl.frequency.linearRampToValueAtTime(1500, t + len / 2); fl.frequency.linearRampToValueAtTime(500, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.5); g.gain.linearRampToValueAtTime(0.0001, t + len); o.connect(fl); fl.connect(g); g.connect(musBus); o.start(t); o.stop(t + len + 0.1); }); });
  const b = ctx.createOscillator(), bg = ctx.createGain(); b.type = 'sine'; b.frequency.value = hz(m.bass[i % 4]); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.16, t + 0.05); bg.gain.exponentialRampToValueAtTime(0.0001, t + len); b.connect(bg); bg.connect(musBus); b.start(t); b.stop(t + len);
  if (m.arp) for (let s = 0; s < 8; s++) { const n = c[[0, 1, 2, 1, 0, 2, 1, 2][s]] + 12 + (s % 4 === 3 ? 12 : 0); tone(hz(n), beat * 0.45, { type: 'triangle', vol: 0.055, delay: t - ctx.currentTime + s * beat / 2, bus: musBus }); }
  if (m.drums) for (let s = 0; s < 8; s++) { noise(0.04, { f: 7000, type: 'highpass', vol: s % 2 ? 0.05 : 0.025, delay: t - ctx.currentTime + s * beat / 2, bus: musBus }); if (s % 4 === 0) tone(110, 0.18, { type: 'sine', vol: 0.28, slide: -70, delay: t - ctx.currentTime + s * beat / 2, bus: musBus }); }
}
function schedule() { if (!ctx || !mood) return; const m = MOODS[mood]; const len = (60 / m.bpm) * 4; while (nextBar < ctx.currentTime + 1.2) { bar(m, Math.max(nextBar, ctx.currentTime + 0.05), barIdx++); nextBar += len; } }
function startMusic(name) { mood = name; if (!ctx) return; clearInterval(timer); nextBar = ctx.currentTime + 0.1; barIdx = 0; timer = setInterval(schedule, 250); schedule(); }

export const audio = {
  init, get sfxOn() { return sfxOn; }, setSfx(v) { sfxOn = v; try { localStorage.setItem('holo.sfx', v ? '1' : '0'); } catch (e) { /* ignore */ } },
  sfx(name) { if (!sfxOn) return; init(); try { (SFX[name] || (() => {}))(); } catch (e) { /* ignore */ } },
  music(name) { if (mood === name) return; mood = name; if (ctx) startMusic(name); },
  get muted() { return muted; },
  setMuted(v) { muted = v; try { localStorage.setItem('holo.muted', v ? '1' : '0'); } catch (e) {} if (master) master.gain.value = v ? 0 : vol; },
  get music() { return musicOn; }, setMusic(v) { musicOn = v; try { localStorage.setItem('holo.music', v ? '1' : '0'); } catch (e) { /* ignore */ } if (musBus) musBus.gain.value = v ? 0.2 : 0; },
  get volume() { return vol; }, setVolume(x) { vol = x; try { localStorage.setItem('holo.vol', String(x)); } catch (e) { /* ignore */ } if (master && !muted) master.gain.value = vol; },
};
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, init, { once: false, passive: true }));
