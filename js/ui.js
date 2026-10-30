// Board UI: lays every card out on a tilted 3D table, animates changes, handles input.
import { D } from './engine.js';
import { audio } from './audio.js';
import { FX, TYPE_COLOR } from './fx.js';

const $ = (s, r = document) => r.querySelector(s);
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CW = 132, CH = 185;
const grid2 = (xs, ys) => Array.from({ length: 6 }, (_, k) => [xs[k % 2], ys[Math.floor(k / 2)]]);
const gridP = (cy) => Array.from({ length: 6 }, (_, k) => [620 + (k % 3) * 90, cy - 48 + Math.floor(k / 3) * 96]);
function makeLayout(mode) {
  if (mode === 'land') return { mode, W: 1600, H: 1040, bx: (i) => 800 + (i - 2) * 168, stadium: [360, 490], handMid: 800, handW: 980, tilt: 20, pos: {
    me: { active: [800, 640], benchY: 850, deck: [1480, 860], discard: [1480, 690], lost: [1300, 775], prizes: grid2([105, 185], [640, 750, 860]), prizeBox: [145, 750, 170, 350], handY: 962 },
    op: { active: [800, 330], benchY: 128, deck: [120, 180], discard: [120, 350], lost: [300, 265], prizes: grid2([1495, 1415], [400, 290, 180]), prizeBox: [1455, 290, 170, 350], handY: -30 } } };
  return { mode, W: 900, H: 1600, bx: (i) => 450 + (i - 2) * 168, stadium: [450, 720], handMid: 450, handW: 830, tilt: 9, pos: {
    me: { active: [450, 1085], benchY: 1300, deck: [95, 885], discard: [245, 885], lost: [405, 885], prizes: gridP(885), prizeBox: [710, 885, 290, 230], handY: 1500 },
    op: { active: [450, 350], benchY: 138, deck: [95, 555], discard: [245, 555], lost: [405, 555], prizes: gridP(555), prizeBox: [710, 555, 290, 230], handY: -28 } } };
}
const STATUS_ICON = { poisoned: '☠️', burned: '🔥', asleep: '💤', paralyzed: '⚡', confused: '💫' };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const orbHTML = (t) => `<span class="orb t-${t}"></span>`;
const costHTML = (cost) => (cost || []).map(orbHTML).join('');

export class BoardUI {
  constructor() {
    this.table = $('#table'); this.cards = new Map(); this.view = null; this.req = null; this.resolve = null; this.queue = Promise.resolve();
    this.fx = new FX($('#fx')); this.target = null; this.drag = null; this.pkUid = new Map(); this.legalIdx = null; this.onLeave = null;
    this.touch = matchMedia('(hover: none)').matches; this.mode = null; this.static = []; this.fit(); addEventListener('resize', () => this.fit());
    this.bind();
  }
  fit() {
    const mode = innerHeight > innerWidth * 1.05 ? 'port' : 'land';
    if (mode !== this.mode) { this.mode = mode; this.L = makeLayout(mode); const tw = $('#tablewrap'); tw.style.width = this.L.W + 'px'; tw.style.height = this.L.H + 'px'; this.buildTable(); if (this.view) this.apply(this.view); }
    const L = this.L, s = Math.min(innerWidth / (L.W + 30), innerHeight / (L.H * 1.07));
    $('#tablewrap').style.setProperty('--s', s.toFixed(3)); $('#table').style.setProperty('--tilt', L.tilt + 'deg');
  }

  // ------------------------------------------------------------------ static table
  buildTable() {
    const t = this.table; this.static.forEach((x) => x.remove()); this.static = []; const L = this.L;
    const add = (e) => { t.prepend(e); this.static.push(e); return e; };
    add(mk('div', 'ring')); this.zones = {};
    const zone = (key, cx, cy, w, h, label, cls = '') => { const z = add(mk('div', 'zone ' + cls, `<span>${label}</span><span class="cnt"></span>`)); z.style.cssText = `left:${cx - w / 2}px;top:${cy - h / 2}px;width:${w}px;height:${h}px`; this.zones[key] = z; return z; };
    for (const side of ['me', 'op']) {
      const P = L.pos[side];
      zone(side + 'Active', P.active[0], P.active[1], CW + 28, CH + 28, 'Active', 'active');
      for (let i = 0; i < 5; i++) zone(side + 'Bench' + i, L.bx(i), P.benchY, CW + 14, CH + 14, i === 0 ? 'Bench' : '');
      zone(side + 'Deck', P.deck[0], P.deck[1], CW + 12, CH + 12, 'Deck');
      for (let i = 0; i < 4; i++) { const pi = add(mk('div', 'pile')); pi.style.cssText = `left:${P.deck[0] - CW / 2 - i * 1.5}px;top:${P.deck[1] - CH / 2 - i * 1.8}px;transform:translateZ(${i}px)`; pi.append(mk('i')); }
      zone(side + 'Discard', P.discard[0], P.discard[1], CW + 12, CH + 12, 'Discard').classList.add('mine');
      zone(side + 'Lost', P.lost[0], P.lost[1], CW + 12, CH + 12, 'Lost Zone', 'lost').classList.add('mine');
      zone(side + 'Prize', P.prizeBox[0], P.prizeBox[1], P.prizeBox[2], P.prizeBox[3], 'Prizes');
      this.zones[side + 'Discard'].onclick = () => this.viewPile(side === 'me' ? this.view.me : 1 - this.view.me, 'discard');
      this.zones[side + 'Lost'].onclick = () => this.viewPile(side === 'me' ? this.view.me : 1 - this.view.me, 'lost');
    }
    zone('stadium', L.stadium[0], L.stadium[1], CW + 20, CH * 0.78 + 20, 'Stadium');
  }
  sideOf(i) { return i === this.view.me ? 'me' : 'op'; }

  // ------------------------------------------------------------------ layout
  layout(v) {
    const out = []; const me = v.me;
    for (const i of [0, 1]) {
      const side = i === me ? 'me' : 'op', P = this.L.pos[side], pl = v.pl[i];
      const n = pl.hand.length, step = Math.min(side === 'me' ? 112 : 46, this.L.handW / Math.max(n, 1)), hm = this.L.handMid;
      pl.hand.forEach((c, k) => { const off = k - (n - 1) / 2;
        out.push({ uid: c.uid, id: c.id || null, x: hm + off * step, y: P.handY + (side === 'me' ? off * off * 1.1 : off * off * -0.8), s: side === 'me' ? 1.05 : 0.6, rot: side === 'me' ? off * 2.2 : -off * 3, z: 30 + k * 0.6, down: !c.id, zone: 'hand', side, owner: i }); });
      const pkSpec = (pk, x, y, s, z, zone) => out.push({ uid: pk.uid, id: pk.id, x, y, s, rot: 0, z, down: false, zone, side, pk, owner: i });
      if (pl.active) pkSpec(pl.active, ...P.active, 1.08, 14, 'active');
      pl.bench.forEach((pk, k) => pkSpec(pk, this.L.bx(k), P.benchY, 0.94, 12, 'bench'));
      const d = pl.discard; if (d.length) { const c = d[d.length - 1]; out.push({ uid: c.uid, id: c.id, x: P.discard[0], y: P.discard[1], s: 0.95, rot: (c.uid % 7) - 3, z: 4, down: false, zone: 'discard', side, owner: i }); }
      pl.prizes.forEach((u, k) => out.push({ uid: u, id: null, x: P.prizes[k][0], y: P.prizes[k][1], s: 0.55, rot: 0, z: 2, down: true, zone: 'prize', side, owner: i }));
    }
    if (v.stadium) out.push({ uid: v.stadium.uid, id: v.stadium.id, x: this.L.stadium[0], y: this.L.stadium[1], s: 0.78, rot: 0, z: 6, down: false, zone: 'stadium', side: 'me', owner: v.stadium.owner });
    return out;
  }
  originOf(sp) {
    const P = this.L.pos[sp.side]; if (['hand', 'prize', 'bench', 'active'].includes(sp.zone)) return { x: P.deck[0], y: P.deck[1], s: 0.9, rot: 0, down: true };
    return { x: this.L.handMid, y: P.handY, s: 0.8, rot: 0, down: false };
  }
  spawn(sp) {
    const e = mk('div', 'card snap', `<div class="inner"><div class="face front"><img draggable="false" alt=""><div class="holo"></div><div class="spark"></div><div class="glare"></div></div><div class="face back"></div></div><div class="ov"></div>`);
    e.dataset.uid = sp.uid; const c = { el: e, img: $('img', e), ov: $('.ov', e), sig: '', id: null, spec: sp };
    this.table.append(e); this.cards.set(sp.uid, c);
    const o = this.originOf(sp); this.setT(e, { ...sp, ...o, z: 400 }); if (o.down) e.classList.add('down');
    void e.offsetWidth; requestAnimationFrame(() => e.classList.remove('snap'));
    this.wire(c); return c;
  }
  setT(e, sp) { e.style.transform = `translate3d(${sp.x - CW / 2}px, ${sp.y - CH / 2}px, ${sp.z || 0}px) rotate(${sp.rot || 0}deg) scale(${sp.s})`; }
  place(c, sp) {
    const e = c.el; c.spec = sp; if (sp.id && c.id !== sp.id) { c.id = sp.id; c.img.src = D(sp.id).img; const d = D(sp.id); e.classList.toggle('foil', !!(d.suffix || /Holo|Rare|ACE|Radiant|Double|Ultra/.test(d.rarity || '') && d.cat === 'Pokemon')); }
    e.classList.toggle('down', !!sp.down); e.classList.toggle('hand', sp.zone === 'hand'); e.classList.toggle('mine', sp.side === 'me'); e.classList.toggle('pk', !!sp.pk);
    e.classList.toggle('idle', !!sp.pk && !!sp.id); e.style.zIndex = sp.z; this.setT(e, sp); e.dataset.pid = sp.pk ? sp.pk.pid : ''; e.dataset.zone = sp.zone;
    // overlay (hp, energy, tool, status)
    const pk = sp.pk; let sig = ''; if (pk) sig = JSON.stringify([pk.dmg, pk.hp, pk.energy.map((x) => x.id), pk.tool && pk.tool.id, pk.cond]);
    if (sig !== c.sig) { c.sig = sig;
      if (!pk) c.ov.innerHTML = ''; else {
        const rem = pk.hp - pk.dmg, pct = Math.max(0, rem / pk.hp * 100); const cls = pct < 30 ? 'low' : pct < 60 ? 'mid' : '';
        const orbs = pk.energy.map((x) => { const d = D(x.id); return orbHTML(d.energyType === 'Special' ? 'Colorless' : d.name.replace(' Energy', '')); }).join('');
        c.ov.innerHTML = `<div class="hp ${cls}"><i style="width:${pct}%"></i><b>${Math.max(0, rem)}/${pk.hp}</b></div><div class="orbs">${orbs}</div>` + (pk.tool ? `<img class="tool" src="${D(pk.tool.id).img}">` : '') + (pk.cond.length ? `<div class="status">${pk.cond.map((k) => STATUS_ICON[k]).join('')}</div>` : '') + (pk.dmg > 0 ? `<div class="dmgbadge">-${pk.dmg}</div>` : ''); } }
  }
  removeCard(uid, c, v) {
    this.cards.delete(uid); const e = c.el; if (e.classList.contains('dissolve')) { setTimeout(() => e.remove(), 950); return; }
    const owner = c.spec.owner, side = this.sideOf(owner), P = this.L.pos[side];
    const lost = v.pl[owner].lost.some((x) => x.uid === uid), disc = v.pl[owner].discard.some((x) => x.uid === uid);
    let dest = P.deck, s = 0.5, delay = 650;
    if (lost) { dest = P.lost; s = 0.1; e.style.transition = 'transform .8s cubic-bezier(.6,0,.6,1), opacity .8s .1s'; e.classList.add('snap-keep'); }
    else if (disc) { dest = P.discard; s = 0.95; }
    else { for (const i of [0, 1]) for (const pk of [v.pl[i].active, ...v.pl[i].bench]) if (pk && (pk.energy.some((x) => x.uid === uid) || (pk.tool && pk.tool.uid === uid))) { const t = this.pkUidPos(pk); if (t) { dest = t; s = 0.3; } } }
    e.style.zIndex = 900; e.style.transform = `translate3d(${dest[0] - CW / 2}px, ${dest[1] - CH / 2}px, 0) rotate(${lost ? 540 : 0}deg) scale(${s})`; e.style.opacity = lost ? '0' : '0.0';
    if (disc) e.style.opacity = '0'; setTimeout(() => e.remove(), delay + 200);
  }
  pkUidPos(pk) { for (const sp of this.lastLayout || []) if (sp.pk && sp.pk.pid === pk.pid) return [sp.x, sp.y]; return null; }

  apply(v) {
    this.view = v; const L = this.layout(v); this.lastLayout = L; const seen = new Set(); this.pkUid.clear();
    for (const sp of L) { seen.add(sp.uid); let c = this.cards.get(sp.uid); if (!c) c = this.spawn(sp); this.place(c, sp); if (sp.pk) this.pkUid.set(sp.pk.pid, sp.uid); }
    for (const [uid, c] of [...this.cards]) if (!seen.has(uid)) this.removeCard(uid, c, v);
    // zones
    for (const i of [0, 1]) { const side = this.sideOf(i), pl = v.pl[i];
      this.zones[side + 'Deck'].querySelector('.cnt').textContent = pl.deckN; this.zones[side + 'Discard'].querySelector('.cnt').textContent = pl.discard.length || '';
      this.zones[side + 'Lost'].querySelector('.cnt').textContent = pl.lost.length || ''; this.zones[side + 'Prize'].querySelector('.cnt').textContent = pl.prizeN;
      this.zones[side + 'Active'].classList.toggle('on', v.cur === i); }
    $('#whoMe').innerHTML = this.who(v, v.me); $('#whoOpp').innerHTML = this.who(v, 1 - v.me);
    $('#whoMe').classList.toggle('turn', v.cur === v.me && !v.winner); $('#whoOpp').classList.toggle('turn', v.cur !== v.me && !v.winner);
    const tp = $('#turnPill'); const mine = v.cur === v.me; tp.textContent = v.turnNo ? (mine ? 'Your turn' : "Opponent's turn") : 'Setting up'; tp.className = v.turnNo ? (mine ? 'me' : 'opp') : '';
    this.refreshInteractive();
  }
  who(v, i) { const p = v.pl[i]; return `<span class="dot"></span>${esc(p.name)} <small>Prizes ${p.prizeN} · Hand ${p.handN} · Deck ${p.deckN} · Lost ${p.lost.length}</small>`; }

  // ------------------------------------------------------------------ pointer & tilt
  wire(c) {
    const e = c.el;
    e.addEventListener('pointermove', (ev) => { if (this.drag) return; const r = e.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * 100, py = (ev.clientY - r.top) / r.height * 100; e.style.setProperty('--mx', px.toFixed(1)); e.style.setProperty('--my', py.toFixed(1)); e.style.setProperty('--rx', ((50 - py) * 0.3).toFixed(1) + 'deg'); e.style.setProperty('--ry', ((px - 50) * 0.3).toFixed(1) + 'deg'); e.classList.add('live'); e.classList.remove('idle'); });
    e.addEventListener('pointerleave', () => { e.style.setProperty('--rx', '0deg'); e.style.setProperty('--ry', '0deg'); e.classList.remove('live'); e.classList.toggle('idle', !!c.spec.pk); e.style.removeProperty('--mx'); e.style.removeProperty('--my'); this.inspect(null); });
    e.addEventListener('pointerenter', () => { if (c.id && !e.classList.contains('down')) this.inspect(c.id, c.spec); });
    e.addEventListener('pointerdown', (ev) => this.downCard(ev, c));
  }
  cardText(id) {
    const d = D(id); let t = '';
    const cost = (a) => `<span class="orbs" style="display:inline-flex;vertical-align:middle">${costHTML(a.cost)}</span>`;
    if (d.cat === 'Pokemon') { t += `<p><b>${esc(d.name)}</b> · ${d.stage} · ${(d.types || []).join('/')} · ${d.hp} HP · Retreat ${d.retreat}</p>`;
      (d.abilities || []).forEach((a) => (t += `<p><b>Ability: ${esc(a.name)}</b><br>${esc(a.effect)}</p>`));
      d.attacks.forEach((a) => (t += `<p>${cost(a)} <b>${esc(a.name)}</b> ${a.damage || ''}<br>${esc(a.effect || '')}</p>`));
      t += `<p>Weak: ${(d.weak || []).join(', ') || '—'} · Resist: ${(d.resist || []).join(', ') || '—'}</p>`; }
    else t += `<p><b>${esc(d.name)}</b> · ${d.trainerType || d.cat}</p><p>${esc(d.effect || (d.cat === 'Energy' ? 'Provides ' + (d.energyType === 'Special' ? 'Colorless' : d.name.replace(' Energy', '')) + ' Energy.' : ''))}</p>`;
    return t;
  }
  inspect(id) {
    const el = $('#inspector'); if (!id || this.touch) { el.classList.remove('on'); return; }
    el.innerHTML = `<img src="${D(id).img}" alt=""><div class="txt">${this.cardText(id)}</div>`; el.classList.add('on');
  }
  /** click a card: it floats up, big and holographic, with its actions beside it */
  sheet(id, items, pk, fromEl) {
    const root = $('#float'); const d = D(id);
    const live = pk ? `<div class="live"><div class="hp ${(pk.hp - pk.dmg) / pk.hp < 0.3 ? 'low' : (pk.hp - pk.dmg) / pk.hp < 0.6 ? 'mid' : ''}"><i style="width:${Math.max(0, (pk.hp - pk.dmg) / pk.hp * 100)}%"></i><b>${pk.hp - pk.dmg}/${pk.hp} HP</b></div><div class="orbs">${pk.energy.map((x) => orbHTML(D(x.id).energyType === 'Special' ? 'Colorless' : D(x.id).name.replace(' Energy', ''))).join('') || '<small>No Energy attached</small>'}</div>${pk.cond.length ? `<div class="conds">${pk.cond.map((k) => STATUS_ICON[k] + ' ' + k).join(' · ')}</div>` : ''}</div>` : '';
    const foil = d.suffix || /Holo|Rare|ACE|Radiant|Double|Ultra/.test(d.rarity || '') && d.cat === 'Pokemon';
    root.innerHTML = `<div class="fback"></div><div class="fwrap"><div class="fstage"><div class="fcard card ${foil ? 'foil' : ''}"><div class="inner"><div class="face front"><img src="${d.img}" alt=""><div class="holo"></div><div class="spark"></div><div class="glare"></div></div></div></div><div class="fshadow"></div></div><div class="fpanel"><button class="x" aria-label="Close">✕</button><div class="fname">${esc(d.name)}</div><div class="fmeta">${d.cat === 'Pokemon' ? `${d.stage} · ${(d.types || []).join('/')} · ${d.hp} HP` : d.trainerType || d.cat}</div>${live}<div class="facts"></div><div class="finfo">${this.cardText(id)}</div></div></div>`;
    const facts = $('.facts', root); this.renderItems(items.length ? items : [], facts, true);
    if (items.length) facts.append(mk('hr'));
    const cl = mk('button', 'ghost', items.length ? 'Put it back' : 'Close'); cl.onclick = () => this.closeFloat(); facts.append(cl);
    $('.x', root).onclick = () => this.closeFloat(); root.classList.add('on'); this.floatOpen = true;
    const fc = $('.fcard', root), r0 = fromEl && fromEl.getBoundingClientRect();
    if (r0) requestAnimationFrame(() => { const r1 = fc.getBoundingClientRect(); const dx = r0.left + r0.width / 2 - (r1.left + r1.width / 2), dy = r0.top + r0.height / 2 - (r1.top + r1.height / 2), s = r0.width / r1.width; fc.animate([{ transform: `translate(${dx}px,${dy}px) scale(${s})`, filter: 'brightness(1.4)' }, { transform: 'none', filter: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.1)' }); });
    const tilt = (e) => { const r = fc.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * 100, py = (e.clientY - r.top) / r.height * 100; fc.style.setProperty('--mx', px.toFixed(1)); fc.style.setProperty('--my', py.toFixed(1)); fc.style.setProperty('--rx', ((50 - py) * 0.22).toFixed(1) + 'deg'); fc.style.setProperty('--ry', ((px - 50) * 0.28).toFixed(1) + 'deg'); };
    root.querySelector('.fstage').addEventListener('pointermove', tilt); root.querySelector('.fstage').addEventListener('pointerleave', () => { fc.style.setProperty('--rx', '0deg'); fc.style.setProperty('--ry', '0deg'); });
    $('.fback', root).onclick = () => this.closeFloat();
  }
  closeFloat() { const r = $('#float'); if (!this.floatOpen) return; this.floatOpen = false; r.classList.remove('on'); }
  closeSheet() { this.closeFloat(); }
  renderItems(items, host, sheet) {
    items.forEach((it) => {
      if (it.t === 'hd') return host.append(mk('div', 'hd', it.text)); if (it.t === 'hr') return host.append(mk('hr')); if (it.t === 'note') return host.append(mk('div', 'eff', esc(it.text)));
      const b = mk('button', '', it.html); b.disabled = !it.enabled; b.onclick = () => { this.closeMenu(); this.closeSheet(); it.fn(); }; host.append(b);
    });
  }

  // ------------------------------------------------------------------ input state
  refreshInteractive() {
    const v = this.view, main = this.req && this.req.kind === 'main'; this.legalIdx = null;
    document.querySelectorAll('.card.playable,.card.canact,.card.targetable').forEach((x) => x.classList.remove('playable', 'canact', 'targetable'));
    this.table.classList.toggle('myturn', !!main); $('#endTurn').disabled = !main; $('#endTurn').classList.toggle('ready', !!main && !this.req.legal.some((a) => !['end', 'retreat'].includes(a.t)));
    if (!main) { this.hint(v && v.cur !== v.me && !v.winner && v.turnNo ? 'Opponent is playing…' : ''); return; }
    const by = { hand: new Map(), pk: new Map() };
    this.req.legal.forEach((a, i) => { if (a.card) { (by.hand.get(a.card) || by.hand.set(a.card, []).get(a.card)).push(i); } const pid = a.pid ?? (a.t === 'attack' ? v.pl[v.me].active.pid : null); if (pid) (by.pk.get(pid) || by.pk.set(pid, []).get(pid)).push(i); if (a.t === 'retreat') { const b = a.target; (by.pk.get(b) || by.pk.set(b, []).get(b)).push(i); const act = v.pl[v.me].active; if (act) (by.pk.get(act.pid) || by.pk.set(act.pid, []).get(act.pid)).push(i); } });
    this.legalIdx = by;
    by.hand.forEach((_, uid) => { const c = this.cards.get(uid); if (c) c.el.classList.add('playable'); });
    by.pk.forEach((_, pid) => { const u = this.pkUid.get(pid), c = u && this.cards.get(u); if (c && c.spec.side === 'me') c.el.classList.add('canact'); });
    this.hint(this.target ? 'Choose a target · Esc to cancel' : 'Your turn: click a card to play it, drag it onto a Pokémon, or click your Pokémon to attack.');
  }
  hint(t) { const h = $('#hint'); h.textContent = t; h.classList.toggle('on', !!t); }
  bind() {
    $('#endTurn').onclick = () => { if (this.req && this.req.kind === 'main') { const i = this.req.legal.findIndex((a) => a.t === 'end'); this.answer({ i }); } };
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.cancelTarget(); this.closeMenu(); this.closeFloat(); } });
    $('#table').addEventListener('click', (e) => { if (this.suppress) { this.suppress = false; return; } const ce = e.target.closest('.card'); if (!ce) { this.closeMenu(); this.cancelTarget(); return; } this.clickCard(ce, e); });
    addEventListener('pointermove', (e) => this.moveDrag(e)); addEventListener('pointerup', (e) => this.upDrag(e));
    $('#btnLog').onclick = () => $('#log').classList.toggle('hidden'); $('#btnLeave').onclick = () => this.onLeave && this.onLeave();
    $('#btnMute').onclick = () => { audio.setMuted(!audio.muted); $('#btnMute').textContent = audio.muted ? '🔇' : '🔊'; };
    $('#btnMute').textContent = audio.muted ? '🔇' : '🔊';
    document.addEventListener('click', (e) => { if (!e.target.closest('#popmenu') && !e.target.closest('.card')) this.closeMenu(); });
  }
  clickCard(ce) {
    const uid = +ce.dataset.uid, c = this.cards.get(uid); if (!c) return; const main = this.req && this.req.kind === 'main';
    if (this.target) { if (this.target.targets.has(ce.dataset.pid) && ce.dataset.pid) { const a = this.target.byPid.get(+ce.dataset.pid); this.cancelTarget(); this.answer({ i: a }); } else this.cancelTarget(); return; }
    if (!c.id || c.spec.down) return; let items = [];
    if (main && c.spec.side === 'me') items = c.spec.zone === 'hand' ? this.handItems(uid) : c.spec.pk ? this.menuItems(c) : [];
    audio.sfx('draw'); this.inspect(null); this.sheet(c.id, items, c.spec.pk, c.el);
  }
  targetName(pid) {
    const v = this.view; for (const i of [0, 1]) { const pl = v.pl[i]; if (pl.active && pl.active.pid === pid) return `${D(pl.active.id).name} (Active)`; const k = pl.bench.findIndex((b) => b.pid === pid); if (k >= 0) return `${D(pl.bench[k].id).name} (Bench ${k + 1})`; }
    return 'Pokémon';
  }
  handItems(uid) {
    const idx = this.legalIdx.hand.get(uid) || []; if (!idx.length) return [{ t: 'note', text: "This card can't be played right now." }];
    const items = [{ t: 'hd', text: idx.length > 1 || this.req.legal[idx[0]].target ? 'Choose where to play it' : 'Play it' }];
    idx.forEach((i) => { const a = this.req.legal[i]; let html;
      if (a.target) { const pk = this.pkByPid(a.target); const verb = { attach: 'Attach to', tool: 'Attach to', evolve: 'Evolve' }[a.t] || 'Use on'; html = `${verb} <b>${esc(this.targetName(a.target))}</b>` + (pk ? `<span class="eff">${pk.hp - pk.dmg}/${pk.hp} HP · ${pk.energy.length} Energy</span>` : ''); }
      else html = `▶ ${esc(a.label)}`;
      items.push({ t: 'item', html, enabled: true, fn: () => { audio.sfx(a.t === 'attach' ? 'attach' : 'place'); this.answer({ i }); } }); });
    return items;
  }
  playHand(uid) {
    const idx = (this.legalIdx.hand.get(uid) || []); if (!idx.length) { this.toast('That card can\'t be played right now'); audio.sfx('click'); return; }
    const acts = idx.map((i) => this.req.legal[i]);
    if (acts.length === 1 && !acts[0].target) { audio.sfx('place'); return this.answer({ i: idx[0] }); }
    this.startTarget(uid, acts, idx);
  }
  startTarget(uid, acts, idx) {
    this.cancelTarget(); this.closeSheet(); const byPid = new Map(), targets = new Set(); acts.forEach((a, k) => { byPid.set(a.target, idx[k]); targets.add(String(a.target)); });
    this.target = { uid, targets, byPid }; targets.forEach((pid) => { const u = this.pkUid.get(+pid), c = u && this.cards.get(u); if (c) c.el.classList.add('targetable'); });
    this.hint(this.touch ? 'Tap a highlighted Pokémon (tap elsewhere to cancel)' : 'Choose a target · Esc to cancel'); const c = this.cards.get(uid); c && c.el.classList.add('dragging');
  }
  cancelTarget() { if (!this.target) return; document.querySelectorAll('.targetable,.dragging').forEach((x) => x.classList.remove('targetable', 'dragging')); this.target = null; this.refreshInteractive(); }

  // drag & drop from hand
  downCard(ev, c) {
    if (ev.button !== 0 || !this.req || this.req.kind !== 'main' || c.spec.zone !== 'hand' || c.spec.side !== 'me') return;
    this.drag = { c, x: ev.clientX, y: ev.clientY, on: false };
  }
  moveDrag(e) {
    const d = this.drag; if (!d) return; if (!d.on) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) return;
      const idx = this.legalIdx.hand.get(d.c.spec.uid) || []; if (!idx.length) { this.drag = null; return; }
      d.on = true; d.idx = idx; d.acts = idx.map((i) => this.req.legal[i]); d.ghost = mk('img'); d.ghost.src = D(d.c.spec.id).img; d.ghost.style.cssText = 'position:fixed;z-index:9999;height:230px;border-radius:10px;pointer-events:none;box-shadow:0 20px 50px #000a,0 0 30px #ffd166;transform:translate(-50%,-60%) rotate(-4deg)'; document.body.append(d.ghost);
      d.c.el.classList.add('dragging'); this.hideInspect = true; this.inspect(null);
      if (d.acts[0].target) d.acts.forEach((a) => { const u = this.pkUid.get(a.target), cc = u && this.cards.get(u); cc && cc.el.classList.add('targetable'); }); }
    d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px';
  }
  upDrag(e) {
    const d = this.drag; this.drag = null; if (!d || !d.on) return; this.suppress = true; setTimeout(() => (this.suppress = false), 60);
    d.ghost.remove(); d.c.el.classList.remove('dragging'); document.querySelectorAll('.targetable').forEach((x) => x.classList.remove('targetable'));
    if (d.acts[0].target) { const els = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest && x.closest('.card')).filter(Boolean); for (const ce of els) { const pid = +ce.dataset.pid; const k = d.acts.findIndex((a) => a.target === pid); if (pid && k >= 0) { audio.sfx('attach'); return this.answer({ i: d.idx[k] }); } } }
    else if (e.clientY < innerHeight * 0.74 && d.acts.length) { audio.sfx('place'); return this.answer({ i: d.idx[0] }); }
  }

  // Pokémon action menu
  closeMenu() { $('#popmenu').classList.add('hidden'); }
  menuItems(c) {
    const pk = c.spec.pk, d = D(pk.id), legal = this.req.legal, v = this.view, isActive = v.pl[v.me].active && v.pl[v.me].active.pid === pk.pid; const items = [];
    const item = (html, enabled, fn) => items.push({ t: 'item', html, enabled, fn });
    if (isActive) { items.push({ t: 'hd', text: 'Attacks' }); const atks = [...d.attacks]; if (pk.tool && D(pk.tool.id).name === 'Technical Machine: Evolution') atks.push({ ...D(pk.tool.id).attacks[0] });
      atks.forEach((a, k) => { const i = legal.findIndex((x) => x.t === 'attack' && x.idx === k); item(`<span class="orbs" style="display:inline-flex">${costHTML(a.cost)}</span> ${esc(a.name)}<span class="dmg">${a.damage || ''}</span>` + (a.effect ? `<span class="eff">${esc(a.effect)}</span>` : ''), i >= 0, () => { audio.sfx('click'); this.answer({ i }); }); }); }
    const abs = legal.map((a, i) => ({ a, i })).filter((x) => x.a.t === 'ability' && x.a.pid === pk.pid);
    (d.abilities || []).forEach((ab, k) => { const f = abs.find((x) => x.a.name === ab.name); if (!k) items.push({ t: 'hd', text: 'Abilities' }); item(`✦ ${esc(ab.name)}<span class="eff">${esc(ab.effect)}</span>`, !!f, () => this.answer({ i: f.i })); });
    const ret = legal.map((a, i) => ({ a, i })).filter((x) => x.a.t === 'retreat');
    if (ret.length) { items.push({ t: 'hr' });
      if (isActive) ret.forEach((x) => item(`↩ Retreat to <b>${esc(this.targetName(x.a.target))}</b>`, true, () => this.answer({ i: x.i })));
      else { const f = ret.find((x) => x.a.target === pk.pid); if (f) item('↩ Retreat — bring forward', true, () => this.answer({ i: f.i })); } }
    return items;
  }
  pkMenu(c) {
    const items = this.menuItems(c); if (!items.length) { this.toast('No actions available for this Pokémon'); return; }
    const m = $('#popmenu'); m.innerHTML = ''; this.renderItems(items, m);
    m.classList.remove('hidden'); const r = c.el.getBoundingClientRect(); const mw = 280, mh = m.offsetHeight; let x = r.right + 10, y = r.top; if (x + mw > innerWidth) x = r.left - mw - 10; if (y + mh > innerHeight - 10) y = innerHeight - mh - 10; m.style.left = Math.max(8, x) + 'px'; m.style.top = Math.max(8, y) + 'px';
  }
  toast(t) { const d = mk('div', '', esc(t)); $('#toast').append(d); setTimeout(() => d.remove(), 2700); }

  // ------------------------------------------------------------------ requests
  prompt(req, view) {
    return new Promise((resolve) => {
      this.resolve = resolve; this.req = req;
      this.queue = this.queue.then(() => { if (view && (!this.view || view.turnNo !== this.view.turnNo || true)) this.apply(view); if (req.kind === 'main') { this.refreshInteractive(); if (!this.shownTurn || this.shownTurn !== view.turnNo) this.shownTurn = view.turnNo; } else if (req.kind === 'select') this.select(req); else if (req.kind === 'setup') this.setup(req); });
    });
  }
  answer(a) { const r = this.resolve; this.resolve = null; this.req = null; this.cancelTarget(); this.closeMenu(); this.closeSheet(); this.closeModal(); this.refreshInteractive(); if (r) r(a); }
  closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }
  modal(html) { const m = $('#modal'); m.innerHTML = html; m.classList.remove('hidden'); return m; }

  select(req) {
    const opts = req.options, cardy = opts.every((o) => o.id); const picked = new Set();
    const title = req.title || 'Choose';
    const sub = req.max > 1 || req.min !== 1 ? `Choose ${req.min === req.max ? req.max : `${req.min}–${req.max}`}` : (req.zone === 'deck' ? 'From your deck' : '');
    const m = this.modal(`<div class="dlg"><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div>${cardy ? '<div class="grid"></div>' : '<div class="opts"></div>'}<div class="foot2"><span class="cntr"></span><button class="btn ok" disabled>Confirm</button></div></div>`);
    const conf = $('.btn', m), cntr = $('.cntr', m), upd = () => { cntr.textContent = req.max > 1 ? `${picked.size} / ${req.max} selected` : ''; conf.disabled = picked.size < req.min || picked.size > req.max; conf.textContent = req.min === 0 && !picked.size ? 'None / Done' : 'Confirm'; conf.disabled = conf.disabled && !(req.min === 0 && !picked.size); };
    const single = req.max === 1 && req.min === 1; if (single) $('.foot2', m).style.display = 'none';
    const fin = () => this.answer([...picked]);
    opts.forEach((o) => {
      let node;
      if (cardy) { const d = D(o.id); let extra = d.name; if (o.pid) { const pk = this.pkByPid(o.pid); if (pk) extra = `${d.name} · ${pk.hp - pk.dmg}/${pk.hp} HP · ${pk.energy.length}⚡`; }
        node = mk('div', 'opt', `<img src="${d.img}" alt=""><small>${esc(extra)}</small>`); node.addEventListener('pointerenter', () => this.inspect(o.id)); node.addEventListener('pointerleave', () => this.inspect(null)); }
      else { node = mk('button', 'btn ' + (o.key === 'first' || o.key === 'yes' ? 'ok' : ''), esc(o.text || o.key)); }
      node.onclick = () => { audio.sfx('click'); if (single) { this.inspect(null); return fin_(o.key); } if (picked.has(o.key)) picked.delete(o.key); else if (picked.size < req.max) picked.add(o.key); node.classList.toggle('on', picked.has(o.key)); upd(); };
      $(cardy ? '.grid' : '.opts', m).append(node);
    });
    const fin_ = (k) => { picked.clear(); picked.add(k); fin(); };
    conf.onclick = fin; upd();
  }
  pkByPid(pid) { const v = this.view; for (const i of [0, 1]) for (const pk of [v.pl[i].active, ...v.pl[i].bench]) if (pk && pk.pid === pid) return pk; return null; }
  setup(req) {
    let active = req.basics[0].key; const bench = new Set(); const b = req.basics;
    const m = this.modal(`<div class="dlg"><h3>Choose your starting Pokémon</h3><div class="sub">Click one for your <b style="color:#ff9a3d">Active</b> spot, then click others to put them on your Bench (up to 5). They stay face-down until both players are ready.</div><div class="grid"></div><div class="foot2"><button class="btn ok">Ready!</button></div></div>`);
    const draw = () => { const g = $('.grid', m); g.innerHTML = ''; b.forEach((o) => { const d = D(o.id); const n = mk('div', 'opt' + (o.key === active ? ' act' : bench.has(o.key) ? ' on' : ''), `<img src="${d.img}"><small>${o.key === active ? 'ACTIVE' : bench.has(o.key) ? 'Bench' : 'Hand'}</small>`);
      n.onclick = () => { audio.sfx('click'); if (o.key === active) return; if (bench.has(o.key)) bench.delete(o.key); else if (bench.size < 5) bench.add(o.key); draw(); }; n.oncontextmenu = (e) => { e.preventDefault(); bench.delete(o.key); active = o.key; draw(); }; n.ondblclick = () => { bench.delete(o.key); active = o.key; draw(); };
      n.addEventListener('pointerenter', () => this.inspect(o.id)); n.addEventListener('pointerleave', () => this.inspect(null)); g.append(n); }); };
    draw(); $('.sub', m).innerHTML += '<br><small>Tip: double-click a card to make it your Active Pokémon.</small>';
    $('.btn', m).onclick = () => this.answer({ active, bench: [...bench] });
  }
  viewPile(p, which) {
    const list = this.view.pl[p][which]; const nm = this.view.pl[p].name; const m = this.modal(`<div class="dlg"><h3>${esc(nm)} — ${which === 'lost' ? 'Lost Zone' : 'Discard pile'} (${list.length})</h3><div class="grid"></div><div class="foot2"><button class="btn">Close</button></div></div>`);
    list.slice().reverse().forEach((c) => { const d = D(c.id); const n = mk('div', 'opt', `<img src="${d.img}" loading="lazy"><small>${esc(d.name)}</small>`); n.addEventListener('pointerenter', () => this.inspect(c.id)); n.addEventListener('pointerleave', () => this.inspect(null)); $('.grid', m).append(n); });
    if (!list.length) $('.grid', m).innerHTML = '<p style="color:#9aa0d0">Empty.</p>'; $('.btn', m).onclick = () => this.closeModal();
  }

  // ------------------------------------------------------------------ events / animation
  enqueue(view, events) {
    const p = this.queue.then(async () => {
      if (this.req) return;                                         // a prompt is pending; its own apply handles view
      await this.pre(events, view); this.apply(view); await this.post(events, view);
    });
    this.queue = p.catch(() => {}); return p;
  }
  center(pid) { const u = this.pkUid.get(pid), c = u && this.cards.get(u); if (!c) return null; const r = c.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: c.el }; }
  posOf(side, key) { const t = this.zones[side + key]; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  popText(x, y, text, cls = '') { const d = mk('div', 'pop ' + cls, esc(text)); d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.append(d); setTimeout(() => d.remove(), 1300); }
  shake(big) { const s = $('#stage'); s.classList.remove('shake', 'shake-big'); void s.offsetWidth; s.classList.add(big ? 'shake-big' : 'shake'); }
  banner(text, color = '#8a5cff') { const b = $('#banner'); b.innerHTML = `<b style="--bc:${color}">${esc(text)}</b>`; setTimeout(() => (b.innerHTML = ''), 1750); }
  log(text) { const l = $('#log'); const p = mk('p', /^—/.test(text) ? 't' : /Knocked Out|wins/.test(text) ? 'k' : '', esc(text)); l.append(p); l.scrollTop = l.scrollHeight; }
  async pre(evs, v) {
    for (const e of evs) {
      if (e.type === 'attack') {
        const c = this.center(e.pid); if (!c) continue; const mine = this.view && this.view.pl && false; const def = this.defenderPos(e.p); const col = TYPE_COLOR[(e.types || ['Colorless'])[0]] || '#fff';
        audio.sfx(e.dmg ? 'zap' : 'ability'); c.el.style.setProperty('--ly', (c.y > innerHeight / 2 ? -70 : 70) + 'px'); c.el.classList.add('lunge'); setTimeout(() => c.el.classList.remove('lunge'), 560);
        this.popText(c.x, c.y - 90, e.name, 'small'); this.fx.ring(c.x, c.y, col, { r: 150 });
        await sleep(320); if (def) this.fx.shot(c.x, c.y, def.x, def.y, col, { dur: 0.4 }); await sleep(480);
      }
      if (e.type === 'ko') { const c = this.center(e.pid); if (c) { const col = TYPE_COLOR[(e.types || ['Colorless'])[0]] || '#fff'; c.el.style.setProperty('--tx', (Math.random() * 160 - 80) + 'px'); c.el.style.setProperty('--ty', '-140px'); c.el.classList.add('dissolve'); audio.sfx('ko'); this.fx.burst(c.x, c.y, col, { n: 90, speed: 520, size: 6, life: 1.1 }); this.fx.ring(c.x, c.y, '#fff', { r: 240, life: 0.9, w: 9 }); this.shake(true); await sleep(900); } }
      if (e.type === 'lost' && this.view) { /* handled in post (needs new positions) */ }
    }
  }
  defenderPos(p) { // position of the active Pokémon of the other player than p
    const v = this.view; if (!v) return null; const opp = 1 - p, pl = v.pl[opp]; if (!pl.active) return null; return this.center(pl.active.pid);
  }
  async post(evs, v) {
    let wait = 0;
    for (const e of evs) {
      switch (e.type) {
        case 'log': this.log(e.text); break;
        case 'draw': audio.sfx('draw'); wait = Math.max(wait, 250); break;
        case 'shuffle': audio.sfx('shuffle'); break;
        case 'search': audio.sfx('search'); break;
        case 'turn': { const mine = e.p === v.me; this.banner(mine ? 'Your turn' : "Opponent's turn", mine ? '#52e08a' : '#ff5c7a'); audio.sfx('turn'); wait = Math.max(wait, 650); break; }
        case 'bench': audio.sfx('place'); break;
        case 'promote': case 'switch': audio.sfx('place'); break;
        case 'attach': { audio.sfx('attach'); const c = this.center(e.pid); const t = D(e.id); if (c) this.fx.burst(c.x, c.y, TYPE_COLOR[t.energyType === 'Special' ? 'Colorless' : t.name.replace(' Energy', '')] || '#fff', { n: 26, speed: 260, life: 0.7 }); break; }
        case 'tool': audio.sfx('attach'); break;
        case 'evolve': { audio.sfx('evolve'); const c = this.center(e.pid); if (c) { this.fx.ring(c.x, c.y, '#fff', { r: 220, life: 0.9, w: 8 }); this.fx.burst(c.x, c.y, '#ffe9a8', { n: 70, speed: 460, life: 1 }); } wait = Math.max(wait, 600); break; }
        case 'ability': { audio.sfx('ability'); const c = e.pid ? this.center(e.pid) : null; if (c) { this.fx.ring(c.x, c.y, '#22e0c8', { r: 170 }); this.popText(c.x, c.y - 100, e.name, 'small'); } wait = Math.max(wait, 350); break; }
        case 'trainer': { audio.sfx('trainer'); const d = D(e.id); const s = $('#spot'); s.innerHTML = `<img src="${d.img}" style="--sc:${e.kind === 'Supporter' ? '#ffb347' : e.kind === 'Stadium' ? '#52e08a' : '#3ea0ff'}">`; setTimeout(() => (s.innerHTML = ''), 1400); wait = Math.max(wait, 900); break; }
        case 'stadium': audio.sfx('place'); break;
        case 'damage': { const c = this.center(e.pid); if (!c) break; const big = e.amount >= 100 || e.ko; audio.sfx(e.weak || big ? 'crit' : 'hit'); c.el.classList.add('hit'); setTimeout(() => c.el.classList.remove('hit'), 520);
          if (e.amount > 0) { this.popText(c.x, c.y - 30, e.counters ? `+${e.amount / 10} ◆` : e.ko ? 'K.O.!' : `-${e.amount}`, e.weak ? 'weak' : ''); if (e.weak) this.popText(c.x, c.y - 100, 'WEAKNESS ×2', 'small'); this.fx.burst(c.x, c.y, e.weak ? '#ffd166' : '#ff5c7a', { n: Math.min(60, 14 + e.amount / 5), speed: 380, life: 0.7 }); this.shake(big); } else this.popText(c.x, c.y - 30, 'No damage', 'small'); wait = Math.max(wait, 650); break; }
        case 'heal': { const c = this.center(e.pid); if (c) { audio.sfx('heal'); this.popText(c.x, c.y - 30, `+${e.amount}`, 'heal'); this.fx.burst(c.x, c.y, '#8bffb1', { n: 24, speed: 200, grav: -120, life: 0.9 }); } break; }
        case 'lost': { audio.sfx('lost'); const side = this.sideOf(e.p); const to = this.posOf(side, 'Lost'); const own = v.pl[e.p].active && this.center(v.pl[e.p].active.pid); const from = e.from === 'deck' || !own ? this.posOf(side, 'Deck') : own; this.fx.vortex(from.x, from.y, to.x, to.y); this.fx.ring(to.x, to.y, '#b46cff', { r: 130, life: 0.8 }); wait = Math.max(wait, 350); break; }
        case 'status': { audio.sfx('status'); const c = this.center(e.pid); if (c) { this.popText(c.x, c.y - 60, e.cond.toUpperCase(), 'small'); this.fx.burst(c.x, c.y, '#b46cff', { n: 30 }); } break; }
        case 'prize': audio.sfx('prize'); wait = Math.max(wait, 400); break;
        case 'vstar': { audio.sfx('vstar'); this.banner('VSTAR POWER', '#ffd166'); this.shake(true); this.fx.ring(innerWidth / 2, innerHeight / 2, '#ffd166', { r: 700, life: 1.2, w: 14 }); this.fx.burst(innerWidth / 2, innerHeight / 2, '#ffe9a8', { n: 140, speed: 700, life: 1.4, size: 6 }); wait = Math.max(wait, 1200); break; }
        case 'checkup': break;
        case 'coin': { await this.coin(e.heads); break; }
        case 'coinfirst': { this.banner(`${v.pl[e.p].name} wins the toss`, '#ffd166'); audio.sfx('coin'); await this.coin(e.p === v.me); wait = Math.max(wait, 700); break; }
        case 'win': { await sleep(900); this.end(e.p === v.me, e.reason); break; }
      }
    }
    if (wait) await sleep(wait);
  }
  async coin(heads) { const w = $('#coinwrap'), c = $('#coin'); w.classList.add('on'); c.classList.remove('flip'); void c.offsetWidth; c.style.setProperty('--endx', (heads ? 1800 : 1980) + 'deg'); c.classList.add('flip'); audio.sfx('coin'); await sleep(1500); this.popText(innerWidth / 2, innerHeight / 2 + 130, heads ? 'HEADS' : 'TAILS', 'weak'); await sleep(650); w.classList.remove('on'); }
  end(won, reason) {
    const e = $('#end'); audio.sfx(won ? 'win' : 'lose'); e.className = won ? 'win' : 'lose';
    e.innerHTML = `<h1>${won ? 'VICTORY' : 'DEFEAT'}</h1><p>${esc(reason || '')}</p><div class="row"><button class="btn" id="again">Play again</button><button class="btn alt" id="toMenu">Main menu</button></div>`;
    if (won) { this.fx.confetti(260); setTimeout(() => this.fx.confetti(160), 1200); }
    $('#toMenu').onclick = () => this.onLeave && this.onLeave(true); $('#again').onclick = () => this.onAgain && this.onAgain();
  }
  reset() { this.closeSheet(); this.cards.forEach((c) => c.el.remove()); this.cards.clear(); this.view = null; this.req = null; this.resolve = null; this.target = null; $('#log').innerHTML = ''; $('#end').className = 'hidden'; this.closeModal(); this.closeMenu(); this.queue = Promise.resolve(); this.hint(''); }
}
