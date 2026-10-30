// Card effects. Each entry is keyed by the card's TCGdex id. Texts come from the printed cards.
import { D, allDefs, isBasicPoke, isPokemon, isEnergy, isBasicEnergy, energyType, hasRuleBox } from './engine.js';

const isLightning = (c) => (D(c.id).types || []).includes('Lightning');

/** look at the top n cards, put `take` into hand, the rest go to the Lost Zone (or discard) */
async function lookTake(g, p, n, take, { lost = true, title }) {
  const cards = g.topCards(p, n); if (!cards.length) return;
  g.ev('look', { p, n: cards.length });
  const keep = await g.pickCards(p, cards, { title, min: Math.min(take, cards.length), max: take, purpose: 'keep', zone: 'deck' });
  keep.forEach((c) => g.pl[p].hand.push(c));
  cards.filter((c) => !keep.includes(c)).forEach((c) => (lost ? g.toLost(p, c) : g.toDiscard(p, c)));
  g.log(`${g.pl[p].name} puts ${cards.length - keep.length} card(s) in the Lost Zone.`);
}
async function benchSearch(g, p, { filter, max, title }) {
  const room = 5 - g.pl[p].bench.length; if (room <= 0) return;
  const got = await g.searchDeck(p, { title, filter, max: Math.min(max, room), purpose: 'search-basic' });
  got.forEach((c) => g.benchCard(p, c));
}
const benchRoom = (g, p) => g.pl[p].bench.length < 5;
const deckHas = (g, p, f) => g.pl[p].deck.some(f);
async function gust(g, p, who) { // switch in an opposing Benched Pokémon
  const opp = g.pl[1 - p]; const [pk] = await g.pickPK(p, opp.bench, { title: 'Choose a Benched Pokémon to switch in', purpose: 'gust' }); g.switchActive(1 - p, pk);
}
async function attachFrom(g, p, energies, pool, title) {
  for (const e of energies) { const [pk] = await g.pickPK(p, pool(), { title: `${title}: ${D(e.id).name}`, purpose: 'attach-target' }); await g.attachEnergy(p, e, pk, { from: 'deck' }); }
}
const pickOppTarget = (g, p, title) => g.pickPK(p, g.inPlay(1 - p), { title, purpose: 'target-opp' });

export const FX = {
  // ===================================================================== LOST ZONE DECK
  'swsh11-079': { // Comfey
    abilities: { 'Flower Selecting': { can: (g, p, pk) => g.pl[p].active === pk && g.pl[p].deck.length > 0, run: (g, p) => lookTake(g, p, 2, 1, { title: 'Put 1 card in your hand — the other goes to the Lost Zone' }) } },
  },
  'swsh11-050': { attacks: { 'Spit Innocently': { noWR: true } } }, // Cramorant (cost handled by engine)
  'swsh11-070': { // Sableye
    attacks: { 'Lost Mine': {
      can: (g, p) => g.lostCount(p) >= 10,
      run: async (g, c) => {
        let left = 12;
        while (left > 0) {
          const pool = g.inPlay(1 - c.p); if (!pool.length) break;
          const [t] = await g.pickPK(c.p, pool, { title: `Lost Mine: choose a Pokémon (${left} counters left)`, purpose: 'target-opp' });
          const opts = []; for (let i = 1; i <= left; i++) opts.push({ key: i, text: `${i} counter${i > 1 ? 's' : ''} (${i * 10})` });
          const [n] = await g.select(c.p, { title: `How many damage counters on ${D(g.top(t).id).name}?`, options: opts, purpose: 'counters-n' });
          await g.counters(t, n); left -= n; await g.sync();
        }
      } } },
  },
  'swsh10-046': { // Radiant Greninja
    abilities: { 'Concealed Cards': { can: (g, p) => g.pl[p].hand.some(isEnergy) && g.pl[p].deck.length > 0, run: async (g, p) => {
      const [e] = await g.pickCards(p, g.pl[p].hand.filter(isEnergy), { title: 'Discard an Energy card to draw 2', purpose: 'discard' });
      g.removeFrom(g.pl[p].hand, e); g.toDiscard(p, e); g.draw(p, 2); } } },
    attacks: { 'Moonlight Shuriken': { run: async (g, c) => {
      const es = c.pk.energy; const out = es.length <= 2 ? [...es] : await g.pickCards(c.p, es, { title: 'Discard 2 Energy from Radiant Greninja', min: 2, max: 2, purpose: 'discard-energy' });
      out.forEach((e) => { g.removeFrom(c.pk.energy, e); g.toDiscard(c.p, e); });
      const pool = g.inPlay(1 - c.p); const ts = await g.pickPK(c.p, pool, { title: 'Choose 2 of your opponent\'s Pokémon (90 damage each)', min: Math.min(2, pool.length), max: 2, purpose: 'target-opp' });
      for (const t of ts) await g.damage(c.pk, t, 90);
    } } },
  },
  'sv06.5-038': { // Fezandipiti ex
    abilities: { 'Flip the Script': { can: (g, p) => g.koOnTurn[p] === g.turnNo - 1 && !g.pl[p].flags.flip && g.pl[p].deck.length > 0, run: (g, p) => { g.pl[p].flags.flip = true; g.draw(p, 3); } } },
    attacks: { 'Cruel Arrow': { run: async (g, c) => { const [t] = await pickOppTarget(g, c.p, 'Cruel Arrow: choose a target (100 damage)'); await g.damage(c.pk, t, 100); } } },
  },
  'swsh11-118': { // Drapion V
    attacks: { 'Dynamic Tail': { run: async (g, c) => {
      if (c.defender) await g.damage(c.pk, c.defender, 190);
      const [t] = await g.pickPK(c.p, g.inPlay(c.p), { title: 'Dynamic Tail: choose one of YOUR Pokémon to take 60 damage', purpose: 'target-own-bad' });
      await g.damage(c.pk, t, 60); } } },
  },
  'swsh11-130': { // Giratina V
    attacks: { 'Abyss Seeking': { run: (g, c) => lookTake(g, c.p, 4, 2, { title: 'Abyss Seeking: put 2 in your hand — the rest go to the Lost Zone' }) }, 'Shred': { ignoreFx: true } },
  },
  'swsh11-131': { // Giratina VSTAR
    attacks: {
      'Lost Impact': { run: async (g, c) => {
        if (c.defender) await g.damage(c.pk, c.defender, 280);
        const all = g.inPlay(c.p).flatMap((pk) => pk.energy.map((e) => ({ e, pk })));
        if (!all.length) return;
        const keys = await g.select(c.p, { title: 'Lost Impact: put 2 attached Energy in the Lost Zone', options: all.map((x) => ({ key: x.e.uid, id: x.e.id })), min: Math.min(2, all.length), max: 2, purpose: 'discard-energy' });
        for (const k of keys) { const x = all.find((y) => y.e.uid === k); g.removeFrom(x.pk.energy, x.e); g.toLost(c.p, x.e, 'play'); }
      } },
      'Star Requiem': { can: (g, p) => g.lostCount(p) >= 10 && !g.pl[p].vstar, run: async (g, c) => {
        g.pl[c.p].vstar = true; g.ev('vstar', { p: c.p }); g.log('VSTAR Power: Star Requiem!');
        if (c.defender) { c.defender.dmg = Math.max(c.defender.dmg, g.maxHp(c.defender)); g.ev('damage', { p: 1 - c.p, pid: c.defender.pid, amount: 999, uid: g.top(c.defender).uid, ko: true }); }
      } },
    },
  },
  'swsh11-155': { play: (g, p) => lookTake(g, p, 5, 3, { title: 'Colress\'s Experiment: take 3 — the rest go to the Lost Zone' }) },
  'sv04.5-084': { can: (g, p) => benchRoom(g, p) && deckHas(g, p, isBasicPoke), play: (g, p) => benchSearch(g, p, { title: 'Nest Ball: choose a Basic Pokémon', filter: isBasicPoke, max: 1 }) },
  'swsh11-163': { // Mirage Gate
    can: (g, p) => g.lostCount(p) >= 7 && deckHas(g, p, isBasicEnergy),
    play: async (g, p) => {
      const pl = g.pl[p]; g.ev('search', { p }); const chosen = [];
      const first = await g.pickCards(p, pl.deck.filter(isBasicEnergy), { title: 'Mirage Gate: choose a basic Energy', min: 0, max: 1, purpose: 'search-energy', zone: 'deck' });
      if (first.length) {
        chosen.push(first[0]);
        const rest = pl.deck.filter((c) => isBasicEnergy(c) && energyType(c) !== energyType(first[0]));
        if (rest.length) chosen.push(...await g.pickCards(p, rest, { title: 'Mirage Gate: choose a different type', min: 0, max: 1, purpose: 'search-energy', zone: 'deck' }));
      }
      chosen.forEach((c) => g.removeFrom(pl.deck, c)); g.shuffle(pl.deck);
      await attachFrom(g, p, chosen, () => g.inPlay(p), 'Mirage Gate');
    },
  },
  'sv08.5-101': { can: (g, p) => benchRoom(g, p) && deckHas(g, p, (c) => isBasicPoke(c) && D(c.id).hp <= 70), play: (g, p) => benchSearch(g, p, { title: 'Buddy-Buddy Poffin: up to 2 Basic Pokémon (70 HP or less)', filter: (c) => isBasicPoke(c) && D(c.id).hp <= 70, max: 2 }) },
  'sv04.5-076': { stadium: { can: (g, p) => benchRoom(g, p) && deckHas(g, p, (c) => isBasicPoke(c) && !hasRuleBox(D(c.id))), run: (g, p) => benchSearch(g, p, { title: 'Artazon: a Basic Pokémon without a Rule Box', filter: (c) => isBasicPoke(c) && !hasRuleBox(D(c.id)), max: 1 }) } },
  'swsh10-154': { can: (g, p) => g.pl[p].active && D(g.top(g.pl[p].active).id).stage === 'Basic' && g.pl[p].bench.length > 0, play: async (g, p) => {
    const old = g.pl[p].active; const [pk] = await g.pickPK(p, g.pl[p].bench, { title: 'Switch Cart: choose a Benched Pokémon', purpose: 'switch' }); g.switchActive(p, pk); g.heal(old, 30); } },
  'sv01-194': { can: (g, p) => g.pl[p].bench.length > 0, play: async (g, p) => { const [pk] = await g.pickPK(p, g.pl[p].bench, { title: 'Switch: choose a Benched Pokémon', purpose: 'switch' }); g.switchActive(p, pk); } },
  'dv1-20': { can: (g, p) => g.pl[p].discard.some((c) => isPokemon(c) || isBasicEnergy(c)), play: async (g, p) => {
    const pl = g.pl[p]; const pool = pl.discard.filter((c) => isPokemon(c) || isBasicEnergy(c)); const n = Math.min(3, pool.length);
    const got = await g.pickCards(p, pool, { title: 'Super Rod: shuffle 3 cards into your deck', min: n, max: 3, purpose: 'recover', zone: 'discard' });
    got.forEach((c) => { g.removeFrom(pl.discard, c); pl.deck.push(c); }); g.shuffle(pl.deck); g.ev('shuffle', { p }); } },
  'me01-114': { can: (g, p) => g.pl[1 - p].bench.length > 0, play: (g, p) => gust(g, p) },
  'swsh10-150': { can: (g, p) => g.pl[1 - p].prizes.length <= 3, play: (g, p) => {
    for (const q of [p, 1 - p]) { const pl = g.pl[q]; pl.deck.push(...pl.hand); pl.hand = []; g.shuffle(pl.deck); g.ev('shuffle', { p: q }); }
    g.draw(p, 6); g.draw(1 - p, 2); } },
  'sv10.5b-084': { can: (g, p) => g.pl[p].deck.length > 0, play: async (g, p) => {
    const pl = g.pl[p]; const top = g.topCards(p, 7); g.ev('look', { p, n: top.length });
    const sups = top.filter((c) => D(c.id).trainerType === 'Supporter'); let got = [];
    if (sups.length) got = await g.pickCards(p, sups, { title: 'Pokégear 3.0: you may take a Supporter', min: 0, max: 1, purpose: 'search', zone: 'deck' });
    got.forEach((c) => pl.hand.push(c)); pl.deck.push(...top.filter((c) => !got.includes(c))); g.shuffle(pl.deck); } },
  'sv08.5-119': { can: (g, p) => g.pl[1 - p].bench.length > 0 && g.pl[p].bench.length > 0, play: async (g, p) => {
    await gust(g, p); const [pk] = await g.pickPK(p, g.pl[p].bench, { title: 'Prime Catcher: switch your Active Pokémon with…', purpose: 'switch' }); g.switchActive(p, pk); } },

  // ===================================================================== CHARIZARD EX DECK
  'sv03.5-004': { attacks: { 'Blazing Destruction': { run: async (g) => { if (g.stadium) { g.pl[g.stadiumOwner].discard.push(g.stadium); g.stadium = null; g.ev('stadium', { p: 0, uid: null }); } } } } },
  'sv03.5-005': { attacks: { 'Fire Blast': { after: async (g, c) => { if (!c.pk.energy.length) return; const [e] = await g.pickCards(c.p, c.pk.energy, { title: 'Discard an Energy from Charmeleon', purpose: 'discard-energy' }); g.removeFrom(c.pk.energy, e); g.toDiscard(c.p, e); } } } },
  'sv03-125': { // Charizard ex
    onEvolve: async (g, p, pk) => {
      const pl = g.pl[p]; const fires = pl.deck.filter((c) => isBasicEnergy(c) && energyType(c) === 'Fire'); if (!fires.length) return;
      g.ev('ability', { p, pid: pk.pid, name: 'Infernal Reign', uid: g.top(pk).uid });
      const got = await g.searchDeck(p, { title: 'Infernal Reign: up to 3 basic Fire Energy', filter: (c) => isBasicEnergy(c) && energyType(c) === 'Fire', max: 3, purpose: 'search-energy' });
      await attachFrom(g, p, got, () => g.inPlay(p), 'Infernal Reign');
    },
    attacks: { 'Burning Darkness': { calc: (g, c) => 180 + 30 * (6 - g.pl[c.p].prizes.length) } },
  },
  'sv03.5-016': { attacks: { 'Call for Family': { run: (g, c) => benchSearch(g, c.p, { title: 'Call for Family: up to 2 Basic Pokémon', filter: isBasicPoke, max: 2 }) } } },
  'sv03-164': { // Pidgeot ex
    abilities: { 'Quick Search': { can: (g, p) => !g.pl[p].flags.qs && g.pl[p].deck.length > 0, run: async (g, p) => {
      g.pl[p].flags.qs = true; const [c] = await g.searchDeck(p, { title: 'Quick Search: choose any card', filter: () => true, max: 1, purpose: 'search-any' }); if (c) g.pl[p].hand.push(c); } } },
    attacks: { 'Blustery Wind': { after: async (g, c) => {
      if (!g.stadium) return; const [k] = await g.select(c.p, { title: 'Discard the Stadium in play?', options: [{ key: 'yes', text: 'Discard it' }, { key: 'no', text: 'Keep it' }], purpose: 'yesno-discard-stadium' });
      if (k === 'yes') { g.pl[g.stadiumOwner].discard.push(g.stadium); g.stadium = null; g.ev('stadium', { p: c.p, uid: null }); } } } },
  },
  'sv01-191': { // Rare Candy
    can: (g, p) => g.pl[p].turns > 1 && rareCandyPairs(g, p).length > 0,
    play: async (g, p) => {
      const pairs = rareCandyPairs(g, p); const [pk] = await g.pickPK(p, [...new Set(pairs.map((x) => x.pk))], { title: 'Rare Candy: choose a Basic Pokémon', purpose: 'attach-target' });
      const cards = pairs.filter((x) => x.pk === pk).map((x) => x.card); const [card] = await g.pickCards(p, cards, { title: 'Choose the Stage 2 Pokémon', purpose: 'evolve' });
      await g.evolve(p, card, pk);
    },
  },
  'sv04.5-091': { can: (g, p) => g.pl[p].hand.length >= 3 && deckHas(g, p, isPokemon), play: async (g, p) => {
    const pl = g.pl[p]; const dis = await g.pickCards(p, pl.hand, { title: 'Ultra Ball: discard 2 other cards', min: 2, max: 2, purpose: 'discard' });
    dis.forEach((c) => { g.removeFrom(pl.hand, c); g.toDiscard(p, c); });
    const [c] = await g.searchDeck(p, { title: 'Ultra Ball: choose a Pokémon', filter: isPokemon, max: 1, purpose: 'search-pokemon' }); if (c) pl.hand.push(c); } },
  'sv01-166': { play: async (g, p) => { // Arven
    const pl = g.pl[p];
    const [i] = await g.searchDeck(p, { title: 'Arven: choose an Item', filter: (c) => D(c.id).trainerType === 'Item', max: 1, purpose: 'search-item' }); if (i) pl.hand.push(i);
    const [t] = await g.searchDeck(p, { title: 'Arven: choose a Pokémon Tool', filter: (c) => D(c.id).trainerType === 'Tool', max: 1, purpose: 'search-tool' }); if (t) pl.hand.push(t); } },
  'sv01-189': { play: (g, p) => { const pl = g.pl[p]; pl.discard.push(...pl.hand); pl.hand = []; g.draw(p, 7); } },
  'sv02-185': { play: (g, p) => { // Iono
    let any = false;
    for (const q of [p, 1 - p]) { const pl = g.pl[q]; if (pl.hand.length) any = true; g.shuffle(pl.hand); pl.deck.unshift(...pl.hand); pl.hand = []; g.ev('shuffle', { p: q }); }
    if (any) for (const q of [p, 1 - p]) g.draw(q, g.pl[q].prizes.length); } },

  // ===================================================================== MIRAIDON EX DECK
  'sv01-081': { // Miraidon ex
    abilities: { 'Tandem Unit': { can: (g, p) => benchRoom(g, p) && deckHas(g, p, (c) => isBasicPoke(c) && isLightning(c)), run: (g, p) => benchSearch(g, p, { title: 'Tandem Unit: up to 2 Basic Lightning Pokémon', filter: (c) => isBasicPoke(c) && isLightning(c), max: 2 }) } },
    attacks: { 'Photon Blaster': { after: (g, c) => { c.pk.noAttackOn = g.turnNo + 2; } } },
  },
  'sv04-070': { attacks: { 'Amp You Very Much': { after: (g, c) => { c.extraPrize = 1; } } } }, // Iron Hands ex
  'swsh9-048': { // Raikou V
    abilities: { 'Fleet-Footed': { can: (g, p, pk) => g.pl[p].active === pk && g.pl[p].deck.length > 0, run: (g, p) => g.draw(p, 1) } },
    attacks: { 'Lightning Rondo': { calc: (g) => 20 + 20 * (g.pl[0].bench.length + g.pl[1].bench.length) } },
  },
  'sv01-170': { // Electric Generator
    can: (g, p) => g.pl[p].bench.some((pk) => (g.dOf(pk).types || []).includes('Lightning')),
    play: async (g, p) => {
      const pl = g.pl[p]; const top = g.topCards(p, 5); g.ev('look', { p, n: top.length });
      const opts = top.filter((c) => isBasicEnergy(c) && energyType(c) === 'Lightning'); let got = [];
      if (opts.length) got = await g.pickCards(p, opts, { title: 'Electric Generator: attach up to 2 Lightning Energy', min: 0, max: 2, purpose: 'search-energy', zone: 'deck' });
      pl.deck.push(...top.filter((c) => !got.includes(c))); g.shuffle(pl.deck);
      await attachFrom(g, p, got, () => pl.bench.filter((pk) => (g.dOf(pk).types || []).includes('Lightning')), 'Electric Generator');
    },
  },
};

function rareCandyPairs(g, p) {
  const out = []; const pl = g.pl[p];
  for (const pk of g.inPlay(p)) {
    const d = g.dOf(pk); if (d.stage !== 'Basic' || pk.since >= g.turnNo) continue;
    for (const c of pl.hand) { const cd = D(c.id); if (cd.stage === 'Stage2' && allDefs().some((x) => x.name === cd.evolveFrom && x.evolveFrom === d.name)) out.push({ pk, card: c }); }
  }
  return out;
}

// ---- name-based aliasing so reprints (same name) share one implementation
const NAME_FX = new Map(); let nameBuilt = false;
export function fxOf(id) {
  if (FX[id]) return FX[id];
  if (!nameBuilt) { nameBuilt = true; for (const k of Object.keys(FX)) { const d = D(k); if (d && !NAME_FX.has(d.name)) NAME_FX.set(d.name, FX[k]); } }
  const d = D(id); return d ? NAME_FX.get(d.name) : undefined;
}

// ===================================================================== HAXORUS DECK
const pickDiscard = (g, p, filter, title, max = 1, zone = 'discard') => g.pickCards(p, g.pl[p].discard.filter(filter), { title, min: Math.min(max, g.pl[p].discard.filter(filter).length), max, purpose: 'recover', zone });
Object.assign(FX, {
  'sv10.5b-068': { attacks: { 'Gather Strength': { run: async (g, c) => { const got = await g.searchDeck(c.p, { title: 'Gather Strength: up to 2 basic Energy', filter: isBasicEnergy, max: 2, purpose: 'search-energy' }); got.forEach((x) => g.pl[c.p].hand.push(x)); } } } },
  'sv10.5b-069': { attacks: { 'Boundless Power': { after: (g, c) => { c.pk.noAttackOn = g.turnNo + 2; } } } },
  'sv10.5b-070': { attacks: {
    'Cross-Cut': { calc: (g, c) => 80 + (c.defender && D(g.top(c.defender).id).stage !== 'Basic' ? 80 : 0) },
    'Axe Blast': { run: async (g, c) => { const d = c.defender; if (d && g.dOf(d).stage === 'Basic') { d.dmg = Math.max(d.dmg, g.maxHp(d)); g.ev('damage', { p: 1 - c.p, pid: d.pid, amount: 999, uid: g.top(d).uid, ko: true }); } else g.log('Axe Blast fizzles: the Defending Pokémon is not a Basic.'); } } } },
  'sv04.5-037': { attacks: { 'Ghost Eye': { run: async (g, c) => { if (c.defender) await g.counters(c.defender, 7); } } } },
  'sv08.5-004': { attacks: { 'Itchy Pollen': { after: (g, c) => { g.itemLock[1 - c.p] = g.turnNo + 1; g.log("They can't play Item cards during their next turn."); } } } },
  'sv08.5-058': { attacks: { 'Demolish': { noWR: true, ignoreFx: true } } },
  'sv06-141': { attacks: { 'Blood Moon': { after: (g, c) => { c.pk.noAttackOn = g.turnNo + 2; } } } },
  'sv04-160': { can: (g, p) => g.pl[p].prizes.length > g.pl[1 - p].prizes.length && g.pl[1 - p].bench.length > 0, play: (g, p) => gust(g, p) },
  'sv06.5-061': { can: (g, p) => g.pl[p].discard.some((c) => isPokemon(c) || isBasicEnergy(c)), play: async (g, p) => { const [c] = await pickDiscard(g, p, (x) => isPokemon(x) || isBasicEnergy(x), 'Night Stretcher: take a Pokémon or basic Energy'); if (c) { g.removeFrom(g.pl[p].discard, c); g.pl[p].hand.push(c); } } },
  'sv08.5-106': { can: (g, p) => g.pl[p].hand.length >= 2, play: async (g, p) => {
    const pl = g.pl[p]; const [d] = await g.pickCards(p, pl.hand, { title: 'Earthen Vessel: discard a card', purpose: 'discard' }); g.removeFrom(pl.hand, d); g.toDiscard(p, d);
    const got = await g.searchDeck(p, { title: 'Earthen Vessel: up to 2 basic Energy', filter: isBasicEnergy, max: 2, purpose: 'search-energy' }); got.forEach((x) => pl.hand.push(x)); } },
  'sv08.5-096': { play: (g, p) => { g.pl[p].flags.bb = (g.pl[p].flags.bb || 0) + 40; g.log('Attacks do 40 more damage to the opposing Active Pokémon ex this turn.'); } },
  'sv07-133': { can: (g, p) => deckHas(g, p, isBasicEnergy), play: async (g, p) => {
    const pl = g.pl[p]; g.ev('search', { p }); const picks = [];
    const a = await g.pickCards(p, pl.deck.filter(isBasicEnergy), { title: 'Crispin: choose a basic Energy', min: 0, max: 1, purpose: 'search-energy', zone: 'deck' });
    if (a.length) { picks.push(a[0]); const rest = pl.deck.filter((x) => isBasicEnergy(x) && energyType(x) !== energyType(a[0])); if (rest.length) picks.push(...await g.pickCards(p, rest, { title: 'Crispin: a different type', min: 0, max: 1, purpose: 'search-energy', zone: 'deck' })); }
    picks.forEach((x) => g.removeFrom(pl.deck, x)); g.shuffle(pl.deck);
    if (picks.length === 2) { const [toHand] = await g.pickCards(p, picks, { title: 'Crispin: which goes to your hand? (the other is attached)', purpose: 'keep' }); const att = picks.find((x) => x !== toHand); pl.hand.push(toHand); const [pk] = await g.pickPK(p, g.inPlay(p), { title: 'Attach to which Pokémon?', purpose: 'attach-target' }); await g.attachEnergy(p, att, pk, { from: 'deck' }); }
    else if (picks.length === 1) pl.hand.push(picks[0]); } },
  'sv06-155': { can: (g, p) => g.pl[p].discard.some((c) => (isPokemon(c) && !hasRuleBox(D(c.id))) || isBasicEnergy(c)), play: async (g, p) => {
    const pl = g.pl[p]; const f = (c) => (isPokemon(c) && !hasRuleBox(D(c.id))) || isBasicEnergy(c); const got = await pickDiscard(g, p, f, "Lana's Aid: take up to 3", 3);
    got.forEach((c) => { g.removeFrom(pl.discard, c); pl.hand.push(c); }); } },
  'sv04-178': { attacks: { 'Evolution': { run: async (g, c) => {
    const me = g.pl[c.p]; if (me.turns < 2) return; const done = new Set();
    const ok = () => me.bench.filter((pk) => !done.has(pk.pid) && pk.since < g.turnNo && me.deck.some((x) => isPokemon(x) && D(x.id).evolveFrom === g.dOf(pk).name));
    for (let n = 0; n < 2 && ok().length; n++) {
      const opts = ok(); const [pk] = await g.pickPK(c.p, opts, { title: `Evolution: choose a Benched Pokémon (${2 - n} left)`, min: n === 0 ? 0 : 0, max: 1, purpose: 'attach-target' }); if (!pk) break; done.add(pk.pid);
      const [card] = await g.searchDeck(c.p, { title: `Evolve ${g.dOf(pk).name}`, filter: (x) => isPokemon(x) && D(x.id).evolveFrom === g.dOf(pk).name, max: 1, min: 1, purpose: 'search-pokemon' });
      if (card) { await g.evolve(c.p, card, pk); await g.sync(); }
    } } } } },
});
