import fs from 'node:fs';
import { Game, setDB, expandDeck } from '../js/engine.js';
import { fxOf } from '../js/cards.js';
import { Bot } from '../js/bot.js';
setDB(JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url))));
const decks = JSON.parse(fs.readFileSync(new URL('../data/decks.json', import.meta.url)));
const lost = decks.find((d) => d.id === 'lost');
for (const nElig of [2, 3, 5]) {
  const reqs = []; const b = new Bot(); const ask = b.ask.bind(b); b.ask = async (r, v, p) => { reqs.push(r); return ask(r, v, p); }; b.update = () => {};
  const g = new Game({ decks: [expandDeck(lost.list), expandDeck(lost.list)], ctl: [b, new Bot()], seed: 5 });
  await g.setup();
  const pl = g.pl[0]; pl.discard = []; for (let i = 0; i < nElig; i++) pl.discard.push(g.inst(i % 2 ? 'ex16-103' : 'swsh11-079'));
  const before = pl.deck.length; reqs.length = 0;
  await fxOf('dv1-20').play(g, 0, null);
  console.log(`eligible ${nElig}: prompts=${reqs.filter((r) => r.kind === 'select').map((r) => `[${r.options.length} opts, min ${r.min}, max ${r.max}${r.forced ? ', forced' : ''}]`).join(' ')} deck ${before}->${pl.deck.length} discard now ${pl.discard.length}`);
}
const g2 = new Game({ decks: [expandDeck(lost.list), expandDeck(lost.list)], ctl: [new Bot(), new Bot()], seed: 7 }); await g2.setup();
const mg = g2.pl[0].hand.find((c) => c.id === 'swsh11-163') || g2.inst('swsh11-163'); console.log('why Mirage Gate:', g2.whyNot(0, mg));
