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

// ------------------------------------------------------------------ saving & resuming
const jget = (k) => { try { return JSON.parse(localStorage.getItem('holo.' + k)); } catch (e) { return null; } };
const jset = (k, v) => { try { localStorage.setItem('holo.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked or full */ } };
const jdel = (k) => { try { localStorage.removeItem('holo.' + k); } catch (e) { /* ignore */ } };
const role = { get: () => { try { return sessionStorage.getItem('holo.role'); } catch (e) { return null; } }, set: (r) => { try { if (r) sessionStorage.setItem('holo.role', r); else sessionStorage.removeItem('holo.role'); } catch (e) { /* ignore */ } } };
const FRESH = 6 * 3600 * 1000, fresh = (x) => !!x && Date.now() - x.t < FRESH;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const netbar = (t) => { const b = $('#netbar'); b.textContent = t || ''; b.classList.toggle('hidden', !t); };

function persist(s, snap) { s.lastSnap = snap; clearTimeout(s.saveT); s.saveT = setTimeout(() => flushSave(s), 250); }
function flushSave(s) { if (s && s.lastSnap && s.kind !== 'guest') jset('save', { kind: s.kind, code: s.code, token: s.token, names: s.names, deckIds: s.deckIds, snap: s.lastSnap, t: Date.now() }); }
function runGame(s, game, resume) {
  s.game = game; window.__game = game; game.onCheckpoint = (snap) => persist(s, snap);
  return game.run({ resume }).then(() => { jdel('save'); }).catch((e) => { console.error(e); toast('Game error: ' + e.message); });
}

// ------------------------------------------------------------------ game plumbing
const humanCtl = { update: (v, e) => ui.enqueue(v, e), ask: (r, v) => ui.prompt(r, v) };
async function wakeLock() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) wakeLock(); });
function enterGame() { ui.reset(); show('game'); audio.music('battle'); wakeLock(); ui.fit(); }
function leaveToMenu() {
  if (session) { try { session.host && session.host.close(); session.link && session.link.close(); session.peer && session.peer.destroy(); } catch (e) { /* ignore */ } session.dead = true; clearTimeout(session.waitT); clearTimeout(session.saveT); }
  session = null; role.set(null); jdel('save'); jdel('guest'); netbar(''); ui.reset(); show('menu'); audio.music('menu'); showResumeBar();
  try { wake && wake.release(); } catch (e) { /* ignore */ } history.replaceState(null, '', location.pathname);
}
ui.onLeave = (toMenu) => { if (toMenu || confirm('Leave the game?')) leaveToMenu(); };
ui.onGameOver = () => { jdel('save'); if (session && session.kind === 'guest') jdel('guest'); };

// ---- practice vs bot
function startPractice(demo = params.get('demo') === '1', saved = null) {
  const s = (session = { kind: 'bot' }); role.set('bot'); let me, foe, names;
  if (saved) { me = deckById(saved.deckIds[0]); foe = deckById(saved.deckIds[1]); names = saved.names; }
  else { me = deckById(deckId); const others = decks.filter((d) => d.id !== deckId); foe = others[Math.floor(Math.random() * others.length)] || me; names = [myName(), `Bot · ${foe.name.split(' — ')[0]}`]; }
  s.names = names; s.deckIds = [me.id, foe.id]; preload(me.list); preload(foe.list); enterGame();
  const ctl = [demo ? { update: humanCtl.update, ask: (r, v) => new Bot({ delay: 500 }).ask(r, v) } : humanCtl, new Bot({ delay: 650 })];
  const game = saved ? Game.restore(saved.snap, ctl) : new Game({ decks: [expandDeck(me.list), expandDeck(foe.list)], names, ctl, seed: Date.now() });
  ui.onAgain = () => startPractice(false); runGame(s, game, !!saved);
}
$('#btnBot').onclick = () => { audio.sfx('click'); startPractice(); };

// ---- host a room (also used to re-open a saved room after a reload)
function hostRoom(saved = null) {
  audio.sfx('click'); show('lobby'); role.set('host'); const me = deckById(saved ? saved.deckIds[0] : deckId); preload(me.list);
  $('#roomCode').textContent = saved ? saved.code : '·····'; $('#lobbyStatus').textContent = saved ? `Re-opening your room… waiting for ${saved.names[1]} to come back` : 'Creating room…';
  const s = (session = { kind: 'host', names: saved ? saved.names : [myName(), null], deckIds: saved ? saved.deckIds : [me.id, null], token: saved ? saved.token : null, code: saved ? saved.code : null, resumeSnap: saved ? saved.snap : null, rematch: { me: false, guest: false } });
  const maybeRematch = () => { if (s.rematch.me && s.rematch.guest && s.link) { s.game = null; startOnline(); } };
  const startOnline = () => {
    const mine = deckById(s.deckIds[0]), theirs = s.guestDeck || deckById(s.deckIds[1]) || decks[0]; preload(theirs.list); s.rematch = { me: false, guest: false };
    enterGame(); s.link.send({ t: 'start', names: s.names, you: 1, deck: mine.id }); s.remote = new RemoteController(s.link); netbar('');
    const ctl = [humanCtl, s.remote]; let p;
    if (s.resumeSnap) { const g = Game.restore(s.resumeSnap, ctl); s.resumeSnap = null; p = runGame(s, g, true); }
    else p = runGame(s, new Game({ decks: [expandDeck(mine.list), expandDeck(theirs.list)], names: s.names, ctl, seed: Date.now() }), false);
    p.then(() => s.link && s.link.send({ t: 'over' }));
  };
  ui.onAgain = () => { s.rematch.me = true; if (!s.link) return toast('Your friend left the room'); $('#again').textContent = 'Waiting for friend…'; $('#again').disabled = true; s.link.send({ t: 'rematch' }); maybeRematch(); };
  const onJoin = (link, m) => {
    if (s.token && m.token !== s.token) { link.send({ t: 'full' }); setTimeout(() => link.close(), 300); return; }          // somebody else
    if (!s.token) { s.token = m.token || 't' + Math.random().toString(36).slice(2); s.names[1] = String(m.name || 'Friend').slice(0, 16); s.guestDeck = deckById(m.deck) || decks[0]; s.deckIds[1] = s.guestDeck.id; }
    if (s.link && s.link !== link) { try { s.link.close(); } catch (e) { /* ignore */ } }
    s.link = link; clearTimeout(s.waitT); netbar('');
    if (s.game && s.remote && s.game.winner === null) { link.send({ t: 'start', names: s.names, you: 1, deck: s.deckIds[0], resumed: true }); s.remote.rebind(link); toast(`${s.names[1]} reconnected`); return; }   // live game: just re-attach
    if (s.game && s.game.winner !== null) { link.send({ t: 'over' }); return; }
    startOnline();
  };
  const onMsg = (link, m) => {
    if (m.t === 'join') return onJoin(link, m);
    if (link !== s.link) return;
    if (m.t === 'answer' && s.remote) s.remote.answer(m);
    else if (m.t === 'rematch') { s.rematch.guest = true; toast(`${s.names[1]} wants a rematch`); maybeRematch(); }
  };
  const onDead = (link) => {
    if (s.dead || link !== s.link) return; s.link = null; if (s.remote) s.remote.link = { send() {} };
    if (s.game && s.game.winner === null) { netbar(`${s.names[1]} disconnected — waiting up to 2 minutes for them to rejoin…`); clearTimeout(s.waitT); s.waitT = setTimeout(() => { netbar(''); ui.end(true, 'Your opponent did not come back'); }, 120000); }
    else toast('Your friend left the room');
  };
  s.host = openHost({
    code: saved && saved.code,
    onReady: (code) => { s.code = code; $('#roomCode').textContent = code; if (!saved) $('#lobbyStatus').textContent = 'Waiting for your friend to join…'; },
    onError: (e) => { $('#lobbyStatus').textContent = 'Could not create a room: ' + (e.type || e.message); },
    onConn: (conn) => { const link = wrap(conn, { onMsg: (m) => onMsg(link, m), onDead: () => onDead(link) }); },
  });
}
$('#btnHost').onclick = () => hostRoom();
$('#lobbyCancel').onclick = () => leaveToMenu();
const inviteURL = () => `${location.origin}${location.pathname}?join=${session && session.code}`;
$('#copyCode').onclick = async () => { try { await navigator.clipboard.writeText(session.code); toast('Code copied'); } catch (e) { toast('Code: ' + session.code); } };
$('#copyLink').onclick = async () => {
  const url = inviteURL(); const data = { title: 'Holo Arena', text: `Join my card battle! Room code: ${session.code}`, url };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) { /* cancelled */ } }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { toast(url); }
};

// ---- join a room (and rejoin it after a drop or reload)
async function joinGame(code, info, { silent = false } = {}) {
  const s = (session = { kind: 'guest', code, info, started: false }); role.set('guest'); jset('guest', { code, ...info, t: Date.now() });
  const gameOver = () => !!(ui.view && ui.view.winner !== null && ui.view.winner !== undefined);
  const open = async () => {
    const { conn, peer } = await joinRoom(code, {}); if (s.dead) { try { peer.destroy(); } catch (e) { /* ignore */ } return; }
    s.peer = peer;
    const link = wrap(conn, {
      onMsg: (m) => {
        if (m.t === 'start') { s.started = true; netbar(''); jset('guest', { code, ...info, t: Date.now() }); enterGame(); ui.onAgain = () => { $('#again').textContent = 'Waiting for friend…'; $('#again').disabled = true; s.link.send({ t: 'rematch' }); }; }
        else if (m.t === 'update') ui.enqueue(m.view, m.events);
        else if (m.t === 'ask') ui.prompt(m.req, m.view).then((answer) => s.link && s.link.send({ t: 'answer', rid: m.rid, answer }));
        else if (m.t === 'full') { toast('That room is already taken'); leaveToMenu(); }
        else if (m.t === 'rematch') toast('Your friend wants a rematch');
        else if (m.t === 'over' && !ui.view) leaveToMenu();
      },
      onDead: () => { if (s.dead || link !== s.link) return; if (s.started && !gameOver()) reconnect(); else if (!s.started && !silent) { toast('Disconnected from the room'); leaveToMenu(); } else if (!gameOver()) reconnect(); },
    });
    s.link = link; link.send({ t: 'join', name: info.name, deck: info.deck, token: info.token });
  };
  const reconnect = async () => {
    netbar('Connection lost — reconnecting to your game…'); const until = Date.now() + 150000;
    while (!s.dead && Date.now() < until) { try { await open(); return; } catch (e) { await sleepMs(3000); } }
    if (!s.dead) { netbar(''); ui.end(true, 'The host did not come back'); }
  };
  if (silent) { enterGame(); netbar('Reconnecting to your game…'); reconnect(); } else await open();
}
$('#btnJoin').onclick = async () => {
  const code = cleanCode($('#code').value); if (code.length !== 5) { toast('Enter the 5-character room code'); $('#code').focus(); return; }
  audio.sfx('click'); const btn = $('#btnJoin'); btn.disabled = true; $('#joinMsg').textContent = 'Connecting…'; preload(deckById(deckId).list);
  try { await joinGame(code, { name: myName(), deck: deckId, token: 't' + Math.random().toString(36).slice(2) + Date.now().toString(36) }); }
  catch (e) { toast(e.message); session = null; role.set(null); jdel('guest'); }
  btn.disabled = false; $('#joinMsg').textContent = 'Enter the 5-character room code';
};

// ------------------------------------------------------------------ resume on load + update check
function showResumeBar() {
  const sv = jget('save'), gv = jget('guest'), bar = $('#resumeBar'); const w = fresh(sv) ? sv : fresh(gv) ? gv : null;
  if (!w) { bar.classList.add('hidden'); return; }
  $('#resumeText').textContent = w === sv ? (sv.kind === 'bot' ? 'You have a practice game in progress.' : `Your room ${sv.code} is still open — your game is saved.`) : `You were playing in room ${gv.code}.`;
  bar.classList.remove('hidden');
  $('#resumeGo').onclick = () => { bar.classList.add('hidden'); w === sv ? (sv.kind === 'bot' ? startPractice(false, sv) : hostRoom(sv)) : joinGame(gv.code, { name: gv.name, deck: gv.deck, token: gv.token }, { silent: true }); };
  $('#resumeNo').onclick = () => { jdel('save'); jdel('guest'); bar.classList.add('hidden'); };
}
{
  let auto = false; try { auto = sessionStorage.getItem('holo.auto') === '1'; sessionStorage.removeItem('holo.auto'); } catch (e) { /* ignore */ }
  const r = role.get(), sv = jget('save'), gv = jget('guest');
  if (auto && (r === 'bot' || r === 'host') && fresh(sv)) setTimeout(() => (sv.kind === 'bot' ? startPractice(false, sv) : hostRoom(sv)), 200);
  else if (auto && r === 'guest' && fresh(gv)) setTimeout(() => joinGame(gv.code, { name: gv.name, deck: gv.deck, token: gv.token }, { silent: true }), 200);
  else showResumeBar();
}
addEventListener('beforeunload', () => { if (session) { flushSave(session); try { sessionStorage.setItem('holo.auto', '1'); } catch (e) { /* ignore */ } } });

let appVer = null, updating = false;
const getVer = async () => { try { const r = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' }); return (await r.json()).v; } catch (e) { return null; } };
getVer().then((v) => { appVer = v; });
function updateNow() {
  if (updating) return; updating = true; netbar('New version ready — updating and returning you to your game…');
  if (session) flushSave(session); try { sessionStorage.setItem('holo.auto', session ? '1' : '0'); } catch (e) { /* ignore */ }
  setTimeout(() => location.reload(), 1800);
}
const checkVer = async () => { const v = await getVer(); if (v && appVer && v !== appVer) updateNow(); };
setInterval(checkVer, 45000); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVer(); });

window.__ui = ui;
window.__dbg = { get session() { return session; }, updateNow };
if (params.get('auto') === '1') setTimeout(() => startPractice(true), 600);   // test helper: bots play both sides
