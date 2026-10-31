# Holo Arena

Fan-made online card battles for you and your friends. Works on phones and computers, runs as a plain static site (perfect for GitHub Pages), and needs **no server and no accounts**.

- **Real card art** with a 3D tilted table, holographic foil, floating card view, particle effects, and synthesized sound (no audio files).
- **Room codes:** one player taps **Host a room** and gets a 5-character code (like `K7PX2`), the other types it under **Join** (or opens the invite link). Peer-to-peer over WebRTC.
- **Practice vs a bot** any time.
- **Mobile friendly:** portrait board layout, tap a card to float it up and choose an action, drag from your hand, screen stays awake.

## Decks (pick one before you play)

| Deck | Idea |
| --- | --- |
| **Lost Zone Giratina VSTAR** | Fill the Lost Zone, then Star Requiem / Lost Mine. |
| **Haxorus — Bring Down the Axe** | Rare Candy into Haxorus; Axe Blast knocks out any Basic. (60-card version: Double Dragon Energy and one Metal Energy removed.) |
| **Charizard ex** | Infernal Reign, Burning Darkness grows with every Prize. |
| **Miraidon ex** | Tandem Unit floods the Bench with Lightning Pokémon. |

The rules engine (`js/engine.js`) implements setup and mulligans, first-turn restrictions, evolution, one Energy / Supporter / Stadium / retreat per turn, Weakness and Resistance, Special Conditions and Pokémon Checkup, Prize cards (V / ex / VSTAR = 2), the Lost Zone, and all three win conditions. Every card in the four decks has its real printed effect in `js/cards.js`.

## How to play

1. Pick a deck and enter a name.
2. **Practice**, **Host a room** (share the code or link), or **Join** with a friend's code.
3. On your turn: click/tap a card to float it up, then choose what to do (play, attach to a specific Pokémon, evolve, attack, use an Ability, retreat). You can also drag a hand card onto a Pokémon.
4. Hover a card (desktop) for a quick preview; click the Discard or Lost Zone piles to inspect them.

## Run it locally

```bash
python -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

Test the rules headlessly (bots play every deck against every other deck):

```bash
node tools/sim.mjs 20
```

Add `?demo=1` to the URL and press **Practice** to watch two bots play on the real UI.

## Publish to GitHub Pages

Push this folder to a repository, then **Settings → Pages → Deploy from a branch → `main` / root**. The site is fully static.

## Updates, saving and reconnecting

- Every move is auto-saved in the host's browser. If a page is refreshed or the browser crashes, the game resumes where it was (practice games too).
- If a player's connection drops or they refresh, they rejoin the same room automatically and carry on; the host waits up to 2 minutes.
- Every open page checks for a new version about every 45 seconds. When one is deployed, the page saves, reloads itself, and puts you back in your game.
- **Before each deploy run `node tools/bump.mjs`** — it stamps a new version into `version.json` and tags every script with it (this is what triggers the auto-update and stops browsers mixing old and new files).

## Networking notes

- Matchmaking uses PeerJS's free public signaling server; game traffic is direct peer-to-peer. The host's browser runs the rules and sends each player only the information they're allowed to see (your opponent's hand and the deck order never leave the host's engine unmasked).
- Most Wi-Fi/home connections just work. Some **mobile carriers and corporate networks** block direct connections and need a TURN relay. `js/config.js` lists STUN servers plus a best-effort public TURN; for dependable mobile-data play, make a free TURN account (e.g. metered.ca) and paste your credentials there.
- If the host's tab is closed or a phone locks its screen long enough to drop the connection, the game ends (no reconnect yet). Keep the screen awake while playing.

## Credits & legal

- Card data and images load from the [TCGdex](https://tcgdex.dev) API. The card back is from Bulbagarden Archives.
- Networking by [PeerJS](https://peerjs.com). The holographic foil look is built from the same CSS gradient / blend-mode technique popularised by [simeydotme/pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) (re-implemented from scratch here).
- This is an unofficial, non-commercial fan project. Pokémon and its card art, names and text are trademarks / copyrights of Nintendo, Creatures Inc., GAME FREAK inc. and The Pokémon Company. This project is not affiliated with or endorsed by them.

## Project layout

```
index.html          app shell
css/style.css       theme, 3D table, holo cards, mobile layout
js/engine.js        rules engine (runs in browser and Node)
js/cards.js         per-card effects
js/bot.js           practice opponent
js/ui.js            board, floating card, animations, input
js/net.js           room codes + WebRTC
js/audio.js fx.js   synthesized sound + particles
data/               cards.json, decks.json
tools/              simulation and data scripts
```

## 3D arena

The board is drawn in WebGL (Three.js, loaded from jsDelivr on demand) underneath the existing DOM cards, which stay as the click and drag targets. Settings > Effects > Graphics picks Auto, High, Medium or Lite (the flat 2D board). Auto uses Medium on phones and drops a level if the frame rate stays low. Lite is used automatically if WebGL or the CDN is unavailable. Code: `js/stage3d.js`; standalone card demo: `proto3d.html`.
