import fs from 'node:fs';
import { parseDeck, validate } from '../js/decklist.js';
const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const text = `Pokémon: 16
4 Comfey LOR 79
1 Cramorant LOR 50
1 Sableye LOR 70
1 Drapion V LOR 118
1 Fezandipiti ex SFA 38
3 Giratina V LOR 130
3 Giratina VSTAR LOR 131
1 Radiant Greninja ASR 46
1 Manaphy BRS 41
Trainer: 30
4 Colress's Experiment
4 Nest Ball
4 Mirage Gate
1 Buddy-Buddy Poffin
1 Artazon
4 Switch Cart
2 Switch
2 Super Rod
2 Boss's Orders
2 Roxanne
2 Pokégear 3.0
1 Rescue Board
1 Prime Catcher
Energy: 14
4 Basic Water Energy
3 Basic Psychic Energy
4 Basic Grass Energy
3 Jet Energy
2 Fake Card Name`;
const r = parseDeck(text, cards); const v = validate(r.list, cards);
console.log('cards parsed', r.list.reduce((a, [, n]) => a + n, 0), 'unknown', r.unknown, 'valid', v.ok, v.errors);
const bad = validate([['swsh11-079', 5], ['ex16-103', 55]], cards); console.log('bad deck errors', bad.errors);
