e = open("js/engine.js", encoding="utf-8").read()


def rep(a, b):
    global e
    assert a in e, a[:90]
    e = e.replace(a, b, 1)


# stateful RNG so a restored game continues identically
rep("this.decks = decks; this.names = names; this.ctl = ctl; this.rng = mulberry32(seed); this.maxTurns = maxTurns;",
    "this.decks = decks; this.names = names; this.ctl = ctl; this.rs = seed >>> 0; this.maxTurns = maxTurns; this.onCheckpoint = null;")
rep("  rnd() { return this.rng(); }",
    """  rnd() { let t = (this.rs = (this.rs + 0x6D2B79F5) | 0); t = Math.imul(t ^ t >>> 15, 1 | t); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  /** everything needed to continue this game later (taken between actions) */
  snapshot() { return JSON.parse(JSON.stringify({ rs: this.rs, uidc: this.uidc, pkc: this.pkc, turnNo: this.turnNo, cur: this.cur, stadium: this.stadium, stadiumOwner: this.stadiumOwner, koOnTurn: this.koOnTurn, itemLock: this.itemLock, names: this.names, decks: this.decks, pl: this.pl, maxTurns: this.maxTurns })); }
  static restore(s, ctl) {
    const g = new Game({ decks: s.decks, names: s.names, ctl, seed: 1, maxTurns: s.maxTurns });
    Object.assign(g, { rs: s.rs, uidc: s.uidc, pkc: s.pkc, turnNo: s.turnNo, cur: s.cur, stadium: s.stadium, stadiumOwner: s.stadiumOwner, koOnTurn: s.koOnTurn, itemLock: s.itemLock, pl: JSON.parse(JSON.stringify(s.pl)) });
    return g;
  }""")
rep("""  async run() {
    try { await this.setup(); while (this.winner === null) { if (this.turnNo >= this.maxTurns) { this.win(this.pl[0].prizes.length <= this.pl[1].prizes.length ? 0 : 1, 'Turn limit'); break; } await this.turn(); } }""",
    """  async run({ resume = false } = {}) {
    try {
      if (resume) await this.sync(); else await this.setup();
      let first = resume;
      while (this.winner === null) { if (this.turnNo >= this.maxTurns) { this.win(this.pl[0].prizes.length <= this.pl[1].prizes.length ? 0 : 1, 'Turn limit'); break; } await this.turn(first); first = false; }
    }""")
rep("""  async turn() {
    const p = this.cur, me = this.pl[p]; this.turnNo++; me.turns++;
    me.sup = me.en = me.ret = me.stad = false; me.flags = {};
    this.inPlay(p).forEach((pk) => { pk.used = {}; });
    this.ev('turn', { p, turnNo: this.turnNo }); this.log(`— ${me.name}'s turn —`);
    if (!me.deck.length) { this.win(1 - p, 'Deck out'); return; }
    this.draw(p, 1); await this.sync();""",
    """  async turn(resume = false) {
    const p = this.cur, me = this.pl[p];
    if (!resume) {
      this.turnNo++; me.turns++;
      me.sup = me.en = me.ret = me.stad = false; me.flags = {};
      this.inPlay(p).forEach((pk) => { pk.used = {}; });
      this.ev('turn', { p, turnNo: this.turnNo }); this.log(`— ${me.name}'s turn —`);
      if (!me.deck.length) { this.win(1 - p, 'Deck out'); return; }
      this.draw(p, 1); await this.sync();
    } else { this.ev('turn', { p, turnNo: this.turnNo }); this.log('— Game resumed —'); await this.sync(); }""")
rep("      const legal = this.legal(p);\n      const why = {};", "      if (this.onCheckpoint) this.onCheckpoint(this.snapshot());\n      const legal = this.legal(p);\n      const why = {};")
open("js/engine.js", "w", encoding="utf-8").write(e)

n = open("js/net.js", encoding="utf-8").read()
a = n.index("/** Create a room."); b = n.index("/** Join a room by code.")
n = n[:a] + r'''/** Create a room. Pass `code` to re-open an existing room (after a page reload). onReady(code) fires when registered; onConn(conn) per incoming connection. */
export function openHost({ code: want, onReady, onConn, onError }) {
  let peer = null, tries = 0, closed = false;
  const start = () => {
    if (!window.Peer) { onError(new Error('Networking library failed to load. Check your connection and reload.')); return; }
    const code = want || makeCode(); peer = new window.Peer(ROOM_PREFIX + code, peerOpts());
    peer.on('open', () => onReady(code));
    peer.on('connection', (c) => onConn(c));
    peer.on('error', (e) => {
      if (closed) return;
      if (e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) { /* ignore */ } if (want && tries++ < 45) setTimeout(start, 2000); else if (!want && tries++ < 6) start(); else onError(e); }
      else onError(e);
    });
    peer.on('disconnected', () => { if (!closed && peer && !peer.destroyed) try { peer.reconnect(); } catch (e) { /* ignore */ } });
  };
  start();
  return { close() { closed = true; try { peer && peer.destroy(); } catch (e) { /* ignore */ } } };
}

''' + n[b:]
a = n.index("/** Engine controller that talks to a remote player. */")
n = n[:a] + r'''/** Engine controller that talks to a remote player. Can be re-attached to a new connection after a drop. */
export class RemoteController {
  constructor(link) { this.link = link; this.rid = 0; this.pending = new Map(); this.cur = null; this.lastView = null; }
  update(view, events) { this.lastView = view; this.link.send({ t: 'update', view, events }); }
  ask(req, view) { return new Promise((resolve) => { const rid = ++this.rid; this.pending.set(rid, resolve); this.cur = { rid, req, view }; this.lastView = view; this.link.send({ t: 'ask', rid, req, view }); }); }
  answer(m) { const r = this.pending.get(m.rid); if (r) { this.pending.delete(m.rid); if (this.cur && this.cur.rid === m.rid) this.cur = null; r(m.answer); } }
  rebind(link) { this.link = link; if (this.lastView) link.send({ t: 'update', view: this.lastView, events: [] }); if (this.cur && this.pending.has(this.cur.rid)) link.send({ t: 'ask', rid: this.cur.rid, req: this.cur.req, view: this.cur.view }); }
}
'''
open("js/net.js", "w", encoding="utf-8").write(n)

u = open("js/ui.js", encoding="utf-8").read()
u = u.replace("    const e = $('#end'); audio.sfx(won ? 'win' : 'lose');", "    this.onGameOver && this.onGameOver(); const e = $('#end'); audio.sfx(won ? 'win' : 'lose');", 1)
open("js/ui.js", "w", encoding="utf-8").write(u)
print("save patch ok")
