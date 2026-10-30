import { Game, setDB, expandDeck, D } from './engine.js';
import { Bot } from './bot.js';
import { BoardUI } from './ui.js';
import { audio } from './audio.js';
import { startBackdrop } from './fx.js';
import { openHost, joinRoom, wrap, RemoteController, cleanCode } from './net.js';
import { REPO_URL } from './config.js';
import { parseDeck, validate, makeCustom } from './decklist.js';

const $ = (s) => document.querySelector(s);
const store = { get: (k, d) => { try { return localStorage.getItem('holo.' + k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('holo.' + k, v); } catch (e) { /* ignore */ } } };
const show = (id) => { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); };
const toast = (t) => { const d = document.createElement('div'); d.textContent = t; $('#toast').append(d); setTimeout(() => d.remove(), 2700); };

const [cards, decks] = await Promise.all([fetch('data/cards.json').then((r) => r.json()), fetch('data/decks.json').then((r) => r.json())]);
setDB(cards);
decks.push(...JSON.parse(store.get('customDecks', '[]') || '[]'));
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
function renderDecks() {
$('#decks').innerHTML = '';
decks.forEach((d) => {
  const el = document.createElement('div'); el.className = 'deck'; el.dataset.id = d.id; el.style.setProperty('--c1', d.colors[0]); el.style.setProperty('--c2', d.colors[1]);
  el.innerHTML = `<div class="pack"><span class="tick">✔</span><button class="viewdeck">Cards</button><img src="${cards[d.cover].img}" alt=""><div class="ribbon">${d.name}</div></div><small>${d.tag}</small>`;
  el.querySelector('.viewdeck').onclick = (ev) => { ev.stopPropagation(); audio.sfx('click'); viewDeck(d); };
  el.onclick = () => { deckId = d.id; store.set('deck', d.id); sync(); audio.sfx('click'); el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); };
  $('#decks').append(el);
});
const add = document.createElement('div'); add.className = 'deck addtile'; add.innerHTML = '<div class="pack"><div class="plus">+</div><div class="ribbon">Import deck</div></div><small>Paste a deck list</small>'; add.onclick = () => importDeck(); $('#decks').append(add); sync();
}
const sync = () => document.querySelectorAll('.deck:not(.addtile)').forEach((e) => e.classList.toggle('sel', e.dataset.id === deckId));
renderDecks();
const DEFAULT_RULES = { prizes: 6, hand: 7, vAsEx: false, noDeckOut: false, firstTurn: false, energyPerTurn: 1, botLevel: 'normal', botSpeed: 650 };
const getRules = () => ({ ...DEFAULT_RULES, ...(JSON.parse(store.get('rules', '{}') || '{}')) });
function rulesText(r) {
  const out = []; if (r.vAsEx) out.push('V counts as ex'); if (r.noDeckOut) out.push("no deck-out loss"); if (r.firstTurn) out.push('attack/Supporter allowed turn 1');
  if (r.prizes !== 6) out.push(`${r.prizes} Prizes`); if (r.hand !== 7) out.push(`${r.hand}-card hand`); if (r.energyPerTurn !== 1) out.push(`${r.energyPerTurn} Energy/turn`); return out.join(' · ');
}
function showRules() {
  const r = getRules(), save = () => store.set('rules', JSON.stringify(r));
  const m = ui.modal(`<div class="dlg rules"><h3>Settings</h3><div class="sub">House rules apply to games you start (Practice, or a room you host). Friends see them when the game begins.</div><div class="rows"></div><div class="foot2"><button class="btn" id="rReset">Reset rules</button><button class="btn ok" id="rDone">Done</button></div></div>`);
  const rows = m.querySelector('.rows');
  const head = (t) => { const d = document.createElement('div'); d.className = 'rhead'; d.textContent = t; rows.append(d); };
  const row = (label, hint, ctl) => { const x = document.createElement('div'); x.className = 'rrow'; x.innerHTML = `<div><b>${label}</b><small>${hint}</small></div>`; x.append(ctl); rows.append(x); return x; };
  const sw = (get, set) => { const b = document.createElement('button'); b.className = 'sw' + (get() ? ' on' : ''); b.onclick = () => { set(!get()); b.classList.toggle('on', get()); audio.sfx('click'); }; return b; };
  const step = (get, set, lo, hi, fmt = (v) => v) => { const d = document.createElement('div'); d.className = 'step'; const a = document.createElement('button'), s = document.createElement('span'), p = document.createElement('button'); a.textContent = '−'; p.textContent = '+'; s.textContent = fmt(get()); a.onclick = () => { set(Math.max(lo, get() - 1)); s.textContent = fmt(get()); }; p.onclick = () => { set(Math.min(hi, get() + 1)); s.textContent = fmt(get()); }; d.append(a, s, p); return d; };
  const choice = (get, set, opts) => { const d = document.createElement('div'); d.className = 'choice'; opts.forEach(([label, val]) => { const b = document.createElement('button'); b.textContent = label; b.className = String(get()) === String(val) ? 'on' : ''; b.onclick = () => { set(val); [...d.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); audio.sfx('click'); }; d.append(b); }); return d; };
  head('House rules');
  row('V counts as ex', "Cards that affect Pokémon ex (Black Belt's Training, Maximum Belt…) also affect V, VSTAR and VMAX", sw(() => r.vAsEx, (v) => { r.vAsEx = v; save(); }));
  row("Don't lose when the deck is empty", 'You just skip your draw instead of losing the game', sw(() => r.noDeckOut, (v) => { r.noDeckOut = v; save(); }));
  row('No first-turn limits', 'The first player may attack and play a Supporter on turn 1', sw(() => r.firstTurn, (v) => { r.firstTurn = v; save(); }));
  row('Prize cards', 'How many each player sets aside (fewer = shorter game)', step(() => r.prizes, (v) => { r.prizes = v; save(); }, 1, 6));
  row('Starting hand', 'Cards drawn at the start', step(() => r.hand, (v) => { r.hand = v; save(); }, 5, 10));
  row('Energy attachments per turn', 'From your hand each turn', step(() => r.energyPerTurn, (v) => { r.energyPerTurn = v; save(); }, 1, 3));
  head('Practice bot');
  row('Difficulty', 'Easy makes random moves some of the time', choice(() => r.botLevel, (v) => { r.botLevel = v; save(); }, [['Easy', 'easy'], ['Normal', 'normal']]));
  row('Speed', 'How long the bot thinks between moves', choice(() => r.botSpeed, (v) => { r.botSpeed = +v; save(); }, [['Fast', 250], ['Normal', 650], ['Slow', 1100]]));
  head('Sound & display');
  row('Music', 'Background music during games', sw(() => audio.music, (v) => audio.setMusic(v)));
  row('Volume', 'Master volume (0–10)', step(() => Math.round(audio.volume * 10), (v) => audio.setVolume(v / 10), 0, 10));
  row('Card size', 'Bigger or smaller cards on the board', choice(() => store.get('cardsize', '1'), (v) => { store.set('cardsize', v); ui.fit(); }, [['Small', 0.85], ['Normal', 1], ['Large', 1.15]]));
  m.querySelector('#rDone').onclick = () => ui.closeModal();
  m.querySelector('#rReset').onclick = () => { store.set('rules', '{}'); ui.closeModal(); showRules(); };
}
function importDeck() {
  const m = ui.modal(`<div class="dlg rules"><h3>Import a deck</h3><div class="sub">Paste a deck list (like <b>4 Comfey</b>, one card per line — set codes are ignored). Only cards in this game's card pool can be used.</div><input id="dName" maxlength="30" placeholder="Deck name" style="width:100%"><textarea id="dText" placeholder="4 Comfey&#10;3 Giratina V&#10;4 Nest Ball&#10;4 Basic Water Energy…"></textarea><div id="dErr" class="derr"></div><div class="foot2"><button class="btn" id="dCancel">Cancel</button><button class="btn ok" id="dSave">Save deck</button></div></div>`);
  m.querySelector('#dCancel').onclick = () => ui.closeModal();
  m.querySelector('#dSave').onclick = () => {
    const { list, unknown } = parseDeck(m.querySelector('#dText').value, cards), v = validate(list, cards), errs = [...v.errors];
    if (unknown.length) errs.unshift(`Not in the card pool: ${[...new Set(unknown)].slice(0, 6).join(', ')}${unknown.length > 6 ? '…' : ''}`);
    if (!list.length) errs.unshift('Paste some cards first');
    if (errs.length) { m.querySelector('#dErr').innerHTML = errs.map((x) => `• ${x}`).join('<br>'); return; }
    const d = makeCustom(m.querySelector('#dName').value.trim(), list, cards); decks.push(d); const all = JSON.parse(store.get('customDecks', '[]') || '[]'); all.push(d); store.set('customDecks', JSON.stringify(all));
    deckId = d.id; store.set('deck', d.id); ui.closeModal(); renderDecks(); toast(`Saved "${d.name}"`);
  };
}
function viewDeck(d) {
  const counts = d.list.map(([id, n]) => ({ id, n, c: cards[id] })); const kind = (x) => (x.c.cat === 'Pokemon' ? 0 : x.c.cat === 'Trainer' ? 1 : 2);
  counts.sort((a, b) => kind(a) - kind(b) || a.c.name.localeCompare(b.c.name));
  const tot = [0, 0, 0]; counts.forEach((x) => (tot[kind(x)] += x.n));
  const m = ui.modal(`<div class="dlg"><h3>${d.name}</h3><div class="sub">${d.count} cards · ${tot[0]} Pokémon · ${tot[1]} Trainers · ${tot[2]} Energy — tap a card to look closer</div><div class="grid"></div><div class="foot2"><button class="btn">Close</button>${d.custom ? '<button class="btn" id="delDeck">Delete deck</button>' : ''}</div></div>`);
  counts.forEach((x) => { const n = document.createElement('div'); n.className = 'opt'; n.innerHTML = `<img src="${x.c.img}" alt=""><small><b>×${x.n}</b> ${x.c.name}</small>`; n.onclick = () => ui.sheet(x.id, [], null, n.querySelector('img')); m.querySelector('.grid').append(n); });
  m.querySelector('.btn').onclick = () => ui.closeModal();
  const del = m.querySelector('#delDeck'); if (del) del.onclick = () => { if (!confirm(`Delete "${d.name}"?`)) return; decks.splice(decks.indexOf(d), 1); store.set('customDecks', JSON.stringify(decks.filter((x) => x.custom))); if (deckId === d.id) { deckId = decks[0].id; store.set('deck', deckId); } ui.closeModal(); renderDecks(); };
}
document.getElementById('btnRules').onclick = () => { audio.sfx('click'); showRules(); };
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
ui.onSurrender = () => {
  if (!session || (ui.view && ui.view.winner !== null && ui.view.winner !== undefined)) return;
  if (!confirm('Surrender this game? You will lose.')) return;
  if (session.kind === 'guest') { session.link && session.link.send({ t: 'surrender' }); return; }
  const g = session.game; if (g && g.winner === null) { g.win(1, 'Surrender'); g.sync(); ui.answer(null); }
};
const getStats = () => ({ w: 0, l: 0, ...(jget('stats') || {}) });
const showRecord = () => { const s = getStats(); $('#record').textContent = s.w + s.l ? `· ${s.w}W – ${s.l}L` : ''; }; showRecord();
ui.onEmote = (t) => { if (!session) return; if (session.kind === 'guest') session.link && session.link.send({ t: 'emote', text: t }); else if (session.kind === 'host') session.link && session.link.send({ t: 'emote', text: t }); };
ui.onGameOver = (won) => { const s = getStats(); won ? s.w++ : s.l++; jset('stats', s); showRecord(); { const hist = jget('history') || []; const mine = session && (session.kind === 'guest' ? session.info.deck : session.deckIds && session.deckIds[0]); hist.unshift({ t: Date.now(), won: !!won, deck: mine || '', opp: ui.view ? ui.view.pl[1 - ui.view.me].name : '', turns: ui.view ? ui.view.turnNo : 0, kind: session ? session.kind : '' }); jset('history', hist.slice(0, 40)); }  jdel('save'); if (session && session.kind === 'guest') jdel('guest'); };

// ---- practice vs bot
function startPractice(demo = params.get('demo') === '1', saved = null) {
  const s = (session = { kind: 'bot' }); role.set('bot'); let me, foe, names;
  if (saved) { me = deckById(saved.deckIds[0]); foe = deckById(saved.deckIds[1]); names = saved.names; }
  else { me = deckById(deckId); const others = decks.filter((d) => d.id !== deckId); foe = others[Math.floor(Math.random() * others.length)] || me; names = [myName(), `Bot · ${foe.name.split(' — ')[0]}`]; }
  s.names = names; s.deckIds = [me.id, foe.id]; preload(me.list); preload(foe.list); enterGame();
  const ctl = [demo ? { update: humanCtl.update, ask: (r, v) => new Bot({ delay: 500 }).ask(r, v) } : humanCtl, new Bot({ delay: getRules().botSpeed, level: getRules().botLevel })];
  const game = saved ? Game.restore(saved.snap, ctl) : new Game({ decks: [expandDeck(me.list), expandDeck(foe.list)], names, ctl, seed: Date.now(), rules: getRules() });
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
    enterGame(); s.link.send({ t: 'start', names: s.names, you: 1, deck: mine.id, rules: getRules() }); s.remote = new RemoteController(s.link); netbar('');
    const ctl = [humanCtl, s.remote]; let p;
    if (s.resumeSnap) { const g = Game.restore(s.resumeSnap, ctl); s.resumeSnap = null; p = runGame(s, g, true); }
    else p = runGame(s, new Game({ decks: [expandDeck(mine.list), expandDeck(theirs.list)], names: s.names, ctl, seed: Date.now(), rules: getRules() }), false);
    p.then(() => s.link && s.link.send({ t: 'over' }));
  };
  ui.onAgain = () => { s.rematch.me = true; if (!s.link) return toast('Your friend left the room'); $('#again').textContent = 'Waiting for friend…'; $('#again').disabled = true; s.link.send({ t: 'rematch' }); maybeRematch(); };
  const cleanCustom = (x) => { try { const list = (x.list || []).filter(([id, n]) => cards[id] && n > 0 && n <= 60).map(([id, n]) => [id, n | 0]); const ok = validate(list, cards).ok; return ok ? { id: String(x.id).slice(0, 20), name: String(x.name).slice(0, 30), list, custom: true } : null; } catch (e) { return null; } };
  const onJoin = (link, m) => {
    if (s.token && m.token !== s.token) { link.send({ t: 'full' }); setTimeout(() => link.close(), 300); return; }          // somebody else
    if (!s.token) { s.token = m.token || 't' + Math.random().toString(36).slice(2); s.names[1] = String(m.name || 'Friend').slice(0, 16); s.guestDeck = deckById(m.deck) || cleanCustom(m.custom) || decks[0]; s.deckIds[1] = s.guestDeck.id; }
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
    else if (m.t === 'emote') ui.showEmote(s.names[1] || 'Friend', String(m.text).slice(0, 40));
    else if (m.t === 'surrender' && s.game && s.game.winner === null) { s.game.win(0, 'Surrender'); s.game.sync(); }
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
        if (m.t === 'start') { if (m.rules && !m.resumed) { const t = rulesText(m.rules); if (t) toast('House rules: ' + t); } s.started = true; netbar(''); jset('guest', { code, ...info, t: Date.now() }); enterGame(); ui.onAgain = () => { $('#again').textContent = 'Waiting for friend…'; $('#again').disabled = true; s.link.send({ t: 'rematch' }); }; }
        else if (m.t === 'update') ui.enqueue(m.view, m.events);
        else if (m.t === 'ask') ui.prompt(m.req, m.view).then((answer) => s.link && s.link.send({ t: 'answer', rid: m.rid, answer }));
        else if (m.t === 'full') { toast('That room is already taken'); leaveToMenu(); }
        else if (m.t === 'rematch') toast('Your friend wants a rematch');
        else if (m.t === 'emote') ui.showEmote(ui.view ? ui.view.pl[1 - ui.view.me].name : 'Friend', String(m.text).slice(0, 40));
        else if (m.t === 'over' && !ui.view) leaveToMenu();
      },
      onDead: () => { if (s.dead || link !== s.link) return; if (s.started && !gameOver()) reconnect(); else if (!s.started && !silent) { toast('Disconnected from the room'); leaveToMenu(); } else if (!gameOver()) reconnect(); },
    });
    s.link = link; link.send({ t: 'join', name: info.name, deck: info.deck, custom: info.custom || null, token: info.token });
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
  try { await joinGame(code, { name: myName(), deck: deckId, custom: deckById(deckId).custom ? deckById(deckId) : null, token: 't' + Math.random().toString(36).slice(2) + Date.now().toString(36) }); }
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

function showStats() {
  const s = getStats(), hist = jget('history') || [], by = {};
  hist.forEach((g) => { const k = g.deck || '?'; (by[k] = by[k] || { w: 0, l: 0 })[g.won ? 'w' : 'l']++; });
  const nm = (id) => (deckById(id) || { name: id || 'Unknown deck' }).name;
  const rowsHtml = Object.entries(by).map(([k, v]) => `<tr><td>${nm(k)}</td><td>${v.w}W – ${v.l}L</td></tr>`).join('') || '<tr><td colspan="2">No games yet</td></tr>';
  const recent = hist.slice(0, 10).map((g) => `<tr><td>${g.won ? '✅ Win' : '❌ Loss'}</td><td>${nm(g.deck)} vs ${g.opp || '—'}</td><td>${g.turns} turns</td></tr>`).join('');
  const m = ui.modal(`<div class="dlg stats"><h3>Your record</h3><div class="sub">${s.w} wins · ${s.l} losses${s.w + s.l ? ` · ${Math.round(s.w / (s.w + s.l) * 100)}% win rate` : ''}</div><div class="rows"><h4>By deck</h4><table>${rowsHtml}</table>${recent ? `<h4>Recent games</h4><table>${recent}</table>` : ''}</div><div class="foot2"><button class="btn" id="sClear">Clear stats</button><button class="btn ok" id="sDone">Close</button></div></div>`);
  m.querySelector('#sDone').onclick = () => ui.closeModal(); m.querySelector('#sClear').onclick = () => { if (confirm('Clear all stats?')) { jdel('stats'); jdel('history'); showRecord(); ui.closeModal(); } };
}
document.getElementById('btnStats').onclick = () => { audio.sfx('click'); showStats(); };
window.__ui = ui;
window.__dbg = { get session() { return session; }, updateNow };
if (params.get('auto') === '1') setTimeout(() => startPractice(true), 600);   // test helper: bots play both sides
