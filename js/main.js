import { Game, setDB, expandDeck, D } from './engine.js';
import { Bot } from './bot.js';
import { BoardUI } from './ui.js';
import { audio } from './audio.js';
import { startBackdrop } from './fx.js';
import { openHost, joinRoom, wrap, RemoteController, cleanCode } from './net.js';
import { REPO_URL } from './config.js';

const $ = (s) => document.querySelector(s);
const store = { get: (k, d) => { try { return localStorage.getItem('holo.' + k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('holo.' + k, v); } catch (e) { /* ignore */ } } };
const show = (id) => { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); };
const toast = (t) => { const d = document.createElement('div'); d.textContent = t; $('#toast').append(d); setTimeout(() => d.remove(), 2700); };

const [cards, decks] = await Promise.all([fetch('data/cards.json').then((r) => r.json()), fetch('data/decks.json').then((r) => r.json())]);
setDB(cards);
const ui = new BoardUI();
let deckId = store.get('deck', decks[0].id); if (!decks.find((d) => d.id === deckId)) deckId = decks[0].id;
const deckById = (id) => decks.find((d) => d.id === id);
let session = null;                                   // { kind, game?, host?, link?, ... }
let wake = null;

// ------------------------------------------------------------------ menu
$('#name').value = store.get('name', '');
if (REPO_URL) $('#gh').href = REPO_URL; else $('#gh').style.display = 'none';
setTimeout(() => document.querySelector('.deck.sel') && document.querySelector('.deck.sel').scrollIntoView({ inline: 'center', block: 'nearest' }), 300);
const covers = decks.map((d) => cards[d.cover].img);
startBackdrop($('#bgfx'), covers);
decks.forEach((d) => {
  const el = document.createElement('div'); el.className = 'deck'; el.dataset.id = d.id; el.style.setProperty('--c1', d.colors[0]); el.style.setProperty('--c2', d.colors[1]);
  el.innerHTML = `<div class="pack"><span class="tick">✔</span><img src="${cards[d.cover].img}" alt=""><div class="ribbon">${d.name}</div></div><small>${d.tag}</small>`;
  el.onclick = () => { deckId = d.id; store.set('deck', d.id); sync(); audio.sfx('click'); el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); };
  $('#decks').append(el);
});
const sync = () => document.querySelectorAll('.deck').forEach((e) => e.classList.toggle('sel', e.dataset.id === deckId)); sync();
const myName = () => { const n = ($('#name').value || '').trim().slice(0, 16) || 'Trainer'; store.set('name', $('#name').value.trim()); return n; };
const preload = (list) => list.forEach(([id]) => { const i = new Image(); i.src = cards[id].img; });
audio.music('menu');

const params = new URLSearchParams(location.search);
if (params.get('join')) { $('#code').value = cleanCode(params.get('join')); setTimeout(() => toast(`Invite loaded — pick a deck, then press Join`), 600); }
$('#code').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnHow').onclick = $('#btnHow2').onclick = () => $('#how').classList.remove('hidden'); $('#howClose').onclick = () => $('#how').classList.add('hidden');
const soundLabel = () => ($('#btnSound').textContent = audio.muted ? '🔇' : '🔊'); soundLabel();
$('#btnSound').onclick = () => { audio.setMuted(!audio.muted); soundLabel(); $('#btnMute').textContent = audio.muted ? '🔇' : '🔊'; };

// ------------------------------------------------------------------ game plumbing
const humanCtl = { update: (v, e) => ui.enqueue(v, e), ask: (r, v) => ui.prompt(r, v) };
async function wakeLock() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) wakeLock(); });
function enterGame() { ui.reset(); show('game'); audio.music('battle'); wakeLock(); ui.fit(); }
function leaveToMenu() {
  if (session) { try { session.host && session.host.close(); session.link && session.link.close(); session.peer && session.peer.destroy(); } catch (e) { /* ignore */ } session.dead = true; }
  session = null; ui.reset(); show('menu'); audio.music('menu'); try { wake && wake.release(); } catch (e) { /* ignore */ } history.replaceState(null, '', location.pathname);
}
ui.onLeave = (toMenu) => { if (toMenu || confirm('Leave the game?')) leaveToMenu(); };

// ---- practice vs bot
function startPractice(demo = params.get('demo') === '1') {
  const me = deckById(deckId); const others = decks.filter((d) => d.id !== deckId); const foe = others[Math.floor(Math.random() * others.length)] || me;
  preload(me.list); preload(foe.list); session = { kind: 'bot' }; enterGame();
  const names = [myName(), `Bot · ${foe.name.split(' — ')[0]}`];
  const game = new Game({ decks: [expandDeck(me.list), expandDeck(foe.list)], names, ctl: [demo ? { update: humanCtl.update, ask: (r, v) => new Bot({ delay: 500 }).ask(r, v) } : humanCtl, new Bot({ delay: 650 })], seed: Date.now() });
  session.game = game; ui.onAgain = () => startPractice(false); window.__game = game; game.run().catch((e) => { console.error(e); toast('Game error: ' + e.message); });
}
$('#btnBot').onclick = () => { audio.sfx('click'); startPractice(); };

// ---- host a room
let hosting = null;
$('#btnHost').onclick = () => {
  audio.sfx('click'); const name = myName(); show('lobby'); $('#roomCode').textContent = '·····'; $('#lobbyStatus').textContent = 'Creating room…'; preload(deckById(deckId).list);
  let guest = null; const s = { kind: 'host', rematch: { me: false, guest: false } }; session = s;
  s.host = openHost({
    onReady: (code) => { s.code = code; $('#roomCode').textContent = code; $('#lobbyStatus').textContent = 'Waiting for your friend to join…'; },
    onError: (e) => { $('#lobbyStatus').textContent = 'Could not create a room: ' + (e.type || e.message); },
    onConn: (conn) => {
      if (guest) { try { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); } catch (e) { /* ignore */ } return; }
      guest = { conn }; const link = wrap(conn, { onMsg: (m) => onGuestMsg(m), onDead: () => onDead() }); s.link = link;
      const onGuestMsg = (m) => {
        if (m.t === 'join' && !guest.name) { guest.name = String(m.name || 'Friend').slice(0, 16); guest.deck = deckById(m.deck) || decks[0]; $('#lobbyStatus').textContent = `${guest.name} joined!`; startOnline(); }
        else if (m.t === 'answer' && s.remote) s.remote.answer(m);
        else if (m.t === 'rematch') { s.rematch.guest = true; toast(`${guest.name} wants a rematch`); maybeRematch(); }
      };
      const onDead = () => { if (s.dead) return; if (s.game && s.game.winner === null) { ui.end(true, 'Your opponent disconnected'); } else toast('Your friend left the room'); s.gone = true; };
      const startOnline = () => {
        const me = deckById(deckId); preload(guest.deck.list); s.rematch = { me: false, guest: false };
        enterGame(); const names = [name, guest.name]; link.send({ t: 'start', names, you: 1, deck: me.id });
        s.remote = new RemoteController(link);
        const game = new Game({ decks: [expandDeck(me.list), expandDeck(guest.deck.list)], names, ctl: [humanCtl, s.remote], seed: Date.now() }); s.game = game; window.__game = game;
        game.run().then(() => link.send({ t: 'over' })).catch((e) => { console.error(e); toast('Game error: ' + e.message); });
      };
      const maybeRematch = () => { if (s.rematch.me && s.rematch.guest && !s.gone) startOnline(); };
      ui.onAgain = () => { s.rematch.me = true; if (s.gone) return toast('Your friend left the room'); $('#again').textContent = 'Waiting for friend…'; $('#again').disabled = true; link.send({ t: 'rematch' }); maybeRematch(); };
    },
  });
  hosting = s;
};
const cancelLobby = () => leaveToMenu(); $('#lobbyCancel').onclick = cancelLobby;
const inviteURL = () => `${location.origin}${location.pathname}?join=${session && session.code}`;
$('#copyCode').onclick = async () => { try { await navigator.clipboard.writeText(session.code); toast('Code copied'); } catch (e) { toast('Code: ' + session.code); } };
$('#copyLink').onclick = async () => {
  const url = inviteURL(); const data = { title: 'Holo Arena', text: `Join my card battle! Room code: ${session.code}`, url };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) { /* cancelled */ } }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { toast(url); }
};

// ---- join a room
$('#btnJoin').onclick = async () => {
  const code = cleanCode($('#code').value); if (code.length !== 5) { toast('Enter the 5-character room code'); $('#code').focus(); return; }
  audio.sfx('click'); const name = myName(); const btn = $('#btnJoin'); btn.disabled = true; $('#joinMsg').textContent = 'Connecting…'; preload(deckById(deckId).list);
  try {
    const { conn, peer } = await joinRoom(code, {}); const s = { kind: 'guest', peer }; session = s; let started = false;
    const link = wrap(conn, {
      onMsg: (m) => {
        if (m.t === 'start') { started = true; enterGame(); ui.onAgain = () => { $('#again').textContent = 'Waiting for friend…'; $('#again').disabled = true; link.send({ t: 'rematch' }); }; }
        else if (m.t === 'update') ui.enqueue(m.view, m.events);
        else if (m.t === 'ask') ui.prompt(m.req, m.view).then((answer) => link.send({ t: 'answer', rid: m.rid, answer }));
        else if (m.t === 'full') { toast('That room is full'); leaveToMenu(); }
        else if (m.t === 'rematch') toast('Your friend wants a rematch');
      },
      onDead: () => { if (s.dead) return; if (started && !(ui.view && ui.view.winner !== null)) ui.end(true, 'The host disconnected'); else { toast('Disconnected from the room'); leaveToMenu(); } },
    });
    s.link = link; link.send({ t: 'join', name, deck: deckId });
  } catch (e) { toast(e.message); }
  btn.disabled = false; $('#joinMsg').textContent = 'Enter the 5-character room code';
};

window.__ui = ui;
