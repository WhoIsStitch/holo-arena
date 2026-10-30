// Headless simulation: bot vs bot over all deck pairings. Usage: node tools/sim.mjs [gamesPerPair]
import fs from 'node:fs';
import { Game, setDB, expandDeck } from '../js/engine.js';
import { Bot } from '../js/bot.js';
const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const decks = JSON.parse(fs.readFileSync(new URL('../data/decks.json', import.meta.url)));
setDB(cards);
const N = +process.argv[2] || 20; const stats = {}; let crashes = 0; const turns = []; const reasons = {};
for (const a of decks) for (const b of decks) {
  for (let i = 0; i < N; i++) {
    const g = new Game({ decks: [expandDeck(a.list), expandDeck(b.list)], names: [a.id, b.id], ctl: [new Bot(), new Bot()], seed: 1000 + i * 7 });
    try { await g.run(); } catch (e) { crashes++; if (crashes < 4) console.log('CRASH', a.id, 'vs', b.id, 'seed', 1000 + i * 7, e.stack.split('\n').slice(0, 5).join('\n')); continue; }
    const k = `${a.id} vs ${b.id}`; stats[k] = stats[k] || [0, 0]; stats[k][g.winner]++; turns.push(g.turnNo); reasons[g.reason] = (reasons[g.reason] || 0) + 1;
  }
}
console.log(stats); console.log('avg turns', (turns.reduce((x, y) => x + y, 0) / turns.length).toFixed(1), 'games', turns.length, 'crashes', crashes); console.log(reasons);
