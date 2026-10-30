// Room codes + WebRTC transport (PeerJS). Host is authoritative: it runs the rules engine and sends each player their own view.
import { ICE_SERVERS, ROOM_PREFIX } from './config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';           // no 0/O/1/I to avoid typos on phones
export const makeCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[01OI]/g, '').slice(0, 5);
const peerOpts = () => ({ debug: 1, config: { iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan' } });

/** Create a room. Calls onReady(code) once the code is registered; onConn(conn) for each incoming connection. */
export function openHost({ onReady, onConn, onError }) {
  let peer = null, tries = 0, closed = false;
  const start = () => {
    if (!window.Peer) { onError(new Error('Networking library failed to load. Check your connection and reload.')); return; }
    const code = makeCode(); peer = new window.Peer(ROOM_PREFIX + code, peerOpts());
    peer.on('open', () => onReady(code));
    peer.on('connection', (c) => onConn(c));
    peer.on('error', (e) => { if (e.type === 'unavailable-id' && tries++ < 6) { peer.destroy(); start(); } else if (!closed) onError(e); });
    peer.on('disconnected', () => { if (!closed && peer && !peer.destroyed) try { peer.reconnect(); } catch (e) { /* ignore */ } });
  };
  start();
  return { close() { closed = true; try { peer && peer.destroy(); } catch (e) { /* ignore */ } } };
}

/** Join a room by code. Resolves with the open connection; rejects with a friendly Error. */
export function joinRoom(code, { onFail }) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) return reject(new Error('Networking library failed to load. Check your connection and reload.'));
    const peer = new window.Peer(undefined, peerOpts()); let done = false;
    const fail = (m) => { if (done) return; done = true; try { peer.destroy(); } catch (e) { /* ignore */ } reject(new Error(m)); };
    const timer = setTimeout(() => fail("Couldn't connect. Check the code, or try both players on Wi-Fi (some mobile networks block direct connections)."), 20000);
    peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `No room "${code}" found. Ask your friend for a fresh code.` : 'Connection error: ' + (e.type || e.message)));
    peer.on('open', () => {
      const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); resolve({ conn, peer }); });
      conn.on('error', () => fail('Connection failed.'));
    });
  });
}

/** Wraps a data connection: JSON messages, heartbeat, and a dead-connection callback. */
export function wrap(conn, { onMsg, onDead }) {
  let last = Date.now(), dead = false;
  const die = (why) => { if (dead) return; dead = true; clearInterval(iv); onDead && onDead(why); };
  conn.on('data', (m) => { last = Date.now(); if (m && m.t === 'ping') return; onMsg(m); });
  conn.on('close', () => die('closed')); conn.on('error', () => die('error'));
  const iv = setInterval(() => { try { conn.send({ t: 'ping' }); } catch (e) { /* ignore */ } if (Date.now() - last > 30000) die('timeout'); }, 4000);
  return { send: (m) => { try { conn.send(m); } catch (e) { /* ignore */ } }, close: () => { dead = true; clearInterval(iv); try { conn.close(); } catch (e) { /* ignore */ } } };
}

/** Engine controller that talks to a remote player. */
export class RemoteController {
  constructor(link) { this.link = link; this.rid = 0; this.pending = new Map(); }
  update(view, events) { this.link.send({ t: 'update', view, events }); }
  ask(req, view) { return new Promise((resolve) => { const rid = ++this.rid; this.pending.set(rid, resolve); this.link.send({ t: 'ask', rid, req, view }); }); }
  answer(m) { const r = this.pending.get(m.rid); if (r) { this.pending.delete(m.rid); r(m.answer); } }
}
