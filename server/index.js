import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Profiles from './profiles.js';
import { Match } from './match.js';
import { MAPS } from '../src/shared/maps/index.js';

// FRONTLINE game server: static hosting for the built client (dist/), a health
// endpoint, and the realtime WebSocket service (matchmaking, private rooms,
// lobbies, authoritative matches and server-held profiles).

const PORT = Number(process.env.PORT || 8787);
const PROTOCOL_VERSION = 3;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

const conns = new Set();
const queue = [];
const rooms = new Map();

// ---------------- HTTP ----------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, online: conns.size, queue: queue.length, rooms: rooms.size, ...Profiles.stats() }));
    return;
  }
  if (!fs.existsSync(DIST)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Client not built. Run `npm run build`, or use `npm run dev` for development.'); return; }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

// ---------------- Rooms ----------------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; }

class Room {
  constructor(kind) {
    this.kind = kind; // 'quick' | 'private'
    this.code = newCode();
    this.players = []; // { conn, loadout, ready, vote }
    this.state = 'lobby';
    this.countdown = 0;
    this.match = null;
    rooms.set(this.code, this);
  }
  add(conn) {
    if (this.players.length >= 2 || this.state !== 'lobby') return false;
    const p = conn.profile;
    this.players.push({ conn, loadout: Profiles.loadoutAllowed(p, p.equipped ? { ...p.equipped, outfit: p.equipped.outfits?.[p.equipped.operator] || 'standard' } : null), ready: false, vote: null });
    conn.room = this;
    this.broadcast();
    return true;
  }
  remove(conn) {
    const i = this.players.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    if (this.match && !this.match.ended) { this.match.disconnected(conn); return; }
    this.players.splice(i, 1);
    conn.room = null;
    this.cancelCountdown();
    if (!this.players.length) this.close();
    else { this.players.forEach((p) => { p.ready = false; }); this.broadcast(); }
  }
  close() { clearInterval(this.cdTimer); this.match?.dispose(); rooms.delete(this.code); for (const p of this.players) p.conn.room = null; }
  state_() {
    return {
      code: this.code, kind: this.kind, state: this.state, countdown: this.countdown,
      players: this.players.map((p) => ({ id: p.conn.id, name: p.conn.profile.name, loadout: p.loadout, ready: p.ready, vote: p.vote, banner: p.loadout.banner })),
    };
  }
  broadcast() { const s = this.state_(); for (const p of this.players) p.conn.send('room', s); }
  onMessage(conn, msg) {
    const pl = this.players.find((p) => p.conn === conn);
    if (!pl) return;
    if (this.state === 'match') { this.match?.onMessage(conn, msg); return; }
    if (msg.type === 'loadout') { pl.loadout = Profiles.loadoutAllowed(conn.profile, msg.loadout); pl.ready = false; this.cancelCountdown(); this.broadcast(); }
    else if (msg.type === 'vote' && MAPS[msg.map]) { pl.vote = msg.map; this.broadcast(); }
    else if (msg.type === 'ready') {
      pl.ready = !!msg.ready;
      if (!pl.ready) this.cancelCountdown();
      if (this.players.length === 2 && this.players.every((p) => p.ready)) this.beginCountdown();
      this.broadcast();
    }
  }
  beginCountdown() {
    if (this.state === 'countdown') return;
    this.state = 'countdown'; this.countdown = 5;
    clearInterval(this.cdTimer);
    this.cdTimer = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) { clearInterval(this.cdTimer); this.launch(); }
      else this.broadcast();
    }, 1000);
    this.broadcast();
  }
  cancelCountdown() { if (this.state === 'countdown') { clearInterval(this.cdTimer); this.state = 'lobby'; this.countdown = 0; } }
  launch() {
    const votes = this.players.map((p) => p.vote).filter(Boolean);
    const pool = votes.length ? votes : Object.keys(MAPS);
    const map = pool[crypto.randomInt(pool.length)];
    this.state = 'match';
    this.match = new Match(this, this.players.map((p) => ({ conn: p.conn, loadout: p.loadout, name: p.conn.profile.name })), map);
    for (const ps of this.match.p) ps.send('start', this.match.startPayload(ps));
    this.broadcast();
  }
  grant(profile, stats) { return Profiles.grantMatch(profile, stats); }
  publicProfile(p) { return Profiles.publicProfile(p); }
  matchEnded() {
    // back to the lobby so the same pair can rematch
    this.match?.dispose();
    this.match = null;
    this.state = 'lobby';
    this.players = this.players.filter((p) => p.conn.ws.readyState === 1);
    for (const p of this.players) p.ready = false;
    if (!this.players.length) this.close(); else this.broadcast();
  }
}

function findMatchFor(conn) {
  for (const room of rooms.values()) {
    const ps = room.match?.p.find((x) => x.conn.profile?.token === conn.profile.token && !x.connected);
    if (ps) return { room, ps };
  }
  return null;
}

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const conn = {
    id: crypto.randomBytes(6).toString('hex'), ws, profile: null, room: null, rtt: 80, msgCount: 0,
    send(type, data = {}) { if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...data })); },
  };
  conns.add(conn);
  const rate = setInterval(() => { conn.msgCount = 0; }, 1000);

  ws.on('message', (raw) => {
    if (++conn.msgCount > 120) return; // flood guard
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ping') { conn.send('pong', { t: msg.t, server: Date.now() }); return; }
    if (msg.type === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) { conn.send('error', { msg: 'Client/server version mismatch — refresh the page.' }); return; }
      conn.profile = Profiles.getOrCreate(msg.token, msg.name, msg.link);
      conn.send('welcome', { id: conn.id, token: conn.profile.token, profile: Profiles.publicProfile(conn.profile) });
      const back = findMatchFor(conn);
      if (back) { conn.room = back.room; const pl = back.room.players.find((p) => p.conn.profile.token === conn.profile.token); if (pl) pl.conn = conn; back.room.match.reconnected(back.ps, conn); }
      return;
    }
    if (!conn.profile) return;
    if (msg.type === 'pongRtt') { conn.rtt = Math.max(0, Math.min(1000, +msg.rtt || 80)); return; }
    if (msg.type === 'req') { handleRequest(conn, msg); return; }
    switch (msg.type) {
      case 'queue': {
        if (conn.room || queue.includes(conn)) return;
        const other = queue.shift();
        if (other && other.ws.readyState === 1 && other !== conn) {
          const room = new Room('quick');
          room.add(other); room.add(conn);
        } else { queue.push(conn); conn.send('queued', { position: queue.length }); }
        return;
      }
      case 'cancelQueue': { const i = queue.indexOf(conn); if (i >= 0) queue.splice(i, 1); conn.send('unqueued', {}); return; }
      case 'createRoom': { if (conn.room) conn.room.remove(conn); const r = new Room('private'); r.add(conn); return; }
      case 'joinRoom': {
        const r = rooms.get(String(msg.code || '').toUpperCase());
        if (!r) { conn.send('error', { msg: 'Room not found. Check the code.' }); return; }
        if (r === conn.room) return;
        if (conn.room) conn.room.remove(conn);
        if (!r.add(conn)) conn.send('error', { msg: 'That room is full or already in a match.' });
        return;
      }
      case 'leaveRoom': { const i = queue.indexOf(conn); if (i >= 0) queue.splice(i, 1); conn.room?.remove(conn); return; }
      default: conn.room?.onMessage(conn, msg);
    }
  });

  ws.on('close', () => {
    clearInterval(rate);
    conns.delete(conn);
    const i = queue.indexOf(conn); if (i >= 0) queue.splice(i, 1);
    conn.room?.remove(conn);
  });
});

function handleRequest(conn, msg) {
  const p = conn.profile, d = msg.payload || {};
  let data;
  switch (msg.rtype) {
    case 'purchase': data = Profiles.purchase(p, d.kind, d.id); break;
    case 'equip': data = Profiles.equip(p, d.equipped); break;
    case 'claimDaily': data = Profiles.claimDaily(p, d.id); break;
    case 'practiceResult': data = Profiles.practiceResult(p, d.result || {}); break;
    case 'profile': data = { ok: true, profile: Profiles.publicProfile(p) }; break;
    case 'rename': p.name = String(d.name || '').slice(0, 16) || p.name; data = { ok: true, profile: Profiles.publicProfile(p) }; break;
    default: data = { ok: false, reason: 'Unknown request' };
  }
  conn.send('res', { id: msg.id, data });
}

server.listen(PORT, () => {
  console.log(`FRONTLINE server · http://localhost:${PORT} · ws path /ws · protocol v${PROTOCOL_VERSION}`);
  if (!fs.existsSync(DIST)) console.log('  (dist/ not found — static client disabled; use `npm run dev` on :5173 which proxies /ws here)');
});
