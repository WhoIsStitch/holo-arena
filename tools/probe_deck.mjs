import fs from 'node:fs';
import { Game, setDB, expandDeck } from '../js/engine.js';
import { Bot } from '../js/bot.js';
setDB(JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url))));
const decks = JSON.parse(fs.readFileSync(new URL('../data/decks.json', import.meta.url)));
const mine = decks.find((d) => d.id === process.argv[2]), opp = decks.find((d) => d.id === (process.argv[3] || 'miraidon'));
const uses = {}, plays = {}; let wins = 0, n = +process.argv[4] || 40;
for (let i = 0; i < n; i++) {
  const b0 = new Bot(); b0.update = (v, evs) => { for (const e of evs) if (e.type === 'log') { const m = /^'?(mine)'s (.+?) uses (.+)!/.exec(e.text.replace(/^[^']*(?=')/, '')) || /^mine's .+ uses (.+)!/.exec(e.text); const t = /^mine's (.+?) uses (.+)!$/.exec(e.text); if (t) uses[t[2]] = (uses[t[2]] || 0) + 1; const pl = /^mine plays (.+)\.$/.exec(e.text); if (pl) plays[pl[1]] = (plays[pl[1]] || 0) + 1; } };
  const b1 = new Bot(); b1.update = () => {};
  const g = new Game({ decks: [expandDeck(mine.list), expandDeck(opp.list)], names: ['mine', 'opp'], ctl: [b0, b1], seed: 900 + i }); await g.run(); if (g.winner === 0) wins++;
}
console.log(process.argv[2], 'vs', opp.id, 'wins', wins, '/', n); console.log('attacks', uses); console.log('trainers', plays);
