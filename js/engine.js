// Pokémon TCG rules engine. Pure JS, no DOM: runs in the browser (host) and in Node (tests).
import { fxOf } from './cards.js';

let DB = {};
export const setDB = (d) => { DB = d; };
export const D = (id) => DB[id];
export const allDefs = () => Object.values(DB);

export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const isPokemon = (c) => D(c.id).cat === 'Pokemon';
export const isTrainer = (c) => D(c.id).cat === 'Trainer';
export const isEnergy = (c) => D(c.id).cat === 'Energy';
export const isBasicEnergy = (c) => isEnergy(c) && D(c.id).energyType !== 'Special';
export const isBasicPoke = (c) => isPokemon(c) && D(c.id).stage === 'Basic';
export const energyType = (c) => D(c.id).name.replace(' Energy', '');
export const hasRuleBox = (d) => !!d.suffix;                      // V, VSTAR, ex, Radiant
export const prizeValue = (d) => (['V', 'VSTAR', 'ex', 'GX'].includes(d.suffix) ? 2 : d.suffix === 'VMAX' ? 3 : 1);
export const provides = (c) => (D(c.id).energyType === 'Special' ? ['Colorless'] : [energyType(c)]);

/** pool = list of energy types provided ('*' = any type). */
export function canPay(cost, pool0) {
  const pool = [...pool0]; let colorless = 0;
  for (const t of cost || []) { if (t === 'Colorless') { colorless++; continue; } let k = pool.indexOf(t); if (k < 0) k = pool.indexOf('*'); if (k < 0) return false; pool.splice(k, 1); }
  return pool.length >= colorless;
}

export class Game {
  constructor({ decks, names = ['Player 1', 'Player 2'], ctl, seed = Date.now(), maxTurns = 400 }) {
    this.decks = decks; this.names = names; this.ctl = ctl; this.rng = mulberry32(seed); this.maxTurns = maxTurns;
    this.uidc = 0; this.evq = []; this.turnNo = 0; this.cur = 0; this.winner = null; this.reason = ''; this.stadium = null; this.stadiumOwner = null;
    this.koOnTurn = [-9, -9]; this.pkc = 0; this.itemLock = [-9, -9];
    this.pl = [0, 1].map((i) => ({ i, name: names[i], deck: [], hand: [], discard: [], prizes: [], lost: [], active: null, bench: [], turns: 0, sup: false, en: false, ret: false, stad: false, vstar: false, flags: {} }));
  }
  // ---------------------------------------------------------------- utils
  rnd() { return this.rng(); }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  inst(id) { return { uid: ++this.uidc, id }; }
  inPlay(p) { const pl = this.pl[p]; return [pl.active, ...pl.bench].filter(Boolean); }
  allPK() { return [...this.inPlay(0), ...this.inPlay(1)]; }
  top(pk) { return pk.cards[pk.cards.length - 1]; }
  dOf(pk) { return D(this.top(pk).id); }
  ownerOf(pk) { return this.inPlay(0).includes(pk) ? 0 : 1; }
  findPK(pid) { return this.allPK().find((x) => x.pid === pid); }
  newPK(inst) { return { pid: ++this.pkc, cards: [inst], energy: [], tool: null, dmg: 0, cond: {}, since: this.turnNo, evolvedTurn: -1, used: {}, noAttackOn: -1 }; }
  log(text) { this.ev('log', { text }); }
  ev(type, data = {}) { this.evq.push({ type, ...data }); }
  async sync() { const evs = this.evq; this.evq = []; await Promise.all(this.ctl.map((c, i) => (c.update ? c.update(this.view(i), evs, i) : null))); }
  maxHp(pk) { return this.dOf(pk).hp; }
  remainingHp(pk) { return this.maxHp(pk) - pk.dmg; }
  pkTypes(pk) { return this.dOf(pk).types || []; }
  lostCount(p) { return this.pl[p].lost.length; }

  // ---------------------------------------------------------------- views
  pkView(pk) {
    const t = this.top(pk);
    return { pid: pk.pid, uid: t.uid, id: t.id, under: pk.cards.slice(0, -1).map((c) => c.id), energy: pk.energy.map((e) => ({ uid: e.uid, id: e.id })), tool: pk.tool ? { uid: pk.tool.uid, id: pk.tool.id } : null,
      dmg: pk.dmg, hp: this.maxHp(pk), cond: Object.keys(pk.cond).filter((k) => pk.cond[k]), noAttack: pk.noAttackOn === this.turnNo + 1 || pk.noAttackOn === this.turnNo };
  }
  view(me) {
    const pl = (i) => { const x = this.pl[i]; const own = i === me; return {
      i, name: x.name, deckN: x.deck.length, handN: x.hand.length, hand: x.hand.map((c) => (own ? { uid: c.uid, id: c.id } : { uid: c.uid })),
      discard: x.discard.map((c) => ({ uid: c.uid, id: c.id })), lost: x.lost.map((c) => ({ uid: c.uid, id: c.id })), prizeN: x.prizes.length, prizes: x.prizes.map((c) => c.uid),
      active: x.active ? this.pkView(x.active) : null, bench: x.bench.map((b) => this.pkView(b)), sup: x.sup, en: x.en, ret: x.ret, stad: x.stad, vstar: x.vstar, turns: x.turns }; };
    return { me, cur: this.cur, turnNo: this.turnNo, winner: this.winner, reason: this.reason, stadium: this.stadium ? { uid: this.stadium.uid, id: this.stadium.id, owner: this.stadiumOwner } : null, pl: [pl(0), pl(1)] };
  }
  async ask(p, req) { return this.ctl[p].ask(req, this.view(p), p); }

  // ---------------------------------------------------------------- selection helpers
  /** options: [{key,id?,pid?,text?}]; returns array of chosen keys */
  async select(p, { title, options, min = 1, max = 1, purpose = 'misc', zone = null }) {
    if (!options.length) return [];
    if (options.length <= min) return options.map((o) => o.key);
    for (let tries = 0; tries < 5; tries++) {
      const ans = await this.ask(p, { kind: 'select', title, options, min, max, purpose, zone });
      const keys = Array.isArray(ans) ? ans : [];
      const valid = new Set(options.map((o) => o.key));
      if (keys.every((k) => valid.has(k)) && new Set(keys).size === keys.length && keys.length >= min && keys.length <= max) return keys;
    }
    return options.slice(0, min).map((o) => o.key);
  }
  cardOpts(cards) { return cards.map((c) => ({ key: c.uid, id: c.id })); }
  pkOpts(pks) { return pks.map((pk) => ({ key: pk.pid, pid: pk.pid, id: this.top(pk).id })); }
  async pickCards(p, cards, o) { const keys = await this.select(p, { ...o, options: this.cardOpts(cards) }); return keys.map((k) => cards.find((c) => c.uid === k)); }
  async pickPK(p, pks, o) { const keys = await this.select(p, { ...o, options: this.pkOpts(pks) }); return keys.map((k) => pks.find((x) => x.pid === k)); }

  // ---------------------------------------------------------------- card movement
  draw(p, n) { const pl = this.pl[p]; let k = 0; for (let i = 0; i < n && pl.deck.length; i++, k++) pl.hand.push(pl.deck.pop()); if (k) this.ev('draw', { p, n: k }); return k; }
  toLost(p, c, from = 'deck') { this.pl[p].lost.push(c); this.ev('lost', { p, uid: c.uid, id: c.id, from }); }
  toDiscard(p, c) { this.pl[p].discard.push(c); }
  removeFrom(arr, c) { const i = arr.findIndex((x) => x.uid === c.uid); if (i >= 0) arr.splice(i, 1); return c; }
  topCards(p, n) { const d = this.pl[p].deck; return d.splice(Math.max(0, d.length - n), n).reverse(); }  // top first
  putBottom(p, cards) { this.pl[p].deck.unshift(...cards); }
  async searchDeck(p, { title, filter, max = 1, min = 0, purpose = 'search' }) {
    const pl = this.pl[p]; const cands = pl.deck.filter(filter);
    this.log(`${pl.name} searches their deck.`);
    this.ev('search', { p });
    const got = cands.length ? await this.pickCards(p, cands, { title, min: Math.min(min, cands.length), max, purpose, zone: 'deck' }) : [];
    got.forEach((c) => this.removeFrom(pl.deck, c));
    this.shuffle(pl.deck); this.ev('shuffle', { p });
    return got;
  }
  benchCard(p, c) { const pk = this.newPK(c); this.pl[p].bench.push(pk); this.ev('bench', { p, uid: c.uid, pid: pk.pid }); return pk; }
  async attachEnergy(p, c, pk, { from = 'hand' } = {}) { pk.energy.push(c); this.ev('attach', { p, uid: c.uid, pid: pk.pid, id: c.id, from }); }
  discardPK(pk) { const o = this.ownerOf(pk); const pl = this.pl[o]; pk.cards.forEach((c) => pl.discard.push(c)); pk.energy.forEach((c) => pl.discard.push(c)); if (pk.tool) pl.discard.push(pk.tool); }
  switchActive(p, pk) { const pl = this.pl[p]; const old = pl.active; pl.bench = pl.bench.filter((x) => x !== pk); pl.bench.push(old); pl.active = pk; old.cond = {}; this.ev('switch', { p, pid: pk.pid }); }
  async promote(p) {
    const pl = this.pl[p]; if (pl.active || !pl.bench.length) return;
    const [pk] = await this.pickPK(p, pl.bench, { title: 'Choose your new Active Pokémon', purpose: 'promote' });
    pl.bench = pl.bench.filter((x) => x !== pk); pl.active = pk; this.ev('promote', { p, pid: pk.pid }); this.log(`${pl.name} promotes ${this.dOf(pk).name}.`);
  }

  // ---------------------------------------------------------------- damage & KO
  async flip() { const h = this.rnd() < 0.5; this.ev('coin', { heads: h }); this.log(h ? 'Coin flip: heads!' : 'Coin flip: tails.'); await this.sync(); return h; }
  preventedOnBench(pk) {
    const o = this.ownerOf(pk); if (this.pl[o].active === pk) return false;
    if (this.dOf(pk).name === 'Charizard ex') return true;                        // Tera
    return this.inPlay(o).some((x) => this.dOf(x).name === 'Manaphy');            // Wave Veil
  }
  async damage(src, tgt, base, { noWR = false, ignoreFx = false, source = null } = {}) {
    const o = this.ownerOf(tgt); let d = base; let weak = false;
    if (src && base > 0 && this.ownerOf(src) !== o && this.pl[o].active === tgt) d += this.atkBonus(src, tgt);
    if (this.pl[o].active === tgt) {
      if (!noWR && src) {
        const dd = this.dOf(tgt), types = this.pkTypes(src);
        if ((dd.weak || []).some((w) => types.includes(w))) { d *= 2; weak = true; }
        if ((dd.resist || []).some((w) => types.includes(w))) d -= 30;
      }
    } else if (!ignoreFx && this.preventedOnBench(tgt)) d = 0;
    if (!ignoreFx && src && this.ownerOf(src) !== o && this.safeguarded(src, tgt)) d = 0;
    d = Math.max(0, d); tgt.dmg += d;
    this.ev('damage', { p: o, pid: tgt.pid, amount: d, weak, uid: this.top(tgt).uid });
    if (d > 0) this.log(`${this.dOf(tgt).name} takes ${d} damage${weak ? ' (weakness!)' : ''}.`);
    if (source) source.lastDamaged = (source.lastDamaged || []).concat(tgt);
    return d;
  }
  atkBonus(src, tgt) {
    const p = this.ownerOf(src), me = this.pl[p], opp = this.pl[1 - p]; let b = 0;
    if (this.dOf(tgt).suffix === 'ex') { b += me.flags.bb || 0; if (src.tool && D(src.tool.id).name === 'Maximum Belt') b += 50; }
    if (src.tool && D(src.tool.id).name === 'Defiance Band' && me.prizes.length > opp.prizes.length) b += 30;
    return b;
  }
  safeguarded(src, tgt) {
    const tn = this.dOf(tgt).name, sd = this.dOf(src);
    if (tn === 'Mimikyu' && ['ex', 'V', 'VSTAR', 'VMAX'].includes(sd.suffix)) return true;
    if (tn === 'Cornerstone Mask Ogerpon ex' && (sd.abilities || []).length > 0) return true;
    return false;
  }
  energyPool(pk) {
    const o = this.ownerOf(pk), d = this.dOf(pk); const pool = [];
    for (const en of pk.energy) {
      if (D(en.id).name === 'Reversal Energy') { if (this.pl[o].prizes.length > this.pl[1 - o].prizes.length && d.stage !== 'Basic' && !d.suffix) pool.push('*', '*', '*'); else pool.push('Colorless'); }
      else pool.push(...provides(en));
    }
    return pool;
  }
  attacksOf(pk) { const a = [...this.dOf(pk).attacks]; if (pk.tool && D(pk.tool.id).name === 'Technical Machine: Evolution') a.push({ ...D(pk.tool.id).attacks[0], fromTool: true }); return a; }
  fxAttack(pk, atk) { const src = atk.fromTool ? fxOf(pk.tool.id) : fxOf(this.top(pk).id); return ((src || {}).attacks || {})[atk.name] || {}; }
  async counters(tgt, n) { const o = this.ownerOf(tgt); tgt.dmg += 10 * n; this.ev('damage', { p: o, pid: tgt.pid, amount: 10 * n, counters: true, uid: this.top(tgt).uid }); this.log(`${n} damage counter${n > 1 ? 's' : ''} placed on ${this.dOf(tgt).name}.`); }
  heal(pk, n) { const h = Math.min(n, pk.dmg); pk.dmg -= h; if (h) this.ev('heal', { pid: pk.pid, amount: h, p: this.ownerOf(pk), uid: this.top(pk).uid }); }
  async checkKOs(extraPrize = 0, byDamage = true) {
    for (let guard = 0; guard < 12; guard++) {
      const dead = this.allPK().filter((pk) => pk.dmg >= this.maxHp(pk)); if (!dead.length) break;
      for (const pk of dead) await this.ko(pk, extraPrize);
      extraPrize = 0;
      if (this.winner) return;
    }
    for (const p of [0, 1]) if (!this.winner && !this.pl[p].active) { if (!this.pl[p].bench.length) { this.win(1 - p, 'No Pokémon left in play'); return; } await this.promote(p); }
  }
  async ko(pk, extra = 0) {
    const o = this.ownerOf(pk), pl = this.pl[o], d = this.dOf(pk), t = this.top(pk);
    this.log(`${d.name} is Knocked Out!`);
    this.ev('ko', { p: o, pid: pk.pid, uid: t.uid, id: t.id, types: d.types });
    if (pl.active === pk) pl.active = null; else pl.bench = pl.bench.filter((x) => x !== pk);
    this.discardPK(pk); this.koOnTurn[o] = this.turnNo;
    const n = prizeValue(d) + extra; const taker = 1 - o, tp = this.pl[taker];
    let got = 0; for (let i = 0; i < n && tp.prizes.length; i++) { tp.hand.push(tp.prizes.pop()); got++; }
    if (got) { this.ev('prize', { p: taker, n: got }); this.log(`${tp.name} takes ${got} Prize card${got > 1 ? 's' : ''}.`); }
    await this.sync();
    if (!tp.prizes.length) this.win(taker, 'Took all Prize cards');
    else if (!this.inPlay(o).length) this.win(taker, 'No Pokémon left in play');
  }
  win(p, reason) { if (this.winner !== null) return; this.winner = p; this.reason = reason; this.log(`${this.pl[p].name} wins! (${reason})`); this.ev('win', { p, reason }); }

  // ---------------------------------------------------------------- setup
  async run() {
    try { await this.setup(); while (this.winner === null) { if (this.turnNo >= this.maxTurns) { this.win(this.pl[0].prizes.length <= this.pl[1].prizes.length ? 0 : 1, 'Turn limit'); break; } await this.turn(); } }
    finally { await this.sync(); }
    return this.winner;
  }
  async setup() {
    for (const p of [0, 1]) { const pl = this.pl[p]; pl.deck = this.shuffle(this.decks[p].map((id) => this.inst(id))); this.draw(p, 7); }
    const mull = [0, 0];
    for (const p of [0, 1]) { const pl = this.pl[p]; while (!pl.hand.some(isBasicPoke)) { mull[p]++; this.log(`${pl.name} has no Basic Pokémon: mulligan.`); pl.deck.push(...pl.hand); pl.hand = []; this.shuffle(pl.deck); this.draw(p, 7); } }
    if (mull[0] !== mull[1]) { const p = mull[0] < mull[1] ? 0 : 1; this.draw(p, Math.abs(mull[0] - mull[1])); this.log(`${this.pl[p].name} draws ${Math.abs(mull[0] - mull[1])} extra card(s) from the mulligan.`); }
    await this.sync();
    const picks = await Promise.all([0, 1].map((p) => this.ask(p, { kind: 'setup', basics: this.pl[p].hand.filter(isBasicPoke).map((c) => ({ key: c.uid, id: c.id })) })));
    for (const p of [0, 1]) {
      const pl = this.pl[p]; const basics = pl.hand.filter(isBasicPoke); const pk = picks[p] || {};
      let act = basics.find((c) => c.uid === pk.active) || basics[0];
      pl.hand = pl.hand.filter((c) => c !== act); pl.active = this.newPK(act);
      for (const u of (pk.bench || []).slice(0, 5)) { const c = pl.hand.find((x) => x.uid === u && isBasicPoke(x)); if (c) { pl.hand = pl.hand.filter((x) => x !== c); pl.bench.push(this.newPK(c)); } }
      for (let i = 0; i < 6; i++) pl.prizes.push(pl.deck.pop());
    }
    this.ev('setup'); this.log('Prize cards are set. Time to flip a coin!');
    const winner = this.rnd() < 0.5 ? 0 : 1; this.ev('coinfirst', { p: winner }); this.log(`${this.pl[winner].name} wins the coin flip.`);
    await this.sync();
    const [choice] = await this.select(winner, { title: 'You won the coin flip!', options: [{ key: 'first', text: 'Go first' }, { key: 'second', text: 'Go second' }], purpose: 'first' });
    this.cur = choice === 'second' ? 1 - winner : winner; this.log(`${this.pl[this.cur].name} goes first.`);
    await this.sync();
  }

  // ---------------------------------------------------------------- turn
  async turn() {
    const p = this.cur, me = this.pl[p]; this.turnNo++; me.turns++;
    me.sup = me.en = me.ret = me.stad = false; me.flags = {};
    this.inPlay(p).forEach((pk) => { pk.used = {}; });
    this.ev('turn', { p, turnNo: this.turnNo }); this.log(`— ${me.name}'s turn —`);
    if (!me.deck.length) { this.win(1 - p, 'Deck out'); return; }
    this.draw(p, 1); await this.sync();
    for (let n = 0; n < 80 && this.winner === null; n++) {
      const legal = this.legal(p);
      const ans = await this.ask(p, { kind: 'main', legal });
      const a = legal[ans && ans.i];
      if (!a) continue;
      if (a.t === 'end') break;
      const ended = await this.perform(p, a);
      if (!this.winner) await this.checkKOs();
      await this.sync();
      if (ended) break;
    }
    for (const pk of this.inPlay(p)) if (pk.tool && D(pk.tool.id).name === 'Technical Machine: Evolution') { me.discard.push(pk.tool); pk.tool = null; }
    if (this.winner === null) await this.checkup(p);
    this.cur = 1 - p; await this.sync();
  }

  stadiumName() { return this.stadium ? D(this.stadium.id).name : null; }
  retreatCost(pk) {
    let c = this.dOf(pk).retreat || 0;
    if (pk.tool && D(pk.tool.id).name === 'Rescue Board') { c = Math.max(0, c - 1); if (this.remainingHp(pk) <= 30) c = 0; }
    return c;
  }
  attackCost(pk, atk) {
    const p = this.ownerOf(pk); const name = this.dOf(pk).name;
    if (name === 'Cramorant' && this.lostCount(p) >= 4) return [];
    let cost = [...(atk.cost || [])];
    if (name === 'Bloodmoon Ursaluna ex' && atk.name === 'Blood Moon') { const n = 6 - this.pl[1 - p].prizes.length; for (let i = 0; i < n; i++) { const k = cost.indexOf('Colorless'); if (k >= 0) cost.splice(k, 1); } }
    if (name === 'Drapion V') { const n = this.inPlay(1 - p).filter((x) => ['Fusion Strike', 'Battle Styles'].includes(D(this.top(x).id).set)).length; for (let i = 0; i < n; i++) { const k = cost.indexOf('Colorless'); if (k >= 0) cost.splice(k, 1); } }
    return cost;
  }
  legal(p) {
    const me = this.pl[p], opp = this.pl[1 - p], L = []; const firstTurnEver = this.turnNo === 1;
    const targets = this.inPlay(p);
    for (const c of me.hand) {
      const d = D(c.id);
      if (d.cat === 'Pokemon') {
        if (d.stage === 'Basic') { if (me.bench.length < 5) L.push({ t: 'bench', card: c.uid, label: `Bench ${d.name}` }); }
        else if (d.evolveFrom && me.turns > 1) for (const pk of targets) if (this.dOf(pk).name === d.evolveFrom && pk.since < this.turnNo && pk.evolvedTurn !== this.turnNo) L.push({ t: 'evolve', card: c.uid, target: pk.pid, label: `Evolve ${this.dOf(pk).name}` });
      } else if (d.cat === 'Energy') {
        if (!me.en) for (const pk of targets) L.push({ t: 'attach', card: c.uid, target: pk.pid, label: `Attach to ${this.dOf(pk).name}` });
      } else if (d.trainerType === 'Tool') {
        for (const pk of targets) if (!pk.tool) L.push({ t: 'tool', card: c.uid, target: pk.pid, label: `Attach to ${this.dOf(pk).name}` });
      } else {
        const fx = fxOf(c.id) || {}; let ok = true;
        if (d.trainerType === 'Supporter' && (me.sup || firstTurnEver)) ok = false;
        if (d.trainerType === 'Stadium' && (me.stad || this.stadiumName() === d.name)) ok = false;
        if (d.trainerType === 'Item' && this.itemLock[p] === this.turnNo) ok = false;
        if (ok && fx.can && !fx.can(this, p, c)) ok = false;
        if (ok) L.push({ t: 'trainer', card: c.uid, label: `Play ${d.name}` });
      }
    }
    if (me.active && !me.ret && me.bench.length && !me.active.cond.asleep && !me.active.cond.paralyzed) {
      const cost = this.retreatCost(me.active);
      if (me.active.energy.length >= cost && canPay(Array(cost).fill('Colorless'), this.energyPool(me.active))) for (const b of me.bench) L.push({ t: 'retreat', target: b.pid, label: `Retreat to ${this.dOf(b).name}` });
    }
    for (const pk of targets) {
      const fxs = fxOf(this.top(pk).id); if (!fxs || !fxs.abilities) continue;
      for (const name in fxs.abilities) { const ab = fxs.abilities[name]; if (!pk.used[name] && (!ab.can || ab.can(this, p, pk))) L.push({ t: 'ability', pid: pk.pid, name, label: `Ability: ${name}` }); }
    }
    if (this.stadium && fxOf(this.stadium.id) && fxOf(this.stadium.id).stadium && !me.flags.stad && fxOf(this.stadium.id).stadium.can(this, p)) L.push({ t: 'stadium', label: `Use ${D(this.stadium.id).name}` });
    const a = me.active;
    if (a && !firstTurnEver && !a.cond.asleep && !a.cond.paralyzed && a.noAttackOn !== this.turnNo) {
      this.attacksOf(a).forEach((atk, i) => { const fx = this.fxAttack(a, atk); if (canPay(this.attackCost(a, atk), this.energyPool(a)) && (!fx.can || fx.can(this, p, a))) L.push({ t: 'attack', idx: i, label: `Attack: ${atk.name}` }); });
    }
    L.push({ t: 'end', label: 'End turn' });
    return L;
  }

  async perform(p, a) {
    const me = this.pl[p], opp = this.pl[1 - p];
    const card = a.card ? me.hand.find((c) => c.uid === a.card) : null; const pk = a.target ? this.findPK(a.target) : null;
    switch (a.t) {
      case 'bench': this.removeFrom(me.hand, card); this.benchCard(p, card); this.log(`${me.name} benches ${D(card.id).name}.`); break;
      case 'evolve': await this.evolve(p, card, pk); break;
      case 'attach': {
        this.removeFrom(me.hand, card); me.en = true; await this.attachEnergy(p, card, pk); this.log(`${me.name} attaches ${D(card.id).name} to ${this.dOf(pk).name}.`);
        if (D(card.id).name === 'Jet Energy' && me.active !== pk) { this.switchActive(p, pk); this.log('Jet Energy swaps it into the Active Spot!'); }
        break; }
      case 'tool': this.removeFrom(me.hand, card); pk.tool = card; this.ev('tool', { p, pid: pk.pid, uid: card.uid, id: card.id }); this.log(`${me.name} attaches ${D(card.id).name}.`); break;
      case 'trainer': return this.playTrainer(p, card);
      case 'retreat': await this.doRetreat(p, pk); break;
      case 'ability': { const x = this.findPK(a.pid); x.used[a.name] = true; this.ev('ability', { p, pid: x.pid, name: a.name, uid: this.top(x).uid }); this.log(`${me.name} uses ${a.name}.`); await this.sync(); await fxOf(this.top(x).id).abilities[a.name].run(this, p, x); break; }
      case 'stadium': me.flags.stad = true; this.ev('ability', { p, name: D(this.stadium.id).name, uid: this.stadium.uid }); await fxOf(this.stadium.id).stadium.run(this, p); break;
      case 'attack': await this.attack(p, a.idx); return true;
    }
    return false;
  }
  async evolve(p, card, pk) {
    const me = this.pl[p]; this.removeFrom(me.hand, card); pk.cards.push(card); pk.evolvedTurn = this.turnNo; pk.cond = {};
    this.ev('evolve', { p, pid: pk.pid, uid: card.uid, id: card.id }); this.log(`${me.name} evolves into ${D(card.id).name}!`);
    await this.sync();
    const fx = fxOf(card.id); if (fx && fx.onEvolve) await fx.onEvolve(this, p, pk);
  }
  async doRetreat(p, to) {
    const me = this.pl[p], pk = me.active, cost = this.retreatCost(pk);
    let paid = [];
    if (cost > 0) { const ids = pk.energy; paid = ids.length === cost ? [...ids] : await this.pickCards(p, ids, { title: `Discard ${cost} Energy to retreat`, min: cost, max: cost, purpose: 'discard-energy' }); }
    paid.forEach((e) => { this.removeFrom(pk.energy, e); me.discard.push(e); });
    me.ret = true; this.switchActive(p, to); this.log(`${me.name} retreats.`);
  }
  async playTrainer(p, card) {
    const me = this.pl[p], d = D(card.id), fx = fxOf(card.id) || {};
    this.removeFrom(me.hand, card);
    this.ev('trainer', { p, uid: card.uid, id: card.id, kind: d.trainerType }); this.log(`${me.name} plays ${d.name}.`);
    if (d.trainerType === 'Supporter') me.sup = true;
    if (d.trainerType === 'Stadium') {
      if (this.stadium) this.pl[this.stadiumOwner].discard.push(this.stadium);
      this.stadium = card; this.stadiumOwner = p; me.stad = true; this.ev('stadium', { p, uid: card.uid, id: card.id }); return false;
    }
    await this.sync();
    me.discard.push(card);       // goes to discard first so effects like Ultra Ball can't re-pick it
    if (fx.play) await fx.play(this, p, card);
    return false;
  }
  async attack(p, idx) {
    const me = this.pl[p], opp = this.pl[1 - p], pk = me.active, d = this.dOf(pk), atk = this.attacksOf(pk)[idx];
    const fx = this.fxAttack(pk, atk);
    this.ev('attack', { p, pid: pk.pid, name: atk.name, types: d.types, uid: this.top(pk).uid, dmg: parseInt(atk.damage) || 0 }); this.log(`${me.name}'s ${d.name} uses ${atk.name}!`);
    await this.sync();
    if (pk.cond.confused) { const h = await this.flip(); if (!h) { await this.counters(pk, 3); this.log('Confused! The attack failed.'); return; } }
    const defender = opp.active; const ctx = { p, me, opp, pk, atk, defender, extraPrize: 0, g: this };
    if (fx.run) await fx.run(this, ctx);
    else {
      let base = parseInt(atk.damage) || 0; if (fx.calc) base = fx.calc(this, ctx);
      if (base > 0 && defender) { const before = defender.dmg; await this.damage(pk, defender, base, { noWR: fx.noWR, ignoreFx: fx.ignoreFx }); ctx.dealt = defender.dmg - before; }
      if (fx.after) await fx.after(this, ctx);
    }
    await this.sync();
    await this.checkKOs(ctx.extraPrize && defender && defender.dmg >= this.maxHp(defender) ? ctx.extraPrize : 0);
  }
  async checkup(justP) {
    this.ev('checkup');
    for (const p of [justP, 1 - justP]) {
      const pk = this.pl[p].active; if (!pk) continue;
      if (pk.cond.poisoned) { await this.counters(pk, 1); this.log(`${this.dOf(pk).name} is hurt by poison.`); }
      if (pk.cond.burned) { await this.counters(pk, 2); if (await this.flip()) delete pk.cond.burned; }
      if (pk.cond.asleep && (await this.flip())) delete pk.cond.asleep;
      if (pk.cond.paralyzed && p === justP && pk.cond.paralyzed < this.turnNo) delete pk.cond.paralyzed;
    }
    await this.checkKOs(); await this.sync();
  }
  setCondition(pk, c) { if (['asleep', 'paralyzed', 'confused'].includes(c)) { delete pk.cond.asleep; delete pk.cond.paralyzed; delete pk.cond.confused; } pk.cond[c] = c === 'paralyzed' ? this.turnNo : true; this.ev('status', { pid: pk.pid, cond: c }); }
}

// ---------------------------------------------------------------- deck helpers
export function expandDeck(list) { const out = []; for (const [id, n] of list) for (let i = 0; i < n; i++) out.push(id); return out; }
