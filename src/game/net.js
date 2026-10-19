import { Emitter } from '../engine/emitter.js';
import { settings } from '../state/settings.js';
import { profile } from '../state/profile.js';

// WebSocket client for the FRONTLINE game server. Handles the connection
// lifecycle, request/response calls (profile, purchases), latency and events.

export const PROTOCOL_VERSION = 3;

function defaultUrl() {
  const custom = settings.get('serverUrl');
  if (custom) return custom;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

class Net extends Emitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.rtt = 0;
    this.pending = new Map();
    this.reqId = 1;
    this.serverTimeOffset = 0;
    this.room = null;
  }

  get url() { return defaultUrl(); }

  connect(timeout = 4000) {
    if (this.connected) return Promise.resolve(this);
    if (this._connecting) return this._connecting;
    this._connecting = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this._connecting = null; reject(new Error('Invalid server URL')); return; }
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); this._connecting = null; reject(new Error('Connection timed out')); }, timeout);
      ws.onopen = () => {
        const p = profile.data;
        this.send('hello', { v: PROTOCOL_VERSION, token: p.token, name: p.name || 'OPERATOR', link: p.linked ? null : profile.exportForLink() });
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'welcome') {
          clearTimeout(timer);
          this.connected = true; this.id = msg.id; this._connecting = null;
          profile.data.token = msg.token;
          profile.remote = this;
          if (msg.profile) profile.applyServerProfile(msg.profile);
          this.startPing();
          this.emit('status', true);
          resolve(this);
        }
        this.handle(msg);
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.connected;
        this.connected = false; this._connecting = null;
        clearInterval(this._ping);
        for (const [, p] of this.pending) p.reject(new Error('Disconnected'));
        this.pending.clear();
        if (profile.remote === this) profile.remote = null;
        this.emit('status', false);
        if (was) this.emit('disconnected');
        else reject(new Error('Server unreachable'));
      };
    });
    return this._connecting;
  }

  disconnect() { try { this.ws?.close(); } catch { /* */ } }

  send(type, data = {}) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type, ...data }));
  }

  request(type, payload = {}) {
    if (!this.connected) return Promise.reject(new Error('Offline'));
    const id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send('req', { id, rtype: type, payload });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('Request timed out')); } }, 6000);
    });
  }

  startPing() {
    clearInterval(this._ping);
    this._ping = setInterval(() => this.send('ping', { t: performance.now() }), 2000);
  }

  /** Estimated server time (ms) for lag compensation timestamps. */
  serverNow() { return performance.now() + this.serverTimeOffset; }

  handle(msg) {
    if (msg.type === 'pong') {
      const rtt = performance.now() - msg.t;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
      this.serverTimeOffset = msg.server + rtt / 2 - performance.now();
      this.send('pongRtt', { rtt: Math.round(this.rtt) });
      this.emit('rtt', this.rtt);
      return;
    }
    if (msg.type === 'res') {
      const p = this.pending.get(msg.id);
      if (p) { this.pending.delete(msg.id); p.resolve(msg.data); }
      return;
    }
    if (msg.type === 'room') this.room = msg;
    this.emit(msg.type, msg);
    this.emit('message', msg);
  }
}

export const net = new Net();
