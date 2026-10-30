// Board UI: lays every card out on a tilted 3D table, animates changes, handles input.
import { D } from './engine.js';
import { audio } from './audio.js';
import { FX, TYPE_COLOR } from './fx.js';

const $ = (s, r = document) => r.querySelector(s);
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function makeLayout(W, H) {
  const port = H > W * 1.05, m = 10, cx = W / 2; let ch, cw, pos, bx, stadium, gap;
  if (!port) {
    ch = Math.min(H * 0.175, (W / 9.0) / 0.716); cw = ch * 0.716; gap = cw * 1.14;
    const R = [0.105, 0.30, 0.50, 0.70, 0.893].map((f) => f * H), c1 = gap * 3.2;
    pos = {
      me: { active: [cx, R[2]], benchY: R[3], deck: [cx + c1, R[2]], discard: [cx + c1, R[3]], lost: [cx - c1, R[3]], prizeAt: [cx - c1, R[2]], handY: R[4] },
      op: { active: [cx, R[1]], benchY: R[0], deck: [cx - c1, R[1]], discard: [cx - c1, R[0]], lost: [cx + c1, R[0]], prizeAt: [cx + c1, R[1]], handY: -ch * 0.3 } };
    stadium = [cx + c1, (R[1] + R[2]) / 2];
  } else {
    cw = Math.min((W - 2 * m) / 5.45, H * 0.122 * 0.716); ch = cw / 0.716; gap = Math.max(cw * 1.04, (W - 2 * m - cw) / 4);
    const R = [0.118, 0.238, 0.356, 0.466, 0.58, 0.70, 0.815, 0.927].map((f) => f * H), p1 = m + cw * 0.55, p2 = p1 + cw * 1.14, p3 = p2 + cw * 1.14, pz = W - m - cw * 0.55;
    pos = {
      me: { active: [cx, R[4]], benchY: R[5], deck: [p1, R[6]], discard: [p2, R[6]], lost: [p3, R[6]], prizeAt: [pz, R[6]], handY: R[7] },
      op: { active: [cx, R[2]], benchY: R[1], deck: [p1, R[0]], discard: [p2, R[0]], lost: [p3, R[0]], prizeAt: [pz, R[0]], handY: -ch * 0.3 } };
    stadium = [cx, R[3]];
  }
  return { W, H, port, cw, ch, hw: port ? W - 20 : W - 380, bx: (i) => cx + (i - 2) * gap, stadium, handMid: cx, pos };
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
    const L = makeLayout(innerWidth, innerHeight); this.L = L; this.cw = L.cw; this.ch = L.ch;
    const st = document.documentElement.style; st.setProperty('--cw', L.cw.toFixed(1) + 'px'); st.setProperty('--ch', L.ch.toFixed(1) + 'px'); st.setProperty('--fs', (L.ch * 0.085).toFixed(1) + 'px');
    const eb = $('#endTurn'); if (L.port) { eb.style.top = (L.stadium[1] - 22) + 'px'; eb.style.bottom = 'auto'; } else { eb.style.top = 'auto'; eb.style.bottom = ''; }
    this.buildTable(); if (this.view) this.apply(this.view);
  }

  // ------------------------------------------------------------------ static table
  buildTable() {
    const t = this.table; this.static.forEach((x) => x.remove()); this.static = []; const L = this.L, cw = this.cw, ch = this.ch;
    const add = (e) => { t.prepend(e); this.static.push(e); return e; }; this.zones = {};
    const zone = (key, c, w, h, label, cls = '') => { const z = add(mk('div', 'zone ' + cls, `<span>${label}</span><span class="cnt"></span>`)); z.style.cssText = `left:${c[0] - w / 2}px;top:${c[1] - h / 2}px;width:${w}px;height:${h}px`; this.zones[key] = z; return z; };
    for (const side of ['me', 'op']) {
      const P = L.pos[side];
      zone(side + 'Active', P.active, cw + 8, ch + 8, 'Active', 'active');
      for (let i = 0; i < 5; i++) zone(side + 'Bench' + i, [L.bx(i), P.benchY], cw + 6, ch + 6, i === 0 ? 'Bench' : '');
      zone(side + 'Deck', P.deck, cw + 4, ch + 4, 'Deck');
      for (let i = 0; i < 4; i++) { const pi = add(mk('div', 'pile')); pi.style.cssText = `left:${P.deck[0] - cw / 2 - i * 1.2}px;top:${P.deck[1] - ch / 2 - i * 1.5}px`; pi.append(mk('i')); }
      zone(side + 'Discard', P.discard, cw + 4, ch + 4, 'Discard').classList.add('mine');
      zone(side + 'Lost', P.lost, cw + 4, ch + 4, 'Lost Zone', 'lost').classList.add('mine');
      zone(side + 'Prize', P.prizeAt, cw * 0.7 + 10, ch * 0.7 + 10, 'Prizes');
      this.zones[side + 'Discard'].onclick = () => this.viewPile(side === 'me' ? this.view.me : 1 - this.view.me, 'discard');
      this.zones[side + 'Lost'].onclick = () => this.viewPile(side === 'me' ? this.view.me : 1 - this.view.me, 'lost');
    }
    zone('stadium', L.stadium, cw * 0.85 + 8, ch * 0.85 + 8, 'Stadium');
  }
  sideOf(i) { return i === this.view.me ? 'me' : 'op'; }

  // ------------------------------------------------------------------ layout
  layout(v) {
    const out = [], me = v.me, L = this.L, cw = this.cw;
    for (const i of [0, 1]) {
      const side = i === me ? 'me' : 'op', P = L.pos[side], pl = v.pl[i];
      const n = pl.hand.length, hm = L.handMid;
      const step = side === 'me' ? Math.min(cw * 1.1, n > 1 ? (L.hw - cw) / (n - 1) : 999) : Math.min(cw * 0.42, n > 1 ? (L.W * 0.5) / (n - 1) : 999);
      pl.hand.forEach((c, k) => { const off = k - (n - 1) / 2;
        out.push({ uid: c.uid, id: c.id || null, x: hm + off * step, y: P.handY, s: side === 'me' ? 1 : 0.56, rot: 0, z: side === 'me' ? 100 + k : 2, down: !c.id, zone: 'hand', side, owner: i }); });
      const pkSpec = (pk, x, y, z, zone) => out.push({ uid: pk.uid, id: pk.id, x, y, s: 1, rot: 0, z, down: false, zone, side, pk, owner: i });
      if (pl.active) pkSpec(pl.active, P.active[0], P.active[1], 20, 'active');
      pl.bench.forEach((pk, k) => pkSpec(pk, L.bx(k), P.benchY, 18, 'bench'));
      const d = pl.discard; if (d.length) { const c = d[d.length - 1]; out.push({ uid: c.uid, id: c.id, x: P.discard[0], y: P.discard[1], s: 1, rot: (c.uid % 5) - 2, z: 6, down: false, zone: 'discard', side, owner: i }); }
      pl.prizes.forEach((u, k) => out.push({ uid: u, id: null, x: P.prizeAt[0] + k * 1.8, y: P.prizeAt[1] - k * 1.8, s: 0.7, rot: 0, z: 3, down: true, zone: 'prize', side, owner: i }));
    }
    if (v.stadium) out.push({ uid: v.stadium.uid, id: v.stadium.id, x: L.stadium[0], y: L.stadium[1], s: 0.85, rot: 0, z: 8, down: false, zone: 'stadium', side: 'me', owner: v.stadium.owner });
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
    const o = this.originOf(sp); this.setT(e, { ...sp, ...o }); if (o.down) e.classList.add('down');
    void e.offsetWidth; requestAnimationFrame(() => e.classList.remove('snap'));
    this.wire(c); return c;
  }
  setT(e, sp) { e.style.transform = `translate(${sp.x - this.cw / 2}px, ${sp.y - this.ch / 2}px) rotate(${sp.rot || 0}deg) scale(${sp.s})`; }
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
    e.style.zIndex = 900; e.style.transform = `translate(${dest[0] - this.cw / 2}px, ${dest[1] - this.ch / 2}px) rotate(${lost ? 540 : 0}deg) scale(${s})`; e.style.opacity = lost ? '0' : '0.0';
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
  who(v, i) { const p = v.pl[i]; return `<span class="dot"></span>${esc(p.name)} <small>Prizes ${p.prizeN} · Hand ${p.handN}</small>`; }

  // ------------------------------------------------------------------ pointer & tilt
  wire(c) {
    const e = c.el;
    e.addEventListener('pointerleave', () => this.inspect(null));
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
    root.innerHTML = `<div class="fback"></div><div class="fwrap"><div class="fstage"><div class="fcard card ${foil ? 'foil' : ''} ${d.suffix ? 'rule' : ''}"><div class="inner"><div class="face front"><img src="${d.img}" alt=""><div class="holo"></div><div class="spark"></div><div class="glare"></div></div></div></div><div class="fshadow"></div></div><div class="fpanel"><button class="x" aria-label="Close">✕</button><div class="fname">${esc(d.name)}</div><div class="fmeta">${d.cat === 'Pokemon' ? `${d.stage} · ${(d.types || []).join('/')} · ${d.hp} HP` : d.trainerType || d.cat}</div>${live}<div class="facts"></div><div class="finfo">${this.cardText(id)}</div></div></div>`;
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
    this.table.classList.toggle('myturn', !!main); $('#endTurn').disabled = !main;
    { const v0 = this.view, eb = $('#endTurn'); eb.textContent = main ? 'End turn' : !v0 || !v0.turnNo ? 'Setting up…' : v0.winner !== null ? 'Game over' : v0.cur !== v0.me ? "Opponent's turn" : 'Wait…'; eb.classList.toggle('wait', !main); } $('#endTurn').classList.toggle('ready', !!main && !this.req.legal.some((a) => !['end', 'retreat'].includes(a.t)));
    if (!main) { this.hint(v && v.cur !== v.me && !v.winner && v.turnNo ? 'Opponent is playing…' : ''); return; }
    const by = { hand: new Map(), pk: new Map() };
    this.req.legal.forEach((a, i) => { if (a.card) { (by.hand.get(a.card) || by.hand.set(a.card, []).get(a.card)).push(i); } const pid = a.pid ?? (a.t === 'attack' ? v.pl[v.me].active.pid : null); if (pid) (by.pk.get(pid) || by.pk.set(pid, []).get(pid)).push(i); if (a.t === 'retreat') { const b = a.target; (by.pk.get(b) || by.pk.set(b, []).get(b)).push(i); const act = v.pl[v.me].active; if (act) (by.pk.get(act.pid) || by.pk.set(act.pid, []).get(act.pid)).push(i); } });
    this.legalIdx = by;
    by.hand.forEach((_, uid) => { const c = this.cards.get(uid); if (c) c.el.classList.add('playable'); });
    by.pk.forEach((_, pid) => { const u = this.pkUid.get(pid), c = u && this.cards.get(u); if (c && c.spec.side === 'me') c.el.classList.add('canact'); });
    this.hint(this.target ? 'Choose a target · Esc to cancel' : 'Your turn: click a card to play it, drag it onto a Pokémon, or click your Pokémon to attack.');
  }
  hint(t) { const h = $('#hint'); h.textContent = t; h.classList.toggle('on', !!t && /target/i.test(t)); }
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
    const m = this.modal(`<div class="dlg"><h3>Choose your starting Pokémon</h3><div class="sub">Pick your <b style="color:#e8801a">Active</b> Pokémon, then add up to 5 to your <b style="color:#12a8c4">Bench</b>. They stay face-down until both players are ready.</div><div class="grid"></div><div class="foot2"><span class="cntr"></span><button class="btn ok">Ready!</button></div></div>`);
    const grid = $('.grid', m), cntr = $('.cntr', m);
    const draw = () => {
      grid.innerHTML = ''; cntr.textContent = `Bench ${bench.size} / 5`;
      b.forEach((o) => {
        const d = D(o.id), isA = o.key === active, isB = bench.has(o.key);
        const n = mk('div', 'opt setupopt' + (isA ? ' act' : isB ? ' on' : ''), `<img src="${d.img}" alt=""><small>${esc(d.name)}</small><div class="seg"><button class="a${isA ? ' sel' : ''}">Active</button><button class="bn${isB ? ' sel' : ''}"${isA ? ' disabled' : ''}>Bench</button></div>`);
        $('.a', n).onclick = (e) => { e.stopPropagation(); audio.sfx('click'); bench.delete(o.key); active = o.key; draw(); };
        $('.bn', n).onclick = (e) => { e.stopPropagation(); if (isA) return; audio.sfx('click'); if (isB) bench.delete(o.key); else if (bench.size < 5) bench.add(o.key); else this.toast('Your Bench is full (5)'); draw(); };
        n.addEventListener('pointerenter', () => this.inspect(o.id)); n.addEventListener('pointerleave', () => this.inspect(null)); grid.append(n);
      });
    };
    draw(); $('.btn', m).onclick = () => { this.inspect(null); this.answer({ active, bench: [...bench] }); };
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
