// A simple but sensible bot. It only sees what a human sees (its own view + legal actions).
import { D, provides } from './engine.js';

function missing(cost0, energies) {
  const cost = cost0 || []; const pool = energies.flatMap(provides); let m = 0, colorless = 0;
  for (const t of cost) { if (t === 'Colorless') { colorless++; continue; } const k = pool.indexOf(t); if (k >= 0) { pool.splice(k, 1); m++; } }
  return cost.length - m - Math.min(colorless, pool.length);
}
const bestMissing = (pk, extra) => Math.min(...D(pk.id).attacks.map((a) => missing(a.cost, [...pk.energy, ...(extra ? [{ id: extra }] : [])])), 9);

const TRAINER_SCORE = { "Professor's Research": 66, "Colress's Experiment": 70, 'Arven': 68, 'Iono': 22, 'Roxanne': 72, "Boss's Orders": 38, 'Nest Ball': 62, 'Buddy-Buddy Poffin': 62,
  'Ultra Ball': 52, 'Rare Candy': 88, 'Super Rod': 30, 'Pokégear 3.0': 58, 'Electric Generator': 64, 'Mirage Gate': 66, 'Switch': 8, 'Switch Cart': 8, 'Prime Catcher': 36, 'Artazon': 50, 'Rescue Board': 25,
  "Black Belt's Training": 54, 'Crispin': 66, "Lana's Aid": 34, 'Night Stretcher': 34, 'Earthen Vessel': 56, 'Counter Catcher': 36, 'Technical Machine: Evolution': 30 };
const PRIO = ['Haxorus', 'Bloodmoon Ursaluna ex', 'Cornerstone Mask Ogerpon ex', 'Fraxure', 'Giratina VSTAR', 'Charizard ex', 'Pidgeot ex', 'Miraidon ex', 'Giratina V', 'Iron Hands ex', 'Rare Candy', 'Raikou V'];

export class Bot {
  constructor({ delay = 0, level = 'normal' } = {}) { this.delay = delay; this.level = level; }
  update() {}
  async ask(req, view, p) {
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    switch (req.kind) {
      case 'main': return this.main(req, view, p);
      case 'setup': return this.setup(req, view, p);
      case 'select': return this.select(req, view, p);
    }
    return null;
  }
  me(v) { return v.pl[v.me]; }
  name(id) { return D(id).name; }
  pkById(v, pid) { return [...v.pl[0].bench, v.pl[0].active, ...v.pl[1].bench, v.pl[1].active].filter(Boolean).find((x) => x.pid === pid); }
  rem(pk) { return pk.hp - pk.dmg; }

  setup(req, v) {
    const basics = req.basics.slice().sort((a, b) => D(a.id).hp - D(b.id).hp);
    const active = (basics.find((b) => ['Comfey', 'Charmander', 'Pidgey', 'Raikou V'].includes(D(b.id).name)) || basics[0]).key;
    const bench = basics.filter((b) => b.key !== active).slice(0, 3).map((b) => b.key);
    return { active, bench };
  }
  main(req, v) {
    const L = req.legal, me = this.me(v);
    const canAttack = L.some((a) => a.t === 'attack');
    const handCard = (uid) => me.hand.find((c) => c.uid === uid);
    if (this.level === 'easy' && Math.random() < 0.3) { const pool = L.map((a, i) => i).filter((i) => L[i].t !== 'end'); if (pool.length) return { i: pool[Math.floor(Math.random() * pool.length)] }; }
    let best = -1, bi = L.length - 1, bestAtk = null, atkScore = 0;
    L.forEach((a, i) => {
      let s = 0; const c = a.card ? handCard(a.card) : null; const nm = c ? D(c.id).name : '';
      switch (a.t) {
        case 'bench': s = me.bench.length < 2 ? 56 : me.bench.length < 4 ? 40 : 12; break;
        case 'evolve': s = 86; break;
        case 'attach': { const pk = this.pkById(v, a.target); const isActive = me.active && me.active.pid === pk.pid;
          const before = bestMissing(pk), after = bestMissing(pk, c.id); const gain = before - after;
          s = (gain > 0 ? 48 + gain * 14 : 22) + (isActive ? 5 : 0) + (before === 0 ? -20 : 0) + (D(pk.id).hp > 150 ? 3 : 0) - pk.energy.length; break; }
        case 'tool': s = 20; break;
        case 'trainer': s = TRAINER_SCORE[nm] ?? 30;
          if (nm === "Professor's Research" && me.hand.length > 4) s = 0;
          if (nm === 'Ultra Ball' && me.hand.length < 5) s = 0;
          if (['Switch', 'Switch Cart'].includes(nm)) s = !canAttack && me.bench.length ? 45 : 0;
          if (nm === 'Prime Catcher') s = 40;
          break;
        case 'ability': s = 78; break;
        case 'stadium': s = 52; break;
        case 'retreat': { const t = this.pkById(v, a.target); s = !canAttack && bestMissing(t) === 0 ? 60 : 0; break; }
        case 'attack': { const atk = D(me.active.id).attacks[a.idx]; if (!atk) { s = 75; break; } const oa = v.pl[1 - v.me].active; s = -100 - (parseInt(atk.damage) || 0) / 10 - (atk.name === 'Star Requiem' ? 80 : 0) - (atk.name === 'Axe Blast' && oa && D(oa.id).stage === 'Basic' ? 90 : 0) - (atk.name === 'Gather Strength' || atk.name === 'Itchy Pollen' ? 1 : 0); break; }
        case 'end': s = 1; break;
      }
      if (a.t === 'attack') { if (-s > atkScore) { atkScore = -s; bestAtk = i; } return; }
      if (s > best) { best = s; bi = i; }
    });
    if (best < 20 && bestAtk !== null) return { i: bestAtk };
    return { i: bi };
  }
  cardScore(id, v) {
    const d = D(id), me = this.me(v); let s = 10;
    const k = PRIO.indexOf(d.name); if (k >= 0) s += 60 - k * 3;
    if (d.cat === 'Energy') s += 18; if (d.cat === 'Pokemon') s += 10 + (d.hp || 0) / 40;
    const have = me.hand.filter((c) => c.id === id).length; s -= have * 8;
    return s;
  }
  select(req, v) {
    const o = req.options, pick = (arr) => arr.slice(0, req.max).map((x) => x.key);
    const me = this.me(v), opp = v.pl[1 - v.me];
    switch (req.purpose) {
      case 'first': return ['first'];
      case 'promote': return [o.slice().sort((a, b) => { const x = this.pkById(v, a.pid), y = this.pkById(v, b.pid); return (y.energy.length * 30 + this.rem(y)) - (x.energy.length * 30 + this.rem(x)); })[0].key];
      case 'target-opp': case 'gust': return [o.slice().sort((a, b) => this.rem(this.pkById(v, a.pid)) - this.rem(this.pkById(v, b.pid)))[0].key].concat(req.max > 1 ? o.slice().sort((a, b) => this.rem(this.pkById(v, a.pid)) - this.rem(this.pkById(v, b.pid))).slice(1, req.max).map((x) => x.key) : []);
      case 'target-own-bad': return [o.slice().sort((a, b) => this.rem(this.pkById(v, b.pid)) - this.rem(this.pkById(v, a.pid)))[0].key];
      case 'attach-target': return [o.slice().sort((a, b) => { const x = this.pkById(v, a.pid), y = this.pkById(v, b.pid); const f = (pk) => pk.hp / 10 + (me.active && me.active.pid === pk.pid ? 6 : 0) - pk.energy.length * 4; return f(y) - f(x); })[0].key];
      case 'switch': return [o.slice().sort((a, b) => this.pkById(v, b.pid).energy.length - this.pkById(v, a.pid).energy.length)[0].key];
      case 'counters-n': return [o[o.length - 1].key];
      case 'yesno-discard-stadium': return ['yes'];
      case 'discard': case 'discard-energy': return o.slice().sort((a, b) => this.cardScore(a.id, v) - this.cardScore(b.id, v)).slice(0, req.min).map((x) => x.key);
      default: {
        const sorted = o.slice().sort((a, b) => (a.id ? this.cardScore(b.id, v) - this.cardScore(a.id, v) : 0));
        return sorted.slice(0, Math.max(req.min, Math.min(req.max, sorted.length))).map((x) => x.key);
      }
    }
  }
}
