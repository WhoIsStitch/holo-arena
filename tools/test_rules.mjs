import fs from 'node:fs';
import { Game, setDB, expandDeck } from '../js/engine.js';
import { Bot } from '../js/bot.js';
setDB(JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url))));
const decks = JSON.parse(fs.readFileSync(new URL('../data/decks.json', import.meta.url)));
const L = (id) => expandDeck(decks.find((d) => d.id === id).list);
for (const rules of [{}, { prizes: 3, hand: 5, noDeckOut: true, vAsEx: true, firstTurn: true, energyPerTurn: 2 }]) {
  let r = { deckout: 0, games: 0, prizeLeft: new Set() };
  for (let s = 1; s <= 12; s++) { const g = new Game({ decks: [L('lost'), L('haxorus')], ctl: [new Bot(), new Bot()], seed: s, rules }); await g.run(); r.games++; if (g.reason === 'Deck out') r.deckout++; r.prizeLeft.add(g.pl[0].prizes.length + g.pl[1].prizes.length); }
  console.log(JSON.stringify(rules), 'games', r.games, 'deck-out losses', r.deckout, 'prizes left (both)', [...r.prizeLeft].join(','));
}
const g = new Game({ decks: [L('lost'), L('lost')], ctl: [new Bot(), new Bot()], seed: 3, rules: { vAsEx: true } }); await g.setup();
console.log('V as ex:', g.isEx({ suffix: 'V' }), 'default:', new Game({ decks: [[], []], ctl: [], seed: 1 }).isEx({ suffix: 'V' }));
