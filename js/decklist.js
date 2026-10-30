// Parse and validate pasted deck lists ("4 Comfey", "4x Nest Ball", "3 Giratina V LOR 130" …) against the card pool.
export const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

export function buildIndex(cards) {
  const idx = new Map();
  for (const c of Object.values(cards)) { const k = norm(c.name); if (!idx.has(k)) idx.set(k, c.id); }
  return idx;
}

export function parseDeck(text, cards) {
  const idx = buildIndex(cards), counts = new Map(), unknown = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim(); if (!line) continue;
    const m = /^[*\-•]?\s*(\d+)\s*x?\s+(.+)$/i.exec(line); if (!m) continue;           // headers like "Pokémon (16)" are skipped
    let rest = norm(m[2]).replace(/^basic /, '').replace(/^\{[a-z]\} /, ''); const words = rest.split(' '); let id = null;
    for (let k = words.length; k >= 1 && !id; k--) id = idx.get(words.slice(0, k).join(' ')) || null;
    if (!id) { unknown.push(m[2].trim()); continue; }
    counts.set(id, (counts.get(id) || 0) + +m[1]);
  }
  return { list: [...counts.entries()], unknown };
}

export function validate(list, cards) {
  const errors = []; const total = list.reduce((a, [, n]) => a + n, 0); const byName = {};
  let basic = 0, ace = 0, radiant = 0;
  for (const [id, n] of list) {
    const c = cards[id], isBasicEnergy = c.cat === 'Energy' && c.energyType !== 'Special';
    byName[c.name] = (byName[c.name] || 0) + n;
    if (c.cat === 'Pokemon' && c.stage === 'Basic') basic += n;
    if (c.rarity === 'ACE SPEC Rare' || c.rarity === 'ACE SPEC') ace += n;
    if (c.suffix === 'Radiant') radiant += n;
    if (!isBasicEnergy && byName[c.name] > 4) errors.push(`More than 4 copies of ${c.name}`);
  }
  if (total !== 60) errors.push(`The deck has ${total} cards (it needs exactly 60)`);
  if (!basic) errors.push('The deck needs at least 1 Basic Pokémon');
  if (ace > 1) errors.push('Only 1 ACE SPEC card is allowed');
  if (radiant > 1) errors.push('Only 1 Radiant Pokémon is allowed');
  return { ok: !errors.length, errors, total };
}

const TYPE_COLORS = { Fire: ['#ff6a2c', '#ffb347'], Water: ['#3ea0ff', '#7fe0ff'], Grass: ['#3fbf5a', '#b6e86a'], Lightning: ['#ffd92a', '#2fb7ff'], Psychic: ['#c455e6', '#ff9ad0'], Fighting: ['#b4642a', '#e8b86a'], Darkness: ['#4a4580', '#9a7cff'], Metal: ['#8a97ab', '#cfd8e6'], Dragon: ['#c4a02a', '#7a3cff'], Colorless: ['#9aa6c8', '#e0e6f5'] };
export function makeCustom(name, list, cards) {
  const mons = list.map(([id]) => cards[id]).filter((c) => c.cat === 'Pokemon').sort((a, b) => (b.hp || 0) - (a.hp || 0));
  const top = mons[0] || cards[list[0][0]];
  return { id: 'c_' + Date.now().toString(36), name: name || 'My deck', tag: 'Imported deck', colors: TYPE_COLORS[(top.types || ['Colorless'])[0]] || TYPE_COLORS.Colorless, cover: top.id, list, count: list.reduce((a, [, n]) => a + n, 0), custom: true };
}
