// Plays a bot game, snapshots at a mid-game checkpoint, then restores that snapshot and finishes it. Also checks determinism.
import fs from 'node:fs';
import { Game, setDB, expandDeck } from '../js/engine.js';
import { Bot } from '../js/bot.js';
setDB(JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url))));
const decks = JSON.parse(fs.readFileSync(new URL('../data/decks.json', import.meta.url)));
let ok = 0, bad = 0;
for (const [a, b] of [['lost', 'haxorus'], ['charizard', 'miraidon'], ['haxorus', 'lost'], ['miraidon', 'charizard']]) {
  for (let seed = 1; seed <= 6; seed++) {
    const mk = () => new Game({ decks: [expandDeck(decks.find((d) => d.id === a).list), expandDeck(decks.find((d) => d.id === b).list)], ctl: [new Bot(), new Bot()], seed });
    const g1 = mk(); let n = 0, snap = null; const target = 30 + seed * 7; g1.onCheckpoint = (s) => { if (++n === target) snap = JSON.stringify(s); };
    const w1 = await g1.run(); if (!snap) { continue; }
    const g2 = Game.restore(JSON.parse(snap), [new Bot(), new Bot()]); const w2 = await g2.run({ resume: true });
    // the restored game must reach the same result as the original (same RNG state, same bot decisions)
    if (w1 === w2 && g1.turnNo === g2.turnNo) ok++; else { bad++; console.log('DIFF', a, b, seed, w1, w2, g1.turnNo, g2.turnNo); }
  }
}
console.log('resume check: identical outcome', ok, 'different', bad);
